let fs;
try {
  fs = require('original-fs');
} catch (_) {
  fs = require('fs');
}
const path = require('path');
const crypto = require('crypto');
const { execSync, execFileSync, spawn } = require('child_process');
const { MARKER_COMMENT, validateAgyRoot } = require('./agyScanner');

const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
function sleepSyncMs(ms) {
  Atomics.wait(sleepBuffer, 0, 0, ms);
}

const BLOCK_SIZE = 4 * 1024 * 1024; // 4MB block size for ASAR integrity

function computeIntegrity(buffer) {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const blocks = [];
  if (buffer.length === 0) {
    blocks.push(crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex'));
  } else {
    for (let offset = 0; offset < buffer.length; offset += BLOCK_SIZE) {
      const slice = buffer.subarray(offset, Math.min(offset + BLOCK_SIZE, buffer.length));
      blocks.push(crypto.createHash('sha256').update(slice).digest('hex'));
    }
  }
  return {
    algorithm: 'SHA256',
    hash,
    blockSize: BLOCK_SIZE,
    blocks
  };
}

/**
 * Reads an ASAR archive into an in-memory tree of metadata + buffers.
 */
function readAsarArchive(asarFilePath) {
  const fullBuf = fs.readFileSync(asarFilePath);
  const headerPickleSize = fullBuf.readUInt32LE(4);
  const jsonLen = fullBuf.readUInt32LE(12);
  const baseOffset = 8 + headerPickleSize;
  const headerJsonStr = fullBuf.subarray(16, 16 + jsonLen).toString('utf8');
  const header = JSON.parse(headerJsonStr);

  return {
    header,
    baseOffset,
    fullBuf
  };
}

/**
 * Rebuilds an ASAR archive buffer after modifying specific internal file entries.
 * `replacements` is a Map or Object mapping slash-separated path (e.g. "dist/preload.js") -> Buffer.
 */
function rebuildAsarArchive(asarData, replacements) {
  const { header, baseOffset, fullBuf } = asarData;
  const headerClone = JSON.parse(JSON.stringify(header));
  const payloadChunks = [];
  let currentOffset = 0;

  function walk(node, currentPath) {
    if (!node || !node.files) return;
    for (const [name, entry] of Object.entries(node.files)) {
      const relPath = currentPath ? `${currentPath}/${name}` : name;
      if (entry.files) {
        walk(entry, relPath);
      } else if (entry.unpacked || entry.link !== undefined) {
        // Unpacked files stay on disk in app.asar.unpacked; symlinks carry `link` only
        continue;
      } else if (entry.offset !== undefined) {
        let fileBuf;
        if (Object.prototype.hasOwnProperty.call(replacements, relPath)) {
          fileBuf = Buffer.isBuffer(replacements[relPath])
            ? replacements[relPath]
            : Buffer.from(String(replacements[relPath]), 'utf8');
        } else {
          const origOffset = baseOffset + Number(entry.offset);
          fileBuf = fullBuf.subarray(origOffset, origOffset + entry.size);
        }

        entry.size = fileBuf.length;
        entry.offset = String(currentOffset);
        if (entry.integrity) {
          entry.integrity = computeIntegrity(fileBuf);
        }
        payloadChunks.push(fileBuf);
        currentOffset += fileBuf.length;
      }
    }
  }

  walk(headerClone, '');

  const newJsonBuf = Buffer.from(JSON.stringify(headerClone), 'utf8');
  const jsonLen = newJsonBuf.length;
  const alignedJsonLen = Math.ceil(jsonLen / 4) * 4;
  const headerPickleSize = 8 + alignedJsonLen;
  const stringPickleSize = 4 + alignedJsonLen;

  const preamble = Buffer.alloc(16 + alignedJsonLen, 0);
  preamble.writeUInt32LE(4, 0);
  preamble.writeUInt32LE(headerPickleSize, 4);
  preamble.writeUInt32LE(stringPickleSize, 8);
  preamble.writeUInt32LE(jsonLen, 12);
  newJsonBuf.copy(preamble, 16);

  return Buffer.concat([preamble, ...payloadChunks]);
}

/**
 * Extracts a specific file from an in-memory ASAR object as a UTF-8 string.
 */
function readAsarFileUtf8(asarData, relPath) {
  const parts = relPath.split('/').filter(Boolean);
  let cur = asarData.header;
  for (const part of parts) {
    if (!cur || !cur.files || !cur.files[part]) {
      throw new Error(`Không tìm thấy file "${relPath}" trong app.asar.`);
    }
    cur = cur.files[part];
  }
  const start = asarData.baseOffset + Number(cur.offset);
  return asarData.fullBuf.subarray(start, start + cur.size).toString('utf8');
}

/**
 * Builds the Main-Process IPC hook snippet injected into `dist/utils.js`.
 */
function buildMainProcessHookCode() {
  return `
${MARKER_COMMENT}
;(function installAgyCustomUiMainHooks() {
  try {
    if (global.__agyCustomUiMainHooksInstalled) return;
    global.__agyCustomUiMainHooksInstalled = true;
    const electron = require('electron');
    const fs = require('fs');
    const path = require('path');
    const ipcMain = electron.ipcMain;
    const dialog = electron.dialog;
    if (!ipcMain) return;

    const getCustomUiDir = () => {
      // __dirname inside app.asar is <Root>/resources/app.asar/dist
      return path.resolve(__dirname, '..', '..', 'agy-custom-ui');
    };

    const getMimeType = (filePath) => {
      const ext = path.extname(String(filePath || '')).toLowerCase();
      const map = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.ogg': 'audio/ogg',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.flac': 'audio/flac',
        '.m4a': 'audio/mp4'
      };
      return map[ext] || 'application/octet-stream';
    };

    ipcMain.handle('agy-custom-ui:get-bundle', async () => {
      try {
        const uiDir = getCustomUiDir();
        const configPath = path.join(uiDir, 'config.json');
        const presetsPath = path.join(uiDir, 'presets.js');
        const runtimePath = path.join(uiDir, 'agyInjectorRuntime.js');

        const config = fs.existsSync(configPath)
          ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
          : null;
        const presetsCode = fs.existsSync(presetsPath)
          ? fs.readFileSync(presetsPath, 'utf8')
          : '';
        const runtimeCode = fs.existsSync(runtimePath)
          ? fs.readFileSync(runtimePath, 'utf8')
          : '';

        return { ok: true, config, presetsCode, runtimeCode, uiDir };
      } catch (err) {
        return { ok: false, error: String(err && err.message ? err.message : err) };
      }
    });

    ipcMain.handle('agy-custom-ui:save-config', async (_event, newConfig) => {
      try {
        const uiDir = getCustomUiDir();
        if (!fs.existsSync(uiDir)) fs.mkdirSync(uiDir, { recursive: true });
        const configPath = path.join(uiDir, 'config.json');
        fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf8');

        // Notify all open windows so live changes sync immediately
        const allWins = [
          ...(typeof electron.BaseWindow?.getAllWindows === 'function' ? electron.BaseWindow.getAllWindows() : []),
          ...(typeof electron.BrowserWindow?.getAllWindows === 'function' ? electron.BrowserWindow.getAllWindows() : [])
        ];
        for (const w of allWins) {
          try {
            const wc = w?.webContents || (typeof exports.getHubWebContents === 'function' ? exports.getHubWebContents(w) : null);
            if (wc && !wc.isDestroyed?.()) {
              wc.send('agy-custom-ui:config-updated', newConfig);
            }
          } catch (_) {}
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err && err.message ? err.message : err) };
      }
    });

    ipcMain.handle('agy-custom-ui:read-media', async (_event, assetRef) => {
      try {
        if (!assetRef || typeof assetRef !== 'string') {
          return { ok: false, error: 'Empty asset reference' };
        }
        const uiDir = getCustomUiDir();
        let resolvedPath = assetRef;
        if (!path.isAbsolute(assetRef) || !fs.existsSync(assetRef)) {
          const candidates = [
            path.join(uiDir, assetRef),
            path.join(uiDir, 'starter-pack', assetRef),
            path.join(uiDir, 'starter-pack', 'music', path.basename(assetRef)),
            path.join(uiDir, 'starter-pack', 'wallpapers', path.basename(assetRef)),
            path.join(uiDir, 'user-media', path.basename(assetRef))
          ];
          const found = candidates.find((p) => fs.existsSync(p));
          if (found) resolvedPath = found;
        }
        if (!fs.existsSync(resolvedPath)) {
          return { ok: false, error: 'File not found: ' + resolvedPath };
        }
        const buf = fs.readFileSync(resolvedPath);
        const mime = getMimeType(resolvedPath);
        return {
          ok: true,
          mime,
          base64: buf.toString('base64'),
          size: buf.length
        };
      } catch (err) {
        return { ok: false, error: String(err && err.message ? err.message : err) };
      }
    });

    ipcMain.handle('agy-custom-ui:pick-file', async (_event, kind) => {
      try {
        const filters = kind === 'audio'
          ? [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a'] }]
          : [{ name: 'Wallpaper / Video / GIF', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'mp4', 'webm'] }];
        const res = await dialog.showOpenDialog({
          title: kind === 'audio' ? 'Chọn file nhạc nền cho AGY' : 'Chọn Hình nền / Ảnh động / Video nền cho AGY',
          properties: ['openFile'],
          filters
        });
        if (res.canceled || !res.filePaths || res.filePaths.length === 0) {
          return { ok: false, canceled: true };
        }
        const srcPath = res.filePaths[0];
        const uiDir = getCustomUiDir();
        const userMediaDir = path.join(uiDir, 'user-media');
        if (!fs.existsSync(userMediaDir)) fs.mkdirSync(userMediaDir, { recursive: true });
        const safeName = Date.now() + '-' + path.basename(srcPath);
        const destPath = path.join(userMediaDir, safeName);
        fs.copyFileSync(srcPath, destPath);
        return {
          ok: true,
          filePath: destPath,
          relativePath: 'user-media/' + safeName,
          fileName: path.basename(srcPath),
          mime: getMimeType(destPath)
        };
      } catch (err) {
        return { ok: false, error: String(err && err.message ? err.message : err) };
      }
    });
  } catch (e) {
    console.error('[AGY-UI-Studio Main Hook Error]', e);
  }
})();
`;
}

/**
 * Builds the Preload-Process hook snippet injected into \`dist/preload.js\`.
 */
function buildPreloadHookCode() {
  return `
${MARKER_COMMENT}
;(function installAgyCustomUiPreloadHook() {
  try {
    if (typeof isRemoteWindow !== 'undefined' && isRemoteWindow) return;
    const g = globalThis;
    if (g.top && g.self && g.top !== g.self) return;

    const bridge = {
      getBundle: () => electron_1.ipcRenderer.invoke('agy-custom-ui:get-bundle'),
      saveConfig: (cfg) => electron_1.ipcRenderer.invoke('agy-custom-ui:save-config', cfg),
      readMedia: (ref) => electron_1.ipcRenderer.invoke('agy-custom-ui:read-media', ref),
      pickFile: (kind) => electron_1.ipcRenderer.invoke('agy-custom-ui:pick-file', kind),
      onConfigUpdated: (callback) => {
        const handler = (_event, cfg) => callback(cfg);
        electron_1.ipcRenderer.on('agy-custom-ui:config-updated', handler);
        return () => electron_1.ipcRenderer.removeListener('agy-custom-ui:config-updated', handler);
      }
    };

    try {
      electron_1.contextBridge.exposeInMainWorld('agyCustomBridge', bridge);
    } catch (_) {}

    let injected = false;
    let injecting = false;
    const injectIntoMainWorld = async () => {
      if (injected || injecting) return;
      injecting = true;
      try {
        const bundle = await bridge.getBundle();
        if (!bundle || !bundle.ok || !bundle.runtimeCode) {
          injecting = false;
          return;
        }
        const initScript =
          bundle.presetsCode +
          '\\n;window.__AGY_INITIAL_CUSTOM_CONFIG__ = ' +
          JSON.stringify(bundle.config || null) +
          ';\\n' +
          bundle.runtimeCode;
        await electron_1.webFrame.executeJavaScript(initScript);
        injected = true;
      } catch (err) {
        console.error('[AGY-UI-Studio Preload Inject Error]', err);
      } finally {
        injecting = false;
      }
    };

    if (g.document && (g.document.readyState === 'interactive' || g.document.readyState === 'complete')) {
      void injectIntoMainWorld();
    } else {
      if (g.document && typeof g.document.addEventListener === 'function') {
        g.document.addEventListener('DOMContentLoaded', () => void injectIntoMainWorld(), { once: true });
      }
      if (typeof g.addEventListener === 'function') {
        g.addEventListener('DOMContentLoaded', () => void injectIntoMainWorld(), { once: true });
        g.addEventListener('load', () => void injectIntoMainWorld(), { once: true });
      }
    }
  } catch (e) {
    console.error('[AGY-UI-Studio Preload Hook Error]', e);
  }
})();
`;
}

function copyDirRecursive(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      let shouldCopy = true;
      if (fs.existsSync(destPath)) {
        try {
          const srcStat = fs.statSync(srcPath);
          const destStat = fs.statSync(destPath);
          if (srcStat.size === destStat.size && Math.floor(srcStat.mtimeMs) === Math.floor(destStat.mtimeMs)) {
            shouldCopy = false;
          }
        } catch (_) {}
      }
      if (shouldCopy) {
        fs.copyFileSync(srcPath, destPath);
        try {
          const srcStat = fs.statSync(srcPath);
          fs.utimesSync(destPath, srcStat.atime, srcStat.mtime);
        } catch (_) {}
      }
    }
  }
}

/**
 * Pure helper: classifies a list of Windows Antigravity.exe process records
 * into GUI Main processes vs Chromium child processes while ignoring
 * ELECTRON_RUN_AS_NODE sidecar helpers (e.g. `--import=...`) and other installs (like Antigravity IDE).
 */
function classifyAgyProcesses(records, exePath = null) {
  const targetExe = exePath ? path.resolve(String(exePath)).toLowerCase() : null;
  const matched = [];
  for (const rec of Array.isArray(records) ? records : []) {
    if (!rec || typeof rec !== 'object') continue;
    const pid = Number(rec.pid);
    const ppid = Number(rec.ppid);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    const recExe = rec.exe ? path.resolve(String(rec.exe)).toLowerCase() : '';
    if (targetExe) {
      if (!recExe || recExe !== targetExe) continue;
    } else if (recExe.includes('antigravity ide')) {
      continue;
    }
    matched.push({
      pid,
      ppid: Number.isFinite(ppid) ? ppid : 0,
      exe: recExe,
      cmd: String(rec.cmd || ''),
      createdMs: Number(rec.createdMs) || 0
    });
  }

  const chromiumChildren = [];
  const chromiumParentPids = new Set();
  for (const p of matched) {
    if (/(?:^|\s)--type=/i.test(p.cmd)) {
      chromiumChildren.push(p);
      if (p.ppid > 0) chromiumParentPids.add(p.ppid);
    }
  }

  const guiMainProcs = [];
  for (const p of matched) {
    const isChromiumChild = /(?:^|\s)--type=/i.test(p.cmd);
    if (isChromiumChild) continue;
    const isRunAsNodeHelper =
      /(?:^|\s)(?:--import=|--eval\b|-e\b)/i.test(p.cmd) ||
      /(?:\\|\/)node_modules(?:\\|\/)/i.test(p.cmd);
    if (chromiumParentPids.has(p.pid) || !isRunAsNodeHelper) {
      guiMainProcs.push(p);
    }
  }

  const guiMainPids = guiMainProcs.map((p) => p.pid);
  const chromiumChildPids = chromiumChildren.map((p) => p.pid);
  const startCandidates = (guiMainProcs.length > 0 ? guiMainProcs : chromiumChildren)
    .map((p) => p.createdMs)
    .filter((ms) => ms > 0);
  const oldestGuiStartMs = startCandidates.length > 0 ? Math.min(...startCandidates) : 0;

  return {
    isRunning: guiMainPids.length > 0 || chromiumChildPids.length > 0,
    guiMainPids,
    chromiumChildPids,
    oldestGuiStartMs
  };
}

/**
 * Determines whether a running Antigravity GUI instance started BEFORE `asarMtimeMs`,
 * meaning its Main Process still has the old pre-patch `app.asar` loaded in memory.
 */
function isRunningAgyStale(runningInfo, asarMtimeMs) {
  if (!runningInfo || !runningInfo.isRunning) return false;
  if (!runningInfo.oldestGuiStartMs || !asarMtimeMs) return false;
  return runningInfo.oldestGuiStartMs < asarMtimeMs - 1000;
}

/**
 * Inspects running Antigravity.exe GUI processes on Windows for a given `exePath`.
 */
function getRunningAgyGuiInfo(exePath = null) {
  const empty = { isRunning: false, guiMainPids: [], chromiumChildPids: [], oldestGuiStartMs: 0 };
  if (process.platform !== 'win32') return empty;
  try {
    const psCmd = [
      "$procs = @(Get-CimInstance Win32_Process -Filter \"Name='Antigravity.exe'\" -ErrorAction SilentlyContinue | ForEach-Object {",
      "  $ms = 0;",
      "  if ($_.CreationDate) { try { $ms = ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } catch {} }",
      "  [PSCustomObject]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; exe = [string]$_.ExecutablePath; cmd = [string]$_.CommandLine; createdMs = [int64]$ms }",
      "});",
      "ConvertTo-Json -InputObject $procs -Compress"
    ].join(' ');
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psCmd],
      { encoding: 'utf8', timeout: 4500, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const trimmed = String(out || '').trim();
    if (!trimmed) return empty;
    const parsed = JSON.parse(trimmed);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return classifyAgyProcesses(list, exePath);
  } catch (_) {
    // Fallback to tasklist only when no specific non-real test exePath is targeted
    if (exePath && !fs.existsSync(exePath)) return empty;
    try {
      const out = execSync('tasklist /FI "IMAGENAME eq Antigravity.exe" /NH', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      const isRunning = Boolean(out && out.toLowerCase().includes('antigravity.exe'));
      return { ...empty, isRunning };
    } catch (__) {
      return empty;
    }
  }
}

/**
 * Closes running Antigravity.exe GUI processes (main + renderer/gpu/utility tree)
 * cleanly for the targeted installation so `app.asar` can be written and reloaded fresh.
 */
function stopRunningAgyGui(exePath = null, preFetchedInfo = null) {
  if (process.platform !== 'win32') return { wasRunning: false, closed: false };
  const info = preFetchedInfo || getRunningAgyGuiInfo(exePath);
  if (!info.isRunning) return { wasRunning: false, closed: false };

  const pidsToKillTree = [...info.guiMainPids];
  const pidsToKillSingle = [...info.chromiumChildPids];

  if (pidsToKillTree.length > 0 || pidsToKillSingle.length > 0) {
    for (const pid of pidsToKillTree) {
      try {
        execFileSync('taskkill.exe', ['/F', '/T', '/PID', String(pid)], {
          stdio: 'ignore',
          timeout: 4000
        });
      } catch (_) {}
    }
    for (const pid of pidsToKillSingle) {
      try {
        execFileSync('taskkill.exe', ['/F', '/PID', String(pid)], {
          stdio: 'ignore',
          timeout: 3000
        });
      } catch (_) {}
    }
  } else {
    try {
      execSync('taskkill /F /IM Antigravity.exe', { stdio: 'ignore' });
    } catch (_) {}
  }

  for (let attempt = 0; attempt < 14; attempt++) {
    sleepSyncMs(250);
    const check = getRunningAgyGuiInfo(exePath);
    if (!check.isRunning) {
      return { wasRunning: true, closed: true };
    }
  }
  return { wasRunning: true, closed: true };
}

/**
 * Legacy fallback kill if Windows still holds a file lock on app.asar after targeted GUI shutdown.
 */
function ensureAgyNotLockingAsar(autoClose = false) {
  if (process.platform !== 'win32') return { wasRunning: false, closed: false };
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq Antigravity.exe" /NH', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const isRunning = out && out.toLowerCase().includes('antigravity.exe');
    if (isRunning && autoClose) {
      execSync('taskkill /F /IM Antigravity.exe', { stdio: 'ignore' });
      return { wasRunning: true, closed: true };
    }
    return { wasRunning: Boolean(isRunning), closed: false };
  } catch (_) {
    return { wasRunning: false, closed: false };
  }
}

function relaunchAgyApp(exePath) {
  if (!exePath || !fs.existsSync(exePath)) return false;
  try {
    const child = spawn(exePath, [], {
      cwd: path.dirname(exePath),
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Writes a buffer to `asarPath` safely on Windows using `original-fs` and `process.noAsar = true`.
 * Crucially, if `app.asar` actually changes while Antigravity GUI is running (e.g. right after an AGY update),
 * we proactively close Antigravity GUI BEFORE writing and relaunch it afterward — because on Windows
 * `fs.writeFileSync` often succeeds without throwing EBUSY while leaving the running Main Process
 * stuck on the old unpatched `dist/utils.js` and stale in-memory ASAR header cache!
 * Likewise, if `app.asar` on disk already matches `dataBuffer` but the running Antigravity GUI started
 * BEFORE `app.asar` was patched, we automatically restart that stale instance.
 */
function writeAsarSafely(asarPath, dataBuffer, options = {}) {
  const { autoRestartAgy = true, exePath = null, forceRestartIfRunning = false } = options;
  const prevNoAsar = process.noAsar;
  process.noAsar = true;
  try {
    let existingIdentical = false;
    let existingMtimeMs = 0;
    if (fs.existsSync(asarPath)) {
      try {
        existingMtimeMs = fs.statSync(asarPath).mtimeMs;
        const existingBuf = fs.readFileSync(asarPath);
        if (existingBuf.length === dataBuffer.length && Buffer.compare(existingBuf, dataBuffer) === 0) {
          existingIdentical = true;
        }
      } catch (_) {}
    }

    const runningInfo = autoRestartAgy ? getRunningAgyGuiInfo(exePath) : { isRunning: false, oldestGuiStartMs: 0 };

    // Case 1: app.asar on disk is already byte-for-byte identical to dataBuffer
    if (existingIdentical) {
      if (
        autoRestartAgy &&
        runningInfo.isRunning &&
        (forceRestartIfRunning || isRunningAgyStale(runningInfo, existingMtimeMs))
      ) {
        stopRunningAgyGui(exePath, runningInfo);
        sleepSyncMs(250);
        const relaunched = relaunchAgyApp(exePath);
        return { method: 'restart-stale-agy', restartedAgy: relaunched, needsRestart: !relaunched };
      }
      return { method: 'hot-sync-resources', restartedAgy: false, needsRestart: false };
    }

    // Case 2: app.asar must be updated on disk AND Antigravity GUI is currently running -> stop FIRST, write, then relaunch!
    const writeWithRetries = (allowForceFallback) => {
      let lastErr = null;
      for (let attempt = 0; attempt < 12; attempt++) {
        try {
          fs.writeFileSync(asarPath, dataBuffer);
          return true;
        } catch (retryErr) {
          lastErr = retryErr;
          if (allowForceFallback && attempt === 4) {
            ensureAgyNotLockingAsar(true);
          }
          sleepSyncMs(350);
        }
      }
      throw lastErr;
    };

    if (runningInfo.isRunning && autoRestartAgy) {
      stopRunningAgyGui(exePath, runningInfo);
      writeWithRetries(true);
      const relaunched = relaunchAgyApp(exePath);
      return { method: 'restart-and-write', restartedAgy: relaunched, needsRestart: !relaunched };
    }

    // Case 3: Antigravity GUI is not running (or autoRestartAgy is false) -> write directly, with lock fallback
    try {
      fs.writeFileSync(asarPath, dataBuffer);
      return {
        method: 'direct',
        restartedAgy: false,
        needsRestart: Boolean(runningInfo.isRunning && !autoRestartAgy)
      };
    } catch (directErr) {
      const isLockError =
        directErr &&
        (directErr.code === 'EBUSY' ||
          directErr.code === 'EPERM' ||
          directErr.code === 'EACCES' ||
          String(directErr.message || '').includes('EBUSY') ||
          String(directErr.message || '').includes('EPERM'));

      if (!isLockError || !autoRestartAgy) {
        throw directErr;
      }

      const procInfo = ensureAgyNotLockingAsar(true);
      writeWithRetries(false);
      const relaunched = procInfo.wasRunning ? relaunchAgyApp(exePath) : false;
      return { method: 'restart-and-write', restartedAgy: relaunched, needsRestart: !relaunched };
    }
  } finally {
    process.noAsar = prevNoAsar;
  }
}

function inspectAsarPatchState(asarPath) {
  try {
    const asar = readAsarArchive(asarPath);
    let version = null;
    try {
      const pkg = JSON.parse(readAsarFileUtf8(asar, 'package.json'));
      if (pkg && pkg.version) version = String(pkg.version);
    } catch (_) {}
    let hasMarker = false;
    try {
      const utilsCode = readAsarFileUtf8(asar, 'dist/utils.js');
      const preloadCode = readAsarFileUtf8(asar, 'dist/preload.js');
      hasMarker = utilsCode.includes(MARKER_COMMENT) || preloadCode.includes(MARKER_COMMENT);
    } catch (_) {}
    return { ok: true, version, hasMarker };
  } catch (_) {
    return { ok: false, version: null, hasMarker: false };
  }
}

function copyMediaWithUniqueHash(srcPath, userMediaDir) {
  const resolvedSrc = path.resolve(srcPath);
  const resolvedDir = path.resolve(userMediaDir);
  if (path.dirname(resolvedSrc).toLowerCase() === resolvedDir.toLowerCase()) {
    return resolvedSrc;
  }
  const baseName = path.basename(resolvedSrc);
  const srcBuf = fs.readFileSync(resolvedSrc);
  const shortHash = crypto.createHash('sha1').update(srcBuf).digest('hex').slice(0, 8);
  const targetName = `${shortHash}-${baseName}`;
  const targetCopy = path.join(resolvedDir, targetName);
  if (!fs.existsSync(targetCopy) || fs.statSync(targetCopy).size !== srcBuf.length) {
    fs.writeFileSync(targetCopy, srcBuf);
  }
  return targetCopy;
}

/**
 * Applies the user's custom UI configuration and injects the runtime into Antigravity App's app.asar.
 */
function applyCustomizationToAgy({ agyRootPath, config, studioRootDir, autoCloseRunningAgy = true }) {
  const prevNoAsar = process.noAsar;
  process.noAsar = true;
  try {
    const validation = validateAgyRoot(agyRootPath);
    if (!validation.valid) {
      return { ok: false, error: validation.reason };
    }

    const { asarPath, backupPath, customUiDir, exePath } = validation;
    const backupMetaPath = `${backupPath}.meta.json`;
    const currentState = inspectAsarPatchState(asarPath);

    // 1. Create or refresh original backup whenever app.asar is currently unpatched
    //    (ensures Antigravity App auto-updates are never overwritten by a stale backup)
    if (!currentState.hasMarker || !fs.existsSync(backupPath)) {
      const origBytes = fs.readFileSync(asarPath);
      fs.writeFileSync(backupPath, origBytes);
      const origSha = crypto.createHash('sha256').update(origBytes).digest('hex');
      fs.writeFileSync(
        backupMetaPath,
        JSON.stringify({ version: currentState.version || validation.version, sha256: origSha }, null, 2),
        'utf8'
      );
    }

    // 2. Prepare resources/agy-custom-ui directory with Starter Pack, User Media, Config & Runtime
    if (!fs.existsSync(customUiDir)) {
      fs.mkdirSync(customUiDir, { recursive: true });
    }

    const starterSrc = path.join(studioRootDir, 'assets', 'starter-pack');
    const starterDest = path.join(customUiDir, 'starter-pack');
    copyDirRecursive(starterSrc, starterDest);

    const userMediaDir = path.join(customUiDir, 'user-media');
    if (!fs.existsSync(userMediaDir)) {
      fs.mkdirSync(userMediaDir, { recursive: true });
    }

    // Copy custom wallpaper file if it's an external path (using content-hash prefix to prevent collisions)
    const cfgClone = JSON.parse(JSON.stringify(config));
    if (
      cfgClone.wallpaper &&
      cfgClone.wallpaper.sourceType === 'custom-file' &&
      cfgClone.wallpaper.customFilePath &&
      fs.existsSync(cfgClone.wallpaper.customFilePath)
    ) {
      cfgClone.wallpaper.customFilePath = copyMediaWithUniqueHash(cfgClone.wallpaper.customFilePath, userMediaDir);
    }

    // Copy any custom music tracks into user-media so they never go missing or collide
    if (cfgClone.music && Array.isArray(cfgClone.music.customTracks)) {
      for (const track of cfgClone.music.customTracks) {
        if (track.filePath && fs.existsSync(track.filePath)) {
          track.filePath = copyMediaWithUniqueHash(track.filePath, userMediaDir);
        }
      }
    }

    // Write config.json, presets.js, and agyInjectorRuntime.js into resources/agy-custom-ui/
    fs.writeFileSync(path.join(customUiDir, 'config.json'), JSON.stringify(cfgClone, null, 2), 'utf8');
    const srcPresetsPath = path.join(studioRootDir, 'src', 'renderer', 'presets.js');
    const destPresetsPath = path.join(customUiDir, 'presets.js');
    const srcRuntimePath = path.join(studioRootDir, 'src', 'injected', 'agyInjectorRuntime.js');
    const destRuntimePath = path.join(customUiDir, 'agyInjectorRuntime.js');

    let runtimeScriptChanged = false;
    try {
      const nextRuntimeBuf = fs.readFileSync(srcRuntimePath);
      const nextPresetsBuf = fs.readFileSync(srcPresetsPath);
      const prevRuntimeBuf = fs.existsSync(destRuntimePath) ? fs.readFileSync(destRuntimePath) : null;
      const prevPresetsBuf = fs.existsSync(destPresetsPath) ? fs.readFileSync(destPresetsPath) : null;
      runtimeScriptChanged =
        !prevRuntimeBuf ||
        !prevPresetsBuf ||
        Buffer.compare(prevRuntimeBuf, nextRuntimeBuf) !== 0 ||
        Buffer.compare(prevPresetsBuf, nextPresetsBuf) !== 0;
    } catch (_) {
      runtimeScriptChanged = true;
    }

    fs.copyFileSync(srcPresetsPath, destPresetsPath);
    fs.copyFileSync(srcRuntimePath, destRuntimePath);

    function stripExistingHook(code) {
      const idx = String(code || '').indexOf(MARKER_COMMENT);
      return idx !== -1 ? String(code).slice(0, idx).trimEnd() : String(code || '');
    }

    // 3. Read clean source ASAR from backupPath and inject hooks into dist/utils.js and dist/preload.js
    const cleanAsar = readAsarArchive(backupPath);
    const origUtils = stripExistingHook(readAsarFileUtf8(cleanAsar, 'dist/utils.js'));
    const origPreload = stripExistingHook(readAsarFileUtf8(cleanAsar, 'dist/preload.js'));

    const patchedUtils = origUtils + '\n' + buildMainProcessHookCode();
    const patchedPreload = origPreload + '\n' + buildPreloadHookCode();

    const rebuiltBuffer = rebuildAsarArchive(cleanAsar, {
      'dist/utils.js': Buffer.from(patchedUtils, 'utf8'),
      'dist/preload.js': Buffer.from(patchedPreload, 'utf8')
    });

    // 4. Write patched app.asar using original-fs.
    //    - If app.asar on disk already matches rebuiltBuffer and AGY started AFTER the patch: hot-sync-resources (no restart).
    //    - If app.asar matches rebuiltBuffer but AGY started BEFORE the patch (stale process): restarts AGY automatically.
    //    - If app.asar changed (fresh AGY update or hook upgrade): stops AGY first, writes cleanly, and relaunches AGY.
    let writeInfo = { method: 'hot-sync-resources', restartedAgy: false, needsRestart: false };
    try {
      writeInfo = writeAsarSafely(asarPath, rebuiltBuffer, {
        autoRestartAgy: autoCloseRunningAgy,
        exePath,
        forceRestartIfRunning: runtimeScriptChanged
      });
    } catch (asarWriteErr) {
      if (!validation.isPatched) {
        throw asarWriteErr;
      }
      // app.asar is already patched with our IPC & preload hooks; updating resources/agy-custom-ui/ is sufficient!
      writeInfo = { method: 'hot-sync-resources', restartedAgy: false, needsRestart: false };
    }

    return {
      ok: true,
      patchedAsarPath: asarPath,
      backupPath,
      customUiDir,
      writeMethod: writeInfo.method,
      restartedAgy: writeInfo.restartedAgy,
      needsRestart: Boolean(writeInfo.needsRestart),
      message: 'Đã nạp giao diện Custom vào Antigravity App thành công!'
    };
  } finally {
    process.noAsar = prevNoAsar;
  }
}

/**
 * Restores Antigravity App back to 100% original factory state from `app.asar.original.bak`.
 */
function restoreOriginalAgy({ agyRootPath, autoCloseRunningAgy = true }) {
  const prevNoAsar = process.noAsar;
  process.noAsar = true;
  try {
    const validation = validateAgyRoot(agyRootPath);
    if (!validation.valid) {
      return { ok: false, error: validation.reason };
    }

    const { asarPath, backupPath, customUiDir, exePath } = validation;
    const backupMetaPath = `${backupPath}.meta.json`;
    const currentState = inspectAsarPatchState(asarPath);

    if (!fs.existsSync(backupPath)) {
      if (!currentState.hasMarker) {
        if (fs.existsSync(customUiDir)) {
          fs.rmSync(customUiDir, { recursive: true, force: true });
        }
        return {
          ok: true,
          restoredPath: asarPath,
          alreadyOriginal: true,
          message: 'Antigravity App đang ở trạng thái nguyên gốc! Đã dọn sạch dữ liệu Custom UI.'
        };
      }
      return {
        ok: false,
        error: 'Không tìm thấy bản sao lưu gốc (app.asar.original.bak). Có thể AGY App vẫn đang ở trạng thái nguyên bản!'
      };
    }

    // Safety check: if AGY auto-updated app.asar (no marker AND version differs from .bak),
    // never overwrite the newer original app.asar with an older .bak!
    const backupState = inspectAsarPatchState(backupPath);
    if (
      !currentState.hasMarker &&
      backupState.ok &&
      currentState.version &&
      backupState.version &&
      currentState.version !== backupState.version
    ) {
      if (fs.existsSync(customUiDir)) {
        fs.rmSync(customUiDir, { recursive: true, force: true });
      }
      try { fs.rmSync(backupPath, { force: true }); } catch (_) {}
      try { fs.rmSync(backupMetaPath, { force: true }); } catch (_) {}
      return {
        ok: true,
        restoredPath: asarPath,
        alreadyOriginal: true,
        message: `Antigravity App đã tự cập nhật lên v${currentState.version} nguyên gốc; đã dọn sạch Custom UI & bản backup cũ (v${backupState.version}) an toàn!`
      };
    }

    let writeInfo = { method: 'already-original', restartedAgy: false };
    if (currentState.hasMarker) {
      const backupBytes = fs.readFileSync(backupPath);
      writeInfo = writeAsarSafely(asarPath, backupBytes, {
        autoRestartAgy: autoCloseRunningAgy,
        exePath
      });
    }

    // Remove custom UI directory cleanly
    if (fs.existsSync(customUiDir)) {
      fs.rmSync(customUiDir, { recursive: true, force: true });
    }

    return {
      ok: true,
      restoredPath: asarPath,
      writeMethod: writeInfo.method,
      restartedAgy: Boolean(writeInfo.restartedAgy),
      message: 'Đã khôi phục Antigravity App về trạng thái nguyên gốc 100%!'
    };
  } finally {
    process.noAsar = prevNoAsar;
  }
}

module.exports = {
  computeIntegrity,
  readAsarArchive,
  rebuildAsarArchive,
  readAsarFileUtf8,
  classifyAgyProcesses,
  isRunningAgyStale,
  getRunningAgyGuiInfo,
  stopRunningAgyGui,
  relaunchAgyApp,
  applyCustomizationToAgy,
  restoreOriginalAgy
};
