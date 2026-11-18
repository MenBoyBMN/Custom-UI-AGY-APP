/**
 * Shared Presets & Default Configuration for AGY UI Studio
 * Works in both Node.js (CommonJS) and Browser Renderer (`window.AGY_PRESETS`).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AGY_PRESETS = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const THEME_PRESETS = [
    {
      id: 'cyberpunk-neon',
      name: 'Cyberpunk Neon 2077',
      badge: 'Signature',
      description: 'Tông đêm Indigo sâu kết hợp điểm nhấn Cyan & Rose tinh tế, dịu mắt khi code đêm.',
      previewGradient: 'linear-gradient(135deg, #090b14 0%, #13182b 58%, #0ea5e9 100%)',
      colors: {
        background: '#090b12',
        foreground: '#f1f5f9',
        card: '#121624',
        sidebar: '#0c0f1a',
        primary: '#38bdf8',
        accent: '#f43f5e',
        border: '#222940',
        userBubble: '#172036',
        aiBubble: '#101420'
      },
      glass: {
        panelOpacity: 0.80,
        backdropBlur: 20,
        borderRadius: 12,
        borderGlow: true,
        glowIntensity: 0.32
      },
      recommended: {
        wallpaperType: 'canvas',
        wallpaperId: 'cyberpunk-city',
        particleType: 'fireflies',
        musicId: 'cyberpunk-synthwave.wav'
      }
    },
    {
      id: 'frosted-aurora',
      name: 'Frosted Aurora Glass',
      badge: 'Dịu mắt',
      description: 'Kính mờ Bắc Cực Quang trong trẻo, chuyển sắc xanh lục bảo trầm và lam biển sâu.',
      previewGradient: 'linear-gradient(135deg, #060d14 0%, #0b2926 58%, #34d399 100%)',
      colors: {
        background: '#070e14',
        foreground: '#f0fdf4',
        card: '#0e1b24',
        sidebar: '#09131a',
        primary: '#34d399',
        accent: '#38bdf8',
        border: '#1c313d',
        userBubble: '#0f292a',
        aiBubble: '#0c1720'
      },
      glass: {
        panelOpacity: 0.78,
        backdropBlur: 24,
        borderRadius: 14,
        borderGlow: false,
        glowIntensity: 0.25
      },
      recommended: {
        wallpaperType: 'canvas',
        wallpaperId: 'aurora-borealis',
        particleType: 'starfield',
        musicId: 'deep-space-ambient.wav'
      }
    },
    {
      id: 'cosmic-nebula',
      name: 'Deep Space Nebula',
      badge: 'Vũ trụ',
      description: 'Không gian thiên hà tĩnh lặng với sắc tím Slate-Violet trầm ấm, chống mỏi mắt.',
      previewGradient: 'linear-gradient(135deg, #080811 0%, #171630 58%, #818cf8 100%)',
      colors: {
        background: '#080911',
        foreground: '#eef2ff',
        card: '#121324',
        sidebar: '#0b0c18',
        primary: '#818cf8',
        accent: '#a78bfa',
        border: '#252645',
        userBubble: '#1c1d38',
        aiBubble: '#101120'
      },
      glass: {
        panelOpacity: 0.80,
        backdropBlur: 20,
        borderRadius: 12,
        borderGlow: false,
        glowIntensity: 0.28
      },
      recommended: {
        wallpaperType: 'canvas',
        wallpaperId: 'nebula-cosmos',
        particleType: 'constellation',
        musicId: 'deep-space-ambient.wav'
      }
    },
    {
      id: 'sakura-lofi',
      name: 'Sakura Lo-Fi Chill',
      badge: 'Lo-Fi',
      description: 'Đêm hoa anh đào trầm ấm, tông hồng khói (Muted Rose) thanh lịch, không gây chói.',
      previewGradient: 'linear-gradient(135deg, #0e0a12 0%, #241524 58%, #f472b6 100%)',
      colors: {
        background: '#0d0a10',
        foreground: '#fdf2f8',
        card: '#19131f',
        sidebar: '#120d16',
        primary: '#f472b6',
        accent: '#fb7185',
        border: '#332232',
        userBubble: '#291a28',
        aiBubble: '#16101b'
      },
      glass: {
        panelOpacity: 0.82,
        backdropBlur: 20,
        borderRadius: 14,
        borderGlow: false,
        glowIntensity: 0.25
      },
      recommended: {
        wallpaperType: 'canvas',
        wallpaperId: 'sakura-night',
        particleType: 'sakura',
        musicId: 'lofi-chill-nights.wav'
      }
    },
    {
      id: 'synthwave-sunset',
      name: 'Synthwave 80s Sunset',
      badge: 'Retro',
      description: 'Hoàng hôn ấm áp với sắc hổ phách (Amber) trên nền than chì sâu, cân bằng thị giác.',
      previewGradient: 'linear-gradient(135deg, #0f0914 0%, #2b142c 58%, #fb923c 100%)',
      colors: {
        background: '#0e0912',
        foreground: '#f8fafc',
        card: '#1b1122',
        sidebar: '#130c18',
        primary: '#fb923c',
        accent: '#f472b6',
        border: '#36203d',
        userBubble: '#2b1830',
        aiBubble: '#160e1c'
      },
      glass: {
        panelOpacity: 0.80,
        backdropBlur: 18,
        borderRadius: 12,
        borderGlow: false,
        glowIntensity: 0.30
      },
      recommended: {
        wallpaperType: 'canvas',
        wallpaperId: 'lofi-sunset-grid',
        particleType: 'starfield',
        musicId: 'cyberpunk-synthwave.wav'
      }
    },
    {
      id: 'matrix-hacker',
      name: 'Matrix Digital Terminal',
      badge: 'Dev CLI',
      description: 'Giao diện Terminal xanh lục bảo trầm chuẩn IDE chuyên nghiệp, độ tương phản tối ưu.',
      previewGradient: 'linear-gradient(135deg, #050b07 0%, #0b2114 58%, #34d399 100%)',
      colors: {
        background: '#060a08',
        foreground: '#ecfdf5',
        card: '#0d1711',
        sidebar: '#08100b',
        primary: '#34d399',
        accent: '#10b981',
        border: '#193023',
        userBubble: '#11261a',
        aiBubble: '#0b140f'
      },
      glass: {
        panelOpacity: 0.84,
        backdropBlur: 14,
        borderRadius: 8,
        borderGlow: false,
        glowIntensity: 0.25
      },
      recommended: {
        wallpaperType: 'canvas',
        wallpaperId: 'matrix-cyber',
        particleType: 'matrix',
        musicId: 'cyberpunk-synthwave.wav'
      }
    },
    {
      id: 'tokyo-rain-zen',
      name: 'Tokyo Rainy Midnight',
      badge: 'Zen Pro',
      description: 'Đêm mưa Tokyo tĩnh lặng, tông xanh đá phiến (Nordic Slate) cực kỳ êm mắt khi làm việc lâu.',
      previewGradient: 'linear-gradient(135deg, #090d14 0%, #162030 58%, #60a5fa 100%)',
      colors: {
        background: '#090c12',
        foreground: '#e2e8f0',
        card: '#121824',
        sidebar: '#0c1018',
        primary: '#60a5fa',
        accent: '#93c5fd',
        border: '#222d40',
        userBubble: '#182438',
        aiBubble: '#101520'
      },
      glass: {
        panelOpacity: 0.82,
        backdropBlur: 20,
        borderRadius: 12,
        borderGlow: false,
        glowIntensity: 0.22
      },
      recommended: {
        wallpaperType: 'svg',
        wallpaperId: 'cosmic-nebula.svg',
        particleType: 'snowfall',
        musicId: 'zen-rain-piano.wav'
      }
    },
    {
      id: 'minimal-oled-pro',
      name: 'Minimalist OLED Pro',
      badge: 'Linear',
      description: 'Đen tuyền Carbon Obsidian chuẩn Linear/Raycast, tinh giản tuyệt đối, không gây xao nhãng.',
      previewGradient: 'linear-gradient(135deg, #050507 0%, #18181b 60%, #a1a1aa 100%)',
      colors: {
        background: '#070709',
        foreground: '#f4f4f5',
        card: '#111114',
        sidebar: '#0b0b0e',
        primary: '#e4e4e7',
        accent: '#a1a1aa',
        border: '#242429',
        userBubble: '#1c1c21',
        aiBubble: '#101013'
      },
      glass: {
        panelOpacity: 0.90,
        backdropBlur: 16,
        borderRadius: 10,
        borderGlow: false,
        glowIntensity: 0.15
      },
      recommended: {
        wallpaperType: 'none',
        wallpaperId: 'none',
        particleType: 'none',
        musicId: 'zen-rain-piano.wav'
      }
    }
  ];

  const BUILTIN_WALLPAPERS = [
    {
      id: 'nebula-cosmos',
      type: 'canvas',
      name: 'Tinh Vân Vũ Trụ 3D (Live 60FPS)',
      badge: 'Canvas 60FPS',
      preview: 'linear-gradient(135deg, #090914, #1e1b4b, #3b82f6)'
    },
    {
      id: 'cyberpunk-city',
      type: 'canvas',
      name: 'Thành Phố Mưa Đêm (Cyber Grid)',
      badge: 'Canvas 60FPS',
      preview: 'linear-gradient(135deg, #090b14, #1e1b4b, #0ea5e9)'
    },
    {
      id: 'aurora-borealis',
      type: 'canvas',
      name: 'Sóng Cực Quang Bắc Cực',
      badge: 'Canvas 60FPS',
      preview: 'linear-gradient(135deg, #040d14, #064e3b, #38bdf8)'
    },
    {
      id: 'sakura-night',
      type: 'canvas',
      name: 'Trăng Đêm Hoa Anh Đào',
      badge: 'Canvas 60FPS',
      preview: 'linear-gradient(135deg, #0e0a12, #331832, #f472b6)'
    },
    {
      id: 'lofi-sunset-grid',
      type: 'canvas',
      name: 'Chân Trời Hoàng Hôn 80s',
      badge: 'Canvas 60FPS',
      preview: 'linear-gradient(135deg, #110918, #4a154b, #fb923c)'
    },
    {
      id: 'matrix-cyber',
      type: 'canvas',
      name: 'Mưa Ký Tự Ma Trận (Matrix)',
      badge: 'Canvas 60FPS',
      preview: 'linear-gradient(135deg, #040a06, #064e3b, #10b981)'
    },
    {
      id: 'cosmic-nebula.svg',
      type: 'svg',
      name: 'Thiên Hà Xoay Chuyển (SVG)',
      badge: 'Vector SVG',
      preview: 'linear-gradient(135deg, #0c0a1d, #312e81, #818cf8)'
    },
    {
      id: 'cyberpunk-grid.svg',
      type: 'svg',
      name: 'Chân Trời Retro (SVG)',
      badge: 'Vector SVG',
      preview: 'linear-gradient(135deg, #140a24, #7c2d12, #38bdf8)'
    },
    {
      id: 'aurora-borealis.svg',
      type: 'svg',
      name: 'Dải Lụa Cực Quang (SVG)',
      badge: 'Vector SVG',
      preview: 'linear-gradient(135deg, #040d14, #065f46, #38bdf8)'
    },
    {
      id: 'sakura-moonlight.svg',
      type: 'svg',
      name: 'Ánh Trăng Sakura (SVG)',
      badge: 'Vector SVG',
      preview: 'linear-gradient(135deg, #110918, #2e142d, #f472b6)'
    }
  ];

  const STARTER_MUSIC = [
    {
      id: 'lofi-chill-nights.wav',
      name: 'Lo-Fi Chill Study Beats',
      artist: 'AGY Studio Offline Audio',
      genre: 'Lo-Fi Chill'
    },
    {
      id: 'cyberpunk-synthwave.wav',
      name: 'Cyberpunk 2077 Neon Arpeggio',
      artist: 'AGY Studio Offline Audio',
      genre: 'Synthwave'
    },
    {
      id: 'deep-space-ambient.wav',
      name: 'Deep Space Cosmic Nebula',
      artist: 'AGY Studio Offline Audio',
      genre: 'Ambient Space'
    },
    {
      id: 'zen-rain-piano.wav',
      name: 'Rainy Tokyo Midnight Piano',
      artist: 'AGY Studio Offline Audio',
      genre: 'Zen & Rain'
    }
  ];

  const DEFAULT_CONFIG = {
    enabled: true,
    activePresetId: 'tokyo-rain-zen',
    colors: { ...THEME_PRESETS[6].colors },
    glass: { ...THEME_PRESETS[6].glass },
    typography: {
      uiFont: "'Inter', 'Segoe UI', system-ui, sans-serif",
      codeFont: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
      fontScale: 100
    },
    wallpaper: {
      enabled: true,
      sourceType: 'svg', // 'canvas' | 'svg' | 'custom-file' | 'none'
      builtinId: 'cosmic-nebula.svg',
      customFilePath: '',
      customFileMime: '',
      autoSyncColors: true,
      syncedForPath: '',
      dimming: 0.58, // 0..0.90 overlay darkness so text stays 100% readable and calm
      blur: 4,       // 0..24px background blur
      saturation: 105,
      playbackRate: 1.0
    },
    music: {
      enabled: false,
      autoplay: false,
      volume: 0.40,
      loop: true,
      showMiniPlayer: true,
      activeTrackId: 'lofi-chill-nights.wav',
      customTracks: [] // Array of { id, name, filePath, mime }
    },
    soundEffects: {
      typingSound: 'holy-panda', // 'off' | 'mx-blue' | 'holy-panda' | 'typewriter' | 'scifi-bubble'
      typingVolume: 0.30,
      sendSound: true
    },
    effects: {
      particles: 'fireflies', // 'none' | 'starfield' | 'sakura' | 'snowfall' | 'fireflies' | 'matrix' | 'constellation'
      particleDensity: 35,    // 15..120 (lower default density for cleaner reading)
      particleSpeed: 0.8,
      cursorEffect: 'none',   // 'none' | 'neon-trail' | 'click-ripple' | 'spotlight'
      promptNeonGlow: true,
      messageSlideAnimation: true,
      crtScanlines: false,
      smartEcoMode: true // Automatically pause animations when window is minimized/unfocused
    },
    layout: {
      sidebarPosition: 'left',       // 'left' | 'right' | 'floating-autohide'
      chatWidth: 'wide',             // 'auto' | 'narrow' | 'default' | 'standard' | 'wide' | 'fill' | 'full' | 'custom'
      chatCustomWidth: 920,          // Custom max-width in px (520..1600) when chatWidth === 'custom'
      messageStyle: 'glass-cards',   // 'glass-cards' | 'chat-bubbles' | 'minimal'
      promptStyle: 'floating-island',// 'floating-island' | 'docked'
      promptWidth: 'match-chat',     // 'match-chat' | 'narrow' | 'compact' | 'medium' | 'custom'
      promptCustomWidth: 720,        // Custom prompt max-width in px (460..1400) when promptWidth === 'custom'
      zenMode: false,
      showInAppButton: true          // Floating button inside AGY App (hotkey Ctrl+Shift+Y always works)
    },
    customCss: ''
  };

  return {
    THEME_PRESETS,
    BUILTIN_WALLPAPERS,
    STARTER_MUSIC,
    DEFAULT_CONFIG
  };
});
