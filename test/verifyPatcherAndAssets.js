const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const vm = require('vm');
const assert = require('assert');

const { validateAgyRoot, autoScanAgyRoot, MARKER_COMMENT } = require('../src/main/agyScanner');
const {
  readAsarArchive,
  rebuildAsarArchive,
  readAsarFileUtf8,
  classifyAgyProcesses,
  isRunningAgyStale,
  applyCustomizationToAgy,
  restoreOriginalAgy
} = require('../src/main/asarPatcher');
const { THEME_PRESETS, BUILTIN_WALLPAPERS, STARTER_MUSIC, DEFAULT_CONFIG } = require('../src/renderer/presets');

const ROOT_DIR = path.resolve(__dirname, '..');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ TOÀN DIỆN AGY UI STUDIO & STARTER PACK');
  console.log('================================================================\n');

  // -------------------------------------------------------------------------
  // 1. Verify Starter Pack Audio (.wav), Animated Wallpapers (.svg) & Icons
  // -------------------------------------------------------------------------
  console.log('▶ [1/5] Kiểm tra gói tài nguyên Starter Pack (Nhạc WAV, Hình nền động SVG, Icon)...');
  for (const track of STARTER_MUSIC) {
    const wavPath = path.join(ROOT_DIR, 'assets', 'starter-pack', 'music', track.id);
    assert(fs.existsSync(wavPath), `Thiếu file nhạc Starter Pack: ${wavPath}`);
    const buf = fs.readFileSync(wavPath);
    assert(buf.length > 100000, `File nhạc ${track.id} quá nhỏ (${buf.length} bytes)`);
    assert.strictEqual(buf.subarray(0, 4).toString('ascii'), 'RIFF', `Header RIFF lỗi ở ${track.id}`);
    assert.strictEqual(buf.subarray(8, 12).toString('ascii'), 'WAVE', `Header WAVE lỗi ở ${track.id}`);
    const dataSize = buf.readUInt32LE(40);
    assert.strictEqual(buf.length, 44 + dataSize, `Kích thước PCM không khớp ở ${track.id}`);

    // Verify non-silent audio samples exist
    let maxPeak = 0;
    for (let offset = 44; offset < Math.min(buf.length, 44 + 44100); offset += 2) {
      const sample = Math.abs(buf.readInt16LE(offset));
      if (sample > maxPeak) maxPeak = sample;
    }
    assert(maxPeak > 2000, `File nhạc ${track.id} bị câm (maxPeak=${maxPeak})`);
    console.log(`  ✓ Nhạc nền "${track.name}" (${track.id}): Hợp lệ (${(buf.length / 1024).toFixed(0)} KB, Peak=${maxPeak})`);
  }

  const svgWallpapers = BUILTIN_WALLPAPERS.filter((w) => w.type === 'svg');
  for (const wp of svgWallpapers) {
    const svgPath = path.join(ROOT_DIR, 'assets', 'starter-pack', 'wallpapers', wp.id);
    assert(fs.existsSync(svgPath), `Thiếu file hình nền SVG: ${svgPath}`);
    const content = fs.readFileSync(svgPath, 'utf8');
    assert(content.includes('<svg') && content.includes('</svg>'), `Cú pháp SVG lỗi: ${wp.id}`);
    assert(content.includes('<animate'), `Hình nền SVG thiếu thẻ chuyển động <animate>: ${wp.id}`);
    console.log(`  ✓ Hình nền động "${wp.name}" (${wp.id}): Hợp lệ (${content.length} bytes)`);
  }

  const iconPng = path.join(ROOT_DIR, 'assets', 'icon.png');
  const iconIco = path.join(ROOT_DIR, 'assets', 'icon.ico');
  assert(fs.existsSync(iconPng) && fs.statSync(iconPng).size > 200, 'Thiếu icon.png');
  assert(fs.existsSync(iconIco) && fs.statSync(iconIco).size > 200, 'Thiếu icon.ico');
  console.log('  ✓ Icon ứng dụng (icon.png & icon.ico): Hợp lệ\n');

  // -------------------------------------------------------------------------
  // 2. Verify JS Syntax of all Modules & Injected Runtime
  // -------------------------------------------------------------------------
  console.log('▶ [2/5] Kiểm tra cú pháp JavaScript của toàn bộ mã nguồn & Runtime nhúng...');
  const jsFilesToCheck = [
    'src/main/agyScanner.js',
    'src/main/asarPatcher.js',
    'src/main/main.js',
    'src/main/preload.js',
    'src/renderer/presets.js',
    'src/renderer/app.js',
    'src/injected/agyInjectorRuntime.js'
  ];
  for (const rel of jsFilesToCheck) {
    const full = path.join(ROOT_DIR, rel);
    const code = fs.readFileSync(full, 'utf8');
    new vm.Script(code, { filename: rel });
    console.log(`  ✓ Cú pháp chuẩn: ${rel}`);
  }
  console.log('');

  // -------------------------------------------------------------------------
  // 3. Verify AGY App Scanner (App vs IDE Differentiation)
  // -------------------------------------------------------------------------
  console.log('▶ [3/5] Kiểm tra bộ tự động quét thư mục gốc Antigravity App...');
  const scanRes = autoScanAgyRoot();
  assert(scanRes.found && scanRes.valid, 'Không tự động quét thấy Antigravity App trên máy!');
  console.log(`  ✓ Đã tự động tìm thấy AGY App tại: ${scanRes.path} (Phiên bản: v${scanRes.version})`);

  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const realIdeDir = path.join(localAppData, 'Programs', 'Antigravity IDE');
  let ideCandidate = realIdeDir;
  const tempIdeStub = path.join(os.tmpdir(), `agy-test-ide-${process.pid}`);
  let ideCheck;
  try {
    if (!fs.existsSync(realIdeDir)) {
      fs.mkdirSync(path.join(tempIdeStub, 'resources', 'app'), { recursive: true });
      fs.writeFileSync(path.join(tempIdeStub, 'resources', 'app', 'product.json'), '{}');
      ideCandidate = tempIdeStub;
    }
    ideCheck = validateAgyRoot(ideCandidate);
  } finally {
    if (fs.existsSync(tempIdeStub)) {
      fs.rmSync(tempIdeStub, { recursive: true, force: true });
    }
  }
  assert.strictEqual(ideCheck.valid, false, 'Bộ quét phải từ chối thư mục Antigravity IDE!');
  console.log(`  ✓ Phân biệt chính xác AGY App và AGY IDE: "${ideCheck.reason}"`);

  const missingCheck = validateAgyRoot('C:\\NonExistent_AGY_Folder_12345');
  assert.strictEqual(missingCheck.valid, false, 'Bộ quét phải báo lỗi khi thư mục không tồn tại!');
  console.log(`  ✓ Xử lý đúng khi không tìm thấy thư mục: "${missingCheck.reason}"\n`);

  // -------------------------------------------------------------------------
  // 4. Verify ASAR Patching, Integrity Verification & Factory Restore in Sandbox
  // -------------------------------------------------------------------------
  console.log('▶ [4/5] Kiểm tra đóng gói ASAR, kiểm tra toàn vẹn SHA256 & Khôi phục gốc (Sandbox)...');
  const tempSandbox = path.join(os.tmpdir(), `agy-test-sandbox-${process.pid}`);
  const tempMediaA = path.join(os.tmpdir(), `agy-test-mediaA-${process.pid}`);
  const tempMediaB = path.join(os.tmpdir(), `agy-test-mediaB-${process.pid}`);
  try {
    for (const d of [tempSandbox, tempMediaA, tempMediaB]) {
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    }
    const sandboxResources = path.join(tempSandbox, 'resources');
    fs.mkdirSync(sandboxResources, { recursive: true });
    fs.writeFileSync(path.join(tempSandbox, 'Antigravity.exe'), 'DUMMY_EXE_STUB');

    const realAsarPath = scanRes.hasBackup ? scanRes.backupPath : scanRes.asarPath;
    const sandboxAsarPath = path.join(sandboxResources, 'app.asar');
    fs.copyFileSync(realAsarPath, sandboxAsarPath);

    const originalHash = sha256File(sandboxAsarPath);
    console.log(`  • SHA256 app.asar gốc trước khi patch: ${originalHash}`);

    // Create two different files sharing the exact same basename to test collision resistance
    fs.mkdirSync(tempMediaA, { recursive: true });
    fs.mkdirSync(tempMediaB, { recursive: true });
    const fileA = path.join(tempMediaA, 'same-name.png');
    const fileB = path.join(tempMediaB, 'same-name.png');
    fs.writeFileSync(fileA, Buffer.from('PNG_CONTENT_A'));
    fs.writeFileSync(fileB, Buffer.from('PNG_CONTENT_B_DIFFERENT'));

    // Apply customization #1
    const customCfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    customCfg.activePresetId = 'frosted-aurora';
    customCfg.wallpaper.sourceType = 'custom-file';
    customCfg.wallpaper.customFilePath = fileA;
    customCfg.music.enabled = true;
    customCfg.music.activeTrackId = 'cyberpunk-synthwave.wav';
    customCfg.music.customTracks = [{ id: 'c1', name: 'same-name.png', filePath: fileB, mime: 'image/png' }];

    const applyRes = applyCustomizationToAgy({
      agyRootPath: tempSandbox,
      config: customCfg,
      studioRootDir: ROOT_DIR,
      autoCloseRunningAgy: false
    });
    assert(applyRes.ok, `Apply thất bại: ${applyRes.error}`);

    const afterApplyStatus = validateAgyRoot(tempSandbox);
    assert(afterApplyStatus.valid && afterApplyStatus.isPatched, 'Trạng thái sau khi Apply phải là isPatched = true!');
    assert(fs.existsSync(afterApplyStatus.backupPath), 'File backup app.asar.original.bak chưa được tạo!');

    // Verify collision-free hashed filenames in user-media
    const deployedCfg = JSON.parse(fs.readFileSync(path.join(afterApplyStatus.customUiDir, 'config.json'), 'utf8'));
    assert.notStrictEqual(
      deployedCfg.wallpaper.customFilePath,
      deployedCfg.music.customTracks[0].filePath,
      'Hai file trùng tên khác nội dung bị ghi đè lên nhau trong user-media!'
    );
    assert(fs.existsSync(deployedCfg.wallpaper.customFilePath), 'Thiếu file media A sau hash copy');
    assert(fs.existsSync(deployedCfg.music.customTracks[0].filePath), 'Thiếu file media B sau hash copy');
    console.log('  ✓ Copy media dùng content-hash chống ghi đè file trùng tên hoạt động chính xác!');

    // Verify patched ASAR structure, syntax of patched dist/utils.js & dist/preload.js, and SHA256 integrity
    const patchedAsar = readAsarArchive(sandboxAsarPath);
    const patchedUtils = readAsarFileUtf8(patchedAsar, 'dist/utils.js');
    const patchedPreload = readAsarFileUtf8(patchedAsar, 'dist/preload.js');
    assert(patchedUtils.includes(MARKER_COMMENT), 'dist/utils.js thiếu hook!');
    assert(patchedPreload.includes(MARKER_COMMENT), 'dist/preload.js thiếu hook!');

    new vm.Script(patchedUtils, { filename: 'dist/utils.js' });
    new vm.Script(patchedPreload, { filename: 'dist/preload.js' });
    console.log('  ✓ Mã dist/utils.js và dist/preload.js sau khi tiêm vào app.asar vượt qua kiểm tra cú pháp VM!');

    // Verify integrity headers of both dist/preload.js and dist/utils.js
    for (const key of ['preload.js', 'utils.js']) {
      const entry = patchedAsar.header.files.dist.files[key];
      const buf = patchedAsar.fullBuf.subarray(
        patchedAsar.baseOffset + Number(entry.offset),
        patchedAsar.baseOffset + Number(entry.offset) + entry.size
      );
      const actualSha = crypto.createHash('sha256').update(buf).digest('hex');
      assert.strictEqual(
        entry.integrity.hash,
        actualSha,
        `Mã băm SHA256 integrity trong ASAR header của dist/${key} không khớp!`
      );
    }
    console.log('  ✓ SHA256 Integrity Header của cả dist/preload.js và dist/utils.js khớp 100%!');

    // Verify Starter Pack assets were copied to resources/agy-custom-ui/starter-pack
    const deployedWav = path.join(afterApplyStatus.customUiDir, 'starter-pack', 'music', 'cyberpunk-synthwave.wav');
    const deployedSvg = path.join(afterApplyStatus.customUiDir, 'starter-pack', 'wallpapers', 'cosmic-nebula.svg');
    assert(fs.existsSync(deployedWav), 'File nhạc Starter Pack chưa được chép vào resources/agy-custom-ui!');
    assert(fs.existsSync(deployedSvg), 'File hình nền Starter Pack chưa được chép vào resources/agy-custom-ui!');
    console.log('  ✓ Toàn bộ nhạc nền, hình nền động và cấu hình đã được nạp vào resources/agy-custom-ui/');

    // Apply customization #2 (test idempotency)
    const applyRes2 = applyCustomizationToAgy({
      agyRootPath: tempSandbox,
      config: customCfg,
      studioRootDir: ROOT_DIR,
      autoCloseRunningAgy: false
    });
    assert(applyRes2.ok, 'Apply lần 2 thất bại!');
    const patchedAsar2 = readAsarArchive(sandboxAsarPath);
    const preload2 = readAsarFileUtf8(patchedAsar2, 'dist/preload.js');
    const markerCount = preload2.split(MARKER_COMMENT).length - 1;
    assert.strictEqual(markerCount, 1, `Apply nhiều lần bị nhân đôi mã tiêm (markerCount=${markerCount})!`);
    console.log('  ✓ Kiểm tra Apply lặp lại nhiều lần: Không bị chồng chéo hoặc nhân đôi mã tiêm!');

    // Restore original
    const restoreRes = restoreOriginalAgy({
      agyRootPath: tempSandbox,
      autoCloseRunningAgy: false
    });
    assert(restoreRes.ok, `Khôi phục gốc thất bại: ${restoreRes.error}`);
    const restoredHash = sha256File(sandboxAsarPath);
    assert.strictEqual(
      restoredHash,
      originalHash,
      'File app.asar sau khi khôi phục không khớp byte-for-byte với bản gốc!'
    );
    assert(!fs.existsSync(afterApplyStatus.customUiDir), 'Thư mục agy-custom-ui chưa được dọn sạch sau khi Restore!');
    console.log(`  ✓ Khôi phục gốc (Restore) khớp 100% byte-for-byte với bản gốc: ${restoredHash}`);

    // Simulate Antigravity auto-update replacing app.asar with a newer unpatched version (e.g. 2.99.0)
    // while an older .bak exists -> restoreOriginalAgy MUST NOT downgrade 2.99.0!
    const origAsarData = readAsarArchive(sandboxAsarPath);
    const pkgObj = JSON.parse(readAsarFileUtf8(origAsarData, 'package.json'));
    pkgObj.version = '2.99.0';
    const newerAsarBuf = rebuildAsarArchive(origAsarData, {
      'package.json': Buffer.from(JSON.stringify(pkgObj, null, 2), 'utf8')
    });
    fs.writeFileSync(afterApplyStatus.backupPath, fs.readFileSync(sandboxAsarPath)); // old 2.32.2 .bak
    fs.writeFileSync(sandboxAsarPath, newerAsarBuf); // newer 2.99.0 unpatched app.asar
    const safeRestoreRes = restoreOriginalAgy({
      agyRootPath: tempSandbox,
      autoCloseRunningAgy: false
    });
    assert(safeRestoreRes.ok && safeRestoreRes.alreadyOriginal, 'Restore phải nhận biết AGY đã tự cập nhật!');
    assert.strictEqual(
      validateAgyRoot(tempSandbox).version,
      '2.99.0',
      'Restore không được ghi đè app.asar phiên bản mới hơn bằng .bak cũ!'
    );
    console.log('  ✓ Bảo vệ an toàn: Restore không ghi đè app.asar mới khi AGY App tự động cập nhật!');

    // Simulate stale .bak refresh on Apply after auto-update
    fs.writeFileSync(afterApplyStatus.backupPath, Buffer.from('STALE_OLD_BACKUP'));
    const applyAfterUpdate = applyCustomizationToAgy({
      agyRootPath: tempSandbox,
      config: customCfg,
      studioRootDir: ROOT_DIR,
      autoCloseRunningAgy: false
    });
    assert(applyAfterUpdate.ok, 'Apply sau khi AGY App cập nhật phiên bản mới thất bại!');
    assert.strictEqual(
      sha256File(afterApplyStatus.backupPath),
      crypto.createHash('sha256').update(newerAsarBuf).digest('hex'),
      'Bản sao lưu .bak cũ không được làm mới từ app.asar mới!'
    );
    console.log('  ✓ Tự động làm mới app.asar.original.bak khi AGY App cập nhật phiên bản mới!');

    // Verify Windows process classification & stale pre-patch detection (ignores ELECTRON_RUN_AS_NODE sidecars & IDE)
    const agyExe = 'C:\\Users\\ASUS\\AppData\\Local\\Programs\\Antigravity\\Antigravity.exe';
    const sampleProcs = [
      {
        pid: 48848,
        ppid: 60968,
        exe: agyExe,
        cmd: `"${agyExe}" --import=file:///C:/Users/ASUS/.gemini/antigravity/lib/node_modules/sidecar/index.js`,
        createdMs: 1000
      },
      {
        pid: 62008,
        ppid: 50136,
        exe: agyExe,
        cmd: `"${agyExe}" --updated`,
        createdMs: 5000
      },
      {
        pid: 68344,
        ppid: 62008,
        exe: agyExe,
        cmd: `"${agyExe}" --type=gpu-process`,
        createdMs: 5100
      },
      {
        pid: 43032,
        ppid: 62008,
        exe: agyExe,
        cmd: `"${agyExe}" --type=renderer`,
        createdMs: 9000
      },
      {
        pid: 99999,
        ppid: 1,
        exe: 'C:\\Users\\ASUS\\AppData\\Local\\Programs\\Antigravity IDE\\Antigravity.exe',
        cmd: '"C:\\Users\\ASUS\\AppData\\Local\\Programs\\Antigravity IDE\\Antigravity.exe"',
        createdMs: 2000
      }
    ];
    const classified = classifyAgyProcesses(sampleProcs, agyExe);
    assert.deepStrictEqual(classified.guiMainPids, [62008], 'Phải chỉ nhận diện đúng GUI Main Process, bỏ qua sidecar và IDE!');
    assert.deepStrictEqual(classified.chromiumChildPids, [68344, 43032], 'Phải nhận diện đúng các tiến trình con Chromium!');
    assert.strictEqual(classified.oldestGuiStartMs, 5000, 'Thời điểm khởi động GUI phải lấy của Main Process, không lấy sidecar!');
    assert.strictEqual(isRunningAgyStale(classified, 8000), true, 'Phải phát hiện AGY đang chạy trước khi patch (stale)!');
    assert.strictEqual(isRunningAgyStale(classified, 4500), false, 'AGY khởi động sau khi patch không được coi là stale!');
    console.log('  ✓ Phân loại tiến trình Antigravity GUI và phát hiện tiến trình cũ trước khi patch chính xác!\n');
  } finally {
    for (const d of [tempSandbox, tempMediaA, tempMediaB]) {
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    }
  }

  // -------------------------------------------------------------------------
  // 5. Verify Theme Presets Completeness
  // -------------------------------------------------------------------------
  console.log('▶ [5/5] Kiểm tra danh sách Preset Theme & Bố cục...');
  assert(THEME_PRESETS.length >= 8, 'Cần tối thiểu 8 bộ Theme Preset');
  for (const p of THEME_PRESETS) {
    assert(p.colors && p.colors.background && p.colors.primary, `Theme ${p.id} thiếu bảng màu`);
    assert(p.glass && typeof p.glass.panelOpacity === 'number', `Theme ${p.id} thiếu thông số kính mờ`);
  }
  console.log(`  ✓ Đã xác minh ${THEME_PRESETS.length} Theme Presets, ${BUILTIN_WALLPAPERS.length} Hình nền động, ${STARTER_MUSIC.length} Bản nhạc nền!\n`);

  console.log('================================================================');
  console.log('🎉 TẤT CẢ 5 HẠNG MỤC KIỂM THỬ ĐỀU VƯỢT QUA 100% KHÔNG LỖI!');
  console.log('================================================================');
}

runTests().catch((err) => {
  console.error('❌ KIỂM THỬ THẤT BẠI:', err);
  process.exit(1);
});
