(function () {
  const { THEME_PRESETS, BUILTIN_WALLPAPERS, DEFAULT_CONFIG } = window.AGY_PRESETS;
  const {
    createVisualEngine,
    createMusicController,
    playKeySound,
    playSendChime,
    syncConfigColorsFromWallpaper,
    resolveChatWidthSpec,
    resolvePromptWidthSpec,
    getContrastTextColor,
    hexToRgb,
    deepMerge,
    escapeHtml
  } = window.__AGY_RUNTIME_FACTORY__;

  let state = {
    agyStatus: null,
    activeSection: 'themes',
    config: deepMerge(DEFAULT_CONFIG, {})
  };

  // DOM References
  const statusDot = document.getElementById('agy-status-dot');
  const statusText = document.getElementById('agy-status-text');
  const patchBadge = document.getElementById('agy-patch-badge');
  const pathDisplay = document.getElementById('agy-path-display');
  const controlsPanel = document.getElementById('studio-controls-panel');
  const masterToggle = document.getElementById('master-enable-toggle');
  const mockWindow = document.getElementById('agy-mock-window');
  const mockBody = document.getElementById('agy-mock-body');
  const mockSidebar = document.getElementById('agy-mock-sidebar');
  const mockMessages = document.getElementById('agy-mock-messages');
  const mockMsgUser = document.getElementById('mock-msg-user');
  const mockMsgAi = document.getElementById('mock-msg-ai');
  const mockPromptWrap = document.getElementById('agy-mock-prompt-wrap');
  const mockPromptInput = document.getElementById('mock-prompt-input');
  const mockSendBtn = document.getElementById('mock-send-btn');
  const mockInAppPill = document.getElementById('mock-inapp-pill');
  const folderModal = document.getElementById('folder-modal');
  const modalPathInput = document.getElementById('modal-path-input');
  const modalErrorMsg = document.getElementById('modal-error-msg');
  const toastEl = document.getElementById('studio-toast');

  let toastTimer = null;
  function showToast(msg, isError = false) {
    toastEl.textContent = msg;
    toastEl.style.borderColor = isError ? 'rgba(244, 63, 94, 0.45)' : 'rgba(255, 255, 255, 0.16)';
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3400);
  }

  let saveDraftTimer = null;
  function scheduleSaveDraft() {
    if (!window.studioAPI) return;
    if (saveDraftTimer) clearTimeout(saveDraftTimer);
    saveDraftTimer = setTimeout(() => {
      saveDraftTimer = null;
      window.studioAPI.saveDraft(state.config);
    }, 250);
  }

  function setLabelText(id, val) {
    const el = controlsPanel.querySelector(id);
    if (el) el.textContent = String(val);
  }

  // Mount Live Preview Engine inside #agy-mock-window
  const previewVisualEngine = createVisualEngine(mockWindow);
  const previewMusicController = createMusicController((mState) => {
    const playBtn = document.getElementById('prev-m-play');
    const labelEl = document.getElementById('prev-m-label');
    if (playBtn) playBtn.textContent = mState.isPlaying ? '⏸ Tạm dừng' : '▶ Nghe nhạc';
    if (labelEl) labelEl.textContent = mState.trackName;
  });

  document.getElementById('prev-m-play').addEventListener('click', async () => {
    await previewMusicController.togglePlay();
    scheduleSaveDraft();
    if (state.activeSection === 'music') renderControlsSection();
  });
  document.getElementById('prev-m-prev').addEventListener('click', async () => {
    await previewMusicController.prevTrack();
    scheduleSaveDraft();
    if (state.activeSection === 'music') renderControlsSection();
  });
  document.getElementById('prev-m-next').addEventListener('click', async () => {
    await previewMusicController.nextTrack();
    scheduleSaveDraft();
    if (state.activeSection === 'music') renderControlsSection();
  });

  function triggerMockMessageSlide() {
    if (!state.config.enabled || !state.config.effects?.messageSlideAnimation) return;
    try {
      mockMsgUser.animate(
        [
          { opacity: 0, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'translateY(0)' }
        ],
        { duration: 220, easing: 'ease-out' }
      );
    } catch (_) {}
  }

  // Interactive Mock Prompt Input (Typing Sound FX + Send Chime)
  mockPromptInput.addEventListener('keydown', (e) => {
    const sfx = state.config.soundEffects || {};
    if (e.key === 'Enter') {
      e.preventDefault();
      if (state.config.enabled && sfx.sendSound) playSendChime(sfx.typingVolume);
      if (mockPromptInput.value.trim()) {
        mockMsgUser.querySelector('.mock-msg-text').textContent = mockPromptInput.value.trim();
        mockPromptInput.value = '';
        triggerMockMessageSlide();
      }
      return;
    }
    if (
      state.config.enabled &&
      sfx.typingSound &&
      sfx.typingSound !== 'off' &&
      (e.key.length === 1 || e.key === 'Backspace')
    ) {
      playKeySound(sfx.typingSound, sfx.typingVolume, false);
    }
  });

  mockSendBtn.addEventListener('click', () => {
    const sfx = state.config.soundEffects || {};
    if (state.config.enabled && sfx.sendSound) playSendChime(sfx.typingVolume);
    if (mockPromptInput.value.trim()) {
      mockMsgUser.querySelector('.mock-msg-text').textContent = mockPromptInput.value.trim();
      mockPromptInput.value = '';
      triggerMockMessageSlide();
    }
  });

  function updateAgyStatusUI(status) {
    state.agyStatus = status;
    if (status && status.valid) {
      statusDot.className = 'status-dot ok';
      statusText.textContent = `Đã kết nối Antigravity App (v${status.version || '2.x'})`;
      pathDisplay.textContent = status.path;
      if (status.isPatched) {
        patchBadge.className = 'patch-badge patched';
        patchBadge.textContent = '✓ ĐÃ NẠP CUSTOM UI';
      } else {
        patchBadge.className = 'patch-badge';
        patchBadge.textContent = 'NGUYÊN GỐC (ORIGINAL)';
      }
    } else {
      statusDot.className = 'status-dot err';
      statusText.textContent = 'Chưa tìm thấy thư mục gốc Antigravity App';
      patchBadge.className = 'patch-badge';
      patchBadge.textContent = 'CHƯA CHỌN';
      pathDisplay.textContent = status?.reason || 'Nhấn Chọn Thư Mục để trỏ tới Antigravity App';
    }
  }

  let previewCustomCssEl = document.getElementById('studio-preview-custom-css');
  if (!previewCustomCssEl) {
    previewCustomCssEl = document.createElement('style');
    previewCustomCssEl.id = 'studio-preview-custom-css';
    document.head.appendChild(previewCustomCssEl);
  }

  function syncLivePreview(options = {}) {
    const { syncAudio = false } = options;
    const cfg = state.config;
    masterToggle.checked = Boolean(cfg.enabled);

    const isEnabled = Boolean(cfg.enabled);
    const neutralColors = {
      background: '#131316',
      foreground: '#f4f4f5',
      card: '#1c1c21',
      sidebar: '#18181b',
      primary: '#71717a',
      accent: '#a1a1aa',
      border: '#27272a',
      userBubble: '#27272a',
      aiBubble: '#1c1c21'
    };
    const c = isEnabled ? cfg.colors || {} : neutralColors;
    const g = isEnabled ? cfg.glass || {} : { panelOpacity: 0.96, backdropBlur: 0, borderRadius: 8, borderGlow: false, glowIntensity: 0 };
    const l = isEnabled ? cfg.layout || {} : { sidebarPosition: 'left', chatWidth: 'default', promptStyle: 'floating-island', promptWidth: 'match-chat', zenMode: false, showInAppButton: true };
    const fx = isEnabled ? cfg.effects || {} : { promptNeonGlow: false };
    const typo = isEnabled ? cfg.typography || {} : {};

    previewCustomCssEl.textContent =
      isEnabled && cfg.customCss && cfg.customCss.trim()
        ? `@scope (#agy-mock-window) {\n${cfg.customCss}\n}`
        : '';

    const cardRgb = hexToRgb(c.card, '21, 12, 40');
    const sidebarRgb = hexToRgb(c.sidebar, '14, 7, 28');
    const userRgb = hexToRgb(c.userBubble || c.card, cardRgb);
    const aiRgb = hexToRgb(c.aiBubble || c.card, cardRgb);
    const primaryRgb = hexToRgb(c.primary, '6, 182, 212');
    const accentRgb = hexToRgb(c.accent, '244, 63, 94');
    const borderRgb = hexToRgb(c.border, '59, 29, 110');
    const bgRgb = hexToRgb(c.background, '11, 6, 22');
    const fgRgb = hexToRgb(c.foreground, '248, 250, 252');
    const opacity = isEnabled ? Number(g.panelOpacity ?? 0.72) : 0.96;
    const blur = isEnabled ? Number(g.backdropBlur ?? 16) : 0;
    const radius = isEnabled ? Number(g.borderRadius ?? 14) : 8;
    const primaryHex = c.primary || '#06b6d4';
    const accentHex = c.accent || '#f43f5e';
    const fgHex = c.foreground || '#f8fafc';

    mockWindow.style.background = c.background || '#090c12';
    mockWindow.style.color = fgHex;
    mockWindow.style.borderColor = `rgba(${borderRgb}, 0.48)`;
    mockWindow.style.fontFamily = typo.uiFont || "'Inter', system-ui, sans-serif";
    mockWindow.style.fontSize = `${Math.round((Number(typo.fontScale || 100) / 100) * 14)}px`;

    // Titlebar
    const mockTitlebar = mockWindow.querySelector('.agy-mock-titlebar');
    if (mockTitlebar) {
      mockTitlebar.style.background = `rgba(${sidebarRgb}, ${Math.min(0.92, opacity + 0.08)})`;
      mockTitlebar.style.borderBottomColor = `rgba(${borderRgb}, 0.42)`;
      mockTitlebar.style.color = fgHex;
    }
    const mockWinShortcut = mockWindow.querySelector('.mock-win-shortcut');
    if (mockWinShortcut) {
      mockWinShortcut.style.color = primaryHex;
    }

    // Sidebar layout & glassmorphism
    mockBody.style.flexDirection = l.sidebarPosition === 'right' ? 'row-reverse' : 'row';
    mockSidebar.style.display = l.zenMode ? 'none' : 'flex';
    mockSidebar.style.opacity = l.sidebarPosition === 'floating-autohide' ? '0.45' : '1';
    mockSidebar.style.background = `rgba(${sidebarRgb}, ${opacity})`;
    mockSidebar.style.backdropFilter = `blur(${blur}px)`;
    mockSidebar.style.borderColor = `rgba(${borderRgb}, 0.42)`;

    const mockSbBtn = mockSidebar.querySelector('.mock-sb-btn');
    if (mockSbBtn) {
      mockSbBtn.style.background = `rgba(${primaryRgb}, 0.14)`;
      mockSbBtn.style.borderColor = `rgba(${primaryRgb}, 0.34)`;
      mockSbBtn.style.color = fgHex;
      mockSbBtn.style.boxShadow = 'none';
    }
    mockSidebar.querySelectorAll('.mock-sb-item').forEach((item) => {
      if (item.classList.contains('active')) {
        item.style.background = `rgba(${primaryRgb}, 0.14)`;
        item.style.border = `1px solid rgba(${primaryRgb}, 0.28)`;
        item.style.color = fgHex;
        item.style.boxShadow = `inset 2.5px 0 0 ${primaryHex}`;
      } else {
        item.style.background = 'transparent';
        item.style.border = '1px solid transparent';
        item.style.color = `rgba(${fgRgb}, 0.76)`;
        item.style.boxShadow = 'none';
      }
    });
    const mockSbFooter = mockSidebar.querySelector('.mock-sb-footer');
    if (mockSbFooter) {
      mockSbFooter.style.color = `rgba(${fgRgb}, 0.56)`;
    }

    // Chat width & messages
    const chatWidthSpec = resolveChatWidthSpec(l);
    mockMessages.style.maxWidth = chatWidthSpec.previewWidth;

    mockMsgUser.style.background = `rgba(${userRgb}, ${Math.min(0.92, opacity + 0.06)})`;
    mockMsgUser.style.backdropFilter = `blur(${blur}px)`;
    mockMsgUser.style.borderRadius = `${radius}px`;
    mockMsgUser.style.borderColor = g.borderGlow ? `rgba(${primaryRgb}, 0.38)` : `rgba(${borderRgb}, 0.45)`;
    mockMsgUser.style.color = fgHex;
    mockMsgUser.style.boxShadow = g.borderGlow
      ? `0 6px 20px rgba(0, 0, 0, 0.28), 0 0 14px rgba(${primaryRgb}, ${Number(g.glowIntensity || 0.3) * 0.22})`
      : '0 4px 14px rgba(0, 0, 0, 0.2)';
    const userRole = mockMsgUser.querySelector('.mock-msg-role');
    if (userRole) userRole.style.color = primaryHex;

    mockMsgAi.style.background =
      l.messageStyle === 'minimal' ? 'transparent' : `rgba(${aiRgb}, ${opacity})`;
    mockMsgAi.style.backdropFilter = l.messageStyle === 'minimal' ? 'none' : `blur(${blur}px)`;
    mockMsgAi.style.borderRadius = l.messageStyle === 'chat-bubbles' ? `${Math.max(16, radius + 4)}px` : `${radius}px`;
    mockMsgAi.style.borderColor =
      l.messageStyle === 'minimal' ? `rgba(${borderRgb}, 0.24)` : `rgba(${borderRgb}, 0.42)`;
    mockMsgAi.style.color = fgHex;
    const aiRole = mockMsgAi.querySelector('.mock-msg-role');
    if (aiRole) aiRole.style.color = accentHex;
    const mockCodeBlock = mockMsgAi.querySelector('.mock-code-block');
    if (mockCodeBlock) {
      mockCodeBlock.style.background = `rgba(${bgRgb}, 0.72)`;
      mockCodeBlock.style.borderColor = `rgba(${borderRgb}, 0.42)`;
      mockCodeBlock.style.color = fgHex;
      mockCodeBlock.style.fontFamily = typo.codeFont || "'JetBrains Mono', Consolas, monospace";
    }

    // Prompt Input
    const isDocked = l.promptStyle === 'docked';
    const promptWidthSpec = resolvePromptWidthSpec(l);
    const previewPromptMaxWidth = isDocked
      ? 'none'
      : promptWidthSpec.previewWidth || chatWidthSpec.previewWidth;
    mockPromptWrap.style.background = `rgba(${cardRgb}, ${Math.min(0.94, opacity + 0.08)})`;
    mockPromptWrap.style.backdropFilter = `blur(${blur}px)`;
    mockPromptWrap.style.borderColor = fx.promptNeonGlow ? `rgba(${primaryRgb}, 0.42)` : `rgba(${borderRgb}, 0.45)`;
    mockPromptWrap.style.boxShadow = fx.promptNeonGlow
      ? `0 8px 24px rgba(0, 0, 0, 0.35), 0 0 14px rgba(${primaryRgb}, 0.16)`
      : '0 6px 20px rgba(0, 0, 0, 0.28)';
    mockPromptWrap.style.maxWidth = previewPromptMaxWidth;
    mockPromptWrap.style.width = isDocked ? 'calc(100% + 36px)' : '100%';
    mockPromptWrap.style.alignSelf = isDocked ? 'stretch' : 'center';
    mockPromptWrap.style.margin = isDocked ? '0 -18px -18px -18px' : '0';
    mockPromptWrap.style.borderRadius = isDocked
      ? `${Math.max(8, radius - 2)}px ${Math.max(8, radius - 2)}px 0 0`
      : `${radius}px`;
    mockPromptWrap.style.borderBottomWidth = isDocked ? '0' : '1px';
    mockPromptInput.style.color = fgHex;
    mockSendBtn.style.background = primaryHex;
    mockSendBtn.style.color = getContrastTextColor(primaryHex);

    mockInAppPill.style.display = l.showInAppButton === false ? 'none' : 'inline-flex';
    mockInAppPill.style.background = `rgba(${cardRgb}, 0.85)`;
    mockInAppPill.style.borderColor = `rgba(${primaryRgb}, 0.38)`;
    mockInAppPill.style.color = fgHex;
    mockInAppPill.style.boxShadow = 'none';

    const mockDotsBtn = mockWindow.querySelector('.mock-dots-btn');
    if (mockDotsBtn) mockDotsBtn.style.color = `rgba(${fgRgb}, 0.75)`;
    const mockOpenIdePill = mockWindow.querySelector('.mock-open-ide-pill');
    if (mockOpenIdePill) {
      mockOpenIdePill.style.background = `rgba(${primaryRgb}, 0.14)`;
      mockOpenIdePill.style.borderColor = `rgba(${primaryRgb}, 0.35)`;
      mockOpenIdePill.style.color = fgHex;
    }

    void previewVisualEngine.syncConfig(cfg);
    if (syncAudio) {
      void previewMusicController.loadAndSync(cfg, false);
    }
    scheduleSaveDraft();
  }

  function renderControlsSection() {
    const sec = state.activeSection;
    const cfg = state.config;

    if (sec === 'themes') {
      const colorTokens = [
        { id: 'c-bg', key: 'background', label: 'Nền chính (Background)', val: cfg.colors.background },
        { id: 'c-fg', key: 'foreground', label: 'Chữ chính (Foreground)', val: cfg.colors.foreground },
        { id: 'c-sidebar', key: 'sidebar', label: 'Thanh bên (Sidebar)', val: cfg.colors.sidebar },
        { id: 'c-card', key: 'card', label: 'Khung thẻ & Chat (Card)', val: cfg.colors.card },
        { id: 'c-primary', key: 'primary', label: 'Màu nhấn chính (Primary)', val: cfg.colors.primary },
        { id: 'c-accent', key: 'accent', label: 'Màu nhấn phụ (Accent)', val: cfg.colors.accent },
        { id: 'c-user-bubble', key: 'userBubble', label: 'Tin nhắn User', val: cfg.colors.userBubble || cfg.colors.card },
        { id: 'c-ai-bubble', key: 'aiBubble', label: 'Tin nhắn AI', val: cfg.colors.aiBubble || cfg.colors.card },
        { id: 'c-border', key: 'border', label: 'Viền khung (Border)', val: cfg.colors.border || '#222d40', span2: true }
      ];

      controlsPanel.innerHTML = `
        <div class="ctrl-card">
          <div class="ctrl-card-title">
            <span class="ctrl-title-left">Bộ Sưu Tập Theme Preset (8 Mẫu Dịu Mắt)</span>
          </div>
          <div class="ctrl-card-sub">Chọn 1 bộ Theme đã cân chỉnh độ tương phản để tự động phối màu, kính mờ, hình nền và hiệu ứng.</div>
          <div class="preset-grid">
            ${THEME_PRESETS.map(
              (p) => `
              <button class="preset-card ${cfg.activePresetId === p.id ? 'active' : ''}" data-preset-id="${p.id}">
                <div class="preset-banner" style="background: ${p.colors.background}">
                  <div class="preset-mini-ui" aria-hidden="true">
                    <div class="preset-mini-sb" style="background: ${p.colors.sidebar}">
                      <div class="preset-mini-sb-bar" style="background: ${p.colors.primary}"></div>
                      <div class="preset-mini-sb-line"></div>
                      <div class="preset-mini-sb-line" style="width: 48%"></div>
                    </div>
                    <div class="preset-mini-chat" style="background: ${p.previewGradient}">
                      <div class="preset-mini-bubble-u" style="background: ${p.colors.userBubble || p.colors.card}"></div>
                      <div class="preset-mini-bubble-a" style="background: ${p.colors.aiBubble || p.colors.card}"></div>
                      <div class="preset-mini-prompt" style="background: ${p.colors.card}; border: 1px solid ${p.colors.border}"></div>
                    </div>
                  </div>
                  <span class="preset-swatches">
                    <span class="preset-swatch-dot" style="background:${p.colors.primary}"></span>
                    <span class="preset-swatch-dot" style="background:${p.colors.accent}"></span>
                  </span>
                  <span class="preset-badge">${p.badge}</span>
                </div>
                <div class="preset-name">${p.name}</div>
                <div class="preset-desc">${p.description}</div>
              </button>
            `
            ).join('')}
          </div>
        </div>

        <div class="ctrl-card">
          <div class="ctrl-card-title">Bảng Màu Chi Tiết &amp; Độ Trong Suốt Kính Mờ</div>
          <div class="ctrl-card-sub">Nhấn vào từng ô màu để tinh chỉnh mã HEX và độ xuyên thấu nhìn xuống hình nền phía sau.</div>
          <div class="color-token-grid">
            ${colorTokens
              .map(
                (t) => `
              <label class="color-token-item ${t.span2 ? 'span-2' : ''}" for="${t.id}">
                <div class="color-token-meta">
                  <span class="color-token-label">${t.label}</span>
                  <span class="color-token-hex" id="${t.id}-hex">${escapeHtml(t.val)}</span>
                </div>
                <input type="color" id="${t.id}" value="${escapeHtml(t.val)}" />
              </label>
            `
              )
              .join('')}
          </div>
          <div class="ctrl-row">
            <span>Độ đặc khung kính <span class="val-pill"><span id="g-opacity-val">${Math.round(cfg.glass.panelOpacity * 100)}</span>%</span></span>
            <input type="range" id="g-opacity" min="0.15" max="0.98" step="0.02" value="${cfg.glass.panelOpacity}" />
          </div>
          <div class="ctrl-row">
            <span>Độ nhòe kính mờ (Blur) <span class="val-pill"><span id="g-blur-val">${cfg.glass.backdropBlur}</span>px</span></span>
            <input type="range" id="g-blur" min="0" max="32" step="1" value="${cfg.glass.backdropBlur}" />
          </div>
          <div class="ctrl-row">
            <span>Độ bo góc khung <span class="val-pill"><span id="g-radius-val">${cfg.glass.borderRadius}</span>px</span></span>
            <input type="range" id="g-radius" min="0" max="26" step="1" value="${cfg.glass.borderRadius}" />
          </div>
          <div class="ctrl-row">
            <span>Viền nhấn ánh sáng dịu (Subtle Glow)</span>
            <input type="checkbox" id="g-glow" ${cfg.glass.borderGlow ? 'checked' : ''} />
          </div>
          <div class="ctrl-row">
            <span>Cường độ ánh sáng viền <span class="val-pill"><span id="g-glow-intensity-val">${Math.round(Number(cfg.glass.glowIntensity ?? 0.3) * 100)}</span>%</span></span>
            <input type="range" id="g-glow-intensity" min="0.1" max="1" step="0.05" value="${Number(cfg.glass.glowIntensity ?? 0.3)}" />
          </div>
        </div>
      `;

      controlsPanel.querySelectorAll('[data-preset-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const preset = THEME_PRESETS.find((p) => p.id === btn.dataset.presetId);
          if (!preset) return;
          cfg.activePresetId = preset.id;
          cfg.colors = { ...preset.colors };
          cfg.glass = { ...preset.glass };
          if (preset.recommended) {
            cfg.wallpaper.enabled = preset.recommended.wallpaperType !== 'none';
            cfg.wallpaper.sourceType = preset.recommended.wallpaperType;
            cfg.wallpaper.builtinId = preset.recommended.wallpaperId;
            cfg.wallpaper.syncedForPath = cfg.wallpaper.customFilePath || '__preset__';
            cfg.effects.particles = preset.recommended.particleType;
            if (preset.recommended.musicId) cfg.music.activeTrackId = preset.recommended.musicId;
          }
          syncLivePreview({ syncAudio: true });
          renderControlsSection();
          showToast(`Đã chọn Theme: ${preset.name}`);
        });
      });

      const bindColor = (id, key) => {
        controlsPanel.querySelector(id)?.addEventListener('input', (e) => {
          cfg.colors[key] = e.target.value;
          setLabelText(`${id}-hex`, e.target.value);
          cfg.activePresetId = 'custom';
          if (cfg.wallpaper) {
            cfg.wallpaper.syncedForPath = cfg.wallpaper.customFilePath || '__manual__';
          }
          syncLivePreview();
        });
      };
      bindColor('#c-bg', 'background');
      bindColor('#c-fg', 'foreground');
      bindColor('#c-card', 'card');
      bindColor('#c-sidebar', 'sidebar');
      bindColor('#c-primary', 'primary');
      bindColor('#c-accent', 'accent');
      bindColor('#c-border', 'border');
      bindColor('#c-user-bubble', 'userBubble');
      bindColor('#c-ai-bubble', 'aiBubble');

      controlsPanel.querySelector('#g-opacity')?.addEventListener('input', (e) => {
        cfg.glass.panelOpacity = parseFloat(e.target.value);
        setLabelText('#g-opacity-val', Math.round(cfg.glass.panelOpacity * 100));
        syncLivePreview();
      });
      controlsPanel.querySelector('#g-blur')?.addEventListener('input', (e) => {
        cfg.glass.backdropBlur = parseInt(e.target.value, 10);
        setLabelText('#g-blur-val', cfg.glass.backdropBlur);
        syncLivePreview();
      });
      controlsPanel.querySelector('#g-radius')?.addEventListener('input', (e) => {
        cfg.glass.borderRadius = parseInt(e.target.value, 10);
        setLabelText('#g-radius-val', cfg.glass.borderRadius);
        syncLivePreview();
      });
      controlsPanel.querySelector('#g-glow')?.addEventListener('change', (e) => {
        cfg.glass.borderGlow = e.target.checked;
        syncLivePreview();
      });
      controlsPanel.querySelector('#g-glow-intensity')?.addEventListener('input', (e) => {
        cfg.glass.glowIntensity = parseFloat(e.target.value);
        setLabelText('#g-glow-intensity-val', Math.round(cfg.glass.glowIntensity * 100));
        syncLivePreview();
      });
    } else if (sec === 'wallpaper') {
      controlsPanel.innerHTML = `
        <div class="ctrl-card">
          <div class="ctrl-card-title">
            <span>Kho Hình Nền Động Tích Hợp Sẵn</span>
            <label class="switch">
              <input type="checkbox" id="wp-enable" ${cfg.wallpaper.enabled ? 'checked' : ''} />
              <span class="slider"></span>
            </label>
          </div>
          <div class="ctrl-card-sub">6 cảnh nền Canvas 60FPS dựng theo thời gian thực + 4 hình nền SVG chuyển động mượt mà.</div>
          <div class="preset-grid">
            ${BUILTIN_WALLPAPERS.map(
              (w) => `
              <button class="preset-card ${
                cfg.wallpaper.sourceType === w.type && cfg.wallpaper.builtinId === w.id ? 'active' : ''
              }" data-wp-id="${w.id}" data-wp-type="${w.type}">
                <div class="preset-banner" style="background: ${w.preview}">
                  <span class="preset-badge">${w.badge}</span>
                </div>
                <div class="preset-name">${w.name}</div>
              </button>
            `
            ).join('')}
          </div>
        </div>

        <div class="ctrl-card">
          <div class="ctrl-card-title">Tải Ảnh / GIF / Video MP4 &amp; WebM Từ Máy</div>
          <div class="ctrl-card-sub">Hỗ trợ PNG, JPG, WebP, ảnh động GIF và Video lặp vô tận MP4, WebM độ phân giải cao.</div>
          <button class="btn-primary-glow" id="btn-pick-custom-wp" style="width:100%;margin-bottom:10px;">
            Chọn File Ảnh / GIF / Video Nền Từ Máy Tính...
          </button>
          <div style="font-size:11px;color:#94a3b8;margin-bottom:10px;word-break:break-all;">
            Đang chọn: <code>${escapeHtml(
              cfg.wallpaper.sourceType === 'custom-file'
                ? cfg.wallpaper.customFilePath
                : `${String(cfg.wallpaper.sourceType || 'none').toUpperCase()} — ${cfg.wallpaper.builtinId || 'none'}`
            )}</code>
          </div>
          <div class="ctrl-row">
            <span>Tự động đồng bộ màu giao diện theo ảnh/video ngoài</span>
            <input type="checkbox" id="wp-auto-sync" ${cfg.wallpaper.autoSyncColors !== false ? 'checked' : ''} />
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <span style="font-size:11.5px;color:#cbd5e1;">Bảng màu đồng bộ:</span>
              ${[
                ['background', 'Nền chính'],
                ['sidebar', 'Thanh dọc trái'],
                ['card', 'Khung Chat'],
                ['userBubble', 'Tin nhắn User'],
                ['primary', 'Màu nhấn chính'],
                ['accent', 'Màu nhấn phụ'],
                ['border', 'Viền khung']
              ]
                .map(
                  ([key, label]) =>
                    `<span title="${label}: ${escapeHtml(cfg.colors[key] || '')}" style="width:16px;height:16px;border-radius:5px;background:${escapeHtml(cfg.colors[key] || '#000')};border:1px solid rgba(255,255,255,0.25);display:inline-block;"></span>`
                )
                .join('')}
            </div>
            <button class="btn-secondary" id="btn-sync-wp-colors" style="white-space:nowrap;">
              Đồng bộ màu ngay
            </button>
          </div>
          <div class="ctrl-row">
            <span>Độ tối lớp phủ nền <span class="val-pill"><span id="wp-dim-val">${Math.round(cfg.wallpaper.dimming * 100)}</span>%</span></span>
            <input type="range" id="wp-dim" min="0" max="0.9" step="0.05" value="${cfg.wallpaper.dimming}" />
          </div>
          <div class="ctrl-row">
            <span>Làm mờ hình nền <span class="val-pill"><span id="wp-blur-val">${cfg.wallpaper.blur}</span>px</span></span>
            <input type="range" id="wp-blur" min="0" max="24" step="1" value="${cfg.wallpaper.blur}" />
          </div>
          <div class="ctrl-row">
            <span>Độ bão hòa màu (Saturation) <span class="val-pill"><span id="wp-sat-val">${cfg.wallpaper.saturation}</span>%</span></span>
            <input type="range" id="wp-sat" min="50" max="180" step="5" value="${cfg.wallpaper.saturation}" />
          </div>
          <div class="ctrl-row">
            <span>Tốc độ chuyển động <span class="val-pill"><span id="wp-speed-val">${cfg.wallpaper.playbackRate}</span>x</span></span>
            <input type="range" id="wp-speed" min="0.25" max="2.5" step="0.25" value="${cfg.wallpaper.playbackRate}" />
          </div>
        </div>
      `;

      controlsPanel.querySelector('#wp-enable')?.addEventListener('change', (e) => {
        cfg.wallpaper.enabled = e.target.checked;
        syncLivePreview();
      });

      controlsPanel.querySelectorAll('[data-wp-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          cfg.wallpaper.enabled = true;
          cfg.wallpaper.sourceType = btn.dataset.wpType;
          cfg.wallpaper.builtinId = btn.dataset.wpId;
          syncLivePreview();
          renderControlsSection();
        });
      });

      controlsPanel.querySelector('#btn-pick-custom-wp')?.addEventListener('click', async () => {
        const res = await window.studioAPI.pickMedia('wallpaper');
        if (res && res.ok) {
          cfg.wallpaper.enabled = true;
          cfg.wallpaper.sourceType = 'custom-file';
          cfg.wallpaper.customFilePath = res.filePath;
          cfg.wallpaper.customFileMime = res.mime;
          let synced = false;
          if (cfg.wallpaper.autoSyncColors !== false && typeof syncConfigColorsFromWallpaper === 'function') {
            const syncRes = await syncConfigColorsFromWallpaper(cfg);
            synced = Boolean(syncRes && syncRes.ok);
          }
          syncLivePreview();
          renderControlsSection();
          showToast(
            synced
              ? `Đã nạp hình nền & đồng bộ màu giao diện theo: ${res.fileName}`
              : `Đã nạp hình nền: ${res.fileName}`
          );
        }
      });

      controlsPanel.querySelector('#wp-auto-sync')?.addEventListener('change', async (e) => {
        cfg.wallpaper.autoSyncColors = e.target.checked;
        if (
          e.target.checked &&
          cfg.wallpaper.sourceType === 'custom-file' &&
          typeof syncConfigColorsFromWallpaper === 'function'
        ) {
          const syncRes = await syncConfigColorsFromWallpaper(cfg);
          if (syncRes && syncRes.ok) {
            syncLivePreview();
            renderControlsSection();
            showToast('Đã tự động đồng bộ màu giao diện theo hình nền ngoài!');
            return;
          }
        }
        syncLivePreview();
      });

      controlsPanel.querySelector('#btn-sync-wp-colors')?.addEventListener('click', async () => {
        if (typeof syncConfigColorsFromWallpaper !== 'function') return;
        const canvasEl = mockWindow.querySelector('.agy-wp-canvas');
        const syncRes = await syncConfigColorsFromWallpaper(cfg, { canvasEl });
        if (syncRes && syncRes.ok) {
          syncLivePreview();
          renderControlsSection();
          showToast('Đã trích xuất & đồng bộ bảng màu khung giao diện theo hình nền!');
        } else {
          showToast('Chưa thể trích xuất màu từ hình nền hiện tại.', true);
        }
      });

      controlsPanel.querySelector('#wp-dim')?.addEventListener('input', (e) => {
        cfg.wallpaper.dimming = parseFloat(e.target.value);
        setLabelText('#wp-dim-val', Math.round(cfg.wallpaper.dimming * 100));
        syncLivePreview();
      });
      controlsPanel.querySelector('#wp-blur')?.addEventListener('input', (e) => {
        cfg.wallpaper.blur = parseInt(e.target.value, 10);
        setLabelText('#wp-blur-val', cfg.wallpaper.blur);
        syncLivePreview();
      });
      controlsPanel.querySelector('#wp-sat')?.addEventListener('input', (e) => {
        cfg.wallpaper.saturation = parseInt(e.target.value, 10);
        setLabelText('#wp-sat-val', cfg.wallpaper.saturation);
        syncLivePreview();
      });
      controlsPanel.querySelector('#wp-speed')?.addEventListener('input', (e) => {
        cfg.wallpaper.playbackRate = parseFloat(e.target.value);
        setLabelText('#wp-speed-val', cfg.wallpaper.playbackRate);
        syncLivePreview();
      });
    } else if (sec === 'music') {
      const mState = previewMusicController.getState();
      const customIds = new Set((cfg.music.customTracks || []).map((ct) => ct.id));
      controlsPanel.innerHTML = `
        <div class="ctrl-card">
          <div class="ctrl-card-title">
            <span>Trình Phát Nhạc Nền Trong AGY App</span>
            <label class="switch">
              <input type="checkbox" id="m-enable" ${cfg.music.enabled ? 'checked' : ''} />
              <span class="slider"></span>
            </label>
          </div>
          <div class="ctrl-card-sub">Tích hợp sẵn 4 bản nhạc Stereo WAV (Lo-Fi, Synthwave, Cosmic Ambient, Rain Piano) hoạt động 100% Offline + hỗ trợ thêm nhạc MP3/WAV từ máy.</div>
          <div class="ctrl-row">
            <span>Tự động phát khi mở AGY App</span>
            <input type="checkbox" id="m-autoplay" ${cfg.music.autoplay ? 'checked' : ''} />
          </div>
          <div class="ctrl-row">
            <span>Lặp lại 1 bài (Loop) — Tắt để tự chuyển bài tiếp theo</span>
            <input type="checkbox" id="m-loop" ${cfg.music.loop !== false ? 'checked' : ''} />
          </div>
          <div class="ctrl-row">
            <span>Hiển thị Mini Music Player góc trái dưới AGY</span>
            <input type="checkbox" id="m-mini" ${cfg.music.showMiniPlayer ? 'checked' : ''} />
          </div>
          <div class="ctrl-row">
            <span>Âm lượng nhạc nền <span class="val-pill"><span id="m-vol-val">${Math.round(cfg.music.volume * 100)}</span>%</span></span>
            <input type="range" id="m-vol" min="0" max="1" step="0.02" value="${cfg.music.volume}" />
          </div>

          <div style="margin: 12px 0; display:flex; flex-direction:column; gap:7px;">
            ${mState.tracks
              .map(
                (t) => `
              <div style="display:flex;gap:6px;align-items:stretch;">
                <button class="preset-card ${t.id === cfg.music.activeTrackId ? 'active' : ''}" data-track-id="${escapeHtml(t.id)}" style="flex:1;flex-direction:row;justify-content:space-between;align-items:center;">
                  <div>
                    <div class="preset-name">${escapeHtml(t.name)}</div>
                    <div class="preset-desc">${escapeHtml(t.artist)}</div>
                  </div>
                  <span class="preset-badge">${t.id === cfg.music.activeTrackId ? 'Đang chọn' : 'Chọn phát'}</span>
                </button>
                ${
                  customIds.has(t.id)
                    ? `<button class="btn-ghost" data-remove-track-id="${escapeHtml(t.id)}" title="Xóa bài nhạc này khỏi danh sách" style="padding:0 10px;">✕</button>`
                    : ''
                }
              </div>
            `
              )
              .join('')}
          </div>

          <button class="btn-secondary" id="btn-add-custom-music" style="width:100%;">
            + Thêm Bài Nhạc MP3 / WAV / OGG / FLAC Từ Máy Tính...
          </button>
        </div>

        <div class="ctrl-card">
          <div class="ctrl-card-title">Âm Thanh Bàn Phím Cơ &amp; Tương Tác (Sound FX)</div>
          <div class="ctrl-card-sub">Phát tiếng Switch cơ học êm ái khi gõ tin nhắn vào ô Chat của AGY App (gõ thử vào ô chat bên phải để nghe).</div>
          <div class="ctrl-row">
            <span>Loại Switch bàn phím cơ</span>
            <select class="ctrl-select" id="sfx-type">
              <option value="holy-panda" ${cfg.soundEffects.typingSound === 'holy-panda' ? 'selected' : ''}>Holy Panda (Thocky trầm ấm)</option>
              <option value="mx-blue" ${cfg.soundEffects.typingSound === 'mx-blue' ? 'selected' : ''}>Cherry MX Blue (Clicky giòn)</option>
              <option value="typewriter" ${cfg.soundEffects.typingSound === 'typewriter' ? 'selected' : ''}>Máy đánh chữ Retro</option>
              <option value="scifi-bubble" ${cfg.soundEffects.typingSound === 'scifi-bubble' ? 'selected' : ''}>Sci-Fi Bubble</option>
              <option value="off" ${cfg.soundEffects.typingSound === 'off' ? 'selected' : ''}>Tắt âm bàn phím</option>
            </select>
          </div>
          <div class="ctrl-row">
            <span>Âm lượng gõ phím <span class="val-pill"><span id="sfx-vol-val">${Math.round(cfg.soundEffects.typingVolume * 100)}</span>%</span></span>
            <input type="range" id="sfx-vol" min="0.05" max="1" step="0.05" value="${cfg.soundEffects.typingVolume}" />
          </div>
          <div class="ctrl-row">
            <span>Âm báo nhẹ khi nhấn Enter gửi tin nhắn</span>
            <input type="checkbox" id="sfx-send" ${cfg.soundEffects.sendSound ? 'checked' : ''} />
          </div>
        </div>
      `;

      controlsPanel.querySelector('#m-enable')?.addEventListener('change', (e) => {
        cfg.music.enabled = e.target.checked;
        syncLivePreview({ syncAudio: true });
      });
      controlsPanel.querySelector('#m-autoplay')?.addEventListener('change', (e) => {
        cfg.music.autoplay = e.target.checked;
        syncLivePreview();
      });
      controlsPanel.querySelector('#m-loop')?.addEventListener('change', (e) => {
        cfg.music.loop = e.target.checked;
        syncLivePreview({ syncAudio: true });
      });
      controlsPanel.querySelector('#m-mini')?.addEventListener('change', (e) => {
        cfg.music.showMiniPlayer = e.target.checked;
        syncLivePreview();
      });
      controlsPanel.querySelector('#m-vol')?.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        cfg.music.volume = v;
        previewMusicController.setVolume(v);
        setLabelText('#m-vol-val', Math.round(v * 100));
        scheduleSaveDraft();
      });

      controlsPanel.querySelectorAll('[data-track-id]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          cfg.music.activeTrackId = btn.dataset.trackId;
          cfg.music.enabled = true;
          await previewMusicController.loadAndSync(cfg, true);
          syncLivePreview();
          renderControlsSection();
        });
      });

      controlsPanel.querySelectorAll('[data-remove-track-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const removeId = btn.dataset.removeTrackId;
          cfg.music.customTracks = (cfg.music.customTracks || []).filter((t) => t.id !== removeId);
          if (cfg.music.activeTrackId === removeId) {
            cfg.music.activeTrackId = DEFAULT_CONFIG.music.activeTrackId;
          }
          syncLivePreview({ syncAudio: true });
          renderControlsSection();
          showToast('Đã xóa bài nhạc khỏi danh sách.');
        });
      });

      controlsPanel.querySelector('#btn-add-custom-music')?.addEventListener('click', async () => {
        const res = await window.studioAPI.pickMedia('audio');
        if (res && res.ok) {
          const newId = 'custom-' + Date.now();
          if (!Array.isArray(cfg.music.customTracks)) cfg.music.customTracks = [];
          cfg.music.customTracks.push({
            id: newId,
            name: res.fileName,
            filePath: res.filePath,
            mime: res.mime
          });
          cfg.music.activeTrackId = newId;
          cfg.music.enabled = true;
          await previewMusicController.loadAndSync(cfg, true);
          syncLivePreview();
          renderControlsSection();
          showToast(`Đã thêm bài nhạc: ${res.fileName}`);
        }
      });

      controlsPanel.querySelector('#sfx-type')?.addEventListener('change', (e) => {
        cfg.soundEffects.typingSound = e.target.value;
        playKeySound(cfg.soundEffects.typingSound, cfg.soundEffects.typingVolume, false);
        syncLivePreview();
      });
      controlsPanel.querySelector('#sfx-vol')?.addEventListener('input', (e) => {
        cfg.soundEffects.typingVolume = parseFloat(e.target.value);
        setLabelText('#sfx-vol-val', Math.round(cfg.soundEffects.typingVolume * 100));
        playKeySound(cfg.soundEffects.typingSound, cfg.soundEffects.typingVolume, false);
        syncLivePreview();
      });
      controlsPanel.querySelector('#sfx-send')?.addEventListener('change', (e) => {
        cfg.soundEffects.sendSound = e.target.checked;
        if (e.target.checked) playSendChime(cfg.soundEffects.typingVolume);
        syncLivePreview();
      });
    } else if (sec === 'effects') {
      controlsPanel.innerHTML = `
        <div class="ctrl-card">
          <div class="ctrl-card-title">Hiệu Ứng Hạt Môi Trường (Ambient Particles)</div>
          <div class="ctrl-card-sub">Chạy trên lớp Canvas GPU độc lập với pointer-events: none, không cản trở thao tác chuột.</div>
          <div class="ctrl-row">
            <span>Kiểu hiệu ứng hạt</span>
            <select class="ctrl-select" id="fx-particles">
              <option value="fireflies" ${cfg.effects.particles === 'fireflies' ? 'selected' : ''}>Đom đóm dịu (Fireflies)</option>
              <option value="starfield" ${cfg.effects.particles === 'starfield' ? 'selected' : ''}>Sao băng Vũ trụ (Starfield)</option>
              <option value="sakura" ${cfg.effects.particles === 'sakura' ? 'selected' : ''}>Hoa anh đào rơi (Sakura Petals)</option>
              <option value="snowfall" ${cfg.effects.particles === 'snowfall' ? 'selected' : ''}>Tuyết rơi (Snowfall)</option>
              <option value="constellation" ${cfg.effects.particles === 'constellation' ? 'selected' : ''}>Mạng hạt liên kết (Constellation)</option>
              <option value="matrix" ${cfg.effects.particles === 'matrix' ? 'selected' : ''}>Mưa ký tự Matrix</option>
              <option value="none" ${cfg.effects.particles === 'none' ? 'selected' : ''}>Tắt hiệu ứng hạt</option>
            </select>
          </div>
          <div class="ctrl-row">
            <span>Mật độ hạt <span class="val-pill"><span id="fx-density-val">${cfg.effects.particleDensity}</span> hạt</span></span>
            <input type="range" id="fx-density" min="15" max="120" step="5" value="${cfg.effects.particleDensity}" />
          </div>
          <div class="ctrl-row">
            <span>Tốc độ hạt <span class="val-pill"><span id="fx-speed-val">${cfg.effects.particleSpeed}</span>x</span></span>
            <input type="range" id="fx-speed" min="0.3" max="2.5" step="0.1" value="${cfg.effects.particleSpeed}" />
          </div>
        </div>

        <div class="ctrl-card">
          <div class="ctrl-card-title">Hiệu Ứng Con Trỏ Chuột &amp; Chuyển Động</div>
          <div class="ctrl-card-sub">Thử di chuột và click lên màn hình Live Preview bên phải để trải nghiệm trực tiếp.</div>
          <div class="ctrl-row">
            <span>Hiệu ứng con trỏ chuột</span>
            <select class="ctrl-select" id="fx-cursor">
              <option value="neon-trail" ${cfg.effects.cursorEffect === 'neon-trail' ? 'selected' : ''}>Vệt sáng sao chổi (Trail)</option>
              <option value="click-ripple" ${cfg.effects.cursorEffect === 'click-ripple' ? 'selected' : ''}>Gợn sóng khi Click</option>
              <option value="spotlight" ${cfg.effects.cursorEffect === 'spotlight' ? 'selected' : ''}>Đèn chiếu Spotlight</option>
              <option value="none" ${cfg.effects.cursorEffect === 'none' ? 'selected' : ''}>Tắt hiệu ứng chuột</option>
            </select>
          </div>
          <div class="ctrl-row">
            <span>Viền nhấn ánh sáng quanh ô nhập Chat</span>
            <input type="checkbox" id="fx-prompt-glow" ${cfg.effects.promptNeonGlow ? 'checked' : ''} />
          </div>
          <div class="ctrl-row">
            <span>Hiệu ứng trượt mượt khi có tin nhắn mới</span>
            <input type="checkbox" id="fx-msg-slide" ${cfg.effects.messageSlideAnimation ? 'checked' : ''} />
          </div>
          <div class="ctrl-row">
            <span>Lớp phủ dòng quét CRT Retro (Scanlines)</span>
            <input type="checkbox" id="fx-crt" ${cfg.effects.crtScanlines ? 'checked' : ''} />
          </div>
          <div class="ctrl-row">
            <span>Smart Eco Mode (Tự nghỉ khi ẩn cửa sổ AGY)</span>
            <input type="checkbox" id="fx-eco" ${cfg.effects.smartEcoMode ? 'checked' : ''} />
          </div>
        </div>
      `;

      controlsPanel.querySelector('#fx-particles')?.addEventListener('change', (e) => {
        cfg.effects.particles = e.target.value;
        syncLivePreview();
      });
      controlsPanel.querySelector('#fx-density')?.addEventListener('input', (e) => {
        cfg.effects.particleDensity = parseInt(e.target.value, 10);
        setLabelText('#fx-density-val', cfg.effects.particleDensity);
        syncLivePreview();
      });
      controlsPanel.querySelector('#fx-speed')?.addEventListener('input', (e) => {
        cfg.effects.particleSpeed = parseFloat(e.target.value);
        setLabelText('#fx-speed-val', cfg.effects.particleSpeed);
        syncLivePreview();
      });
      controlsPanel.querySelector('#fx-cursor')?.addEventListener('change', (e) => {
        cfg.effects.cursorEffect = e.target.value;
        syncLivePreview();
      });
      controlsPanel.querySelector('#fx-prompt-glow')?.addEventListener('change', (e) => {
        cfg.effects.promptNeonGlow = e.target.checked;
        syncLivePreview();
      });
      controlsPanel.querySelector('#fx-msg-slide')?.addEventListener('change', (e) => {
        cfg.effects.messageSlideAnimation = e.target.checked;
        syncLivePreview();
      });
      controlsPanel.querySelector('#fx-crt')?.addEventListener('change', (e) => {
        cfg.effects.crtScanlines = e.target.checked;
        syncLivePreview();
      });
      controlsPanel.querySelector('#fx-eco')?.addEventListener('change', (e) => {
        cfg.effects.smartEcoMode = e.target.checked;
        syncLivePreview();
      });
    } else if (sec === 'layout') {
      const widthSpec = resolveChatWidthSpec(cfg.layout || {});
      const promptSpec = resolvePromptWidthSpec(cfg.layout || {});
      const getPromptHintHtml = (pSpec, isDocked) =>
        isDocked
          ? 'Đang bật <b>Trải rộng sát đáy (Docked)</b> nên khung nhập lệnh giãn 100%. Chọn mức gọn hơn để tự chuyển sang Đảo nổi.'
          : pSpec.mode === 'match-chat'
            ? 'Khung nhập lệnh đang theo <b>Độ rộng khung Chat</b> ở trên.'
            : `Khung nhập lệnh giữ gọn ở mức <b>${escapeHtml(pSpec.label)}</b>, trong khi khung tin nhắn phía trên vẫn giữ nguyên độ rộng.`;
      controlsPanel.innerHTML = `
        <div class="ctrl-card">
          <div class="ctrl-card-title">Bố Cục Giao Diện AGY App</div>
          <div class="ctrl-card-sub">Can thiệp bằng CSS Flexbox/Grid sạch 100%, giữ nguyên toàn bộ chức năng gốc của AGY App.</div>
          <div class="ctrl-row">
            <span>Vị trí thanh bên (Sidebar)</span>
            <select class="ctrl-select" id="l-sidebar">
              <option value="left" ${cfg.layout.sidebarPosition === 'left' ? 'selected' : ''}>Bên Trái (Mặc định)</option>
              <option value="right" ${cfg.layout.sidebarPosition === 'right' ? 'selected' : ''}>Chuyển sang Bên Phải</option>
              <option value="floating-autohide" ${cfg.layout.sidebarPosition === 'floating-autohide' ? 'selected' : ''}>Tự động làm mờ khi không chạm</option>
            </select>
          </div>
          <div class="ctrl-row">
            <span>Độ rộng khung Chat (Conversation Width)</span>
            <select class="ctrl-select" id="l-width">
              <option value="auto" ${widthSpec.mode === 'auto' ? 'selected' : ''}>Theo AGY gốc (Không ghi đè)</option>
              <option value="narrow" ${widthSpec.mode === 'narrow' ? 'selected' : ''}>Narrow (640px)</option>
              <option value="default" ${widthSpec.mode === 'default' ? 'selected' : ''}>Default (780px)</option>
              <option value="wide" ${widthSpec.mode === 'wide' ? 'selected' : ''}>Wide (1180px)</option>
              <option value="fill" ${widthSpec.mode === 'fill' ? 'selected' : ''}>Fill (98%)</option>
              <option value="custom" ${widthSpec.mode === 'custom' ? 'selected' : ''}>Tùy chỉnh theo px</option>
            </select>
          </div>
          <div class="ctrl-row">
            <span>Kéo độ rộng tùy chỉnh <span class="val-pill"><span id="l-custom-width-val">${widthSpec.customPx}</span>px</span></span>
            <input type="range" class="ctrl-range" id="l-custom-width" min="520" max="1600" step="10" value="${widthSpec.customPx}" />
          </div>
          <div class="ctrl-card-sub" id="l-width-hint" style="margin-top:-4px;margin-bottom:10px;">
            ${
              widthSpec.mode === 'auto'
                ? 'Đang nhường quyền chỉnh khung chat cho Settings gốc của AGY (Appearance → Chat Layout).'
                : `Đang chỉnh khung chat ở mức <b>${escapeHtml(widthSpec.label)}</b>. Chọn <b>Theo AGY gốc</b> nếu muốn chỉnh bằng Settings gốc của AGY.`
            }
          </div>
          <div class="ctrl-row">
            <span>Kiểu khung nhập lệnh (Prompt Box)</span>
            <select class="ctrl-select" id="l-prompt">
              <option value="floating-island" ${cfg.layout.promptStyle !== 'docked' ? 'selected' : ''}>Đảo nổi (Floating Island)</option>
              <option value="docked" ${cfg.layout.promptStyle === 'docked' ? 'selected' : ''}>Trải rộng sát đáy (Docked)</option>
            </select>
          </div>
          <div class="ctrl-row">
            <span>Độ rộng khung nhập lệnh (Prompt Width)</span>
            <select class="ctrl-select" id="l-prompt-width">
              <option value="match-chat" ${promptSpec.mode === 'match-chat' ? 'selected' : ''}>Theo khung Chat</option>
              <option value="narrow" ${promptSpec.mode === 'narrow' ? 'selected' : ''}>Nhỏ gọn (640px)</option>
              <option value="compact" ${promptSpec.mode === 'compact' ? 'selected' : ''}>Cân đối (760px)</option>
              <option value="medium" ${promptSpec.mode === 'medium' ? 'selected' : ''}>Vừa (880px)</option>
              <option value="custom" ${promptSpec.mode === 'custom' ? 'selected' : ''}>Tùy chỉnh theo px</option>
            </select>
          </div>
          <div class="ctrl-row">
            <span>Kéo độ rộng khung nhập <span class="val-pill"><span id="l-prompt-custom-width-val">${promptSpec.customPx}</span>px</span></span>
            <input type="range" class="ctrl-range" id="l-prompt-custom-width" min="460" max="1400" step="10" value="${promptSpec.customPx}" />
          </div>
          <div class="ctrl-card-sub" id="l-prompt-width-hint" style="margin-top:-4px;margin-bottom:10px;">
            ${getPromptHintHtml(promptSpec, cfg.layout.promptStyle === 'docked')}
          </div>
          <div class="ctrl-row">
            <span>Kiểu khung tin nhắn (Message Style)</span>
            <select class="ctrl-select" id="l-msg-style">
              <option value="glass-cards" ${cfg.layout.messageStyle === 'glass-cards' ? 'selected' : ''}>Thẻ kính bo góc (Glass Cards)</option>
              <option value="chat-bubbles" ${cfg.layout.messageStyle === 'chat-bubbles' ? 'selected' : ''}>Bong bóng Chat (Chat Bubbles)</option>
              <option value="minimal" ${cfg.layout.messageStyle === 'minimal' ? 'selected' : ''}>Tối giản trong suốt (Minimal)</option>
            </select>
          </div>
          <div class="ctrl-row">
            <span>Chế độ Zen Focus Mode (Ẩn thanh bên)</span>
            <input type="checkbox" id="l-zen" ${cfg.layout.zenMode ? 'checked' : ''} />
          </div>
        </div>

        <div class="ctrl-card">
          <div class="ctrl-card-title">Font Chữ &amp; Tỷ Lệ Hiển Thị (Typography)</div>
          <div class="ctrl-card-sub">Tùy chỉnh font chữ giao diện, font code Monospace và tỷ lệ phóng to/thu nhỏ chữ.</div>
          <div class="ctrl-row">
            <span>Font giao diện (UI Font)</span>
            <select class="ctrl-select" id="t-uifont">
              <option value="'Inter', 'Segoe UI', system-ui, sans-serif" ${(cfg.typography?.uiFont || '').includes('Inter') ? 'selected' : ''}>Inter / Segoe UI (Mặc định)</option>
              <option value="'Segoe UI', system-ui, sans-serif" ${(cfg.typography?.uiFont || '').startsWith("'Segoe UI'") ? 'selected' : ''}>Segoe UI (Windows Native)</option>
              <option value="'JetBrains Mono', Consolas, monospace" ${(cfg.typography?.uiFont || '').includes('JetBrains Mono') ? 'selected' : ''}>JetBrains Mono (Dev Style)</option>
              <option value="system-ui, -apple-system, sans-serif" ${(cfg.typography?.uiFont || '').startsWith('system-ui') ? 'selected' : ''}>System UI</option>
            </select>
          </div>
          <div class="ctrl-row">
            <span>Font mã nguồn (Code Font)</span>
            <select class="ctrl-select" id="t-codefont">
              <option value="'JetBrains Mono', 'Fira Code', Consolas, monospace" ${(cfg.typography?.codeFont || '').includes('JetBrains Mono') ? 'selected' : ''}>JetBrains Mono / Fira Code</option>
              <option value="'Cascadia Code', Consolas, monospace" ${(cfg.typography?.codeFont || '').includes('Cascadia') ? 'selected' : ''}>Cascadia Code</option>
              <option value="Consolas, 'Courier New', monospace" ${(cfg.typography?.codeFont || '').startsWith('Consolas') ? 'selected' : ''}>Consolas Classic</option>
            </select>
          </div>
          <div class="ctrl-row">
            <span>Tỷ lệ cỡ chữ <span class="val-pill"><span id="t-scale-val">${Number(cfg.typography?.fontScale || 100)}</span>%</span></span>
            <input type="range" id="t-scale" min="85" max="125" step="5" value="${Number(cfg.typography?.fontScale || 100)}" />
          </div>
        </div>

        <div class="ctrl-card">
          <div class="ctrl-card-title">Bảng Điều Khiển Nhúng Trực Tiếp Trong AGY App</div>
          <div class="ctrl-card-sub">
            Khi đã Apply, bạn có thể mở bảng <b>AGY UI Studio</b> ngay bên trong giao diện AGY App mà không cần bật app ngoài.
          </div>
          <div class="ctrl-row">
            <span>Hiển thị nút <b>AGY Studio</b> trên thanh tiêu đề (cạnh ⋮ và Open IDE)</span>
            <input type="checkbox" id="l-inapp-btn" ${cfg.layout.showInAppButton !== false ? 'checked' : ''} />
          </div>
          <div class="ctrl-row">
            <span>Phím tắt mở nhanh trong AGY App</span>
            <code>Ctrl + Shift + Y</code>
          </div>
        </div>
      `;

      const syncStandaloneWidthHint = () => {
        const spec = resolveChatWidthSpec(cfg.layout || {});
        const selectEl = controlsPanel.querySelector('#l-width');
        if (selectEl) selectEl.value = spec.mode;
        const valEl = controlsPanel.querySelector('#l-custom-width-val');
        if (valEl) valEl.textContent = String(spec.customPx);
        const hintEl = controlsPanel.querySelector('#l-width-hint');
        if (hintEl) {
          hintEl.innerHTML =
            spec.mode === 'auto'
              ? 'Đang nhường quyền chỉnh khung chat cho Settings gốc của AGY (Appearance → Chat Layout).'
              : `Đang chỉnh khung chat ở mức <b>${escapeHtml(spec.label)}</b>. Chọn <b>Theo AGY gốc</b> nếu muốn chỉnh bằng Settings gốc của AGY.`;
        }
      };

      const syncStandalonePromptHint = () => {
        const pSpec = resolvePromptWidthSpec(cfg.layout || {});
        const isDocked = cfg.layout.promptStyle === 'docked';
        const styleEl = controlsPanel.querySelector('#l-prompt');
        if (styleEl) styleEl.value = isDocked ? 'docked' : 'floating-island';
        const selectEl = controlsPanel.querySelector('#l-prompt-width');
        if (selectEl) selectEl.value = pSpec.mode;
        const valEl = controlsPanel.querySelector('#l-prompt-custom-width-val');
        if (valEl) valEl.textContent = String(pSpec.customPx);
        const hintEl = controlsPanel.querySelector('#l-prompt-width-hint');
        if (hintEl) hintEl.innerHTML = getPromptHintHtml(pSpec, isDocked);
      };

      controlsPanel.querySelector('#l-sidebar')?.addEventListener('change', (e) => {
        cfg.layout.sidebarPosition = e.target.value;
        syncLivePreview();
      });
      controlsPanel.querySelector('#l-width')?.addEventListener('change', (e) => {
        cfg.layout.chatWidth = e.target.value;
        syncLivePreview();
        syncStandaloneWidthHint();
      });
      controlsPanel.querySelector('#l-custom-width')?.addEventListener('input', (e) => {
        cfg.layout.chatCustomWidth = parseInt(e.target.value, 10);
        cfg.layout.chatWidth = 'custom';
        syncLivePreview();
        syncStandaloneWidthHint();
      });
      controlsPanel.querySelector('#l-prompt')?.addEventListener('change', (e) => {
        cfg.layout.promptStyle = e.target.value;
        syncLivePreview();
        syncStandalonePromptHint();
      });
      controlsPanel.querySelector('#l-prompt-width')?.addEventListener('change', (e) => {
        cfg.layout.promptWidth = e.target.value;
        if (e.target.value !== 'match-chat' && cfg.layout.promptStyle === 'docked') {
          cfg.layout.promptStyle = 'floating-island';
        }
        syncLivePreview();
        syncStandalonePromptHint();
      });
      controlsPanel.querySelector('#l-prompt-custom-width')?.addEventListener('input', (e) => {
        cfg.layout.promptCustomWidth = parseInt(e.target.value, 10);
        cfg.layout.promptWidth = 'custom';
        cfg.layout.promptStyle = 'floating-island';
        syncLivePreview();
        syncStandalonePromptHint();
      });
      controlsPanel.querySelector('#l-msg-style')?.addEventListener('change', (e) => {
        cfg.layout.messageStyle = e.target.value;
        syncLivePreview();
      });
      controlsPanel.querySelector('#l-zen')?.addEventListener('change', (e) => {
        cfg.layout.zenMode = e.target.checked;
        syncLivePreview();
      });
      controlsPanel.querySelector('#t-uifont')?.addEventListener('change', (e) => {
        if (!cfg.typography) cfg.typography = {};
        cfg.typography.uiFont = e.target.value;
        syncLivePreview();
      });
      controlsPanel.querySelector('#t-codefont')?.addEventListener('change', (e) => {
        if (!cfg.typography) cfg.typography = {};
        cfg.typography.codeFont = e.target.value;
        syncLivePreview();
      });
      controlsPanel.querySelector('#t-scale')?.addEventListener('input', (e) => {
        if (!cfg.typography) cfg.typography = {};
        cfg.typography.fontScale = parseInt(e.target.value, 10);
        setLabelText('#t-scale-val', cfg.typography.fontScale);
        syncLivePreview();
      });
      controlsPanel.querySelector('#l-inapp-btn')?.addEventListener('change', (e) => {
        cfg.layout.showInAppButton = e.target.checked;
        syncLivePreview();
      });
    } else if (sec === 'backup') {
      controlsPanel.innerHTML = `
        <div class="ctrl-card">
          <div class="ctrl-card-title">Tùy Chỉnh CSS Nâng Cao (Custom CSS)</div>
          <div class="ctrl-card-sub">Viết thêm các quy tắc CSS riêng nếu bạn muốn tùy biến sâu hơn bất kỳ thành phần nào của AGY.</div>
          <textarea class="ctrl-textarea" id="custom-css-box" placeholder="/* Ví dụ: .prose { font-size: 15px !important; } */">${escapeHtml(
            cfg.customCss || ''
          )}</textarea>
        </div>

        <div class="ctrl-card">
          <div class="ctrl-card-title">Sao Lưu Cấu Hình &amp; Khôi Phục Gốc</div>
          <div class="ctrl-card-sub">Xuất cấu hình ra file .json để chia sẻ, hoặc đặt lại thông số về mặc định.</div>
          <div style="display:flex; gap:10px; margin-bottom:12px;">
            <button class="btn-secondary" id="btn-export-json" style="flex:1;">Xuất Theme (.json)</button>
            <button class="btn-secondary" id="btn-import-json" style="flex:1;">Nhập Theme (.json)</button>
          </div>
          <button class="btn-danger" id="btn-reset-defaults" style="width:100%;">
            Đặt lại thông số trong Studio về mặc định
          </button>
        </div>
      `;

      controlsPanel.querySelector('#custom-css-box')?.addEventListener('input', (e) => {
        cfg.customCss = e.target.value;
        syncLivePreview();
      });
      controlsPanel.querySelector('#btn-export-json')?.addEventListener('click', async () => {
        const res = await window.studioAPI.exportConfig(cfg);
        if (res && res.ok) showToast('Đã xuất file cấu hình Theme thành công!');
      });
      controlsPanel.querySelector('#btn-import-json')?.addEventListener('click', async () => {
        const res = await window.studioAPI.importConfig();
        if (res && res.ok && res.config) {
          state.config = deepMerge(DEFAULT_CONFIG, res.config);
          syncLivePreview({ syncAudio: true });
          renderControlsSection();
          showToast('Đã nhập cấu hình Theme thành công!');
        } else if (res && !res.canceled && res.error) {
          showToast(res.error, true);
        }
      });
      controlsPanel.querySelector('#btn-reset-defaults')?.addEventListener('click', () => {
        state.config = deepMerge(DEFAULT_CONFIG, {});
        syncLivePreview({ syncAudio: true });
        renderControlsSection();
        showToast('Đã đặt lại thông số mặc định!');
      });
    }
  }

  // Sidebar Navigation Clicks
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach((el) => el.classList.remove('active'));
      item.classList.add('active');
      state.activeSection = item.dataset.section;
      renderControlsSection();
    });
  });

  masterToggle.addEventListener('change', (e) => {
    state.config.enabled = e.target.checked;
    syncLivePreview({ syncAudio: true });
  });

  // Folder Selection Modal Handlers
  function openFolderModal(customReason = '') {
    folderModal.style.display = 'flex';
    modalPathInput.value = state.agyStatus?.path || '';
    modalErrorMsg.textContent = customReason || '';
  }

  document.getElementById('btn-change-folder').addEventListener('click', () => {
    openFolderModal();
  });

  document.getElementById('btn-open-folder').addEventListener('click', () => {
    if (state.agyStatus?.path) {
      window.studioAPI.openFolder(state.agyStatus.path);
    } else {
      openFolderModal('Vui lòng chọn thư mục gốc của Antigravity App trước.');
    }
  });

  document.getElementById('modal-close-btn').addEventListener('click', () => {
    folderModal.style.display = 'none';
  });

  document.getElementById('modal-browse-btn').addEventListener('click', async () => {
    const res = await window.studioAPI.selectAgyFolder();
    if (res && !res.canceled) {
      modalPathInput.value = res.path || '';
      if (res.valid) {
        updateAgyStatusUI(res);
        folderModal.style.display = 'none';
        showToast('Đã chọn thư mục gốc Antigravity App thành công!');
      } else {
        modalErrorMsg.textContent = res.reason || 'Thư mục không hợp lệ!';
      }
    }
  });

  document.getElementById('modal-confirm-btn').addEventListener('click', async () => {
    const val = modalPathInput.value.trim();
    const res = await window.studioAPI.rescan(val);
    if (res && res.valid) {
      updateAgyStatusUI(res);
      folderModal.style.display = 'none';
      showToast('Đã xác nhận thư mục gốc Antigravity App!');
    } else {
      modalErrorMsg.textContent = res?.reason || 'Không tìm thấy resources/app.asar trong thư mục này!';
    }
  });

  // Primary Action: APPLY TO AGY
  document.getElementById('btn-apply-agy').addEventListener('click', async () => {
    if (!state.agyStatus || !state.agyStatus.valid) {
      openFolderModal('Vui lòng chọn thư mục gốc của Antigravity App trước khi nhấn Apply!');
      return;
    }
    const applyBtn = document.getElementById('btn-apply-agy');
    const origText = applyBtn.textContent;
    applyBtn.textContent = '⏳ ĐANG NẠP VÀO AGY...';
    applyBtn.disabled = true;

    try {
      const res = await window.studioAPI.applyToAgy({
        agyRootPath: state.agyStatus.path,
        config: state.config
      });
      if (res && res.ok) {
        if (res.status) updateAgyStatusUI(res.status);
        showToast('🎉 Đã nạp giao diện Custom vào AGY App thành công! Mở AGY App để trải nghiệm ngay!');
      } else {
        showToast(res?.error || 'Có lỗi xảy ra khi Apply!', true);
      }
    } finally {
      applyBtn.textContent = origText;
      applyBtn.disabled = false;
    }
  });

  // Restore Original AGY
  document.getElementById('btn-restore-agy').addEventListener('click', async () => {
    if (!state.agyStatus || !state.agyStatus.valid) {
      openFolderModal('Vui lòng chọn thư mục gốc của Antigravity App trước!');
      return;
    }
    const res = await window.studioAPI.restoreAgy({
      agyRootPath: state.agyStatus.path
    });
    if (res && res.ok) {
      if (res.status) updateAgyStatusUI(res.status);
      showToast('♻️ Đã khôi phục Antigravity App về nguyên bản 100%!');
    } else {
      showToast(res?.error || 'Không thể khôi phục!', true);
    }
  });

  // Launch AGY App
  document.getElementById('btn-launch-agy').addEventListener('click', async () => {
    if (!state.agyStatus || !state.agyStatus.valid) {
      openFolderModal('Vui lòng chọn thư mục gốc của Antigravity App trước!');
      return;
    }
    const res = await window.studioAPI.launchAgy(state.agyStatus.path);
    if (res && res.ok) {
      showToast('🚀 Đang khởi chạy Antigravity App...');
    } else {
      showToast(res?.error || 'Không thể mở Antigravity.exe!', true);
    }
  });

  // Startup Initialization
  async function initApp() {
    if (window.studioAPI) {
      const initData = await window.studioAPI.init();
      if (initData.config) {
        state.config = deepMerge(DEFAULT_CONFIG, initData.config);
      }
      updateAgyStatusUI(initData.scanResult);
      if (!initData.scanResult || !initData.scanResult.found) {
        openFolderModal(initData.scanResult?.reason);
      }
    }
    renderControlsSection();
    syncLivePreview({ syncAudio: true });

    if (
      state.config.wallpaper?.enabled &&
      state.config.wallpaper?.sourceType === 'custom-file' &&
      state.config.wallpaper?.autoSyncColors !== false &&
      state.config.wallpaper?.customFilePath &&
      state.config.wallpaper?.syncedForPath !== state.config.wallpaper?.customFilePath &&
      typeof syncConfigColorsFromWallpaper === 'function'
    ) {
      const syncRes = await syncConfigColorsFromWallpaper(state.config);
      if (syncRes && syncRes.ok) {
        syncLivePreview();
        renderControlsSection();
      }
    }
  }

  initApp();
})();
