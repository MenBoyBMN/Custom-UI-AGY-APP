# AGY UI Studio

**Bộ công cụ tùy biến giao diện, hình nền động, âm nhạc, hiệu ứng môi trường và bố cục chuyên sâu cho Antigravity Desktop App trên Windows.**

![Platform](https://img.shields.io/badge/Platform-Windows%20x64-0ea5e9?style=flat-square)
![Electron](https://img.shields.io/badge/Electron-33.2.0-47848f?style=flat-square)
![Version](https://img.shields.io/badge/Version-v1.0.0-34d399?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-a78bfa?style=flat-square)

---

## Tổng quan

**AGY UI Studio** giúp bạn biến hóa giao diện của **Antigravity Desktop App** (phiên bản Electron App độc lập, không nhầm với Antigravity IDE) trở nên dịu mắt, cá nhân hóa và giàu cảm hứng làm việc hơn với Live Preview thời gian thực, gói tài nguyên Starter Pack hoạt động 100% offline và trình chỉnh sửa **In-App Studio (`Ctrl + Shift + Y`)** tích hợp ngay bên trong Antigravity App.

> [!NOTE]
> Toàn bộ tùy biến chỉ tác động ở tầng giao diện Frontend (`Renderer`), tự động sao lưu `app.asar` gốc trước khi áp dụng và hỗ trợ **Khôi phục gốc 100%** chỉ với 1 cú nhấp chuột.

---

## Tính năng nổi bật

### 1. Bảng màu & Kính mờ (8 Preset dịu mắt)
Tích hợp sẵn 8 bộ theme cân chỉnh độ tương phản chuẩn **Eye-Comfort Dark Mode**:
- **Cyberpunk Neon 2077** (`Signature`)
- **Frosted Aurora Glass** (`Dịu mắt`)
- **Deep Space Nebula** (`Vũ trụ`)
- **Sakura Lo-Fi Chill** (`Lo-Fi`)
- **Synthwave 80s Sunset** (`Retro`)
- **Matrix Digital Terminal** (`Dev CLI`)
- **Tokyo Rainy Midnight** (`Zen Pro`)
- **Minimalist OLED Pro** (`Linear`)

Hỗ trợ tùy chỉnh chi tiết **9 color token** (`background`, `foreground`, `sidebar`, `card`, `primary`, `accent`, `userBubble`, `aiBubble`, `border`) và thông số **Glassmorphism** (`panelOpacity`, `backdropBlur`, `borderRadius`, `borderGlow`, `glowIntensity`).

### 2. Hình nền động & Đồng bộ màu thông minh
- **6 hình nền Canvas 60FPS**: Tinh Vân Vũ Trụ 3D (`nebula-cosmos`), Thành Phố Mưa Đêm (`cyberpunk-city`), Sóng Cực Quang Bắc Cực (`aurora-borealis`), Trăng Đêm Hoa Anh Đào (`sakura-night`), Chân Trời Hoàng Hôn 80s (`lofi-sunset-grid`), Mưa Ký Tự Ma Trận (`matrix-cyber`).
- **4 hình nền Vector SVG động Offline**: `cosmic-nebula.svg`, `cyberpunk-grid.svg`, `aurora-borealis.svg`, `sakura-moonlight.svg`.
- **File cá nhân**: Hỗ trợ ảnh tĩnh, ảnh động và video (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.svg`, `.mp4`, `.webm`), tùy chỉnh làm tối nền (Dimming), làm mờ (Blur), độ bão hòa (Saturation), tốc độ phát (Playback Rate) và tự động đồng bộ màu chủ đạo (`autoSyncColors`).

### 3. Nhạc nền Offline & Âm thanh gõ phím cơ
- **4 bản nhạc WAV Starter Pack** phát hoàn toàn offline:
  - *Lo-Fi Chill Study Beats* (`lofi-chill-nights.wav`)
  - *Cyberpunk 2077 Neon Arpeggio* (`cyberpunk-synthwave.wav`)
  - *Deep Space Cosmic Nebula* (`deep-space-ambient.wav`)
  - *Rainy Tokyo Midnight Piano* (`zen-rain-piano.wav`)
- Hỗ trợ thêm danh sách nhạc cá nhân (`.mp3`, `.wav`, `.ogg`, `.flac`, `.m4a`) cùng **Mini Music Player** ngay trong Antigravity App.
- **Âm thanh bàn phím cơ tổng hợp**: `holy-panda`, `mx-blue`, `typewriter`, `scifi-bubble` (hoặc `off`) kèm âm thanh khi gửi tin nhắn.

### 4. Hiệu ứng môi trường & Tiết kiệm tài nguyên
- **6 hiệu ứng hạt ánh sáng**: `starfield`, `sakura`, `snowfall`, `fireflies`, `matrix`, `constellation` với thanh chỉnh mật độ và tốc độ.
- **Hiệu ứng tương tác**: Con trỏ (`neon-trail`, `click-ripple`, `spotlight`), viền sáng ô Prompt, hiệu ứng trượt tin nhắn, CRT Scanlines.
- **Smart Eco Mode**: Tự động tạm dừng vòng lặp animation khi cửa sổ thu nhỏ hoặc không focus để tiết kiệm CPU/GPU.

### 5. Bố cục, Kiểu chữ, Custom CSS & Sao lưu
- Tùy chỉnh vị trí Sidebar (`left`, `right`, `floating-autohide`), độ rộng khung Chat (`auto`, `narrow`, `default`, `standard`, `wide`, `fill`, `full`, `custom` px), kiểu tin nhắn (`glass-cards`, `chat-bubbles`, `minimal`), kiểu & độ rộng ô Prompt (`floating-island`, `docked`), Zen Mode.
- Tùy chỉnh `uiFont`, `codeFont` và `fontScale`.
- Nhúng **Custom CSS** riêng và **Xuất / Nhập file cấu hình `.json`** để sao lưu hoặc chia sẻ theme.

### 6. Chỉnh trực tiếp ngay trong Antigravity App
- Sau khi áp dụng theme, ngay trên giao diện Antigravity App sẽ có nút **AGY Studio** và phím tắt toàn cục **`Ctrl + Shift + Y`** (`Esc` để đóng) giúp tinh chỉnh mọi thứ theo thời gian thực.

---

## Cài đặt & Sử dụng

### Cách 1: Tải bản Portable `.exe` (Khuyên dùng — Không cần cài Node.js)
1. Truy cập trang **[Releases](https://github.com/MenBoyBMN/Custom-UI-AGY-APP/releases)** và tải file `AGY-UI-Studio-v1.0.0-win32-x64.zip`.
2. Giải nén toàn bộ thư mục `.zip` vào một nơi cố định trên máy (ví dụ `D:\Tools\AGY-UI-Studio\`).
3. Chạy file **`AGY-UI-Studio.exe`**.

### Cách 2: Chạy từ mã nguồn (Dành cho Developer)
Yêu cầu: **Windows x64** và **Node.js 18+**.

```bash
# 1. Clone repository
git clone https://github.com/MenBoyBMN/Custom-UI-AGY-APP.git
cd Custom-UI-AGY-APP

# 2. Cài đặt dependencies
npm install

# 3. Khởi chạy ứng dụng
npm start
```

Hoặc tự đóng gói ra bản `.exe` độc lập (output tại `release/AGY-UI-Studio-win32-x64/` và launcher `AGY-UI-Studio.exe` ở thư mục gốc):

```bash
npm run pack-exe
```

---

## Hướng dẫn nhanh

1. **Nhận diện Antigravity App**: Khi mở AGY UI Studio, công cụ sẽ tự quét các vị trí cài đặt chuẩn trên Windows (như `%LOCALAPPDATA%\Programs\Antigravity`). Nếu bạn cài ở thư mục khác, nhấn **Chọn thư mục** và trỏ tới thư mục gốc chứa `Antigravity.exe` và `resources/app.asar`.
2. **Thiết kế & Xem trước**: Chọn Preset hoặc tự tinh chỉnh màu sắc, kính mờ, hình nền, nhạc nền, hiệu ứng và bố cục ở cột giữa — khung **LIVE PREVIEW** bên phải sẽ cập nhật ngay lập tức.
3. **Áp dụng vào AGY**: Nhấn **Áp dụng vào AGY**.
   - Lần đầu tiên: Studio sẽ sao lưu `app.asar` gốc thành `app.asar.original.bak` (kèm checksum SHA256), nạp Starter Pack & cấu hình vào `resources/agy-custom-ui/` và patch `dist/utils.js`, `dist/preload.js` trong `resources/app.asar`. Nếu Antigravity App đang chạy bị khóa file, Studio sẽ tự đóng và mở lại an toàn.
   - Các lần chỉnh tiếp theo: Studio sử dụng cơ chế `hot-sync-resources` cập nhật trực tiếp vào `resources/agy-custom-ui/` mà không cần ghi lại `app.asar`.
4. **Tùy biến trong lúc dùng**: Mở Antigravity App và nhấn **`Ctrl + Shift + Y`** (hoặc bấm nút **AGY Studio**) để chỉnh sửa trực tiếp ngay trong app.
5. **Khôi phục về nguyên bản**: Nhấn nút **Khôi phục gốc** trên thanh header của AGY UI Studio để phục hồi `app.asar` nguyên bản từ `app.asar.original.bak` và dọn sạch thư mục `resources/agy-custom-ui/`.

---

## Cơ chế an toàn & Bảo vệ cập nhật

- **Tách biệt AGY App và AGY IDE**: Bộ quét (`src/main/agyScanner.js`) tự động từ chối thư mục `Antigravity IDE` (chứa `resources/app/product.json`) để tránh patch nhầm.
- **Bảo toàn ASAR Integrity**: Khi đóng gói lại `resources/app.asar` (`src/main/asarPatcher.js`), SHA256 block integrity header của từng file sửa đổi được tính toán lại chuẩn xác.
- **Chống ghi đè khi AGY App tự cập nhật**: File `app.asar.original.bak.meta.json` lưu phiên bản và SHA256 bản gốc. Nếu Antigravity App tự update lên phiên bản mới (xóa marker patch), công cụ sẽ tự động làm mới bản backup theo version mới và không bao giờ ghi đè bản `app.asar` mới bằng backup cũ.
- **Chống trùng tên media cá nhân**: Ảnh/video/nhạc cá nhân khi chép vào `resources/agy-custom-ui/user-media/` đều được gắn tiền tố hash nội dung (`<sha1-8chars>-<filename>`).

---

## Cấu trúc mã nguồn

```text
Custom AGY/
├── assets/
│   ├── icon.ico / icon.png            # Biểu tượng ứng dụng
│   └── starter-pack/
│       ├── music/                     # 4 file nhạc WAV offline
│       └── wallpapers/                # 4 file hình nền động SVG offline
├── scripts/
│   ├── buildExe.js                    # Script đóng gói Portable EXE (@electron/packager + launcher)
│   └── generateStarterAssets.js       # Script tạo nhạc WAV, SVG & icon Starter Pack
├── src/
│   ├── main/
│   │   ├── main.js                    # Electron Main Process & IPC handlers
│   │   ├── preload.js                 # Preload bridge cho Studio UI
│   │   ├── agyScanner.js              # Quét & xác thực thư mục gốc Antigravity App
│   │   └── asarPatcher.js             # Đọc/rebuild ASAR, SHA256 integrity, Apply & Restore
│   ├── renderer/
│   │   ├── index.html                 # Giao diện chính AGY UI Studio & Live Preview
│   │   ├── styles.css                 # Styling cho Studio UI
│   │   ├── presets.js                 # 8 Theme Presets, Built-in Wallpapers, Music & Default Config
│   │   └── app.js                     # Logic điều khiển Studio UI & đồng bộ Preview
│   └── injected/
│       └── agyInjectorRuntime.js      # Runtime nhúng vào Antigravity App & In-App Studio Drawer
├── test/
│   ├── verifyPatcherAndAssets.js      # Unit/Integration test (Assets, Syntax, Scanner, ASAR Sandbox)
│   └── verifyElectronRuntime.js       # E2E test trên Electron runtime thật
├── Khoi_Chay_AGY_UI_Studio.bat        # Script khởi chạy nhanh trên Windows
├── package.json
└── LICENSE
```

---

## Kiểm thử (Testing)

Chạy kiểm thử đơn vị & tích hợp ASAR (trên sandbox tạm, không ảnh hưởng bản Antigravity thật):

```bash
npm test
```

Chạy kiểm thử E2E bằng Electron thật (kiểm tra UI Studio, Blob media, In-App Drawer và ASAR patch/restore):

```bash
npm run test:e2e
```

---

## Giấy phép

Phát hành theo giấy phép [MIT License](LICENSE).
