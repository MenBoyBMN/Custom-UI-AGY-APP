const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { validateAgyRoot, autoScanAgyRoot } = require('./agyScanner');
const { applyCustomizationToAgy, restoreOriginalAgy } = require('./asarPatcher');
const { DEFAULT_CONFIG } = require('../renderer/presets');

const STUDIO_ROOT_DIR = path.resolve(__dirname, '..', '..');

let mainWindow = null;

const UNSAFE_MERGE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const ALLOWED_MEDIA_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg',
  '.mp4', '.webm', '.ogg', '.mp3', '.wav', '.flac', '.m4a'
]);

function deepMerge(target, source) {
  const out = { ...target };
  if (!source || typeof source !== 'object' || Array.isArray(source)) return out;
  for (const key of Object.keys(source)) {
    if (UNSAFE_MERGE_KEYS.has(key)) continue;
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      out[key] = deepMerge(target[key], source[key]);
    } else {
      out[key] = source[key];
    }
  }
  return out;
}

function isPathInsideDir(targetPath, parentDir) {
  const rel = path.relative(path.resolve(parentDir), path.resolve(targetPath));
  return Boolean(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function mirrorMediaToStudioUserData(filePath, customUiDir) {
  if (!filePath || !customUiDir || !fs.existsSync(filePath)) return filePath;
  if (!isPathInsideDir(filePath, customUiDir)) return filePath;
  try {
    const studioMediaDir = path.join(app.getPath('userData'), 'studio-media');
    if (!fs.existsSync(studioMediaDir)) fs.mkdirSync(studioMediaDir, { recursive: true });
    const dest = path.join(studioMediaDir, path.basename(filePath));
    if (!fs.existsSync(dest)) fs.copyFileSync(filePath, dest);
    return dest;
  } catch (_) {
    return filePath;
  }
}

function getStudioSettingsPath() {
  return path.join(app.getPath('userData'), 'studio-settings.json');
}

function readStudioSettings() {
  const p = getStudioSettingsPath();
  if (!fs.existsSync(p)) {
    return { agyRootPath: null, config: deepMerge(DEFAULT_CONFIG, {}) };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      agyRootPath: raw.agyRootPath || null,
      config: deepMerge(DEFAULT_CONFIG, raw.config || {})
    };
  } catch (_) {
    return { agyRootPath: null, config: deepMerge(DEFAULT_CONFIG, {}) };
  }
}

function writeStudioSettings(data) {
  const p = getStudioSettingsPath();
  const dir = path.dirname(p);
  const current = readStudioSettings();
  const next = { ...current, ...data };
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    console.warn('[AGY-UI-Studio] Could not write settings:', err && err.message ? err.message : err);
  }
  return next;
}

function getMimeType(filePath) {
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
}

function createWindow() {
  const iconPath = path.join(STUDIO_ROOT_DIR, 'assets', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 880,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#070510',
    title: 'AGY UI Studio - Custom Giao Diện Antigravity App',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const rendererUrl = require('url').pathToFileURL(path.join(STUDIO_ROOT_DIR, 'src', 'renderer', 'index.html')).href;
  mainWindow.loadFile(path.join(STUDIO_ROOT_DIR, 'src', 'renderer', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== rendererUrl) {
      event.preventDefault();
    }
  });
}

function registerIpcHandlers() {
  ipcMain.handle('studio:init', async () => {
    const settingsPath = getStudioSettingsPath();
    const hasSavedSettings = fs.existsSync(settingsPath);
    const settingsMtime = hasSavedSettings ? fs.statSync(settingsPath).mtimeMs : 0;
    const settings = readStudioSettings();
    const scanResult = autoScanAgyRoot(settings.agyRootPath);
    if (scanResult.found && scanResult.path) {
      // Sync from AGY's deployed config.json if Studio has no saved settings yet
      // OR if AGY's config.json was updated at/after the last Studio draft save.
      const targetConfigPath = path.join(scanResult.customUiDir, 'config.json');
      if (fs.existsSync(targetConfigPath)) {
        try {
          const targetMtime = fs.statSync(targetConfigPath).mtimeMs;
          if (!hasSavedSettings || targetMtime >= settingsMtime - 250) {
            const deployedCfg = JSON.parse(fs.readFileSync(targetConfigPath, 'utf8'));
            const merged = deepMerge(DEFAULT_CONFIG, deployedCfg);
            if (merged.wallpaper?.customFilePath) {
              merged.wallpaper.customFilePath = mirrorMediaToStudioUserData(
                merged.wallpaper.customFilePath,
                scanResult.customUiDir
              );
            }
            if (Array.isArray(merged.music?.customTracks)) {
              for (const tr of merged.music.customTracks) {
                if (tr.filePath) tr.filePath = mirrorMediaToStudioUserData(tr.filePath, scanResult.customUiDir);
              }
            }
            settings.config = merged;
          }
        } catch (_) {}
      }
      writeStudioSettings({ agyRootPath: scanResult.path, config: settings.config });
    }
    return {
      scanResult,
      config: settings.config || DEFAULT_CONFIG
    };
  });

  ipcMain.handle('studio:rescan', async (_event, customPath) => {
    const settings = readStudioSettings();
    const scanResult = customPath
      ? validateAgyRoot(customPath)
      : autoScanAgyRoot(settings.agyRootPath);
    if (scanResult.valid && scanResult.path) {
      writeStudioSettings({ agyRootPath: scanResult.path });
    }
    return scanResult;
  });

  ipcMain.handle('studio:select-agy-folder', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn thư mục gốc của Antigravity App (Chứa Antigravity.exe & resources/app.asar)',
      properties: ['openDirectory']
    });
    if (res.canceled || !res.filePaths || res.filePaths.length === 0) {
      return { canceled: true };
    }
    const chosen = res.filePaths[0];
    const validation = validateAgyRoot(chosen);
    if (validation.valid) {
      writeStudioSettings({ agyRootPath: validation.path });
    }
    return { canceled: false, ...validation };
  });

  ipcMain.handle('studio:pick-media', async (_event, kind) => {
    const filters =
      kind === 'audio'
        ? [{ name: 'Audio Files (MP3, WAV, OGG, FLAC)', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a'] }]
        : [
            {
              name: 'Hình nền / GIF / Video (PNG, JPG, GIF, SVG, MP4, WebM)',
              extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'mp4', 'webm']
            }
          ];
    const res = await dialog.showOpenDialog(mainWindow, {
      title: kind === 'audio' ? 'Chọn File Nhạc Nền' : 'Chọn Hình Nền Động / GIF / Video',
      properties: ['openFile'],
      filters
    });
    if (res.canceled || !res.filePaths || res.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }
    const filePath = res.filePaths[0];
    return {
      ok: true,
      filePath,
      fileName: path.basename(filePath),
      mime: getMimeType(filePath)
    };
  });

  ipcMain.handle('studio:read-media', async (_event, assetRef) => {
    try {
      if (!assetRef || typeof assetRef !== 'string') {
        return { ok: false, error: 'Empty assetRef' };
      }
      const starterDir = path.join(STUDIO_ROOT_DIR, 'assets', 'starter-pack');
      let resolvedPath = null;
      if (path.isAbsolute(assetRef) && fs.existsSync(assetRef)) {
        resolvedPath = path.resolve(assetRef);
      } else {
        const safeBase = path.basename(assetRef);
        const relClean = String(assetRef).replace(/^[/\\]+/, '');
        const candidates = [
          path.join(starterDir, relClean),
          path.join(starterDir, 'music', safeBase),
          path.join(starterDir, 'wallpapers', safeBase)
        ];
        const found = candidates.find((p) => isPathInsideDir(p, starterDir) && fs.existsSync(p));
        if (found) resolvedPath = found;
      }
      if (!resolvedPath || !fs.existsSync(resolvedPath)) {
        return { ok: false, error: 'Không tìm thấy file: ' + assetRef };
      }
      const ext = path.extname(resolvedPath).toLowerCase();
      if (!ALLOWED_MEDIA_EXTS.has(ext)) {
        return { ok: false, error: 'Định dạng file media không được hỗ trợ: ' + ext };
      }
      const stat = fs.statSync(resolvedPath);
      if (!stat.isFile()) {
        return { ok: false, error: 'Đường dẫn không phải file hợp lệ.' };
      }
      const buf = fs.readFileSync(resolvedPath);
      return {
        ok: true,
        mime: getMimeType(resolvedPath),
        base64: buf.toString('base64'),
        size: buf.length
      };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  });

  ipcMain.handle('studio:save-draft', async (_event, config) => {
    writeStudioSettings({ config });
    return { ok: true };
  });

  ipcMain.handle('studio:apply-to-agy', async (_event, { agyRootPath, config }) => {
    try {
      const result = applyCustomizationToAgy({
        agyRootPath,
        config,
        studioRootDir: STUDIO_ROOT_DIR,
        autoCloseRunningAgy: true
      });
      if (result.ok) {
        writeStudioSettings({ agyRootPath, config });
      } else {
        writeStudioSettings({ config });
      }
      const updatedStatus = validateAgyRoot(agyRootPath);
      return { ...result, status: updatedStatus };
    } catch (err) {
      return {
        ok: false,
        error: `Lỗi khi nạp giao diện vào AGY App: ${err && err.message ? err.message : err}`
      };
    }
  });

  ipcMain.handle('studio:restore-agy', async (_event, { agyRootPath }) => {
    try {
      const result = restoreOriginalAgy({
        agyRootPath,
        autoCloseRunningAgy: true
      });
      const updatedStatus = validateAgyRoot(agyRootPath);
      return { ...result, status: updatedStatus };
    } catch (err) {
      return {
        ok: false,
        error: `Lỗi khi khôi phục AGY App: ${err && err.message ? err.message : err}`
      };
    }
  });

  ipcMain.handle('studio:launch-agy', async (_event, agyRootPath) => {
    try {
      const validation = validateAgyRoot(agyRootPath);
      if (!validation.valid || !validation.exePath) {
        return { ok: false, error: 'Không tìm thấy file thực thi Antigravity.exe trong thư mục gốc!' };
      }
      const child = spawn(validation.exePath, [], {
        cwd: validation.path,
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  });

  ipcMain.handle('studio:open-folder', async (_event, folderPath) => {
    if (folderPath && typeof folderPath === 'string' && fs.existsSync(folderPath)) {
      try {
        if (!fs.statSync(folderPath).isDirectory()) {
          return { ok: false, error: 'Đường dẫn không phải là thư mục.' };
        }
      } catch (_) {
        return { ok: false };
      }
      const errMsg = await shell.openPath(folderPath);
      return errMsg ? { ok: false, error: errMsg } : { ok: true };
    }
    return { ok: false };
  });

  ipcMain.handle('studio:export-config', async (_event, config) => {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Xuất File Cấu Hình Theme AGY (.json)',
      defaultPath: 'agy-custom-theme.json',
      filters: [{ name: 'JSON Config', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    try {
      fs.writeFileSync(res.filePath, JSON.stringify(config, null, 2), 'utf8');
      return { ok: true, filePath: res.filePath };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  });

  ipcMain.handle('studio:import-config', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Nhập File Cấu Hình Theme AGY (.json)',
      properties: ['openFile'],
      filters: [{ name: 'JSON Config', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePaths || res.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }
    try {
      const cfg = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8'));
      return { ok: true, config: cfg };
    } catch (err) {
      return { ok: false, error: 'File JSON không hợp lệ!' };
    }
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerIpcHandlers();
    createWindow();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
