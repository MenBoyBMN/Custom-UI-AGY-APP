/**
 * Packages AGY UI Studio into:
 * 1. Full Standalone Windows Bundle: `release/AGY-UI-Studio-win32-x64/AGY-UI-Studio.exe`
 * 2. Convenient Root-Level Native Windows Executable: `AGY-UI-Studio.exe` (with custom icon)
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const packager = require('@electron/packager');

const ROOT_DIR = path.resolve(__dirname, '..');

async function buildExe() {
  console.log('================================================================');
  console.log('📦 ĐANG ĐÓNG GÓI AGY UI STUDIO THÀNH FILE .EXE...');
  console.log('================================================================');

  try {
    execSync('taskkill /F /IM AGY-UI-Studio.exe', { stdio: 'ignore' });
  } catch (_) {}

  const outDir = path.join(ROOT_DIR, 'release');
  const iconPath = path.join(ROOT_DIR, 'assets', 'icon.ico');

  const appPaths = await packager({
    dir: ROOT_DIR,
    name: 'AGY-UI-Studio',
    platform: 'win32',
    arch: 'x64',
    out: outDir,
    overwrite: true,
    asar: false,
    prune: true,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    ignore: [
      /^\/release($|\/)/,
      /^\/test($|\/)/,
      /^\/scripts($|\/)/,
      /^\/node_modules($|\/)/,
      /^\/\.git($|\/)/,
      /^\/\.gitignore$/,
      /^\/package-lock\.json$/,
      /^\/Khoi_Chay_AGY_UI_Studio\.bat$/,
      /AGY-UI-Studio\.exe$/
    ]
  });

  console.log('✓ Đã đóng gói bộ cài đặt độc lập tại:', appPaths[0]);

  // Also compile a convenient root-level AGY-UI-Studio.exe launcher using built-in .NET csc.exe
  const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
  if (fs.existsSync(cscPath)) {
    const csSource = `
using System;
using System.IO;
using System.Diagnostics;
using System.Windows.Forms;

class Program {
    [STAThread]
    static void Main() {
        try {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string packagedExe = Path.Combine(baseDir, "release", "AGY-UI-Studio-win32-x64", "AGY-UI-Studio.exe");
            string devElectron = Path.Combine(baseDir, "node_modules", "electron", "dist", "electron.exe");

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.WorkingDirectory = baseDir;
            psi.UseShellExecute = false;

            if (File.Exists(packagedExe)) {
                psi.FileName = packagedExe;
            } else if (File.Exists(devElectron)) {
                psi.FileName = devElectron;
                psi.Arguments = "\\"" + baseDir.TrimEnd('\\\\') + "\\"";
            } else {
                MessageBox.Show("Không tìm thấy bộ thực thi AGY-UI-Studio.exe!", "AGY UI Studio", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            Process.Start(psi);
        } catch (Exception ex) {
            MessageBox.Show("Lỗi khởi chạy AGY UI Studio: " + ex.Message, "AGY UI Studio", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
`;
    const csFile = path.join(ROOT_DIR, 'scripts', '_launcher.cs');
    const rootExe = path.join(ROOT_DIR, 'AGY-UI-Studio.exe');
    fs.writeFileSync(csFile, csSource, 'utf8');
    try {
      const iconArg = fs.existsSync(iconPath) ? `"/win32icon:${iconPath}"` : '';
      execSync(
        `"${cscPath}" /nologo /target:winexe "/out:${rootExe}" ${iconArg} /r:System.Windows.Forms.dll "${csFile}"`,
        { stdio: 'inherit' }
      );
      console.log('✓ Đã tạo file chạy nhanh tại thư mục gốc:', rootExe);
    } finally {
      if (fs.existsSync(csFile)) fs.unlinkSync(csFile);
    }
  }

  console.log('================================================================');
  console.log('🎉 ĐÓNG GÓI .EXE HOÀN TẤT THÀNH CÔNG!');
  console.log('================================================================');
}

buildExe().catch((err) => {
  console.error('❌ Lỗi khi đóng gói .exe:', err);
  process.exit(1);
});
