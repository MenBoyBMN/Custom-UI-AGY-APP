let fs;
try {
  fs = require('original-fs');
} catch (_) {
  fs = require('fs');
}
const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');

const MARKER_COMMENT = '/* __AGY_UI_STUDIO_INJECTED_V1__ */';

function readExactSync(fd, length, position) {
  const buf = Buffer.alloc(length);
  let total = 0;
  while (total < length) {
    const n = fs.readSync(fd, buf, total, length - total, position + total);
    if (n <= 0) break;
    total += n;
  }
  return total === length ? buf : buf.subarray(0, total);
}

function readAsarEntryText(fd, baseOffset, entry, asarPath) {
  if (!entry || typeof entry.size !== 'number') return '';
  if (entry.unpacked) {
    return '';
  }
  if (entry.offset === undefined) return '';
  const buf = readExactSync(fd, entry.size, baseOffset + Number(entry.offset));
  return buf.toString('utf8');
}

/**
 * Validates whether a directory is a valid Antigravity Desktop App root directory
 * (specifically the standalone App, NOT Antigravity IDE).
 */
function validateAgyRoot(candidatePath) {
  if (!candidatePath || typeof candidatePath !== 'string') {
    return {
      valid: false,
      reason: 'Đường dẫn trống hoặc không hợp lệ.'
    };
  }

  let normalized = path.resolve(candidatePath.trim());
  // If user selected the "resources" subfolder or "Antigravity.exe" parent, normalize to root
  if (path.basename(normalized).toLowerCase() === 'resources') {
    normalized = path.dirname(normalized);
  }
  if (normalized.toLowerCase().endsWith('.exe')) {
    normalized = path.dirname(normalized);
  }

  if (!fs.existsSync(normalized)) {
    return {
      valid: false,
      path: normalized,
      reason: 'Thư mục không tồn tại trên ổ đĩa.'
    };
  }

  // Reject Antigravity IDE if user accidentally picks "Antigravity IDE"
  const folderName = path.basename(normalized).toLowerCase();
  const ideProductJson = path.join(normalized, 'resources', 'app', 'product.json');
  if (folderName.includes('antigravity ide') || fs.existsSync(ideProductJson)) {
    return {
      valid: false,
      path: normalized,
      reason: 'Đây là thư mục Antigravity IDE. Vui lòng chọn thư mục Antigravity App (phiên bản App độc lập).'
    };
  }

  const exePath = path.join(normalized, 'Antigravity.exe');
  const resourcesDir = path.join(normalized, 'resources');
  const asarPath = path.join(resourcesDir, 'app.asar');
  const backupPath = path.join(resourcesDir, 'app.asar.original.bak');
  const customUiDir = path.join(resourcesDir, 'agy-custom-ui');

  if (!fs.existsSync(asarPath)) {
    return {
      valid: false,
      path: normalized,
      reason: 'Không tìm thấy file resources/app.asar trong thư mục này.'
    };
  }

  // Read version & check if already patched from app.asar header/content
  let version = '2.x';
  let isPatched = false;
  try {
    const fd = fs.openSync(asarPath, 'r');
    try {
      const sizeBuf = readExactSync(fd, 16, 0);
      if (sizeBuf.length === 16) {
        const headerPickleSize = sizeBuf.readUInt32LE(4);
        const jsonLen = sizeBuf.readUInt32LE(12);
        if (jsonLen > 0 && jsonLen < 64 * 1024 * 1024 && headerPickleSize >= jsonLen + 8) {
          const headerBuf = readExactSync(fd, jsonLen, 16);
          if (headerBuf.length === jsonLen) {
            const header = JSON.parse(headerBuf.toString('utf8'));
            const baseOffset = 8 + headerPickleSize;

            if (header.files && header.files['package.json']) {
              const pkgText = readAsarEntryText(fd, baseOffset, header.files['package.json'], asarPath);
              if (pkgText) {
                const pkgJson = JSON.parse(pkgText);
                if (pkgJson.version) version = pkgJson.version;
              }
            }

            const distFiles = header.files && header.files.dist && header.files.dist.files;
            if (distFiles && distFiles['preload.js'] && distFiles['utils.js']) {
              const preloadContent = readAsarEntryText(fd, baseOffset, distFiles['preload.js'], asarPath);
              const utilsContent = readAsarEntryText(fd, baseOffset, distFiles['utils.js'], asarPath);
              const hasPreloadMarker = preloadContent.includes(MARKER_COMMENT);
              const hasUtilsMarker = utilsContent.includes(MARKER_COMMENT);
              const hasRuntimeOnDisk = fs.existsSync(path.join(customUiDir, 'agyInjectorRuntime.js'));
              if (hasPreloadMarker && hasUtilsMarker && hasRuntimeOnDisk) {
                isPatched = true;
              }
            }
          }
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    // Non-fatal header read error
  }

  const hasBackup = fs.existsSync(backupPath);

  return {
    valid: true,
    path: normalized,
    exePath: fs.existsSync(exePath) ? exePath : null,
    asarPath,
    backupPath,
    customUiDir,
    hasBackup,
    isPatched,
    version,
    reason: 'Đã nhận diện thành công thư mục gốc Antigravity App.'
  };
}

function discoverExtraWindowsCandidates() {
  if (process.platform !== 'win32') return [];
  const extra = [];
  // 1. Running Antigravity.exe process executable path
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "(Get-Process -Name 'Antigravity' -ErrorAction SilentlyContinue | Select-Object -First 3 -ExpandProperty Path) -join \"`n\""
      ],
      { encoding: 'utf8', timeout: 2500, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    for (const line of String(out || '').split(/\r?\n/)) {
      const p = line.trim();
      if (p) extra.push(path.dirname(p));
    }
  } catch (_) {}

  // 2. Windows Uninstall Registry (DisplayIcon / InstallLocation)
  try {
    const out = execFileSync(
      'reg.exe',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', '/s', '/f', 'Antigravity'],
      { encoding: 'utf8', timeout: 2500, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    for (const line of String(out || '').split(/\r?\n/)) {
      const match = line.match(/^\s*(?:InstallLocation|DisplayIcon)\s+REG_\w+\s+(.+)$/i);
      if (match && match[1]) {
        const raw = match[1].trim().replace(/^"|"$/g, '').split(',')[0].trim();
        if (raw) {
          extra.push(raw.toLowerCase().endsWith('.exe') ? path.dirname(raw) : raw);
        }
      }
    }
  } catch (_) {}

  return extra;
}

/**
 * Automatically scans default installation locations on Windows for Antigravity App.
 */
function autoScanAgyRoot(savedPath = null) {
  const candidates = [];

  if (savedPath) {
    candidates.push(savedPath);
  }

  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
  const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';

  candidates.push(
    path.join(localAppData, 'Programs', 'Antigravity'),
    path.join(localAppData, 'Programs', 'Antigravity Insiders'),
    path.join(localAppData, 'Antigravity'),
    path.join(programFiles, 'Antigravity'),
    path.join(programFilesX86, 'Antigravity')
  );

  const seen = new Set();
  const checkedPaths = [];

  const tryCandidates = (list) => {
    for (const candidate of list) {
      if (!candidate) continue;
      const norm = path.resolve(candidate);
      if (seen.has(norm.toLowerCase())) continue;
      seen.add(norm.toLowerCase());
      checkedPaths.push(norm);

      const validation = validateAgyRoot(norm);
      if (validation.valid) {
        return {
          found: true,
          ...validation,
          checkedPaths
        };
      }
    }
    return null;
  };

  const quickMatch = tryCandidates(candidates);
  if (quickMatch) return quickMatch;

  const extraMatch = tryCandidates(discoverExtraWindowsCandidates());
  if (extraMatch) return extraMatch;

  return {
    found: false,
    valid: false,
    path: null,
    checkedPaths,
    reason: 'Không tự động tìm thấy thư mục gốc của Antigravity App ở các vị trí mặc định. Vui lòng chọn thư mục thủ công!'
  };
}

module.exports = {
  MARKER_COMMENT,
  validateAgyRoot,
  autoScanAgyRoot
};
