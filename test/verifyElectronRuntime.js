/**
 * End-to-End Electron Renderer Verification Script
 * 1. Launches the Standalone AGY UI Studio window, verifies auto-scan, 8 presets,
 *    Starter Pack WAV/SVG Blob URLs, and captures a real screenshot.
 * 2. Launches a simulated Antigravity App Hub window with the injected runtime
 *    (agyInjectorRuntime.js), opens the embedded In-App Studio Drawer, tests all tabs,
 *    and captures a real screenshot.
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { autoScanAgyRoot } = require('../src/main/agyScanner');
const { applyCustomizationToAgy, restoreOriginalAgy } = require('../src/main/asarPatcher');
const { DEFAULT_CONFIG } = require('../src/renderer/presets');

const ARTIFACT_DIR = process.env.AGY_SCREENSHOT_DIR || '';

app.whenReady().then(async () => {
  try {
    const rootDir = path.resolve(__dirname, '..');

    ipcMain.handle('studio:init', async () => ({
      scanResult: autoScanAgyRoot(),
      config: DEFAULT_CONFIG,
      studioRootDir: rootDir
    }));

    ipcMain.handle('studio:save-draft', async () => ({ ok: true }));

    const tempCustomWpPath = path.join(os.tmpdir(), `agy-e2e-wp-${process.pid}.svg`);
    fs.writeFileSync(
      tempCustomWpPath,
      `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
        <rect width="128" height="128" fill="#064e3b"/>
        <circle cx="48" cy="48" r="36" fill="#10b981"/>
        <circle cx="88" cy="84" r="24" fill="#f59e0b"/>
      </svg>`,
      'utf8'
    );

    ipcMain.handle('studio:pick-media', async () => ({
      ok: true,
      filePath: tempCustomWpPath,
      fileName: path.basename(tempCustomWpPath),
      mime: 'image/svg+xml'
    }));

    ipcMain.handle('studio:read-media', async (_e, assetRef) => {
      if (assetRef && fs.existsSync(assetRef)) {
        const buf = fs.readFileSync(assetRef);
        const ext = path.extname(assetRef).toLowerCase();
        return {
          ok: true,
          mime: ext === '.wav' ? 'audio/wav' : 'image/svg+xml',
          base64: buf.toString('base64')
        };
      }
      const candidates = [
        path.join(rootDir, 'assets', 'starter-pack', assetRef),
        path.join(rootDir, 'assets', 'starter-pack', 'music', path.basename(assetRef)),
        path.join(rootDir, 'assets', 'starter-pack', 'wallpapers', path.basename(assetRef))
      ];
      const found = candidates.find((p) => fs.existsSync(p));
      if (!found) return { ok: false, error: 'Not found: ' + assetRef };
      const buf = fs.readFileSync(found);
      const ext = path.extname(found).toLowerCase();
      return {
        ok: true,
        mime: ext === '.wav' ? 'audio/wav' : 'image/svg+xml',
        base64: buf.toString('base64')
      };
    });

    // -----------------------------------------------------------------------
    // Window 1: Standalone AGY UI Studio
    // -----------------------------------------------------------------------
    const win1 = new BrowserWindow({
      width: 1420,
      height: 880,
      show: false,
      webPreferences: {
        preload: path.join(rootDir, 'src', 'main', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        offscreen: true
      }
    });

    const pageErrors = [];
    win1.webContents.on('page-error', (err) => pageErrors.push(String(err)));

    await win1.loadFile(path.join(rootDir, 'src', 'renderer', 'index.html'));
    await new Promise((r) => setTimeout(r, 900));

    const checkResult = await win1.webContents.executeJavaScript(`
      (async () => {
        const wavBlobUrl = await window.__AGY_RUNTIME_FACTORY__.resolveMediaToBlobUrl('music/lofi-chill-nights.wav');
        const svgBlobUrl = await window.__AGY_RUNTIME_FACTORY__.resolveMediaToBlobUrl('wallpapers/cosmic-nebula.svg');
        const presetCardsCount = document.querySelectorAll('.preset-card').length;
        const pathText = document.getElementById('agy-path-display')?.textContent || '';
        const wpCanvas = document.querySelector('#agy-mock-window .agy-wp-canvas');

        // Verify slider input updates label in-place without destroying DOM node
        const sliderBefore = document.getElementById('g-opacity');
        sliderBefore.value = '0.51';
        sliderBefore.dispatchEvent(new Event('input', { bubbles: true }));
        const sliderAfter = document.getElementById('g-opacity');
        const opacityLabel = document.getElementById('g-opacity-val')?.textContent || '';

        // Verify adaptive palette extraction math on emerald + amber pixels
        const rgba = new Uint8ClampedArray(64 * 4);
        for (let i = 0; i < 64; i++) {
          const idx = i * 4;
          if (i < 40) {
            rgba[idx] = 16; rgba[idx + 1] = 185; rgba[idx + 2] = 129; rgba[idx + 3] = 255; // emerald
          } else {
            rgba[idx] = 245; rgba[idx + 1] = 158; rgba[idx + 2] = 11; rgba[idx + 3] = 255; // amber
          }
        }
        const extracted = window.__AGY_RUNTIME_FACTORY__.extractPaletteFromPixels(rgba);
        const monoRgba = new Uint8ClampedArray(16 * 4).fill(180);
        for (let i = 3; i < monoRgba.length; i += 4) monoRgba[i] = 255;
        const monoPalette = window.__AGY_RUNTIME_FACTORY__.extractPaletteFromPixels(monoRgba);

        // Verify selecting an external wallpaper auto-syncs sidebar, chat bubbles, prompt box & send button
        const sidebarBgBefore = document.getElementById('agy-mock-sidebar')?.style.background || '';
        const sendBgBefore = document.getElementById('mock-send-btn')?.style.background || '';
        const userBubbleBefore = document.getElementById('mock-msg-user')?.style.background || '';

        document.querySelector('.nav-item[data-section="wallpaper"]')?.click();
        await new Promise((r) => setTimeout(r, 100));
        const hasAutoSyncToggle = Boolean(document.getElementById('wp-auto-sync'));
        const hasSyncBtn = Boolean(document.getElementById('btn-sync-wp-colors'));
        document.getElementById('btn-pick-custom-wp')?.click();
        await new Promise((r) => setTimeout(r, 450));

        const sidebarBgAfter = document.getElementById('agy-mock-sidebar')?.style.background || '';
        const sendBgAfter = document.getElementById('mock-send-btn')?.style.background || '';
        const userBubbleAfter = document.getElementById('mock-msg-user')?.style.background || '';

        // Verify WAV Blob URL actually decodes in HTML5 Audio inside Chromium
        const audioLoaded = await new Promise((resolve) => {
          const testAudio = new Audio(wavBlobUrl);
          const done = (ok) => resolve(ok);
          testAudio.addEventListener('canplaythrough', () => done(testAudio.duration > 1), { once: true });
          testAudio.addEventListener('error', () => done(false), { once: true });
          setTimeout(() => done(testAudio.readyState >= 1), 1500);
        });

        return {
          wavBlobUrl,
          svgBlobUrl,
          audioLoaded,
          presetCardsCount,
          pathText,
          hasCanvas: Boolean(wpCanvas && wpCanvas.width > 0),
          sliderPreserved: sliderBefore === sliderAfter && opacityLabel === '51',
          extractedValidHex: Boolean(
            extracted &&
              /^#[0-9a-f]{6}$/i.test(extracted.sidebar) &&
              /^#[0-9a-f]{6}$/i.test(extracted.primary) &&
              /^#[0-9a-f]{6}$/i.test(extracted.accent)
          ),
          monoValidHex: Boolean(monoPalette && /^#[0-9a-f]{6}$/i.test(monoPalette.primary)),
          hasAutoSyncToggle,
          hasSyncBtn,
          sidebarColorSynced: Boolean(sidebarBgAfter && sidebarBgAfter !== sidebarBgBefore),
          sendColorSynced: Boolean(sendBgAfter && sendBgAfter !== sendBgBefore),
          userBubbleColorSynced: Boolean(userBubbleAfter && userBubbleAfter !== userBubbleBefore)
        };
      })();
    `);

    assert(pageErrors.length === 0, 'Page errors in Studio: ' + pageErrors.join('; '));
    assert(checkResult.wavBlobUrl && checkResult.wavBlobUrl.startsWith('blob:'), 'WAV Blob URL failed');
    assert(checkResult.svgBlobUrl && checkResult.svgBlobUrl.startsWith('blob:'), 'SVG Blob URL failed');
    assert(checkResult.audioLoaded, 'HTML5 Audio failed to decode Starter Pack WAV Blob URL');
    assert(checkResult.presetCardsCount === 8, 'Expected 8 preset cards rendered');
    assert(checkResult.hasCanvas, 'Wallpaper Canvas was not initialized');
    assert(checkResult.sliderPreserved, 'Range slider DOM element was destroyed or label did not update');
    assert(checkResult.extractedValidHex, 'Adaptive palette extractor did not return valid 6-digit hex colors');
    assert(checkResult.monoValidHex, 'Monochrome fallback palette did not return valid 6-digit hex colors');
    assert(checkResult.hasAutoSyncToggle && checkResult.hasSyncBtn, 'Wallpaper auto-sync controls missing');
    assert(checkResult.sidebarColorSynced, 'Left sidebar color did not sync to custom wallpaper');
    assert(checkResult.sendColorSynced, 'Send button color did not sync to custom wallpaper');
    assert(checkResult.userBubbleColorSynced, 'User chat bubble color did not sync to custom wallpaper');

    if (ARTIFACT_DIR && fs.existsSync(ARTIFACT_DIR)) {
      await win1.webContents.executeJavaScript(`
        (async () => {
          document.querySelector('.nav-item[data-section="themes"]')?.click();
          await new Promise((r) => setTimeout(r, 80));
          document.querySelector('[data-preset-id="tokyo-rain-zen"]')?.click();
          await new Promise((r) => setTimeout(r, 180));
        })();
      `);
      const img1 = await win1.webContents.capturePage();
      fs.writeFileSync(path.join(ARTIFACT_DIR, 'verified_studio_app.png'), img1.toPNG());
    }

    // -----------------------------------------------------------------------
    // Window 2: Simulated Antigravity App with Injected In-App Studio Drawer
    // -----------------------------------------------------------------------
    const win2 = new BrowserWindow({
      width: 1360,
      height: 840,
      show: false,
      webPreferences: {
        preload: path.join(rootDir, 'src', 'main', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        offscreen: true
      }
    });

    const pageErrors2 = [];
    win2.webContents.on('page-error', (err) => pageErrors2.push(String(err)));

    const mockAgyHtml = `<!DOCTYPE html>
    <html class="dark" lang="en">
      <head>
        <meta charset="utf-8"><title>Antigravity</title>
        <style>
          .agy-custom-thread { max-width: 720px; width: 100%; margin: 0 auto; }
          .agy-msg-percent { max-width: 82%; display: inline-block; }
        </style>
      </head>
      <body class="theme-standalone dark" data-agy-theme data-newux-theme="onyx" style="margin:0;height:100vh;overflow:hidden;font-family:Inter,sans-serif;color:#f8fafc;">
        <div id="root" style="height:100%;width:100%;">
          <div class="agy-shell h-full w-full flex flex-col bg-background" style="height:100%;width:100%;display:flex;flex-direction:column;">
            <!-- Top 35px Menu Bar -->
            <div class="shrink-0" style="height:35px;">
              <div data-testid="title-menu-bar" class="bg-sidebar" style="height:100%;display:flex;align-items:center;gap:14px;padding:0 14px;font-size:12px;">
                <button style="background:transparent;border:none;font:inherit;padding:4px 8px;">Antigravity</button>
                <button style="background:transparent;border:none;font:inherit;padding:4px 8px;">Workspace</button>
                <button style="background:transparent;border:none;font:inherit;padding:4px 8px;">View</button>
                <button style="background:transparent;border:none;font:inherit;padding:4px 8px;">Window</button>
              </div>
            </div>
            <!-- Main Inset Shell -->
            <div class="agy-inset-shell" style="flex:1;display:flex;min-height:0;position:relative;">
              <!-- Left Sidebar -->
              <div style="width:265px;height:100%;--color-sidebar:var(--shell-canvas);--sidebar:var(--shell-canvas);">
                <div role="navigation" aria-label="Sidebar" class="bg-sidebar" style="height:100%;display:flex;flex-direction:column;padding:12px;gap:10px;">
                  <div data-testid="sidebar-navigation-items" style="display:flex;flex-direction:column;gap:6px;">
                    <button data-testid="new-conversation-button" style="padding:8px 12px;border-radius:10px;text-align:left;font-weight:600;">+ New Conversation</button>
                    <button style="padding:7px 12px;border-radius:8px;text-align:left;background:transparent;border:none;color:inherit;">🕒 Automations</button>
                    <button class="bg-sidebar-secondary" aria-current="page" style="padding:7px 12px;border-radius:8px;text-align:left;">🧰 Customizations</button>
                  </div>
                  <div data-testid="conversation-list-sidebar" style="flex:1;display:flex;flex-direction:column;gap:6px;margin-top:8px;">
                    <div data-index="0" class="bg-sidebar">
                      <div data-testid="section-header" class="group/section-header bg-sidebar" style="padding:6px 8px;">
                        <h2 style="margin:0;font-size:12px;">Projects</h2>
                      </div>
                    </div>
                    <div data-index="1" data-sidebar-section-drop-id="p1" class="bg-sidebar">
                      <button data-project-card="true" data-testid="project-header" aria-expanded="true" class="bg-sidebar" style="width:100%;padding:8px 10px;text-align:left;">📂 Custom AGY</button>
                    </div>
                    <div data-index="2">
                      <div data-testid="conversation-row-sidebar" data-selected="true" class="agy-sidebar-row" style="padding:7px 12px;margin-left:14px;">Custom UI App For AGY</div>
                    </div>
                    <div data-index="3" data-sidebar-section-drop-id="p2" class="bg-sidebar">
                      <button data-project-card="true" data-testid="project-header" aria-expanded="false" class="bg-sidebar" style="width:100%;padding:8px 10px;text-align:left;">📁 EcomReview AI</button>
                    </div>
                    <div data-index="4" data-sidebar-section-drop-id="p3" class="bg-sidebar">
                      <button data-project-card="true" data-testid="project-header" aria-expanded="false" class="bg-sidebar" style="width:100%;padding:8px 10px;text-align:left;">📁 TodoLite</button>
                    </div>
                  </div>
                </div>
              </div>
              <!-- Main Sheet & Content Body -->
              <div class="agy-sheet" data-sheet-inset="true" style="flex:1;display:flex;flex-direction:column;padding:8px;">
                <div data-main-content-body="true" style="flex:1;display:flex;flex-direction:column;justify-content:space-between;padding:24px;position:relative;">
                  <div style="display:flex;justify-content:flex-end;align-items:center;gap:8px;">
                    <button id="mock-three-dot-btn" aria-label="More actions" style="background:transparent;border:none;color:inherit;padding:4px;"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="13" r="1.5"/></svg></button>
                    <button data-testid="open-editor-single" style="padding:5px 12px;font-size:12px;">Open IDE</button>
                  </div>
                  <div class="agy-home agy-custom-thread" id="mock-custom-thread" style="text-align:center;">
                    <h2 style="font-weight:500;font-size:22px;">Welcome back, MainBoy. Where should we pick up?</h2>
                    <span id="mock-small-pill" style="display:inline-block;max-width:120px;overflow:hidden;">badge</span>
                    <div id="mock-pct-bubble" class="agy-msg-percent">short message</div>
                  </div>
                  <div id="mock-composer-wrap" style="max-width:780px;width:100%;margin:0 auto;">
                    <div id="antigravity.agentSidePanelInputBox" class="surface-composer" style="padding:8px;">
                      <div style="padding:4px 8px;font-size:12px;opacity:0.85;">📁 Custom AGY ▾ &nbsp;&nbsp; 💻 Local Checkout ▾</div>
                      <div class="surface-composer-card" style="padding:12px;">
                        <div contenteditable="true" style="min-height:28px;">Ask anything, @ to mention, / for actions</div>
                      </div>
                    </div>
                  </div>
                  <div role="dialog" style="display:none;">
                    <div id="mock-dialog-box" style="max-width:520px;">Settings Modal</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>`;

    await win2.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(mockAgyHtml));
    const presetsCode = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'presets.js'), 'utf8');
    const runtimeCode = fs.readFileSync(path.join(rootDir, 'src', 'injected', 'agyInjectorRuntime.js'), 'utf8');

    await win2.webContents.executeJavaScript(`
      (async () => {
        ${presetsCode}
        window.__AGY_INITIAL_CUSTOM_CONFIG__ = window.AGY_PRESETS.DEFAULT_CONFIG;
        window.__AGY_INITIAL_CUSTOM_CONFIG__.music.enabled = true;
        ${runtimeCode}
        await new Promise((r) => setTimeout(r, 450));
      })();
    `);

    if (ARTIFACT_DIR && fs.existsSync(ARTIFACT_DIR)) {
      const imgMain = await win2.webContents.capturePage();
      fs.writeFileSync(path.join(ARTIFACT_DIR, 'verified_agy_main_ui.png'), imgMain.toPNG());
    }

    const inAppCheck = await win2.webContents.executeJavaScript(`
      (async () => {
        const btn = document.querySelector('.agy-floating-studio-btn');
        const mountedInHeader = Boolean(btn && btn.classList.contains('agy-in-header'));
        const nextIsThreeDots = Boolean(btn && btn.nextElementSibling && btn.nextElementSibling.id === 'mock-three-dot-btn');
        if (btn) btn.click();
        await new Promise((r) => setTimeout(r, 500));
        const backdrop = document.querySelector('.agy-inapp-drawer-backdrop');
        const drawer = document.querySelector('.agy-inapp-drawer');
        const closeBtn = document.querySelector('.agy-inapp-close');
        const menuBar = document.querySelector('[data-testid="title-menu-bar"]');
        const drawerOpen = backdrop && backdrop.classList.contains('open');
        const miniPlayerVisible = document.querySelector('.agy-mini-music-widget') !== null;
        const rect = drawer ? drawer.getBoundingClientRect() : null;
        const closeRect = closeBtn ? closeBtn.getBoundingClientRect() : null;
        const menuRect = menuBar ? menuBar.getBoundingClientRect() : null;
        const tabContentLen = document.querySelector('#agy-inapp-tab-content')?.innerHTML?.length || 0;

        // Verify In-App Wallpaper tab adaptive sync controls
        document.querySelector('.agy-inapp-tab[data-tab="wallpaper"]')?.click();
        await new Promise((r) => setTimeout(r, 150));
        const inAppHasAutoSync = Boolean(document.getElementById('inapp-wp-autosync'));
        const inAppHasSyncBtn = Boolean(document.getElementById('inapp-sync-wp-colors'));
        const stylesBefore = document.getElementById('agy-custom-ui-dynamic-styles')?.textContent || '';
        document.querySelector('[data-wp-id="aurora-borealis.svg"]')?.click();
        await new Promise((r) => setTimeout(r, 200));
        document.getElementById('inapp-sync-wp-colors')?.click();
        await new Promise((r) => setTimeout(r, 350));
        const stylesAfter = document.getElementById('agy-custom-ui-dynamic-styles')?.textContent || '';

        // Verify In-App Chat Layout controls (Auto / Narrow / Default / Wide / Fill / Custom)
        document.querySelector('.agy-inapp-tab[data-tab="effects"]')?.click();
        await new Promise((r) => setTimeout(r, 150));
        const chatWidthBtnCount = document.querySelectorAll('[data-chat-width]').length;
        const composerWrap = document.getElementById('mock-composer-wrap');
        const composerBox = document.getElementById('antigravity.agentSidePanelInputBox');
        const composerCard = composerBox.querySelector('.surface-composer-card');
        const mainBody = document.querySelector('[data-main-content-body]');
        const customThread = document.getElementById('mock-custom-thread');
        const pctBubble = document.getElementById('mock-pct-bubble');
        const smallPill = document.getElementById('mock-small-pill');
        const dialogBox = document.getElementById('mock-dialog-box');

        document.querySelector('[data-chat-width="narrow"]')?.click();
        await new Promise((r) => setTimeout(r, 80));
        const narrowMaxW = getComputedStyle(composerWrap).maxWidth;
        const narrowThreadMaxW = getComputedStyle(customThread).maxWidth;
        const pctBubbleMaxWWhileNarrow = getComputedStyle(pctBubble).maxWidth;
        const pillMaxWWhileNarrow = getComputedStyle(smallPill).maxWidth;
        const dialogMaxWWhileNarrow = getComputedStyle(dialogBox).maxWidth;

        // Verify Docked prompt style overrides chatWidth on composer wrapper (flush edge-to-edge + bottom 0px)
        // while keeping the chat thread at 640px!
        const promptSelect = document.getElementById('inapp-layout-prompt');
        promptSelect.value = 'docked';
        promptSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 340));
        const dockedMaxWWhileNarrow = getComputedStyle(composerWrap).maxWidth;
        const dockedThreadMaxWWhileNarrow = getComputedStyle(customThread).maxWidth;
        const dockedBottomLeftRadius = getComputedStyle(composerBox).borderBottomLeftRadius;
        const dockedCardBottomLeftRadius = getComputedStyle(composerCard).borderBottomLeftRadius;
        const dockedBodyRect = mainBody.getBoundingClientRect();
        const dockedComposerRect = composerBox.getBoundingClientRect();
        const dockedFlushEdges =
          Math.abs(dockedComposerRect.left - dockedBodyRect.left) <= 2 &&
          Math.abs(dockedComposerRect.right - dockedBodyRect.right) <= 2 &&
          Math.abs(dockedComposerRect.bottom - dockedBodyRect.bottom) <= 2;

        // Verify max custom slider (1600px) expands non-Tailwind chat thread while Docked stays flush
        const customSlider1600 = document.getElementById('inapp-layout-custom-width');
        customSlider1600.value = '1600';
        customSlider1600.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 80));
        const custom1600ThreadMaxW = getComputedStyle(customThread).maxWidth;
        const dockedMaxWWhile1600 = getComputedStyle(composerWrap).maxWidth;

        // Verify decoupled Prompt Width: keep chat thread at 1600px while shrinking prompt box to 640px / 680px
        const promptWidthSelect = document.getElementById('inapp-layout-prompt-width');
        promptWidthSelect.value = 'narrow';
        promptWidthSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 80));
        const independentPromptNarrowW = getComputedStyle(composerWrap).maxWidth;
        const independentThreadStill1600 = getComputedStyle(customThread).maxWidth;
        const autoSwitchedOffDocked = promptSelect.value === 'floating-island';

        const promptSlider = document.getElementById('inapp-layout-prompt-custom-width');
        promptSlider.value = '680';
        promptSlider.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 340));
        const independentPromptCustomW = getComputedStyle(composerBox).maxWidth;

        // Reset promptWidth back to match-chat before testing Fill / 1040 / Auto
        promptWidthSelect.value = 'match-chat';
        promptWidthSelect.dispatchEvent(new Event('change', { bubbles: true }));
        promptSelect.value = 'floating-island';
        promptSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 80));

        document.querySelector('[data-chat-width="fill"]')?.click();
        await new Promise((r) => setTimeout(r, 80));
        const fillMaxW = getComputedStyle(composerWrap).maxWidth;
        const pillMaxWWhileFill = getComputedStyle(smallPill).maxWidth;

        const customSliderBefore = document.getElementById('inapp-layout-custom-width');
        customSliderBefore.value = '1040';
        customSliderBefore.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 80));
        const customSliderAfter = document.getElementById('inapp-layout-custom-width');
        const customMaxW = getComputedStyle(composerWrap).maxWidth;
        const customLabelVal = document.getElementById('inapp-layout-custom-width-val')?.textContent || '';

        document.querySelector('[data-chat-width="auto"]')?.click();
        await new Promise((r) => setTimeout(r, 80));
        const autoMaxW = getComputedStyle(composerWrap).maxWidth;
        const autoTaggedCount = document.querySelectorAll('[data-agy-chat-frame]').length;

        // Verify stacking context & [data-browser-hole] clip-path punching
        const layersRoot = document.querySelector('.agy-custom-layers-root');
        const wpLayer = document.querySelector('.agy-wp-layer');
        const fxCanvas = document.querySelector('.agy-fx-canvas');
        const layersZIndex = layersRoot ? getComputedStyle(layersRoot).zIndex : '';
        const wpLayerZIndex = wpLayer ? getComputedStyle(wpLayer).zIndex : '';
        const fxCanvasZIndex = fxCanvas ? getComputedStyle(fxCanvas).zIndex : '';

        const holeEl = document.createElement('div');
        holeEl.setAttribute('data-browser-hole', 'true');
        holeEl.style.cssText = 'position:fixed;left:300px;top:60px;width:500px;height:400px;';
        document.body.appendChild(holeEl);
        await new Promise((r) => setTimeout(r, 120));
        const clipWithHole = wpLayer ? wpLayer.style.clipPath : '';
        holeEl.remove();
        await new Promise((r) => setTimeout(r, 120));
        const clipAfterHoleRemoved = wpLayer ? wpLayer.style.clipPath : '';

        return {
          mountedInHeader,
          nextIsThreeDots,
          drawerOpen,
          miniPlayerVisible,
          drawerRect: rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null,
          closeButtonBelowTitleBar: Boolean(closeRect && menuRect && closeRect.top >= menuRect.bottom),
          tabContentLen,
          inAppHasAutoSync,
          inAppHasSyncBtn,
          inAppStylesSynced: Boolean(stylesAfter && stylesAfter !== stylesBefore),
          chatWidthBtnCount,
          narrowMaxW,
          narrowThreadMaxW,
          pctBubbleMaxWWhileNarrow,
          dockedMaxWWhileNarrow,
          dockedThreadMaxWWhileNarrow,
          dockedBottomLeftRadius,
          dockedCardBottomLeftRadius,
          dockedFlushEdges,
          custom1600ThreadMaxW,
          dockedMaxWWhile1600,
          independentPromptNarrowW,
          independentThreadStill1600,
          autoSwitchedOffDocked,
          independentPromptCustomW,
          fillMaxW,
          customMaxW,
          customLabelVal,
          customSliderPreserved: customSliderBefore === customSliderAfter,
          autoMaxW,
          autoTaggedCount,
          pillMaxWWhileNarrow,
          pillMaxWWhileFill,
          dialogMaxWWhileNarrow,
          layersZIndex,
          wpLayerZIndex,
          fxCanvasZIndex,
          clipWithHole,
          clipAfterHoleRemoved
        };
      })();
    `);

    assert(pageErrors2.length === 0, 'Page errors in simulated AGY window: ' + pageErrors2.join('; '));
    assert.strictEqual(inAppCheck.layersZIndex, 'auto', 'layersRoot must not trap fxCanvas in z-index: 0 stacking context');
    assert.strictEqual(inAppCheck.wpLayerZIndex, '0', 'wpLayer should stay at z-index: 0 behind #root');
    assert.strictEqual(inAppCheck.fxCanvasZIndex, '999980', 'fxCanvas should render at z-index: 999980');
    assert(inAppCheck.clipWithHole && inAppCheck.clipWithHole.includes('polygon(evenodd'), 'Built-in browser hole clip-path did not punch out wallpaper');
    assert.strictEqual(inAppCheck.clipAfterHoleRemoved, '', 'Built-in browser hole clip-path did not clear after hole removal');

    assert(inAppCheck.mountedInHeader, 'AGY Studio button was not mounted in header');
    assert(inAppCheck.nextIsThreeDots, 'AGY Studio button was not placed immediately left of the 3-dot button');
    assert(inAppCheck.drawerOpen, 'In-App Studio Drawer did not open');
    assert(inAppCheck.closeButtonBelowTitleBar, 'In-App Studio close button overlaps the top title bar');
    assert(inAppCheck.miniPlayerVisible, 'In-App Mini Music Player did not mount');
    assert(inAppCheck.inAppHasAutoSync && inAppCheck.inAppHasSyncBtn, 'In-App Wallpaper auto-sync controls missing');
    assert(inAppCheck.inAppStylesSynced, 'In-App dynamic stylesheet did not update on adaptive wallpaper sync');
    assert.strictEqual(inAppCheck.chatWidthBtnCount, 6, 'Expected 6 chat width preset buttons in In-App Drawer');
    assert.strictEqual(inAppCheck.narrowMaxW, '640px', 'Narrow chat width did not apply 640px');
    assert.strictEqual(inAppCheck.narrowThreadMaxW, '640px', 'Non-Tailwind chat thread did not apply 640px');
    assert.strictEqual(inAppCheck.pctBubbleMaxWWhileNarrow, '82%', 'Percentage message bubble max-width was unexpectedly overridden');
    assert.strictEqual(inAppCheck.dockedMaxWWhileNarrow, 'none', 'Docked outer wrapper did not expand past parent padding');
    assert.strictEqual(inAppCheck.dockedThreadMaxWWhileNarrow, '640px', 'Docked prompt box unexpectedly changed chat thread width');
    assert.strictEqual(inAppCheck.dockedBottomLeftRadius, '0px', 'Docked prompt box did not flatten bottom corners');
    assert.strictEqual(inAppCheck.dockedCardBottomLeftRadius, '0px', 'Docked inner composer card did not flatten bottom corners');
    assert(inAppCheck.dockedFlushEdges, 'Docked prompt box was not flush with left/right/bottom edges of main body');
    assert.strictEqual(inAppCheck.custom1600ThreadMaxW, '1600px', 'Custom 1600px width did not apply to non-Tailwind chat thread');
    assert.strictEqual(inAppCheck.dockedMaxWWhile1600, 'none', 'Docked outer wrapper did not stay full-bleed when chatWidth is 1600px');
    assert.strictEqual(inAppCheck.independentPromptNarrowW, '640px', 'Decoupled narrow prompt width did not shrink prompt box to 640px');
    assert.strictEqual(inAppCheck.independentThreadStill1600, '1600px', 'Decoupled narrow prompt width unexpectedly shrunk chat thread');
    assert(inAppCheck.autoSwitchedOffDocked, 'Choosing narrower prompt width did not auto-switch off Docked mode');
    assert.strictEqual(inAppCheck.independentPromptCustomW, '680px', 'Decoupled prompt custom width slider did not apply 680px');
    assert.strictEqual(inAppCheck.fillMaxW, '98%', 'Fill chat width did not apply 98%');
    assert.strictEqual(inAppCheck.customMaxW, '1040px', 'Custom chat width slider did not apply 1040px');
    assert.strictEqual(inAppCheck.customLabelVal, '1040', 'Custom chat width label did not update');
    assert(inAppCheck.customSliderPreserved, 'Custom chat width slider DOM node was destroyed on input');
    assert.strictEqual(inAppCheck.autoMaxW, '780px', 'Auto chat width did not release override back to native 780px');
    assert.strictEqual(inAppCheck.autoTaggedCount, 0, 'Auto chat width left stale data-agy-chat-frame tags');
    assert.strictEqual(inAppCheck.pillMaxWWhileNarrow, '120px', 'Small pill max-width was unexpectedly overridden in narrow mode');
    assert.strictEqual(inAppCheck.pillMaxWWhileFill, '120px', 'Small pill max-width was unexpectedly overridden in fill mode');
    assert.strictEqual(inAppCheck.dialogMaxWWhileNarrow, '520px', 'Dialog modal max-width was unexpectedly overridden');

    if (fs.existsSync(tempCustomWpPath)) {
      fs.rmSync(tempCustomWpPath, { force: true });
    }

    if (ARTIFACT_DIR && fs.existsSync(ARTIFACT_DIR)) {
      await win2.webContents.executeJavaScript(`
        (async () => {
          document.querySelector('.agy-inapp-tab[data-tab="theme"]')?.click();
          await new Promise((r) => setTimeout(r, 80));
          document.querySelector('[data-preset="tokyo-rain-zen"]')?.click();
          await new Promise((r) => setTimeout(r, 180));
        })();
      `);
      const img2 = await win2.webContents.capturePage();
      fs.writeFileSync(path.join(ARTIFACT_DIR, 'verified_inapp_drawer_open.png'), img2.toPNG());
    }

    // -----------------------------------------------------------------------
    // 3. Test Apply & Restore directly inside Electron Main Process (original-fs)
    // -----------------------------------------------------------------------
    const ofs = require('original-fs');
    const tempElectronSandbox = path.join(os.tmpdir(), `agy-e2e-asar-${process.pid}`);
    let electronApplyRes;
    let electronRestoreRes;
    try {
      if (ofs.existsSync(tempElectronSandbox)) {
        ofs.rmSync(tempElectronSandbox, { recursive: true, force: true });
      }
      ofs.mkdirSync(path.join(tempElectronSandbox, 'resources'), { recursive: true });
      ofs.writeFileSync(path.join(tempElectronSandbox, 'Antigravity.exe'), 'STUB');
      const realScan = autoScanAgyRoot();
      ofs.copyFileSync(
        realScan.hasBackup ? realScan.backupPath : realScan.asarPath,
        path.join(tempElectronSandbox, 'resources', 'app.asar')
      );

      electronApplyRes = applyCustomizationToAgy({
        agyRootPath: tempElectronSandbox,
        config: DEFAULT_CONFIG,
        studioRootDir: rootDir
      });
      assert(electronApplyRes.ok, 'Apply inside Electron failed: ' + electronApplyRes.error);

      electronRestoreRes = restoreOriginalAgy({
        agyRootPath: tempElectronSandbox
      });
      assert(electronRestoreRes.ok, 'Restore inside Electron failed: ' + electronRestoreRes.error);
    } finally {
      if (ofs.existsSync(tempElectronSandbox)) {
        ofs.rmSync(tempElectronSandbox, { recursive: true, force: true });
      }
      if (fs.existsSync(tempCustomWpPath)) {
        fs.rmSync(tempCustomWpPath, { force: true });
      }
    }

    console.log('================================================================');
    console.log('✅ KIỂM THỬ ELECTRON RENDERER, IN-APP STUDIO & ORIGINAL-FS ASAR THÀNH CÔNG 100%:');
    console.log('  • Apply & Restore .asar trực tiếp trong tiến trình Electron:', electronApplyRes.ok && electronRestoreRes.ok);
    console.log('  • Đường dẫn AGY nhận diện trên UI:', checkResult.pathText);
    console.log('  • Số lượng thẻ Theme hiển thị:', checkResult.presetCardsCount);
    console.log('  • Blob URL Nhạc WAV Starter Pack:', checkResult.wavBlobUrl);
    console.log('  • Blob URL Hình nền SVG Starter Pack:', checkResult.svgBlobUrl);
    console.log('  • In-App Studio Drawer mở trực tiếp trên AGY:', inAppCheck.drawerOpen, inAppCheck.drawerRect, 'contentLen:', inAppCheck.tabContentLen);
    console.log('  • Mini Music Player hiển thị trên AGY:', inAppCheck.miniPlayerVisible);
    console.log('================================================================');

    app.quit();
    process.exit(0);
  } catch (err) {
    console.error('❌ Lỗi kiểm thử Electron Renderer:', err);
    app.quit();
    process.exit(1);
  }
});
