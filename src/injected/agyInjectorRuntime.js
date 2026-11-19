/**
 * AGY UI Studio - Injected Frontend Runtime & In-App Customizer
 * Runs safely inside Antigravity App's Renderer Process (Frontend only)
 * AND powers the Live Preview inside the Standalone AGY UI Studio app.
 */
(function () {
  if (window.__AGY_CUSTOM_UI_RUNTIME_ACTIVE__) return;
  window.__AGY_CUSTOM_UI_RUNTIME_ACTIVE__ = true;

  const PRESETS_DATA = window.AGY_PRESETS || {
    THEME_PRESETS: [],
    BUILTIN_WALLPAPERS: [],
    STARTER_MUSIC: [],
    DEFAULT_CONFIG: {}
  };

  const bridge = window.agyCustomBridge || window.studioAPI || null;
  const isStandaloneStudio = Boolean(window.__IS_STANDALONE_AGY_STUDIO__);

  const UNSAFE_MERGE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

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

  let currentConfig = deepMerge(
    PRESETS_DATA.DEFAULT_CONFIG,
    window.__AGY_INITIAL_CUSTOM_CONFIG__ || {}
  );

  // Bounded LRU Blob URL cache to avoid re-reading files from disk without leaking memory
  const MAX_BLOB_CACHE = 10;
  const blobUrlCache = new Map();

  async function resolveMediaToBlobUrl(assetRef) {
    if (!assetRef) return null;
    if (assetRef.startsWith('blob:') || assetRef.startsWith('data:')) {
      return assetRef;
    }
    if (blobUrlCache.has(assetRef)) {
      const cached = blobUrlCache.get(assetRef);
      blobUrlCache.delete(assetRef);
      blobUrlCache.set(assetRef, cached);
      return cached;
    }
    if (!bridge || typeof bridge.readMedia !== 'function') {
      return null;
    }
    try {
      const res = await bridge.readMedia(assetRef);
      if (!res || !res.ok || !res.base64) {
        console.warn('[AGY-UI-Studio] Could not load media:', assetRef, res && res.error);
        return null;
      }
      const binaryStr = atob(res.base64);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: res.mime || 'application/octet-stream' });
      const blobUrl = URL.createObjectURL(blob);
      blobUrlCache.set(assetRef, blobUrl);
      while (blobUrlCache.size > MAX_BLOB_CACHE) {
        const oldestKey = blobUrlCache.keys().next().value;
        const oldestUrl = blobUrlCache.get(oldestKey);
        blobUrlCache.delete(oldestKey);
        if (oldestUrl && oldestUrl.startsWith('blob:')) {
          try { URL.revokeObjectURL(oldestUrl); } catch (_) {}
        }
      }
      return blobUrl;
    } catch (err) {
      console.warn('[AGY-UI-Studio] Media Blob conversion error:', err);
      return null;
    }
  }

  function hexToRgb(hex, fallback = '15, 10, 30') {
    const clean = String(hex || '').replace('#', '').trim();
    if (clean.length === 3) {
      const r = parseInt(clean[0] + clean[0], 16);
      const g = parseInt(clean[1] + clean[1], 16);
      const b = parseInt(clean[2] + clean[2], 16);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) return `${r}, ${g}, ${b}`;
    }
    if (clean.length === 6) {
      const r = parseInt(clean.slice(0, 2), 16);
      const g = parseInt(clean.slice(2, 4), 16);
      const b = parseInt(clean.slice(4, 6), 16);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) return `${r}, ${g}, ${b}`;
    }
    return fallback;
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // =========================================================================
  // 0. ADAPTIVE WALLPAPER COLOR PALETTE EXTRACTOR (GIF / Video / Image / SVG)
  // =========================================================================
  function clampNum(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function rgbToHsl(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) * 0.5;
    if (max === min) {
      return { h: 0, s: 0, l };
    }
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === rn) {
      h = (gn - bn) / d + (gn < bn ? 6 : 0);
    } else if (max === gn) {
      h = (bn - rn) / d + 2;
    } else {
      h = (rn - gn) / d + 4;
    }
    return { h: (h * 60 + 360) % 360, s, l };
  }

  function hslToHex(h, s, l) {
    const hn = (((h % 360) + 360) % 360) / 360;
    const sn = clampNum(s, 0, 1);
    const ln = clampNum(l, 0, 1);
    const hue2rgb = (p, q, t) => {
      let tn = t;
      if (tn < 0) tn += 1;
      if (tn > 1) tn -= 1;
      if (tn < 1 / 6) return p + (q - p) * 6 * tn;
      if (tn < 1 / 2) return q;
      if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
      return p;
    };
    let r, g, b;
    if (sn === 0) {
      r = g = b = ln;
    } else {
      const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
      const p = 2 * ln - q;
      r = hue2rgb(p, q, hn + 1 / 3);
      g = hue2rgb(p, q, hn);
      b = hue2rgb(p, q, hn - 1 / 3);
    }
    const toHex = (x) =>
      Math.round(clampNum(x * 255, 0, 255))
        .toString(16)
        .padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function hueDistance(h1, h2) {
    const diff = Math.abs(h1 - h2) % 360;
    return diff > 180 ? 360 - diff : diff;
  }

  function lerpHue(h1, h2, t) {
    let diff = ((h2 - h1 + 540) % 360) - 180;
    return (h1 + diff * t + 360) % 360;
  }

  function getContrastTextColor(hex) {
    const rgbStr = hexToRgb(hex, '6, 182, 212');
    const parts = rgbStr.split(',').map((n) => parseInt(n.trim(), 10) || 0);
    const toLinear = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    const lum = 0.2126 * toLinear(parts[0]) + 0.7152 * toLinear(parts[1]) + 0.0722 * toLinear(parts[2]);
    return lum > 0.52 ? '#0f172a' : '#ffffff';
  }

  /**
   * Builds a harmonious, high-contrast 9-token UI theme palette from raw RGBA image pixels.
   * Ensures left sidebar, chat panels, bubbles, borders, and primary/accent glows match the media.
   */
  function extractPaletteFromPixels(rgbaData) {
    if (!rgbaData || rgbaData.length < 4) return null;
    const buckets = new Map();
    let totalPixels = 0;

    for (let i = 0; i + 3 < rgbaData.length; i += 4) {
      const a = rgbaData[i + 3];
      if (a < 128) continue;
      const r = rgbaData[i];
      const g = rgbaData[i + 1];
      const b = rgbaData[i + 2];
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      let entry = buckets.get(key);
      if (!entry) {
        entry = { sumR: 0, sumG: 0, sumB: 0, count: 0 };
        buckets.set(key, entry);
      }
      entry.sumR += r;
      entry.sumG += g;
      entry.sumB += b;
      entry.count += 1;
      totalPixels += 1;
    }

    if (totalPixels === 0) return null;

    const clusterList = [];
    let chromaticWeight = 0;
    for (const entry of buckets.values()) {
      const r = entry.sumR / entry.count;
      const g = entry.sumG / entry.count;
      const b = entry.sumB / entry.count;
      const hsl = rgbToHsl(r, g, b);
      if (hsl.s >= 0.12 && hsl.l >= 0.05 && hsl.l <= 0.95) {
        chromaticWeight += entry.count * hsl.s;
      }
      clusterList.push({
        count: entry.count,
        ratio: entry.count / totalPixels,
        h: hsl.h,
        s: hsl.s,
        l: hsl.l
      });
    }

    // Monochrome / grayscale fallback
    if (chromaticWeight / totalPixels < 0.025) {
      return {
        background: '#06070a',
        foreground: '#f8fafc',
        card: '#13161e',
        sidebar: '#0b0d13',
        primary: '#cbd5e1',
        accent: '#94a3b8',
        border: '#2c3342',
        userBubble: '#222836',
        aiBubble: '#10131b'
      };
    }

    const scoreVibrant = (c) => {
      if (c.l < 0.11 || c.l > 0.91 || c.s < 0.15) return 0;
      const areaFactor = Math.pow(c.ratio, 0.42);
      const satFactor = 0.25 + Math.pow(c.s, 1.35) * 1.65;
      const lumFactor = Math.max(0.15, 1 - Math.abs(c.l - 0.54) * 1.15);
      return areaFactor * satFactor * lumFactor;
    };

    let primaryCluster = null;
    let primaryScore = 0;
    for (const c of clusterList) {
      const sc = scoreVibrant(c);
      if (sc > primaryScore) {
        primaryScore = sc;
        primaryCluster = c;
      }
    }

    if (!primaryCluster) {
      let bestFallbackScore = -1;
      for (const c of clusterList) {
        const sc = c.ratio * (0.1 + c.s);
        if (sc > bestFallbackScore) {
          bestFallbackScore = sc;
          primaryCluster = c;
        }
      }
      primaryScore = bestFallbackScore;
    }

    let accentCluster = null;
    let accentScore = 0;
    for (const c of clusterList) {
      const dist = hueDistance(c.h, primaryCluster.h);
      if (dist < 34) continue;
      const baseSc = scoreVibrant(c);
      if (baseSc <= 0) continue;
      const distBonus = 1 + Math.min(dist, 120) / 360;
      const sc = baseSc * distBonus;
      if (sc > accentScore) {
        accentScore = sc;
        accentCluster = c;
      }
    }

    // Dominant ambient hue/saturation for sidebar, card, and background glass tints
    let bestAmbient = null;
    let bestAmbientScore = -1;
    for (const c of clusterList) {
      const lumWeight = c.l <= 0.78 ? 1.0 : 0.45;
      const sc = c.ratio * (0.15 + c.s * 0.85) * lumWeight;
      if (sc > bestAmbientScore) {
        bestAmbientScore = sc;
        bestAmbient = c;
      }
    }

    let baseHue = primaryCluster.h;
    let baseSat = clampNum(primaryCluster.s * 0.55, 0.25, 0.55);
    if (bestAmbient && bestAmbient.s >= 0.08) {
      let sinSum = 0;
      let cosSum = 0;
      let satSum = 0;
      let wSum = 0;
      for (const c of clusterList) {
        if (c.s < 0.08 || hueDistance(c.h, bestAmbient.h) > 45) continue;
        const w = c.ratio * (0.2 + c.s);
        const rad = (c.h * Math.PI) / 180;
        sinSum += Math.sin(rad) * w;
        cosSum += Math.cos(rad) * w;
        satSum += c.s * w;
        wSum += w;
      }
      if (wSum > 0) {
        baseHue = ((Math.atan2(sinSum, cosSum) * 180) / Math.PI + 360) % 360;
        baseSat = satSum / wSum;
      } else {
        baseHue = bestAmbient.h;
        baseSat = bestAmbient.s;
      }
    }

    const primaryHue = primaryCluster.h;
    const primarySat = clampNum(primaryCluster.s, 0.64, 0.92);
    const primaryLight = clampNum(primaryCluster.l, 0.52, 0.64);

    const hasDistinctAccent = Boolean(accentCluster && accentScore > primaryScore * 0.16);
    const accentHue = hasDistinctAccent ? accentCluster.h : (primaryHue + 34) % 360;
    const accentSat = hasDistinctAccent
      ? clampNum(accentCluster.s, 0.62, 0.92)
      : clampNum(primarySat * 0.95, 0.60, 0.90);
    const accentLight = hasDistinctAccent
      ? clampNum(accentCluster.l, 0.54, 0.68)
      : clampNum(primaryLight + 0.05, 0.56, 0.68);

    const bgSat = clampNum(baseSat * 0.78, 0.24, 0.52);
    const sidebarSat = clampNum(baseSat * 0.85, 0.28, 0.58);
    const cardSat = clampNum(baseSat * 0.80, 0.26, 0.54);
    const borderHue = lerpHue(baseHue, primaryHue, 0.45);
    const borderSat = clampNum(Math.max(baseSat, primarySat) * 0.68, 0.34, 0.64);
    const userHue = lerpHue(primaryHue, baseHue, 0.18);
    const userSat = clampNum(primarySat * 0.72, 0.36, 0.64);

    return {
      background: hslToHex(baseHue, bgSat, 0.06),
      foreground: hslToHex(primaryHue, 0.16, 0.97),
      card: hslToHex(baseHue, cardSat, 0.145),
      sidebar: hslToHex(baseHue, sidebarSat, 0.095),
      primary: hslToHex(primaryHue, primarySat, primaryLight),
      accent: hslToHex(accentHue, accentSat, accentLight),
      border: hslToHex(borderHue, borderSat, 0.30),
      userBubble: hslToHex(userHue, userSat, 0.21),
      aiBubble: hslToHex(baseHue, clampNum(cardSat * 0.95, 0.25, 0.50), 0.115)
    };
  }

  function extractPaletteFromDrawable(drawable) {
    const sampleSize = 64;
    const canvas = document.createElement('canvas');
    canvas.width = sampleSize;
    canvas.height = sampleSize;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.clearRect(0, 0, sampleSize, sampleSize);
    ctx.drawImage(drawable, 0, 0, sampleSize, sampleSize);
    const imgData = ctx.getImageData(0, 0, sampleSize, sampleSize);
    let lumSum = 0;
    for (let i = 0; i + 3 < imgData.data.length; i += 4) {
      lumSum += (imgData.data[i] * 0.299 + imgData.data[i + 1] * 0.587 + imgData.data[i + 2] * 0.114) / 255;
    }
    const avgLum = lumSum / (sampleSize * sampleSize);
    return {
      palette: extractPaletteFromPixels(imgData.data),
      avgLum
    };
  }

  function sampleImagePalette(blobUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      let settled = false;
      const done = (val) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(val);
      };
      const timer = setTimeout(() => done(null), 5000);
      img.onload = () => {
        try {
          const res = extractPaletteFromDrawable(img);
          done(res ? res.palette : null);
        } catch (_) {
          done(null);
        }
      };
      img.onerror = () => done(null);
      img.src = blobUrl;
    });
  }

  function sampleVideoPalette(blobUrl) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      let settled = false;

      const cleanup = () => {
        try {
          video.pause();
          video.removeAttribute('src');
          video.load();
        } catch (_) {}
      };
      const done = (val) => {
        if (settled) return;
        settled = true;
        clearTimeout(overallTimer);
        cleanup();
        resolve(val);
      };
      const overallTimer = setTimeout(() => done(null), 7000);

      const waitForSeek = (targetTime) =>
        new Promise((resSeek) => {
          let seekDone = false;
          const finishSeek = () => {
            if (seekDone) return;
            seekDone = true;
            clearTimeout(seekTimer);
            video.removeEventListener('seeked', finishSeek);
            resSeek();
          };
          const seekTimer = setTimeout(finishSeek, 1500);
          video.addEventListener('seeked', finishSeek);
          try {
            video.currentTime = targetTime;
          } catch (_) {
            finishSeek();
          }
        });

      video.addEventListener(
        'loadeddata',
        async () => {
          try {
            const dur = video.duration;
            if (Number.isFinite(dur) && dur > 0.4) {
              await waitForSeek(Math.min(1.0, dur * 0.25));
            }
            let sampled = extractPaletteFromDrawable(video);
            if (sampled && sampled.avgLum < 0.03 && Number.isFinite(dur) && dur > 1.0) {
              await waitForSeek(dur * 0.5);
              sampled = extractPaletteFromDrawable(video);
            }
            done(sampled ? sampled.palette : null);
          } catch (_) {
            done(null);
          }
        },
        { once: true }
      );
      video.addEventListener('error', () => done(null), { once: true });
      video.src = blobUrl;
    });
  }

  async function extractPaletteFromWallpaperConfig(cfg, fallbackCanvasEl = null) {
    const wp = (cfg && cfg.wallpaper) || {};
    if (!wp.enabled || wp.sourceType === 'none') return null;

    if (wp.sourceType === 'canvas') {
      if (fallbackCanvasEl && fallbackCanvasEl.width > 0 && fallbackCanvasEl.height > 0) {
        try {
          const sampled = extractPaletteFromDrawable(fallbackCanvasEl);
          if (sampled && sampled.palette) return sampled.palette;
        } catch (_) {}
      }
      const matchedPreset = (PRESETS_DATA.THEME_PRESETS || []).find(
        (p) => p.recommended && p.recommended.wallpaperId === wp.builtinId
      );
      return matchedPreset ? { ...matchedPreset.colors } : null;
    }

    const ref = wp.sourceType === 'svg' ? `wallpapers/${wp.builtinId}` : wp.customFilePath;
    if (!ref) return null;
    const blobUrl = await resolveMediaToBlobUrl(ref);
    if (!blobUrl) return null;

    const isVideo =
      /\.(mp4|webm)(\?|$)/i.test(ref) || String(wp.customFileMime || '').startsWith('video/');
    if (isVideo) {
      return sampleVideoPalette(blobUrl);
    }
    return sampleImagePalette(blobUrl);
  }

  async function syncConfigColorsFromWallpaper(cfg, options = {}) {
    if (!cfg || !cfg.wallpaper) return { ok: false };
    const palette = await extractPaletteFromWallpaperConfig(cfg, options.canvasEl || null);
    if (!palette) return { ok: false };
    cfg.colors = { ...(cfg.colors || {}), ...palette };
    cfg.activePresetId = 'adaptive-wallpaper';
    cfg.wallpaper.syncedForPath =
      cfg.wallpaper.sourceType === 'custom-file'
        ? cfg.wallpaper.customFilePath || ''
        : `${cfg.wallpaper.sourceType}:${cfg.wallpaper.builtinId || ''}`;
    return { ok: true, palette };
  }

  // =========================================================================
  // 1. MECHANICAL KEYBOARD & UI SOUND SYNTHESIZER (Web Audio API - Zero Lag)
  // =========================================================================
  let audioCtx = null;
  function getAudioContext() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function playKeySound(profile = 'holy-panda', volume = 0.35, isEnter = false) {
    if (!profile || profile === 'off' || volume <= 0) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(Math.min(1, volume), now);
    master.connect(ctx.destination);

    // Subtle pitch variation per keystroke for natural feel
    const detune = 0.94 + Math.random() * 0.12;

    if (profile === 'holy-panda') {
      // Deep "Thock" tactile sound
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      const baseFreq = (isEnter ? 145 : 185) * detune;
      osc.frequency.setValueAtTime(baseFreq * 1.8, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.55, now + 0.045);
      g.gain.setValueAtTime(0.8, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc.connect(g);
      g.connect(master);
      osc.start(now);
      osc.stop(now + 0.055);
    } else if (profile === 'mx-blue') {
      // Crisp high-pitched click + bottom out
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime((isEnter ? 1100 : 1450) * detune, now);
      osc.frequency.exponentialRampToValueAtTime(280, now + 0.025);
      g.gain.setValueAtTime(0.45, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.028);
      osc.connect(g);
      g.connect(master);
      osc.start(now);
      osc.stop(now + 0.03);
    } else if (profile === 'typewriter') {
      // Metallic strike
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime((isEnter ? 620 : 820) * detune, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.04);
      g.gain.setValueAtTime(0.5, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
      osc.connect(g);
      g.connect(master);
      osc.start(now);
      osc.stop(now + 0.05);
    } else if (profile === 'scifi-bubble') {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime((isEnter ? 320 : 480) * detune, now);
      osc.frequency.exponentialRampToValueAtTime((isEnter ? 740 : 680) * detune, now + 0.045);
      g.gain.setValueAtTime(0.45, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc.connect(g);
      g.connect(master);
      osc.start(now);
      osc.stop(now + 0.055);
    }
  }

  function playSendChime(volume = 0.35) {
    const ctx = getAudioContext();
    if (!ctx || volume <= 0) return;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99]; // C5 - E5 - G5 pleasant triad
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.045);
      g.gain.setValueAtTime(volume * 0.25, now + idx * 0.045);
      g.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.045 + 0.22);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(now + idx * 0.045);
      osc.stop(now + idx * 0.045 + 0.24);
    });
  }

  // =========================================================================
  // 2. CANVAS WALLPAPER & PARTICLE EFFECTS ENGINE
  // =========================================================================
  function createVisualEngine(containerEl) {
    const rootWrap = document.createElement('div');
    rootWrap.className = 'agy-custom-layers-root';
    rootWrap.innerHTML = `
      <div class="agy-wp-layer">
        <canvas class="agy-wp-canvas"></canvas>
        <img class="agy-wp-img" alt="" style="display:none;" />
        <video class="agy-wp-video" autoplay loop muted playsinline style="display:none;"></video>
        <div class="agy-wp-dim"></div>
      </div>
      <canvas class="agy-fx-canvas"></canvas>
      <div class="agy-scanlines-overlay" style="display:none;"></div>
    `;
    containerEl.prepend(rootWrap);

    const wpLayer = rootWrap.querySelector('.agy-wp-layer');
    const wpCanvas = rootWrap.querySelector('.agy-wp-canvas');
    const wpImg = rootWrap.querySelector('.agy-wp-img');
    const wpVideo = rootWrap.querySelector('.agy-wp-video');
    const wpDim = rootWrap.querySelector('.agy-wp-dim');
    const fxCanvas = rootWrap.querySelector('.agy-fx-canvas');
    const scanlinesEl = rootWrap.querySelector('.agy-scanlines-overlay');

    const wpCtx = wpCanvas.getContext('2d');
    const fxCtx = fxCanvas.getContext('2d');

    let width = 1280;
    let height = 720;
    let rafId = null;
    let isWindowHidden = Boolean(document.hidden);
    let isDestroyed = false;
    let cfg = currentConfig;
    let lastMediaKey = '';
    let lastWpId = '';
    let cachedPrimaryRgb = hexToRgb(cfg.colors?.primary, '6, 182, 212');
    let fxDirty = false;

    // State for procedural wallpapers & particles
    let stars = [];
    let particles = [];
    let matrixDrops = [];
    let cursorTrail = [];
    let ripples = [];
    let mousePos = { x: -999, y: -999 };

    const isBodyTarget = containerEl === document.body;
    let lastHoleClip = '';

    function syncBrowserHoleMask() {
      if (!isBodyTarget) return;
      const holes = document.querySelectorAll('[data-browser-hole]');
      let activeRect = null;
      for (const h of holes) {
        if (!h.isConnected) continue;
        const cs = window.getComputedStyle(h);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = h.getBoundingClientRect();
        if (r.width > 4 && r.height > 4) {
          activeRect = r;
          break;
        }
      }
      let nextClip = '';
      if (activeRect) {
        const l = Math.max(0, Math.round(activeRect.left));
        const t = Math.max(0, Math.round(activeRect.top));
        const r = Math.min(window.innerWidth, Math.round(activeRect.right));
        const b = Math.min(window.innerHeight, Math.round(activeRect.bottom));
        if (r > l && b > t) {
          nextClip = `polygon(evenodd, 0px 0px, 100% 0px, 100% 100%, 0px 100%, 0px 0px, ${l}px ${t}px, ${r}px ${t}px, ${r}px ${b}px, ${l}px ${b}px, ${l}px ${t}px)`;
        }
      }
      if (nextClip !== lastHoleClip) {
        lastHoleClip = nextClip;
        wpLayer.style.clipPath = nextClip;
        fxCanvas.style.clipPath = nextClip;
        scanlinesEl.style.clipPath = nextClip;
      }
    }

    function shouldAnimate() {
      if (isDestroyed || !cfg.enabled) return false;
      if (isWindowHidden && cfg.effects?.smartEcoMode) return false;
      const hasCanvasWp = Boolean(cfg.wallpaper?.enabled && cfg.wallpaper?.sourceType === 'canvas');
      const hasParticles = (cfg.effects?.particles || 'none') !== 'none';
      const cEffect = cfg.effects?.cursorEffect || 'none';
      const hasCursorAnim =
        (cEffect === 'neon-trail' && cursorTrail.length > 0) ||
        (cEffect === 'click-ripple' && ripples.length > 0) ||
        (cEffect === 'spotlight' && mousePos.x > 0);
      return hasCanvasWp || hasParticles || hasCursorAnim;
    }

    function ensureLoopRunning() {
      if (rafId === null && shouldAnimate()) {
        rafId = requestAnimationFrame(tick);
      }
    }

    function initSceneObjects(forceAll = false) {
      if (forceAll || stars.length === 0) {
        stars = Array.from({ length: 90 }, () => ({
          x: Math.random() * width,
          y: Math.random() * height,
          r: 0.6 + Math.random() * 1.8,
          alpha: 0.2 + Math.random() * 0.8,
          speed: 0.15 + Math.random() * 0.45
        }));
      }

      const density = Math.max(10, Math.min(140, Number(cfg.effects?.particleDensity || 55)));
      if (forceAll || particles.length !== density) {
        particles = Array.from({ length: density }, () => ({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 1.1,
          vy: 0.5 + Math.random() * 1.4,
          size: 2 + Math.random() * 4.5,
          angle: Math.random() * Math.PI * 2,
          spin: (Math.random() - 0.5) * 0.04,
          hue: Math.random() * 60
        }));
      }

      const cols = Math.ceil(width / 18);
      if (forceAll || matrixDrops.length !== cols) {
        matrixDrops = Array.from({ length: cols }, () => Math.random() * -50);
      }
    }

    function resize(forceInit = false) {
      const rect = containerEl.getBoundingClientRect();
      const rawW = isBodyTarget ? window.innerWidth : (rect.width || window.innerWidth);
      const rawH = isBodyTarget ? window.innerHeight : (rect.height || window.innerHeight);
      const nextW = Math.max(300, Math.floor(rawW));
      const nextH = Math.max(200, Math.floor(rawH));
      const dimsChanged = nextW !== width || nextH !== height;
      if (!dimsChanged && !forceInit && wpCanvas.width === nextW && wpCanvas.height === nextH) {
        return;
      }
      width = nextW;
      height = nextH;
      wpCanvas.width = width;
      wpCanvas.height = height;
      fxCanvas.width = width;
      fxCanvas.height = height;
      initSceneObjects(dimsChanged || forceInit);
    }

    const onMouseMove = (e) => {
      if (isBodyTarget) {
        mousePos.x = e.clientX;
        mousePos.y = e.clientY;
      } else {
        const rect = containerEl.getBoundingClientRect();
        mousePos.x = e.clientX - rect.left;
        mousePos.y = e.clientY - rect.top;
      }
      if (cfg.enabled && cfg.effects?.cursorEffect === 'neon-trail') {
        cursorTrail.push({ x: mousePos.x, y: mousePos.y, life: 1.0 });
        if (cursorTrail.length > 28) cursorTrail.shift();
        ensureLoopRunning();
      } else if (cfg.enabled && cfg.effects?.cursorEffect === 'spotlight') {
        ensureLoopRunning();
      }
    };

    const onMouseDown = (e) => {
      let x, y;
      if (isBodyTarget) {
        x = e.clientX;
        y = e.clientY;
      } else {
        const rect = containerEl.getBoundingClientRect();
        x = e.clientX - rect.left;
        y = e.clientY - rect.top;
      }
      if (cfg.enabled && cfg.effects?.cursorEffect === 'click-ripple') {
        ripples.push({ x, y, r: 4, alpha: 0.95 });
        ensureLoopRunning();
      }
    };

    const onResize = () => resize(false);
    const onVisibilityChange = () => {
      isWindowHidden = document.hidden;
      if (wpVideo && wpVideo.style.display !== 'none' && cfg.enabled) {
        if (isWindowHidden && cfg.effects?.smartEcoMode) wpVideo.pause();
        else wpVideo.play().catch(() => {});
      }
      if (!isWindowHidden) {
        ensureLoopRunning();
      }
    };

    const eventTarget = isBodyTarget ? window : containerEl;
    eventTarget.addEventListener('mousemove', onMouseMove, { passive: true });
    eventTarget.addEventListener('mousedown', onMouseDown, { passive: true });
    window.addEventListener('resize', onResize);
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => resize(false));
      ro.observe(containerEl);
    }

    document.addEventListener('visibilitychange', onVisibilityChange);

    function drawProceduralWallpaper(t) {
      const id = cfg.wallpaper?.builtinId || 'cyberpunk-city';
      if (id !== 'matrix-cyber') {
        wpCtx.clearRect(0, 0, width, height);
      } else if (lastWpId !== 'matrix-cyber') {
        wpCtx.fillStyle = '#020a05';
        wpCtx.fillRect(0, 0, width, height);
      }
      lastWpId = id;

      if (id === 'nebula-cosmos') {
        const grad = wpCtx.createRadialGradient(
          width * (0.5 + 0.12 * Math.sin(t * 0.3)),
          height * (0.45 + 0.1 * Math.cos(t * 0.25)),
          20,
          width * 0.5,
          height * 0.5,
          Math.max(width, height) * 0.75
        );
        grad.addColorStop(0, '#3b0764');
        grad.addColorStop(0.45, '#1e1b4b');
        grad.addColorStop(1, '#04020a');
        wpCtx.fillStyle = grad;
        wpCtx.fillRect(0, 0, width, height);

        // Glowing nebula clouds
        for (let i = 0; i < 3; i++) {
          const cx = width * (0.3 + 0.2 * i + 0.08 * Math.sin(t * 0.4 + i * 2));
          const cy = height * (0.4 + 0.12 * Math.cos(t * 0.35 + i));
          const r = Math.min(width, height) * 0.38;
          const ng = wpCtx.createRadialGradient(cx, cy, 5, cx, cy, r);
          const colors = ['rgba(139, 92, 246, 0.26)', 'rgba(236, 72, 153, 0.22)', 'rgba(56, 189, 248, 0.2)'];
          ng.addColorStop(0, colors[i]);
          ng.addColorStop(1, 'rgba(0,0,0,0)');
          wpCtx.fillStyle = ng;
          wpCtx.fillRect(0, 0, width, height);
        }

        // Twinkling stars
        wpCtx.fillStyle = '#ffffff';
        for (const s of stars) {
          s.x -= s.speed * 0.3;
          if (s.x < 0) s.x = width;
          wpCtx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(t * 1.5 + s.x));
          wpCtx.beginPath();
          wpCtx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          wpCtx.fill();
        }
        wpCtx.globalAlpha = 1;
      } else if (id === 'cyberpunk-city') {
        const sky = wpCtx.createLinearGradient(0, 0, 0, height);
        sky.addColorStop(0, '#070210');
        sky.addColorStop(0.55, '#1e0836');
        sky.addColorStop(1, '#090d1a');
        wpCtx.fillStyle = sky;
        wpCtx.fillRect(0, 0, width, height);

        // Neon sun glow
        const sunY = height * 0.52;
        const sunGrad = wpCtx.createRadialGradient(width * 0.5, sunY, 10, width * 0.5, sunY, height * 0.32);
        sunGrad.addColorStop(0, 'rgba(244, 63, 94, 0.48)');
        sunGrad.addColorStop(0.5, 'rgba(6, 182, 212, 0.22)');
        sunGrad.addColorStop(1, 'rgba(0,0,0,0)');
        wpCtx.fillStyle = sunGrad;
        wpCtx.fillRect(0, 0, width, height);

        // Cyberpunk buildings silhouette
        wpCtx.fillStyle = '#070410';
        const bCount = 18;
        const bWidth = width / bCount;
        for (let i = 0; i < bCount; i++) {
          const bh = height * (0.22 + ((Math.sin(i * 9.2) + 1) * 0.16));
          const bx = i * bWidth;
          const by = height - bh;
          wpCtx.fillRect(bx + 2, by, bWidth - 4, bh);

          // Glowing cyan/pink building windows
          wpCtx.fillStyle = i % 2 === 0 ? 'rgba(6, 182, 212, 0.35)' : 'rgba(244, 63, 94, 0.35)';
          for (let wy = by + 12; wy < height - 15; wy += 18) {
            if (Math.sin(i * 3 + wy + Math.floor(t)) > -0.2) {
              wpCtx.fillRect(bx + 8, wy, bWidth - 16, 4);
            }
          }
          wpCtx.fillStyle = '#070410';
        }

        // Falling neon rain
        wpCtx.strokeStyle = 'rgba(56, 189, 248, 0.32)';
        wpCtx.lineWidth = 1.2;
        wpCtx.beginPath();
        for (const s of stars) {
          s.y = (s.y + s.speed * 18) % height;
          wpCtx.moveTo(s.x, s.y);
          wpCtx.lineTo(s.x - 2, s.y + 16);
        }
        wpCtx.stroke();
      } else if (id === 'aurora-borealis') {
        const bg = wpCtx.createLinearGradient(0, 0, 0, height);
        bg.addColorStop(0, '#020617');
        bg.addColorStop(0.65, '#062c30');
        bg.addColorStop(1, '#021019');
        wpCtx.fillStyle = bg;
        wpCtx.fillRect(0, 0, width, height);

        const bands = [
          { color: 'rgba(16, 185, 129, 0.26)', speed: 0.7, amp: 55, yOff: 0.32 },
          { color: 'rgba(56, 189, 248, 0.22)', speed: -0.5, amp: 70, yOff: 0.42 },
          { color: 'rgba(168, 85, 247, 0.18)', speed: 0.9, amp: 45, yOff: 0.26 }
        ];
        for (const b of bands) {
          wpCtx.fillStyle = b.color;
          wpCtx.beginPath();
          wpCtx.moveTo(0, height);
          for (let x = 0; x <= width; x += 24) {
            const y =
              height * b.yOff +
              Math.sin(x * 0.004 + t * b.speed) * b.amp +
              Math.cos(x * 0.009 - t * 0.4) * (b.amp * 0.5);
            wpCtx.lineTo(x, y);
          }
          wpCtx.lineTo(width, height);
          wpCtx.closePath();
          wpCtx.fill();
        }
      } else if (id === 'sakura-night') {
        const bg = wpCtx.createLinearGradient(0, 0, width, height);
        bg.addColorStop(0, '#12071d');
        bg.addColorStop(0.6, '#2a0f33');
        bg.addColorStop(1, '#43123b');
        wpCtx.fillStyle = bg;
        wpCtx.fillRect(0, 0, width, height);

        const mx = width * 0.76;
        const my = height * 0.26;
        const moonGlow = wpCtx.createRadialGradient(mx, my, 10, mx, my, height * 0.28);
        moonGlow.addColorStop(0, 'rgba(255, 241, 242, 0.92)');
        moonGlow.addColorStop(0.35, 'rgba(251, 113, 133, 0.35)');
        moonGlow.addColorStop(1, 'rgba(0,0,0,0)');
        wpCtx.fillStyle = moonGlow;
        wpCtx.beginPath();
        wpCtx.arc(mx, my, height * 0.28, 0, Math.PI * 2);
        wpCtx.fill();
      } else if (id === 'lofi-sunset-grid') {
        const bg = wpCtx.createLinearGradient(0, 0, 0, height);
        bg.addColorStop(0, '#0f0322');
        bg.addColorStop(0.58, '#581c87');
        bg.addColorStop(0.6, '#090214');
        bg.addColorStop(1, '#090214');
        wpCtx.fillStyle = bg;
        wpCtx.fillRect(0, 0, width, height);

        const horizon = height * 0.58;
        const sunGrad = wpCtx.createLinearGradient(0, horizon - 140, 0, horizon);
        sunGrad.addColorStop(0, '#facc15');
        sunGrad.addColorStop(0.5, '#f97316');
        sunGrad.addColorStop(1, '#ec4899');
        wpCtx.fillStyle = sunGrad;
        wpCtx.beginPath();
        wpCtx.arc(width * 0.5, horizon - 30, 100, 0, Math.PI * 2);
        wpCtx.fill();

        // Perspective synthwave grid
        wpCtx.strokeStyle = 'rgba(236, 72, 153, 0.42)';
        wpCtx.lineWidth = 1.5;
        wpCtx.beginPath();
        for (let i = -10; i <= 10; i++) {
          wpCtx.moveTo(width * 0.5 + i * 25, horizon);
          wpCtx.lineTo(width * 0.5 + i * 190, height);
        }
        const scroll = (t * 45) % 40;
        for (let y = horizon + scroll; y < height; y += 36) {
          wpCtx.moveTo(0, y);
          wpCtx.lineTo(width, y);
        }
        wpCtx.stroke();
      } else if (id === 'matrix-cyber') {
        wpCtx.fillStyle = 'rgba(2, 10, 5, 0.22)';
        wpCtx.fillRect(0, 0, width, height);
        wpCtx.fillStyle = '#22c55e';
        wpCtx.font = '14px monospace';
        const chars = '01AGYSTUDIOｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿ';
        for (let i = 0; i < matrixDrops.length; i++) {
          const ch = chars[Math.floor(Math.random() * chars.length)];
          const x = i * 18;
          const y = matrixDrops[i] * 18;
          wpCtx.fillText(ch, x, y);
          if (y > height && Math.random() > 0.975) {
            matrixDrops[i] = 0;
          }
          matrixDrops[i] += 0.55;
        }
      }
    }

    function drawEffectsOverlay(t) {
      fxCtx.clearRect(0, 0, width, height);
      const pType = cfg.effects?.particles || 'none';
      const speedMult = Number(cfg.effects?.particleSpeed || 1.0);
      const primaryColor = cfg.colors?.primary || '#06b6d4';
      const accentColor = cfg.colors?.accent || '#f43f5e';

      if (pType !== 'none') {
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          if (pType === 'starfield') {
            p.y -= p.vy * 0.45 * speedMult;
            if (p.y < 0) p.y = height;
            fxCtx.fillStyle = '#ffffff';
            fxCtx.globalAlpha = 0.35 + 0.55 * Math.abs(Math.sin(t * 2 + i));
            fxCtx.beginPath();
            fxCtx.arc(p.x, p.y, p.size * 0.45, 0, Math.PI * 2);
            fxCtx.fill();
          } else if (pType === 'sakura') {
            p.x += (Math.sin(t + i) * 0.6 + 0.5) * speedMult;
            p.y += p.vy * 0.75 * speedMult;
            p.angle += p.spin;
            if (p.y > height + 10) {
              p.y = -10;
              p.x = Math.random() * width;
            }
            if (p.x > width + 10) p.x = -10;
            else if (p.x < -10) p.x = width + 10;
            fxCtx.save();
            fxCtx.translate(p.x, p.y);
            fxCtx.rotate(p.angle);
            fxCtx.fillStyle = 'rgba(251, 113, 133, 0.75)';
            fxCtx.beginPath();
            fxCtx.ellipse(0, 0, p.size * 1.3, p.size * 0.7, 0, 0, Math.PI * 2);
            fxCtx.fill();
            fxCtx.restore();
          } else if (pType === 'snowfall') {
            p.x += Math.sin(t * 0.8 + i) * 0.4 * speedMult;
            p.y += p.vy * 0.8 * speedMult;
            if (p.y > height + 8) {
              p.y = -8;
              p.x = Math.random() * width;
            }
            if (p.x > width + 8) p.x = -8;
            else if (p.x < -8) p.x = width + 8;
            fxCtx.fillStyle = 'rgba(241, 245, 249, 0.75)';
            fxCtx.beginPath();
            fxCtx.arc(p.x, p.y, p.size * 0.6, 0, Math.PI * 2);
            fxCtx.fill();
          } else if (pType === 'fireflies') {
            p.x += Math.cos(t * 0.9 + i) * 0.65 * speedMult;
            p.y += Math.sin(t * 0.7 + i * 1.3) * 0.65 * speedMult;
            const glow = 0.25 + 0.75 * Math.abs(Math.sin(t * 1.8 + i));
            fxCtx.fillStyle = i % 2 === 0 ? primaryColor : accentColor;
            fxCtx.globalAlpha = glow * 0.8;
            fxCtx.beginPath();
            fxCtx.arc(p.x, p.y, p.size * 0.7, 0, Math.PI * 2);
            fxCtx.fill();
          } else if (pType === 'constellation') {
            p.x += p.vx * speedMult;
            p.y += (p.vy - 0.9) * speedMult;
            if (p.x < 0 || p.x > width) p.vx *= -1;
            if (p.y < 0 || p.y > height) p.vy = 0.9 - (p.vy - 0.9);
            fxCtx.fillStyle = primaryColor;
            fxCtx.globalAlpha = 0.65;
            fxCtx.beginPath();
            fxCtx.arc(p.x, p.y, 2, 0, Math.PI * 2);
            fxCtx.fill();

            for (let j = i + 1; j < particles.length; j++) {
              const p2 = particles[j];
              const dx = p.x - p2.x;
              const dy = p.y - p2.y;
              const distSq = dx * dx + dy * dy;
              if (distSq < 12100) {
                const dist = Math.sqrt(distSq);
                fxCtx.strokeStyle = primaryColor;
                fxCtx.globalAlpha = (1 - dist / 110) * 0.25;
                fxCtx.beginPath();
                fxCtx.moveTo(p.x, p.y);
                fxCtx.lineTo(p2.x, p2.y);
                fxCtx.stroke();
              }
            }
          } else if (pType === 'matrix') {
            p.y = (p.y + p.vy * 3.2 * speedMult) % height;
            fxCtx.fillStyle = '#22c55e';
            fxCtx.globalAlpha = 0.55;
            fxCtx.font = '12px monospace';
            fxCtx.fillText((i % 2 === 0 ? '1' : '0'), p.x, p.y);
          }
        }
        fxCtx.globalAlpha = 1;
        fxDirty = true;
      }

      // Cursor Effects
      const cEffect = cfg.effects?.cursorEffect || 'none';
      if (cEffect === 'neon-trail' && cursorTrail.length > 1) {
        for (let i = 0; i < cursorTrail.length; i++) {
          const pt = cursorTrail[i];
          pt.life -= 0.045;
          if (pt.life <= 0) continue;
          fxCtx.fillStyle = primaryColor;
          fxCtx.globalAlpha = pt.life * 0.55;
          fxCtx.beginPath();
          fxCtx.arc(pt.x, pt.y, pt.life * 6, 0, Math.PI * 2);
          fxCtx.fill();
        }
        cursorTrail = cursorTrail.filter((pt) => pt.life > 0);
        fxCtx.globalAlpha = 1;
        fxDirty = true;
      } else if (cEffect === 'spotlight' && mousePos.x > 0) {
        const sg = fxCtx.createRadialGradient(mousePos.x, mousePos.y, 5, mousePos.x, mousePos.y, 180);
        sg.addColorStop(0, `rgba(${cachedPrimaryRgb}, 0.16)`);
        sg.addColorStop(1, 'rgba(0,0,0,0)');
        fxCtx.fillStyle = sg;
        fxCtx.fillRect(0, 0, width, height);
        fxDirty = true;
      } else if (cEffect === 'click-ripple' && ripples.length > 0) {
        for (const rp of ripples) {
          rp.r += 3.2;
          rp.alpha -= 0.03;
          if (rp.alpha <= 0) continue;
          fxCtx.strokeStyle = primaryColor;
          fxCtx.lineWidth = 2;
          fxCtx.globalAlpha = rp.alpha;
          fxCtx.beginPath();
          fxCtx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
          fxCtx.stroke();
        }
        ripples = ripples.filter((rp) => rp.alpha > 0);
        fxCtx.globalAlpha = 1;
        fxDirty = true;
      }
    }

    let startTime = performance.now();
    function tick(now) {
      rafId = null;
      if (!shouldAnimate()) {
        if (fxDirty && !isDestroyed) {
          fxCtx.clearRect(0, 0, width, height);
          fxDirty = false;
        }
        return;
      }

      const t = (now - startTime) * 0.001 * Number(cfg.wallpaper?.playbackRate || 1.0);
      if (cfg.wallpaper?.enabled && cfg.wallpaper?.sourceType === 'canvas') {
        drawProceduralWallpaper(t);
      }
      drawEffectsOverlay(t);
      rafId = requestAnimationFrame(tick);
    }

    async function syncConfig(newCfg) {
      cfg = newCfg;
      cachedPrimaryRgb = hexToRgb(cfg.colors?.primary, '6, 182, 212');
      rootWrap.style.display = cfg.enabled ? 'block' : 'none';
      scanlinesEl.style.display = cfg.enabled && cfg.effects?.crtScanlines ? 'block' : 'none';

      if (!cfg.enabled) {
        wpVideo.pause();
        return;
      }

      initSceneObjects(false);

      // Wallpaper visibility & filter styling
      const wp = cfg.wallpaper || {};
      wpLayer.style.display = wp.enabled && wp.sourceType !== 'none' ? 'block' : 'none';
      wpDim.style.background = `rgba(0, 0, 0, ${Number(wp.dimming ?? 0.45)})`;
      const filterCss = `blur(${Number(wp.blur || 0)}px) saturate(${Number(wp.saturation || 100)}%)`;
      wpCanvas.style.filter = filterCss;
      wpImg.style.filter = filterCss;
      wpVideo.style.filter = filterCss;

      if (!wp.enabled || wp.sourceType === 'none') {
        wpCanvas.style.display = 'none';
        wpImg.style.display = 'none';
        wpVideo.style.display = 'none';
        wpVideo.pause();
      } else if (wp.sourceType === 'canvas') {
        if (wp.builtinId !== 'matrix-cyber') lastWpId = '';
        wpCanvas.style.display = 'block';
        wpImg.style.display = 'none';
        wpVideo.style.display = 'none';
        wpVideo.pause();
      } else if (wp.sourceType === 'svg' || wp.sourceType === 'custom-file') {
        wpCanvas.style.display = 'none';
        const ref = wp.sourceType === 'svg' ? `wallpapers/${wp.builtinId}` : wp.customFilePath;
        const mediaKey = `${wp.sourceType}:${ref}`;
        if (mediaKey !== lastMediaKey) {
          lastMediaKey = mediaKey;
          const blobUrl = await resolveMediaToBlobUrl(ref);
          if (isDestroyed || lastMediaKey !== mediaKey || !cfg.enabled) return;
          if (blobUrl) {
            const isVideo = /\.(mp4|webm)(\?|$)/i.test(ref) || (wp.customFileMime || '').startsWith('video/');
            if (isVideo) {
              wpImg.style.display = 'none';
              wpVideo.style.display = 'block';
              wpVideo.src = blobUrl;
              wpVideo.playbackRate = Number(wp.playbackRate || 1.0);
              wpVideo.play().catch(() => {});
            } else {
              wpVideo.pause();
              wpVideo.style.display = 'none';
              wpImg.style.display = 'block';
              wpImg.src = blobUrl;
            }
          }
        } else {
          const isVideo = /\.(mp4|webm)(\?|$)/i.test(ref) || (wp.customFileMime || '').startsWith('video/');
          wpImg.style.display = isVideo ? 'none' : 'block';
          wpVideo.style.display = isVideo ? 'block' : 'none';
          if (isVideo) {
            wpVideo.playbackRate = Number(wp.playbackRate || 1.0);
            if (!isWindowHidden || !cfg.effects?.smartEcoMode) {
              wpVideo.play().catch(() => {});
            }
          }
        }
      } else {
        wpCanvas.style.display = 'none';
        wpImg.style.display = 'none';
        wpVideo.style.display = 'none';
        wpVideo.pause();
      }

      ensureLoopRunning();
    }

    resize(true);
    ensureLoopRunning();

    return {
      syncConfig,
      syncBrowserHoleMask,
      resize: () => {
        resize(false);
        syncBrowserHoleMask();
      },
      destroy: () => {
        isDestroyed = true;
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        if (ro) ro.disconnect();
        eventTarget.removeEventListener('mousemove', onMouseMove);
        eventTarget.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('resize', onResize);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        wpVideo.pause();
        wpVideo.removeAttribute('src');
        rootWrap.remove();
      }
    };
  }

  // =========================================================================
  // 3. BACKGROUND MUSIC PLAYER CONTROLLER
  // =========================================================================
  function createMusicController(onStateChange) {
    const audio = new Audio();
    audio.loop = true;
    let currentTrackRef = '';
    let isPlaying = false;

    audio.addEventListener('play', () => {
      isPlaying = true;
      if (onStateChange) onStateChange(getState());
    });
    audio.addEventListener('pause', () => {
      isPlaying = false;
      if (onStateChange) onStateChange(getState());
    });
    audio.addEventListener('ended', () => {
      if (!audio.loop) nextTrack();
    });

    function getAllTracks(cfg = currentConfig) {
      const starter = (PRESETS_DATA.STARTER_MUSIC || []).map((t) => ({
        id: t.id,
        name: t.name,
        artist: t.artist,
        ref: `music/${t.id}`
      }));
      const custom = (cfg.music?.customTracks || []).map((t) => ({
        id: t.id || t.filePath,
        name: t.name || 'Custom Track',
        artist: 'Nhạc từ máy tính',
        ref: t.filePath
      }));
      return [...starter, ...custom];
    }

    function getActiveTrackInfo(cfg = currentConfig) {
      const tracks = getAllTracks(cfg);
      return tracks.find((t) => t.id === cfg.music?.activeTrackId) || tracks[0] || null;
    }

    async function loadAndSync(cfg = currentConfig, forcePlay = false) {
      currentConfig = cfg;
      const m = cfg.music || {};
      audio.volume = Math.max(0, Math.min(1, Number(m.volume ?? 0.45)));
      audio.loop = Boolean(m.loop ?? true);

      if (!cfg.enabled || !m.enabled) {
        audio.pause();
        if (onStateChange) onStateChange(getState());
        return;
      }

      const active = getActiveTrackInfo(cfg);
      if (!active) return;

      if (currentTrackRef !== active.ref || !audio.src) {
        const expectedRef = active.ref;
        currentTrackRef = expectedRef;
        const blobUrl = await resolveMediaToBlobUrl(expectedRef);
        if (currentTrackRef !== expectedRef) return;
        if (blobUrl) {
          audio.src = blobUrl;
        }
      }

      if (forcePlay || m.autoplay || isPlaying) {
        try {
          await audio.play();
        } catch (_) {
          // Unlock on next user interaction if blocked by browser autoplay policy
          const resumeOnce = () => {
            if (currentConfig.enabled && currentConfig.music?.enabled) {
              audio.play().catch(() => {});
            }
            window.removeEventListener('pointerdown', resumeOnce);
            window.removeEventListener('keydown', resumeOnce);
          };
          window.addEventListener('pointerdown', resumeOnce, { once: true });
          window.addEventListener('keydown', resumeOnce, { once: true });
        }
      }
      if (onStateChange) onStateChange(getState());
    }

    async function togglePlay() {
      if (!currentConfig.music.enabled) {
        currentConfig.music.enabled = true;
        await loadAndSync(currentConfig, true);
        return;
      }
      if (audio.paused) {
        await loadAndSync(currentConfig, true);
      } else {
        audio.pause();
      }
    }

    async function nextTrack(dir = 1) {
      const tracks = getAllTracks(currentConfig);
      if (tracks.length === 0) return;
      const idx = tracks.findIndex((t) => t.id === currentConfig.music?.activeTrackId);
      const nextIdx = (idx + dir + tracks.length) % tracks.length;
      currentConfig.music.activeTrackId = tracks[nextIdx].id;
      currentConfig.music.enabled = true;
      await loadAndSync(currentConfig, true);
    }

    function getState() {
      const track = getActiveTrackInfo(currentConfig);
      return {
        isPlaying: !audio.paused && isPlaying,
        trackName: track ? track.name : 'Chưa chọn nhạc',
        trackArtist: track ? track.artist : '',
        volume: audio.volume,
        tracks: getAllTracks(currentConfig),
        activeTrackId: currentConfig.music?.activeTrackId
      };
    }

    return {
      loadAndSync,
      togglePlay,
      nextTrack: () => nextTrack(1),
      prevTrack: () => nextTrack(-1),
      setVolume: (v) => {
        currentConfig.music.volume = v;
        audio.volume = Math.max(0, Math.min(1, Number(v)));
        if (onStateChange) onStateChange(getState());
      },
      getState
    };
  }

  function normalizeChatWidthMode(mode) {
    const raw = String(mode || 'wide').toLowerCase();
    if (raw === 'auto' || raw === 'native') return 'auto';
    if (raw === 'narrow') return 'narrow';
    if (raw === 'default' || raw === 'standard') return 'default';
    if (raw === 'wide') return 'wide';
    if (raw === 'fill' || raw === 'full') return 'fill';
    if (raw === 'custom') return 'custom';
    return 'default';
  }

  function resolveChatWidthSpec(layout = {}) {
    const mode = normalizeChatWidthMode(layout.chatWidth);
    const customPx = Math.round(clampNum(Number(layout.chatCustomWidth || 920), 480, 1800));
    const map = {
      auto: { mode: 'auto', cssMaxWidth: null, previewWidth: '76%', label: 'Theo AGY gốc' },
      narrow: { mode: 'narrow', cssMaxWidth: '640px', previewWidth: '62%', label: 'Narrow (640px)' },
      default: { mode: 'default', cssMaxWidth: '780px', previewWidth: '76%', label: 'Default (780px)' },
      wide: { mode: 'wide', cssMaxWidth: '1180px', previewWidth: '92%', label: 'Wide (1180px)' },
      fill: { mode: 'fill', cssMaxWidth: '98%', previewWidth: '100%', label: 'Fill (98%)' },
      custom: {
        mode: 'custom',
        cssMaxWidth: `${customPx}px`,
        previewWidth: `${Math.round(clampNum((customPx / 1600) * 100, 48, 100))}%`,
        label: `Tùy chỉnh (${customPx}px)`
      }
    };
    return { ...(map[mode] || map.default), customPx };
  }

  function normalizePromptWidthMode(mode) {
    const raw = String(mode || 'match-chat').toLowerCase();
    if (raw === 'match-chat' || raw === 'auto') return 'match-chat';
    if (raw === 'narrow') return 'narrow';
    if (raw === 'compact') return 'compact';
    if (raw === 'medium' || raw === 'default') return 'medium';
    if (raw === 'custom') return 'custom';
    return 'match-chat';
  }

  function resolvePromptWidthSpec(layout = {}) {
    const mode = normalizePromptWidthMode(layout.promptWidth);
    const customPx = Math.round(clampNum(Number(layout.promptCustomWidth || 720), 460, 1400));
    const map = {
      'match-chat': { mode: 'match-chat', cssMaxWidth: null, previewWidth: null, label: 'Theo khung Chat' },
      narrow: { mode: 'narrow', cssMaxWidth: '640px', previewWidth: '56%', label: 'Nhỏ gọn (640px)' },
      compact: { mode: 'compact', cssMaxWidth: '760px', previewWidth: '68%', label: 'Cân đối (760px)' },
      medium: { mode: 'medium', cssMaxWidth: '880px', previewWidth: '78%', label: 'Vừa (880px)' },
      custom: {
        mode: 'custom',
        cssMaxWidth: `${customPx}px`,
        previewWidth: `${Math.round(clampNum((customPx / 1600) * 100, 42, 96))}%`,
        label: `Tùy chỉnh (${customPx}px)`
      }
    };
    return { ...(map[mode] || map['match-chat']), customPx };
  }

  // Export engine constructors & shared utilities if running inside Standalone Studio Preview
  window.__AGY_RUNTIME_FACTORY__ = {
    createVisualEngine,
    createMusicController,
    playKeySound,
    playSendChime,
    resolveMediaToBlobUrl,
    extractPaletteFromPixels,
    extractPaletteFromWallpaperConfig,
    syncConfigColorsFromWallpaper,
    normalizeChatWidthMode,
    resolveChatWidthSpec,
    normalizePromptWidthMode,
    resolvePromptWidthSpec,
    getContrastTextColor,
    hexToRgb,
    deepMerge,
    escapeHtml
  };

  if (isStandaloneStudio) {
    // In standalone studio, the studio app.js mounts the preview container explicitly
    return;
  }

  // =========================================================================
  // 4. ANTIGRAVITY APP FRONTEND CSS & LAYOUT INJECTION
  // =========================================================================
  const styleEl = document.createElement('style');
  styleEl.id = 'agy-custom-ui-dynamic-styles';
  document.head.appendChild(styleEl);

  function buildDynamicStylesheet(cfg) {
    if (!cfg || !cfg.enabled) {
      return `
        .agy-custom-layers-root, .agy-mini-music-widget { display: none !important; }
        .agy-floating-studio-btn { opacity: 0.45; }
      `;
    }

    const c = cfg.colors || {};
    const g = cfg.glass || {};
    const l = cfg.layout || {};
    const fx = cfg.effects || {};
    const typo = cfg.typography || {};
    const wp = cfg.wallpaper || {};

    const bgRgb = hexToRgb(c.background, '11, 6, 22');
    const fgRgb = hexToRgb(c.foreground, '248, 250, 252');
    const cardRgb = hexToRgb(c.card, '21, 12, 40');
    const sidebarRgb = hexToRgb(c.sidebar, '14, 7, 28');
    const primaryRgb = hexToRgb(c.primary, '6, 182, 212');
    const accentRgb = hexToRgb(c.accent, '244, 63, 94');
    const borderRgb = hexToRgb(c.border, '59, 29, 110');
    const userBubbleRgb = hexToRgb(c.userBubble || c.card, cardRgb);
    const aiBubbleRgb = hexToRgb(c.aiBubble || c.card, cardRgb);
    const primaryFg = getContrastTextColor(c.primary || '#06b6d4');

    const opacity = Number(g.panelOpacity ?? 0.72);
    const blur = Number(g.backdropBlur ?? 16);
    const radius = Number(g.borderRadius ?? 14);
    const fontScalePct = clampNum(Number(typo.fontScale || 100), 80, 140);
    const wpActive = Boolean(wp.enabled && wp.sourceType && wp.sourceType !== 'none');

    // When a wallpaper is active, keep the main content pane crystal-clear (only a light tint)
    // because .agy-wp-layer already applies wallpaper.dimming & wallpaper.blur!
    const mainBgAlpha = wpActive ? 0.15 : opacity;
    const mainBlurCss = wpActive ? 'none' : `blur(${blur}px)`;

    // Chat container width (null when 'auto' -> lets Antigravity's native Settings control width)
    const chatWidthSpec = resolveChatWidthSpec(l);
    const chatMaxWidth = chatWidthSpec.cssMaxWidth;
    const isDockedPrompt = l.promptStyle === 'docked';
    const promptWidthSpec = resolvePromptWidthSpec(l);
    const independentPromptMaxWidth = !isDockedPrompt ? promptWidthSpec.cssMaxWidth : null;
    const excludeComposerFromChatWidth = isDockedPrompt || Boolean(independentPromptMaxWidth);
    const dockedExclude = excludeComposerFromChatWidth
      ? ':not([data-agy-composer-wrap="true"]):not(:has(> .surface-composer)):not(:has(> #antigravity\\.agentSidePanelInputBox))'
      : '';

    return `
      /* Keep :root --background as a valid 6-digit hex for preload Hub surface color sync */
      :root, html {
        --background: ${c.background || '#0b0616'} !important;
        --foreground: ${c.foreground || '#f8fafc'} !important;
        --primary: ${c.primary || '#06b6d4'} !important;
        --primary-foreground: ${primaryFg} !important;
        --accent: ${c.accent || '#f43f5e'} !important;
        --radius: ${radius}px !important;
        --font-sans: ${typo.uiFont || "'Inter', system-ui, sans-serif"} !important;
        --default-font-family: ${typo.uiFont || "'Inter', system-ui, sans-serif"} !important;
        --vscode-font-family: ${typo.uiFont || "'Inter', system-ui, sans-serif"} !important;
        --font-mono: ${typo.codeFont || "'JetBrains Mono', Consolas, monospace"} !important;
        --default-mono-font-family: ${typo.codeFont || "'JetBrains Mono', Consolas, monospace"} !important;
        --editor-font-family: ${typo.codeFont || "'JetBrains Mono', Consolas, monospace"} !important;
        --vscode-editor-font-family: ${typo.codeFont || "'JetBrains Mono', Consolas, monospace"} !important;
        --app-font-scale: ${fontScalePct / 100} !important;
      }
      ${
        fontScalePct !== 100
          ? `html { font-size: ${((16 * fontScalePct) / 100).toFixed(2)}px !important; }`
          : ''
      }

      /* Override all Antigravity 2.0 / Onyx / Tailwind v4 tokens on body & subtrees */
      body, #root, .dark, .theme-standalone,
      body[data-agy-theme],
      body[data-agy-theme][data-newux-theme],
      body[data-agy-theme][data-newux-theme="onyx"],
      body[data-agy-theme][data-newux-theme="onyx"].dark,
      [data-theme="dark"], [data-theme="light"],
      [style*="--color-sidebar"], [style*="--sidebar"] {
        --background: rgba(${bgRgb}, ${mainBgAlpha}) !important;
        --color-background: rgba(${bgRgb}, ${mainBgAlpha}) !important;
        --body-background: transparent !important;
        --content: rgba(${bgRgb}, ${mainBgAlpha}) !important;
        --foreground: ${c.foreground || '#f8fafc'} !important;
        --color-foreground: ${c.foreground || '#f8fafc'} !important;
        --primary: ${c.primary || '#06b6d4'} !important;
        --color-primary: ${c.primary || '#06b6d4'} !important;
        --primary-foreground: ${primaryFg} !important;
        --color-primary-foreground: ${primaryFg} !important;
        --accent: ${c.accent || '#f43f5e'} !important;
        --shell: transparent !important;
        --shell-canvas: transparent !important;
        --sidebar: rgba(${sidebarRgb}, ${opacity}) !important;
        --color-sidebar: rgba(${sidebarRgb}, ${opacity}) !important;
        --sidebar-background: rgba(${sidebarRgb}, ${opacity}) !important;
        --sidebar-secondary: rgba(${primaryRgb}, 0.22) !important;
        --color-sidebar-secondary: rgba(${primaryRgb}, 0.22) !important;
        --sidebar-muted: rgba(${primaryRgb}, 0.14) !important;
        --color-sidebar-muted: rgba(${primaryRgb}, 0.14) !important;
        --card: rgba(${cardRgb}, ${opacity}) !important;
        --color-card: rgba(${cardRgb}, ${opacity}) !important;
        --card-foreground: ${c.foreground || '#f8fafc'} !important;
        --card-border: rgba(${borderRgb}, 0.58) !important;
        --color-card-border: rgba(${borderRgb}, 0.58) !important;
        --border: rgba(${borderRgb}, 0.52) !important;
        --color-border: rgba(${borderRgb}, 0.52) !important;
        --secondary: rgba(${primaryRgb}, 0.18) !important;
        --color-secondary: rgba(${primaryRgb}, 0.18) !important;
        --secondary-foreground: rgba(${fgRgb}, 0.9) !important;
        --color-secondary-foreground: rgba(${fgRgb}, 0.9) !important;
        --muted: rgba(${cardRgb}, ${Math.min(0.78, opacity * 0.85)}) !important;
        --color-muted: rgba(${cardRgb}, ${Math.min(0.78, opacity * 0.85)}) !important;
        --muted-foreground: rgba(${fgRgb}, 0.7) !important;
        --color-muted-foreground: rgba(${fgRgb}, 0.7) !important;
        --placeholder: rgba(${fgRgb}, 0.48) !important;
        --color-placeholder: rgba(${fgRgb}, 0.48) !important;
        --popover: rgba(${cardRgb}, 0.95) !important;
        --popover-foreground: ${c.foreground || '#f8fafc'} !important;
        --glass: rgba(${cardRgb}, ${Math.min(0.9, opacity + 0.08)}) !important;
        --glass-border: rgba(${borderRgb}, 0.62) !important;
        --glass-highlight: rgba(${primaryRgb}, 0.2) !important;
        --onyx-frame: rgba(${sidebarRgb}, ${Math.min(0.9, opacity + 0.08)}) !important;
        --onyx-well: rgba(${sidebarRgb}, ${Math.min(0.8, opacity)}) !important;
        --onyx-raised: rgba(${cardRgb}, ${Math.min(0.92, opacity + 0.12)}) !important;
        --onyx-selected: rgba(${primaryRgb}, 0.25) !important;
        --onyx-key: rgba(${primaryRgb}, 0.24) !important;
        --home-glow: rgba(${primaryRgb}, 0.22) !important;
        --card-edge: rgba(${borderRgb}, 0.55) !important;
        --nux-focus-ring: ${c.primary || '#06b6d4'} !important;
        font-family: ${typo.uiFont || "'Inter', system-ui, sans-serif"} !important;
      }

      /* 1. Transparent Outer Shells so Background Wallpaper is 100% Visible */
      html, body, #root, #app, .theme-standalone,
      .agy-shell, body[data-agy-theme] .agy-shell,
      .agy-inset-shell, body[data-agy-theme] .agy-inset-shell,
      .agy-sheet, body[data-agy-theme] .agy-sheet,
      .agy-home {
        background-color: transparent !important;
        color: ${c.foreground || '#f8fafc'} !important;
      }
      #root, #app {
        position: relative !important;
        z-index: 1 !important;
      }

      code, pre, kbd, .font-mono, .code-block {
        font-family: ${typo.codeFont || "'JetBrains Mono', Consolas, monospace"} !important;
      }

      /* 2. Background Wallpaper & Particle / Cursor Canvas Layers */
      .agy-custom-layers-root {
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        z-index: auto !important;
        pointer-events: none !important;
        overflow: hidden !important;
        background: transparent !important;
      }
      .agy-wp-layer {
        z-index: 0 !important;
        background: ${c.background || '#0b0616'} !important;
      }
      .agy-wp-layer, .agy-wp-canvas, .agy-wp-img, .agy-wp-video, .agy-wp-dim {
        position: absolute !important;
        inset: 0 !important;
        width: 100% !important;
        height: 100% !important;
        object-fit: cover !important;
        pointer-events: none !important;
      }
      /* Float Particle FX & Cursor Effects above UI panels without blocking clicks */
      body > .agy-custom-layers-root > .agy-fx-canvas {
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        z-index: 999980 !important;
        pointer-events: none !important;
      }
      body > .agy-custom-layers-root > .agy-scanlines-overlay {
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        background: repeating-linear-gradient(
          to bottom,
          transparent 0px,
          transparent 2px,
          rgba(0, 0, 0, 0.22) 3px
        ) !important;
        z-index: 999981 !important;
        pointer-events: none !important;
      }

      /* 3. Top Menu Bar & Header Bar ("Thanh trên cùng")
         Avoid backdrop-filter on header bars so they never create a fixed containing-block
         or stacking-context trap for header dropdown menus (e.g. 3-dot More menu, Title menus). */
      [data-testid="title-menu-bar"],
      .agy-shell > .shrink-0:first-of-type {
        background: rgba(${sidebarRgb}, ${Math.min(0.94, opacity + 0.1)}) !important;
        border-bottom: 1px solid rgba(${borderRgb}, 0.42) !important;
        color: ${c.foreground || '#f8fafc'} !important;
      }
      [data-testid="title-menu-bar"] button {
        color: rgba(${fgRgb}, 0.85) !important;
        border-radius: 6px !important;
        transition: background-color 0.15s ease, color 0.15s ease !important;
      }
      [data-testid="title-menu-bar"] button:hover {
        background: rgba(${primaryRgb}, 0.14) !important;
        color: ${c.foreground || '#f8fafc'} !important;
      }
      [data-testid="right-cluster-fade"] {
        display: none !important;
      }
      div:has(> [data-testid="right-cluster-fade"]) {
        background: transparent !important;
      }
      [data-testid^="open-editor-"] {
        background: rgba(${primaryRgb}, 0.14) !important;
        border: 1px solid rgba(${primaryRgb}, 0.36) !important;
        color: ${c.foreground || '#f8fafc'} !important;
        border-radius: 999px !important;
        box-shadow: none !important;
      }
      [data-testid^="open-editor-"]:hover {
        background: rgba(${primaryRgb}, 0.24) !important;
        border-color: rgba(${primaryRgb}, 0.55) !important;
      }
      .agy-floating-studio-btn {
        background: rgba(${cardRgb}, 0.86) !important;
        border-color: rgba(${borderRgb}, 0.55) !important;
        color: ${c.foreground || '#f8fafc'} !important;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.28) !important;
      }
      .agy-floating-studio-btn:hover {
        background: rgba(${primaryRgb}, 0.18) !important;
        border-color: rgba(${primaryRgb}, 0.45) !important;
      }
      .agy-mini-music-widget {
        background: rgba(${cardRgb}, 0.88) !important;
        border-color: rgba(${borderRgb}, 0.52) !important;
        color: ${c.foreground || '#f8fafc'} !important;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45) !important;
      }
      .agy-mini-music-widget button:hover {
        background: rgba(${primaryRgb}, 0.25) !important;
      }
      [data-main-content-header],
      [data-testid="pane-titlebar-toolbar"] {
        background: rgba(${sidebarRgb}, ${Math.min(0.68, opacity * 0.78)}) !important;
        border-bottom: 1px solid rgba(${borderRgb}, 0.35) !important;
      }

      /* 4. Sidebar & Project Frames ("Các khung Project & Sidebar") */
      [role="navigation"][aria-label="Sidebar"],
      [data-sidebar="sidebar"],
      [data-testid="sidebar"],
      aside:not([data-main-content-body] *):not([role="dialog"] *):not(.agy-inapp-drawer *),
      [data-testid="sidebar-split"] > div:first-child [role="navigation"] {
        background: rgba(${sidebarRgb}, ${opacity}) !important;
        backdrop-filter: blur(${blur}px) saturate(135%) !important;
        -webkit-backdrop-filter: blur(${blur}px) saturate(135%) !important;
        border-right: 1px solid rgba(${borderRgb}, 0.42) !important;
      }
      /* Remove solid dark rectangles on virtualized list row wrappers in Sidebar */
      [data-testid="conversation-list-sidebar"] [data-index],
      [data-sidebar-scroll-container] [data-index],
      [data-sidebar-section-drop-id] {
        background-color: transparent !important;
      }
      /* Section Headers ("Projects", "Pinned Conversations", "Coordinators") */
      [data-testid="section-header"],
      .group\\/section-header {
        background: transparent !important;
        border-radius: 6px !important;
        color: rgba(${fgRgb}, 0.62) !important;
      }
      [data-testid="section-header"] h2,
      .group\\/section-header h2 {
        color: rgba(${fgRgb}, 0.62) !important;
        font-weight: 600 !important;
        letter-spacing: 0.4px !important;
      }
      /* Individual Project Folder Cards (Custom AGY, EcomReview AI, TodoLite, etc.) */
      button[data-project-card],
      [data-testid="project-header"] {
        background: rgba(${cardRgb}, ${Math.min(0.65, opacity * 0.75)}) !important;
        border: 1px solid rgba(${borderRgb}, 0.35) !important;
        border-radius: ${Math.max(8, radius - 4)}px !important;
        color: rgba(${fgRgb}, 0.88) !important;
        margin-block: 1px !important;
        transition: all 0.16s ease !important;
      }
      button[data-project-card][aria-expanded="true"],
      [data-testid="project-header"][aria-expanded="true"] {
        background: rgba(${cardRgb}, ${Math.min(0.84, opacity * 0.9)}) !important;
        border-color: rgba(${primaryRgb}, 0.35) !important;
        color: ${c.foreground || '#f8fafc'} !important;
        box-shadow: inset 2.5px 0 0 ${c.primary || '#60a5fa'} !important;
      }
      button[data-project-card]:hover,
      [data-testid="project-header"]:hover {
        background: rgba(${primaryRgb}, 0.14) !important;
        border-color: rgba(${primaryRgb}, 0.4) !important;
        color: #ffffff !important;
      }
      /* "+ New Conversation" Button in Sidebar */
      [data-testid="new-conversation-button"] {
        background: rgba(${primaryRgb}, 0.14) !important;
        border: 1px solid rgba(${primaryRgb}, 0.36) !important;
        color: ${c.foreground || '#f8fafc'} !important;
        box-shadow: none !important;
      }
      [data-testid="new-conversation-button"]:hover {
        background: rgba(${primaryRgb}, 0.22) !important;
        border-color: rgba(${primaryRgb}, 0.52) !important;
      }
      /* Top Sidebar Navigation Items (Automations, Customizations, etc.) */
      [data-testid="sidebar-navigation-items"] > *:not([data-testid="new-conversation-button"]) {
        border: 1px solid transparent !important;
        transition: all 0.16s ease !important;
      }
      [data-testid="sidebar-navigation-items"] > *[aria-current="page"],
      [data-testid="sidebar-navigation-items"] > *.bg-sidebar-secondary {
        background: rgba(${primaryRgb}, 0.14) !important;
        border-color: rgba(${primaryRgb}, 0.32) !important;
        color: ${c.foreground || '#f8fafc'} !important;
      }
      /* Conversation Rows inside Projects */
      .agy-sidebar-row,
      [data-testid="conversation-row-sidebar"] {
        background: transparent !important;
        border: 1px solid transparent !important;
        border-radius: ${Math.max(6, radius - 5)}px !important;
        transition: all 0.15s ease !important;
      }
      .agy-sidebar-row:hover,
      [data-testid="conversation-row-sidebar"]:hover {
        background: rgba(${primaryRgb}, 0.1) !important;
        border-color: rgba(${primaryRgb}, 0.22) !important;
      }
      .agy-sidebar-row[data-selected="true"],
      body[data-agy-theme][data-newux-theme="onyx"].dark .agy-sidebar-row[data-selected="true"],
      body[data-agy-theme][data-newux-theme="onyx"] .agy-sidebar-row[data-selected="true"] {
        background: rgba(${primaryRgb}, 0.15) !important;
        border: 1px solid rgba(${primaryRgb}, 0.32) !important;
        box-shadow: inset 2.5px 0 0 ${c.primary || '#60a5fa'} !important;
        color: #ffffff !important;
      }
      .agy-row-actions,
      .agy-row-actions::before {
        background: none !important;
      }

      /* 5. Main Chat Frame & Prompt Input Composer ("Khung Chat") */
      .agy-sheet[data-sheet-inset] [data-main-content-body],
      .agy-inset-shell [data-side-panel-body] {
        background-color: rgba(${bgRgb}, ${mainBgAlpha}) !important;
        backdrop-filter: ${mainBlurCss} !important;
        -webkit-backdrop-filter: ${mainBlurCss} !important;
        border: 1px solid rgba(${borderRgb}, 0.42) !important;
        border-radius: ${radius}px !important;
        box-shadow: ${
          g.borderGlow
            ? `0 0 22px rgba(${primaryRgb}, ${Number(g.glowIntensity || 0.3) * 0.16}), `
            : ''
        }inset 0 1px 0 rgba(255, 255, 255, 0.05) !important;
      }
      [data-split-panes] .agy-sheet[data-sheet-inset] [data-tiling-pane] {
        background-image: linear-gradient(
          transparent var(--split-card-top),
          rgba(${bgRgb}, ${mainBgAlpha}) var(--split-card-top)
        ) !important;
      }

      /* Prompt Composer Island (Outer Frame: Custom AGY / Local Checkout + Inner Card: Ask anything) */
      .surface-composer,
      body[data-agy-theme] .surface-composer,
      body[data-agy-theme][data-newux-theme="onyx"] .surface-composer,
      body[data-agy-theme][data-newux-theme="onyx"].dark .surface-composer,
      #antigravity\\.agentSidePanelInputBox {
        background: rgba(${sidebarRgb}, ${Math.min(0.92, opacity + 0.08)}) !important;
        backdrop-filter: blur(${blur}px) saturate(140%) !important;
        -webkit-backdrop-filter: blur(${blur}px) saturate(140%) !important;
        border: 1px solid rgba(${borderRgb}, 0.48) !important;
        border-radius: ${radius + 2}px !important;
        box-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.55) !important;
        transition: all 0.2s ease !important;
      }
      .surface-composer > .surface-composer-card,
      body[data-agy-theme] .surface-composer > .surface-composer-card,
      body[data-agy-theme][data-newux-theme="onyx"] .surface-composer > .surface-composer-card,
      body[data-agy-theme][data-newux-theme="onyx"].dark .surface-composer > .surface-composer-card {
        background: rgba(${cardRgb}, ${Math.min(0.94, opacity + 0.1)}) !important;
        backdrop-filter: blur(${blur}px) saturate(135%) !important;
        -webkit-backdrop-filter: blur(${blur}px) saturate(135%) !important;
        border: 1px solid rgba(${borderRgb}, 0.52) !important;
        border-radius: ${radius}px !important;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06) !important;
        transition: all 0.2s ease !important;
      }
      /* Prevent inner contenteditable focus ring from drawing a box around the placeholder line */
      .surface-composer [contenteditable="true"]:focus,
      .surface-composer textarea:focus {
        outline: none !important;
        box-shadow: none !important;
        border-color: transparent !important;
      }
      ${
        fx.promptNeonGlow
          ? `
        .surface-composer:focus-within,
        body[data-agy-theme][data-newux-theme="onyx"].dark .surface-composer:focus-within {
          border-color: rgba(${primaryRgb}, 0.52) !important;
          box-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.6), 0 0 18px rgba(${primaryRgb}, 0.18) !important;
        }
        .surface-composer:focus-within > .surface-composer-card,
        body[data-agy-theme][data-newux-theme="onyx"].dark .surface-composer:focus-within > .surface-composer-card {
          border-color: rgba(${primaryRgb}, 0.45) !important;
        }
      `
          : ''
      }

      /* User & AI Message Bubbles & Cards in Chat */
      .agy-user-bubble,
      body[data-agy-theme][data-newux-theme] .agy-user-bubble {
        background: rgba(${userBubbleRgb}, ${Math.min(0.9, opacity + 0.08)}) !important;
        backdrop-filter: blur(${blur}px) !important;
        -webkit-backdrop-filter: blur(${blur}px) !important;
        border: 1px solid ${g.borderGlow ? `rgba(${primaryRgb}, 0.36)` : `rgba(${borderRgb}, 0.45)`} !important;
        border-radius: ${radius}px !important;
        box-shadow: ${
          g.borderGlow
            ? `0 6px 20px rgba(0, 0, 0, 0.28), 0 0 14px rgba(${primaryRgb}, ${Number(g.glowIntensity || 0.3) * 0.2})`
            : '0 4px 14px rgba(0, 0, 0, 0.22)'
        } !important;
      }
      .agy-card, .artifact-card, .agy-callout, .agy-takeover-card, .agy-tip-card {
        background: rgba(${aiBubbleRgb}, ${Math.min(0.88, opacity + 0.04)}) !important;
        backdrop-filter: blur(${blur}px) !important;
        -webkit-backdrop-filter: blur(${blur}px) !important;
        border: 1px solid rgba(${borderRgb}, 0.42) !important;
        border-radius: ${radius}px !important;
      }

      /* Dropdowns, Menus & Popovers */
      .surface-glass, .surface-opaque:not([role="dialog"]):not([role="dialog"] *),
      [role="menu"], [role="listbox"], [data-select-popup] {
        background: rgba(${cardRgb}, ${Math.min(0.95, opacity + 0.16)}) !important;
        backdrop-filter: blur(${Math.max(12, blur)}px) saturate(140%) !important;
        -webkit-backdrop-filter: blur(${Math.max(12, blur)}px) saturate(140%) !important;
        border-color: rgba(${borderRgb}, 0.52) !important;
      }

      /* Settings & App Dialog Modals (Follows Glass Panel Opacity & Blur Sliders) */
      [role="dialog"]:not(.agy-inapp-drawer),
      .agy-dialog:not(.agy-inapp-drawer) {
        background: rgba(${cardRgb}, ${opacity}) !important;
        backdrop-filter: blur(${blur}px) saturate(140%) !important;
        -webkit-backdrop-filter: blur(${blur}px) saturate(140%) !important;
        border: 1px solid rgba(${borderRgb}, 0.52) !important;
        border-radius: ${Math.max(12, radius)}px !important;
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.52), inset 0 1px 0 rgba(255, 255, 255, 0.06) !important;
        --background: transparent !important;
        --color-background: transparent !important;
        --content: transparent !important;
        --shell: transparent !important;
        --shell-canvas: transparent !important;
        --sidebar: rgba(${sidebarRgb}, ${Math.min(0.5, opacity * 0.55)}) !important;
        --color-sidebar: rgba(${sidebarRgb}, ${Math.min(0.5, opacity * 0.55)}) !important;
        --sidebar-background: rgba(${sidebarRgb}, ${Math.min(0.5, opacity * 0.55)}) !important;
        --card: rgba(${cardRgb}, ${Math.min(0.45, opacity * 0.5)}) !important;
        --color-card: rgba(${cardRgb}, ${Math.min(0.45, opacity * 0.5)}) !important;
        --onyx-frame: rgba(${sidebarRgb}, ${Math.min(0.48, opacity * 0.52)}) !important;
        --onyx-well: rgba(${sidebarRgb}, ${Math.min(0.42, opacity * 0.45)}) !important;
        --onyx-raised: rgba(${cardRgb}, ${Math.min(0.55, opacity * 0.62)}) !important;
      }
      [role="dialog"]:not(.agy-inapp-drawer) .surface-opaque,
      .agy-dialog:not(.agy-inapp-drawer) .surface-opaque {
        background: transparent !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }
      [role="dialog"]:not(.agy-inapp-drawer) aside,
      [role="dialog"]:not(.agy-inapp-drawer) nav,
      [role="dialog"]:not(.agy-inapp-drawer) [role="navigation"],
      .agy-dialog:not(.agy-inapp-drawer) aside,
      .agy-dialog:not(.agy-inapp-drawer) nav,
      .agy-dialog:not(.agy-inapp-drawer) [role="navigation"] {
        background: rgba(${sidebarRgb}, ${Math.min(0.52, opacity * 0.6)}) !important;
        border-right-color: rgba(${borderRgb}, 0.36) !important;
      }

      /* Chat Width & Prompt Box Styling */
      ${
        chatMaxWidth
          ? `
        [data-agy-chat-frame="true"]:not(.agy-inapp-drawer *):not([role="dialog"] *):not([role="menu"] *):not([role="listbox"] *):not([role="tooltip"] *)${dockedExclude},
        [data-main-content-body] [style*="max-width"][style*="margin"]:not(.agy-inapp-drawer *):not([role="dialog"] *):not([role="menu"] *):not([role="listbox"] *):not([role="tooltip"] *)${dockedExclude},
        ${
          excludeComposerFromChatWidth
            ? ''
            : `
        [data-agy-composer-wrap="true"]:not(.agy-inapp-drawer *):not([role="dialog"] *),
        [data-main-content-body] div:has(> .surface-composer):not(.agy-inapp-drawer *):not([role="dialog"] *),
        [data-main-content-body] div:has(> #antigravity\\.agentSidePanelInputBox):not(.agy-inapp-drawer *):not([role="dialog"] *),`
        }
        main .max-w-2xl:not([role="dialog"] *)${dockedExclude},
        main .max-w-3xl:not([role="dialog"] *)${dockedExclude},
        main .max-w-4xl:not([role="dialog"] *)${dockedExclude},
        main .max-w-5xl:not([role="dialog"] *)${dockedExclude},
        main .max-w-6xl:not([role="dialog"] *)${dockedExclude},
        [data-main-content-body] .max-w-2xl:not([role="dialog"] *)${dockedExclude},
        [data-main-content-body] .max-w-3xl:not([role="dialog"] *)${dockedExclude},
        [data-main-content-body] .max-w-4xl:not([role="dialog"] *)${dockedExclude},
        [data-main-content-body] .max-w-5xl:not([role="dialog"] *)${dockedExclude},
        [data-main-content-body] .max-w-6xl:not([role="dialog"] *)${dockedExclude} {
          max-width: ${chatMaxWidth} !important;
          width: 100% !important;
          margin-left: auto !important;
          margin-right: auto !important;
        }
      `
          : ''
      }
      ${
        independentPromptMaxWidth
          ? `
        [data-main-content-body] [data-agy-composer-wrap="true"]:not(.agy-inapp-drawer *):not([role="dialog"] *):not([role="menu"] *):not([role="listbox"] *):not([role="tooltip"] *),
        [data-tiling-pane] [data-agy-composer-wrap="true"]:not(.agy-inapp-drawer *):not([role="dialog"] *):not([role="menu"] *):not([role="listbox"] *):not([role="tooltip"] *),
        [data-side-panel-body] [data-agy-composer-wrap="true"]:not(.agy-inapp-drawer *):not([role="dialog"] *):not([role="menu"] *):not([role="listbox"] *):not([role="tooltip"] *),
        main [data-agy-composer-wrap="true"]:not(.agy-inapp-drawer *):not([role="dialog"] *):not([role="menu"] *):not([role="listbox"] *):not([role="tooltip"] *),
        [data-main-content-body] div:has(> .surface-composer):not(.agy-inapp-drawer *):not([role="dialog"] *),
        [data-main-content-body] div:has(> #antigravity\\.agentSidePanelInputBox):not(.agy-inapp-drawer *):not([role="dialog"] *),
        .surface-composer,
        body[data-agy-theme] .surface-composer,
        #antigravity\\.agentSidePanelInputBox {
          max-width: ${independentPromptMaxWidth} !important;
          width: 100% !important;
          margin-left: auto !important;
          margin-right: auto !important;
        }
      `
          : ''
      }
      ${
        isDockedPrompt
          ? `
        [data-main-content-body]:has([data-agy-composer-outer="true"]),
        [data-tiling-pane]:has([data-agy-composer-outer="true"]),
        [data-side-panel-body]:has([data-agy-composer-outer="true"]) {
          padding-bottom: 0 !important;
          overflow-x: hidden !important;
        }
        [data-agy-composer-wrap="true"]:not([data-agy-composer-outer="true"]):not(.agy-inapp-drawer *):not([role="dialog"] *):not([role="menu"] *):not([role="listbox"] *):not([role="tooltip"] *),
        [data-main-content-body] div:has(> .surface-composer):not([data-agy-composer-outer="true"]):not(.agy-inapp-drawer *):not([role="dialog"] *),
        [data-main-content-body] div:has(> #antigravity\\.agentSidePanelInputBox):not([data-agy-composer-outer="true"]):not(.agy-inapp-drawer *):not([role="dialog"] *),
        [data-tiling-pane] div:has(> .surface-composer):not([data-agy-composer-outer="true"]):not(.agy-inapp-drawer *):not([role="dialog"] *),
        [data-tiling-pane] div:has(> #antigravity\\.agentSidePanelInputBox):not([data-agy-composer-outer="true"]):not(.agy-inapp-drawer *):not([role="dialog"] *),
        [data-side-panel-body] div:has(> .surface-composer):not([data-agy-composer-outer="true"]):not(.agy-inapp-drawer *):not([role="dialog"] *),
        [data-side-panel-body] div:has(> #antigravity\\.agentSidePanelInputBox):not([data-agy-composer-outer="true"]):not(.agy-inapp-drawer *):not([role="dialog"] *),
        main div:has(> .surface-composer):not([data-agy-composer-outer="true"]):not(.agy-inapp-drawer *):not([role="dialog"] *),
        main div:has(> #antigravity\\.agentSidePanelInputBox):not([data-agy-composer-outer="true"]):not(.agy-inapp-drawer *):not([role="dialog"] *) {
          box-sizing: border-box !important;
          max-width: 100% !important;
          width: 100% !important;
          margin-left: 0 !important;
          margin-right: 0 !important;
          margin-bottom: 0 !important;
          padding-left: 0 !important;
          padding-right: 0 !important;
          padding-bottom: 0 !important;
        }
        [data-main-content-body] [data-agy-composer-outer="true"]:not(.agy-inapp-drawer *):not([role="dialog"] *):not([role="menu"] *):not([role="listbox"] *):not([role="tooltip"] *),
        [data-tiling-pane] [data-agy-composer-outer="true"]:not(.agy-inapp-drawer *):not([role="dialog"] *):not([role="menu"] *):not([role="listbox"] *):not([role="tooltip"] *),
        [data-side-panel-body] [data-agy-composer-outer="true"]:not(.agy-inapp-drawer *):not([role="dialog"] *):not([role="menu"] *):not([role="listbox"] *):not([role="tooltip"] *),
        main [data-agy-composer-outer="true"]:not(.agy-inapp-drawer *):not([role="dialog"] *):not([role="menu"] *):not([role="listbox"] *):not([role="tooltip"] *),
        [data-agy-composer-outer="true"]:not(.agy-inapp-drawer *):not([role="dialog"] *) {
          box-sizing: border-box !important;
          max-width: none !important;
          width: calc(100% + var(--agy-dock-pad-l, 0px) + var(--agy-dock-pad-r, 0px)) !important;
          margin-left: calc(-1 * var(--agy-dock-pad-l, 0px)) !important;
          margin-right: calc(-1 * var(--agy-dock-pad-r, 0px)) !important;
          margin-bottom: calc(-1 * var(--agy-dock-pad-b, 0px)) !important;
          padding-left: 0 !important;
          padding-right: 0 !important;
          padding-bottom: 0 !important;
        }
        .surface-composer,
        body[data-agy-theme] .surface-composer,
        body[data-agy-theme][data-newux-theme="onyx"] .surface-composer,
        body[data-agy-theme][data-newux-theme="onyx"].dark .surface-composer,
        #antigravity\\.agentSidePanelInputBox {
          box-sizing: border-box !important;
          width: 100% !important;
          max-width: 100% !important;
          margin: 0 !important;
          padding-left: 0 !important;
          padding-right: 0 !important;
          padding-bottom: 0 !important;
          border-bottom-width: 0 !important;
          border-radius: ${Math.max(8, radius - 2)}px ${Math.max(8, radius - 2)}px 0 0 !important;
          box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.35) !important;
        }
        .surface-composer > .surface-composer-card,
        body[data-agy-theme] .surface-composer > .surface-composer-card,
        body[data-agy-theme][data-newux-theme="onyx"] .surface-composer > .surface-composer-card,
        body[data-agy-theme][data-newux-theme="onyx"].dark .surface-composer > .surface-composer-card {
          box-sizing: border-box !important;
          border-bottom-width: 0 !important;
          border-radius: ${Math.max(6, radius - 4)}px ${Math.max(6, radius - 4)}px 0 0 !important;
          margin: 0 !important;
        }
      `
          : ''
      }

      ${
        l.messageStyle === 'chat-bubbles'
          ? `
        article, [data-message-role] {
          border-radius: ${Math.max(16, radius + 4)}px !important;
          padding: 10px 14px !important;
          background: rgba(${aiBubbleRgb}, ${Math.min(0.84, opacity * 0.9)}) !important;
          border: 1px solid rgba(${borderRgb}, 0.48) !important;
        }
      `
          : l.messageStyle === 'minimal'
            ? `
        article, [data-message-role], .agy-card, .artifact-card {
          background: transparent !important;
          border-color: rgba(${borderRgb}, 0.28) !important;
          box-shadow: none !important;
        }
      `
            : `
        article, [data-message-role], .prose {
          border-radius: ${radius}px !important;
        }
      `
      }

      /* Sidebar Layout Modes */
      ${
        l.sidebarPosition === 'right'
          ? `
        [data-testid="sidebar-split"] {
          flex-direction: row-reverse !important;
        }
      `
          : ''
      }
      ${
        l.sidebarPosition === 'floating-autohide'
          ? `
        [role="navigation"][aria-label="Sidebar"], aside, [data-sidebar="sidebar"] {
          transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease !important;
        }
        [role="navigation"][aria-label="Sidebar"]:not(:hover), aside:not(:hover), [data-sidebar="sidebar"]:not(:hover) {
          opacity: 0.18 !important;
        }
      `
          : ''
      }
      ${
        l.zenMode
          ? `
        [role="navigation"][aria-label="Sidebar"], [data-testid="sidebar-sash"], aside, [data-sidebar="sidebar"] {
          display: none !important;
        }
      `
          : ''
      }

      /* Smooth Message Entry Animation */
      ${
        fx.messageSlideAnimation
          ? `
        @keyframes agyFadeSlideUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        main article,
        [data-main-content-body] [data-message-role] {
          animation: agyFadeSlideUp 0.22s ease-out;
        }
      `
          : ''
      }

      /* Custom Scrollbar */
      ::-webkit-scrollbar { width: 5px; height: 5px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.14);
        border-radius: 99px;
      }
      ::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.26);
      }

      /* User Custom CSS Override */
      ${cfg.customCss || ''}
    `;
  }

  // =========================================================================
  // 5. IN-APP FLOATING MINI MUSIC PLAYER & FULL IN-APP STUDIO DRAWER
  // =========================================================================
  const uiStyleEl = document.createElement('style');
  uiStyleEl.id = 'agy-inapp-studio-ui-styles';
  uiStyleEl.textContent = `
    .agy-floating-studio-btn {
      position: fixed;
      top: 42px;
      right: 18px;
      z-index: 999990;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 11px;
      border-radius: 999px;
      background: rgba(14, 16, 23, 0.88);
      backdrop-filter: blur(14px);
      border: 1px solid rgba(255, 255, 255, 0.14);
      color: #f1f5f9;
      font: 600 11.5px/1 'Inter', system-ui, sans-serif;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
      transition: all 0.18s ease;
      user-select: none;
      -webkit-app-region: no-drag;
    }
    .agy-floating-studio-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.25);
    }
    .agy-floating-studio-btn.agy-in-header {
      position: static;
      top: auto;
      right: auto;
      bottom: auto;
      z-index: auto;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 28px;
      padding: 0 11px;
      flex-shrink: 0;
      white-space: nowrap;
      line-height: 1;
      backdrop-filter: none;
    }
    .agy-floating-studio-btn.agy-in-header.agy-needs-gap {
      margin-right: 6px;
    }
    .agy-mini-music-widget {
      position: fixed;
      left: 18px;
      bottom: 18px;
      z-index: 999989;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-radius: 999px;
      background: rgba(14, 16, 23, 0.9);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #f1f5f9;
      font: 500 11.5px/1.2 'Inter', system-ui, sans-serif;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
      user-select: none;
    }
    .agy-mini-music-widget button {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.08);
      color: #f1f5f9;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
    }
    .agy-mini-music-widget button:hover {
      background: rgba(255, 255, 255, 0.14);
    }
    .agy-inapp-drawer-backdrop {
      position: fixed !important;
      top: var(--agy-drawer-top, 36px) !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      width: 100vw !important;
      height: calc(100vh - var(--agy-drawer-top, 36px)) !important;
      padding: 8px 10px 10px 10px !important;
      box-sizing: border-box !important;
      z-index: 999995 !important;
      background: rgba(4, 6, 12, 0.42) !important;
      backdrop-filter: blur(4px) !important;
      display: none !important;
      justify-content: flex-end !important;
      align-items: stretch !important;
    }
    .agy-inapp-drawer-backdrop.open {
      display: flex !important;
    }
    .agy-inapp-drawer {
      width: 428px !important;
      max-width: 100% !important;
      height: 100% !important;
      background: rgba(14, 14, 17, 0.96) !important;
      backdrop-filter: blur(28px) saturate(140%) !important;
      border: 1px solid rgba(255, 255, 255, 0.1) !important;
      border-radius: 14px !important;
      overflow: hidden !important;
      color: #f4f4f5 !important;
      font-family: 'Inter', system-ui, sans-serif !important;
      display: flex !important;
      flex-direction: column !important;
      box-shadow: -16px 12px 48px rgba(0, 0, 0, 0.72), inset 0 1px 0 rgba(255, 255, 255, 0.05) !important;
    }
    .agy-inapp-header {
      padding: 13px 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.065);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      background: #121215;
    }
    .agy-inapp-brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .agy-inapp-brand-icon {
      width: 30px;
      height: 30px;
      border-radius: 8px;
      background: #1c1c21;
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #f4f4f5;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .agy-inapp-close {
      width: 28px;
      height: 28px;
      padding: 0 !important;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px !important;
      font-size: 13px !important;
      flex-shrink: 0;
      background: rgba(255, 255, 255, 0.04) !important;
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
      color: #a1a1aa !important;
    }
    .agy-inapp-close:hover {
      border-color: rgba(244, 63, 94, 0.45) !important;
      background: rgba(244, 63, 94, 0.16) !important;
      color: #fda4af !important;
    }
    .agy-inapp-tabs {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 4px;
      padding: 4px;
      margin: 10px 14px 4px 14px;
      background: #0b0b0d;
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 9px;
    }
    .agy-inapp-tab {
      padding: 6px 4px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      background: transparent;
      color: #8e8e99;
      border: 1px solid transparent;
      cursor: pointer;
      white-space: nowrap;
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: all 0.15s ease;
    }
    .agy-inapp-tab:hover {
      color: #e4e4e7;
    }
    .agy-inapp-tab.active {
      background: #1f1f26;
      color: #ffffff;
      border-color: rgba(255, 255, 255, 0.14);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
    }
    .agy-inapp-body {
      flex: 1;
      overflow-y: auto;
      padding: 10px 14px 14px 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .agy-inapp-card {
      background: #16161a;
      border: 1px solid rgba(255, 255, 255, 0.065);
      border-radius: 10px;
      padding: 12px 13px;
    }
    .agy-inapp-card h4 {
      margin: 0 0 10px 0;
      font-size: 12px;
      font-weight: 600;
      color: #f4f4f5;
      letter-spacing: 0.1px;
    }
    .agy-inapp-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 7px;
    }
    .agy-inapp-preset-btn {
      padding: 8px;
      border-radius: 9px;
      border: 1px solid rgba(255, 255, 255, 0.07);
      background: #111114;
      color: #e4e4e7;
      text-align: left;
      cursor: pointer;
      font-size: 11.5px;
      font-weight: 600;
      transition: all 0.15s ease;
    }
    .agy-inapp-preset-btn:hover {
      border-color: rgba(255, 255, 255, 0.18);
      background: #1a1a20;
    }
    .agy-inapp-preset-btn.active {
      border-color: #e4e4e7;
      background: #1c1c22;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
      color: #ffffff;
    }
    .agy-inapp-color-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      margin-bottom: 10px;
    }
    .agy-inapp-color-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 6px 8px;
      background: #111114;
      border: 1px solid rgba(255, 255, 255, 0.065);
      border-radius: 7px;
      cursor: pointer;
    }
    .agy-inapp-color-item:hover {
      border-color: rgba(255, 255, 255, 0.15);
    }
    .agy-inapp-color-item.span-2 {
      grid-column: span 2;
    }
    .agy-inapp-color-meta {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .agy-inapp-color-lbl {
      font-size: 10.5px;
      font-weight: 500;
      color: #d4d4d8;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .agy-inapp-color-hex {
      font-size: 9.5px;
      font-family: 'JetBrains Mono', Consolas, monospace;
      color: #8e8e99;
      text-transform: uppercase;
      margin-top: 1px;
    }
    .agy-inapp-drawer input[type="color"] {
      -webkit-appearance: none;
      appearance: none;
      width: 24px;
      height: 24px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 6px;
      background: transparent;
      padding: 0;
      cursor: pointer;
      flex-shrink: 0;
    }
    .agy-inapp-drawer input[type="color"]::-webkit-color-swatch-wrapper {
      padding: 0;
    }
    .agy-inapp-drawer input[type="color"]::-webkit-color-swatch {
      border: none;
      border-radius: 5px;
    }
    .agy-inapp-drawer input[type="range"] {
      -webkit-appearance: none;
      appearance: none;
      width: 136px;
      height: 4px;
      background: #27272e;
      border-radius: 99px;
      outline: none;
      cursor: pointer;
    }
    .agy-inapp-drawer input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 13px;
      height: 13px;
      border-radius: 50%;
      background: #f4f4f5;
      border: 2px solid #18181b;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.35), 0 1px 4px rgba(0, 0, 0, 0.6);
      cursor: pointer;
    }
    .agy-inapp-drawer input[type="checkbox"] {
      -webkit-appearance: none;
      appearance: none;
      width: 32px;
      height: 18px;
      background: #27272e;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 99px;
      position: relative;
      cursor: pointer;
      outline: none;
      transition: all 0.16s ease;
      flex-shrink: 0;
    }
    .agy-inapp-drawer input[type="checkbox"]::before {
      content: "";
      position: absolute;
      width: 12px;
      height: 12px;
      left: 2px;
      top: 2px;
      border-radius: 50%;
      background: #a1a1aa;
      transition: all 0.16s ease;
    }
    .agy-inapp-drawer input[type="checkbox"]:checked {
      background: #10b981;
      border-color: #34d399;
    }
    .agy-inapp-drawer input[type="checkbox"]:checked::before {
      transform: translateX(14px);
      background: #ffffff;
    }
    .agy-inapp-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 6px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      font-size: 11.5px;
      color: #d4d4d8;
    }
    .agy-inapp-row:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }
    .agy-inapp-seg-group {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
      margin-bottom: 10px;
    }
    .agy-inapp-seg-btn {
      padding: 6px 5px;
      border-radius: 7px;
      border: 1px solid rgba(255, 255, 255, 0.07);
      background: #111114;
      color: #d4d4d8;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      text-align: center;
      line-height: 1.25;
      transition: all 0.15s ease;
    }
    .agy-inapp-seg-btn:hover {
      border-color: rgba(255, 255, 255, 0.18);
      color: #f4f4f5;
    }
    .agy-inapp-seg-btn.active {
      background: #1f1f26;
      border-color: #e4e4e7;
      color: #ffffff;
    }
    .agy-inapp-seg-sub {
      display: block;
      font-size: 9.5px;
      font-weight: 400;
      color: #8e8e99;
      margin-top: 2px;
    }
    .agy-inapp-seg-btn.active .agy-inapp-seg-sub {
      color: #d4d4d8;
    }
    .agy-inapp-hint {
      font-size: 11px;
      line-height: 1.45;
      color: #8e8e99;
      background: #111114;
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 7px;
      padding: 7px 10px;
      margin-bottom: 8px;
    }
    .agy-inapp-btn {
      padding: 7px 12px;
      border-radius: 7px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: #1a1a20;
      color: #f4f4f5;
      font-size: 11.5px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .agy-inapp-btn:hover {
      background: #232329;
      border-color: rgba(255, 255, 255, 0.22);
    }
    .agy-inapp-btn-primary {
      background: #f4f4f5 !important;
      color: #09090b !important;
      border-color: #ffffff !important;
      font-weight: 700 !important;
    }
    .agy-inapp-btn-primary:hover {
      background: #e4e4e7 !important;
    }
    .agy-inapp-footer {
      padding: 11px 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.065);
      background: #121215;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }
  `;
  document.head.appendChild(uiStyleEl);

  const visualEngine = createVisualEngine(document.body);
  let miniMusicEl = null;

  let activeInAppTab = 'theme';

  const musicController = createMusicController((state) => {
    if (miniMusicEl) {
      const playBtn = miniMusicEl.querySelector('.agy-mm-play');
      const titleEl = miniMusicEl.querySelector('.agy-mm-title');
      if (playBtn) playBtn.textContent = state.isPlaying ? '⏸' : '▶';
      if (titleEl) titleEl.textContent = state.trackName;
    }
    if (drawerBackdrop && drawerBackdrop.classList.contains('open') && activeInAppTab === 'music') {
      const inAppPlay = drawerBackdrop.querySelector('#inapp-m-play');
      if (inAppPlay) inAppPlay.textContent = state.isPlaying ? '⏸ Tạm dừng' : '▶ Phát nhạc';
      drawerBackdrop.querySelectorAll('[data-track-id]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.trackId === state.activeTrackId);
      });
    }
  });

  // Mount Studio Button (inside header next to 3-dots & Open IDE, with top-right fallback),
  // Mini Music Player & In-App Studio Drawer
  const floatingBtn = document.createElement('button');
  floatingBtn.className = 'agy-floating-studio-btn';
  floatingBtn.type = 'button';
  floatingBtn.title = 'Mở AGY UI Studio ngay trong App (Ctrl + Shift + Y)';
  floatingBtn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
      <polyline points="2 17 12 22 22 17"></polyline>
      <polyline points="2 12 12 17 22 12"></polyline>
    </svg>
    <span>AGY Studio</span>
  `;

  let isMountingStudioBtn = false;
  let mountedHeaderParent = null;
  let mountedHeaderAnchor = null;
  let isPointerPressed = false;

  const POPUP_OR_GUARD_SELECTOR =
    '[role="menu"], [role="listbox"], [role="dialog"], [role="tooltip"], [data-select-popup], [data-radix-popper-content-wrapper], [data-base-ui-portal], [data-floating-ui-portal], [data-radix-focus-guard], [data-base-ui-focus-guard], [data-floating-ui-focus-guard]';

  function hasActivePopupOrMenu() {
    try {
      return Boolean(
        document.querySelector(
          '[role="menu"], [role="listbox"], [data-select-popup], [data-radix-popper-content-wrapper], [data-popup-open], [aria-expanded="true"][aria-haspopup]'
        )
      );
    } catch (_) {
      return false;
    }
  }

  function isVisibleElement(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function findThreeDotAnchorBefore(node) {
    let prev = node.previousElementSibling;
    while (prev) {
      if (
        prev === floatingBtn ||
        prev.classList?.contains('agy-floating-studio-btn') ||
        prev.matches?.('[data-testid="right-cluster-fade"]') ||
        prev.matches?.(POPUP_OR_GUARD_SELECTOR)
      ) {
        prev = prev.previousElementSibling;
        continue;
      }
      const isBtnOrWrapper =
        prev.matches?.('button, [role="button"]') ||
        Boolean(prev.querySelector?.('button, [role="button"]'));
      const textLen = (prev.textContent || '').trim().length;
      const hasSvg = Boolean(prev.querySelector?.('svg'));
      if (isBtnOrWrapper && (hasSvg || textLen <= 3)) {
        return prev;
      }
      break;
    }
    return null;
  }

  function syncStudioButtonDisplay() {
    const desired =
      currentConfig.layout?.showInAppButton === false
        ? 'none'
        : floatingBtn.classList.contains('agy-in-header')
          ? 'inline-flex'
          : 'flex';
    if (floatingBtn.style.display !== desired) {
      floatingBtn.style.display = desired;
    }
  }

  function mountStudioButtonInHeader() {
    if (isMountingStudioBtn) return;

    // Never mutate or reflow the header while the user is pressing the mouse
    // or while a dropdown menu / popover is open (prevents closing Radix/Base-UI triggers).
    if (
      floatingBtn.isConnected &&
      floatingBtn.classList.contains('agy-in-header') &&
      (isPointerPressed || hasActivePopupOrMenu())
    ) {
      return;
    }

    // Fast path: button is already mounted in the exact right header parent right before its anchor.
    if (
      floatingBtn.isConnected &&
      floatingBtn.classList.contains('agy-in-header') &&
      mountedHeaderParent &&
      mountedHeaderParent.isConnected &&
      floatingBtn.parentElement === mountedHeaderParent &&
      mountedHeaderAnchor &&
      mountedHeaderAnchor.isConnected &&
      mountedHeaderAnchor.parentElement === mountedHeaderParent
    ) {
      let nextSib = floatingBtn.nextElementSibling;
      while (nextSib && nextSib.matches?.('[data-testid="right-cluster-fade"]')) {
        nextSib = nextSib.nextElementSibling;
      }
      if (nextSib === mountedHeaderAnchor) {
        syncStudioButtonDisplay();
        return;
      }
    }

    isMountingStudioBtn = true;
    try {
      const openEditorCandidates = Array.from(
        document.querySelectorAll('[data-testid^="open-editor-"]')
      );
      const openEditorBtn =
        openEditorCandidates.find(isVisibleElement) || openEditorCandidates[0] || null;

      if (!openEditorBtn) {
        mountedHeaderParent = null;
        mountedHeaderAnchor = null;
        floatingBtn.classList.remove('agy-in-header', 'agy-needs-gap');
        if (floatingBtn.parentElement !== document.body && document.body) {
          document.body.appendChild(floatingBtn);
        }
        syncStudioButtonDisplay();
        return;
      }

      let insertBeforeEl = openEditorBtn;
      let cursor = openEditorBtn;
      for (let depth = 0; depth < 3 && cursor && cursor.parentElement; depth++) {
        const parent = cursor.parentElement;
        if (parent === document.body || parent === document.documentElement) break;

        const threeDotAnchor = findThreeDotAnchorBefore(cursor);
        if (threeDotAnchor) {
          insertBeforeEl = threeDotAnchor;
          break;
        }

        if (
          parent.matches?.('[data-main-content-header], [data-testid="pane-titlebar-toolbar"]')
        ) {
          break;
        }
        cursor = parent;
      }

      const targetParent = insertBeforeEl.parentElement;
      if (!targetParent) return;

      floatingBtn.classList.add('agy-in-header');
      try {
        const cs = window.getComputedStyle(targetParent);
        const gapVal = parseFloat(cs.columnGap || cs.gap || '0');
        floatingBtn.classList.toggle('agy-needs-gap', Number.isNaN(gapVal) || gapVal < 4);
      } catch (_) {
        floatingBtn.classList.add('agy-needs-gap');
      }

      let immediatePrev = insertBeforeEl.previousElementSibling;
      while (
        immediatePrev &&
        immediatePrev !== floatingBtn &&
        immediatePrev.matches?.('[data-testid="right-cluster-fade"]')
      ) {
        immediatePrev = immediatePrev.previousElementSibling;
      }
      if (floatingBtn.parentElement !== targetParent || immediatePrev !== floatingBtn) {
        targetParent.insertBefore(floatingBtn, insertBeforeEl);
      }
      mountedHeaderParent = targetParent;
      mountedHeaderAnchor = insertBeforeEl;
      syncStudioButtonDisplay();
    } finally {
      isMountingStudioBtn = false;
    }
  }

  mountStudioButtonInHeader();

  miniMusicEl = document.createElement('div');
  miniMusicEl.className = 'agy-mini-music-widget';
  miniMusicEl.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M9 18V5l12-2v13"></path>
      <circle cx="6" cy="18" r="3"></circle>
      <circle cx="18" cy="16" r="3"></circle>
    </svg>
    <button class="agy-mm-prev" title="Bài trước">⏮</button>
    <button class="agy-mm-play" title="Phát / Tạm dừng">▶</button>
    <button class="agy-mm-next" title="Bài tiếp">⏭</button>
    <span class="agy-mm-title" style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Lo-Fi Chill</span>
  `;
  document.body.appendChild(miniMusicEl);

  miniMusicEl.querySelector('.agy-mm-play').addEventListener('click', () => musicController.togglePlay());
  miniMusicEl.querySelector('.agy-mm-prev').addEventListener('click', () => musicController.prevTrack());
  miniMusicEl.querySelector('.agy-mm-next').addEventListener('click', () => musicController.nextTrack());

  const drawerBackdrop = document.createElement('div');
  drawerBackdrop.className = 'agy-inapp-drawer-backdrop';
  drawerBackdrop.innerHTML = `
    <div class="agy-inapp-drawer">
      <div class="agy-inapp-header">
        <div class="agy-inapp-brand">
          <div class="agy-inapp-brand-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
              <polyline points="2 17 12 22 22 17"></polyline>
              <polyline points="2 12 12 17 22 12"></polyline>
            </svg>
          </div>
          <div>
            <div style="font-size:13.5px;font-weight:700;color:#f4f4f5;">AGY UI Studio <span style="font-size:10px;font-weight:600;padding:1px 6px;border-radius:5px;background:rgba(255,255,255,0.07);color:#d4d4d8;margin-left:4px;">In-App</span></div>
            <div style="font-size:10.5px;color:#8e8e99;margin-top:2px;">Phím tắt: Ctrl + Shift + Y · Đóng: Esc</div>
          </div>
        </div>
        <button class="agy-inapp-close agy-inapp-btn" title="Đóng (Esc)" aria-label="Đóng">✕</button>
      </div>
      <div class="agy-inapp-tabs">
        <button class="agy-inapp-tab active" data-tab="theme">Giao diện</button>
        <button class="agy-inapp-tab" data-tab="wallpaper">Hình nền</button>
        <button class="agy-inapp-tab" data-tab="music">Âm thanh</button>
        <button class="agy-inapp-tab" data-tab="effects">Bố cục &amp; FX</button>
      </div>
      <div class="agy-inapp-body" id="agy-inapp-tab-content"></div>
      <div class="agy-inapp-footer">
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:500;color:#d4d4d8;cursor:pointer;">
          <input type="checkbox" id="agy-inapp-master-toggle" checked />
          <span>Bật giao diện Custom</span>
        </label>
        <button class="agy-inapp-btn agy-inapp-btn-primary" id="agy-inapp-save-btn">Lưu Vĩnh Viễn</button>
      </div>
    </div>
  `;
  document.body.appendChild(drawerBackdrop);

  function renderInAppTabContent() {
    const container = drawerBackdrop.querySelector('#agy-inapp-tab-content');
    const masterCheckbox = drawerBackdrop.querySelector('#agy-inapp-master-toggle');
    if (masterCheckbox) masterCheckbox.checked = Boolean(currentConfig.enabled);

    if (activeInAppTab === 'theme') {
      const inAppColorTokens = [
        { id: 'inapp-col-bg', key: 'background', label: 'Nền chính (Background)', val: currentConfig.colors.background },
        { id: 'inapp-col-fg', key: 'foreground', label: 'Chữ chính (Foreground)', val: currentConfig.colors.foreground || '#f8fafc' },
        { id: 'inapp-col-sidebar', key: 'sidebar', label: 'Thanh bên (Sidebar)', val: currentConfig.colors.sidebar },
        { id: 'inapp-col-card', key: 'card', label: 'Khung Chat (Card)', val: currentConfig.colors.card },
        { id: 'inapp-col-user', key: 'userBubble', label: 'Tin nhắn User', val: currentConfig.colors.userBubble || currentConfig.colors.card },
        { id: 'inapp-col-ai', key: 'aiBubble', label: 'Tin nhắn AI', val: currentConfig.colors.aiBubble || currentConfig.colors.card },
        { id: 'inapp-col-primary', key: 'primary', label: 'Màu nhấn (Primary)', val: currentConfig.colors.primary },
        { id: 'inapp-col-accent', key: 'accent', label: 'Màu phụ (Accent)', val: currentConfig.colors.accent },
        { id: 'inapp-col-border', key: 'border', label: 'Viền khung (Border)', val: currentConfig.colors.border, span2: true }
      ];

      container.innerHTML = `
        <div class="agy-inapp-card">
          <h4>Bộ Sưu Tập Theme Preset (Dịu Mắt)</h4>
          <div class="agy-inapp-grid">
            ${(PRESETS_DATA.THEME_PRESETS || [])
              .map(
                (p) => `
              <button class="agy-inapp-preset-btn ${currentConfig.activePresetId === p.id ? 'active' : ''}" data-preset="${escapeHtml(p.id)}">
                <div style="height:34px;border-radius:6px;background:${escapeHtml(p.colors.background)};margin-bottom:6px;position:relative;display:flex;align-items:center;justify-content:space-between;padding:0 6px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">
                  <div style="position:absolute;inset:0;display:flex;pointer-events:none;">
                    <div style="width:26%;height:100%;background:${escapeHtml(p.colors.sidebar)};border-right:1px solid rgba(255,255,255,0.07);"></div>
                    <div style="flex:1;background:${escapeHtml(p.previewGradient)};opacity:0.88;"></div>
                  </div>
                  <span style="position:relative;z-index:1;display:inline-flex;gap:3px;padding:2px 5px;border-radius:99px;background:rgba(9,9,11,0.68);">
                    <span style="width:7px;height:7px;border-radius:50%;background:${escapeHtml(p.colors.primary)};border:1px solid rgba(255,255,255,0.25);"></span>
                    <span style="width:7px;height:7px;border-radius:50%;background:${escapeHtml(p.colors.accent)};border:1px solid rgba(255,255,255,0.25);"></span>
                  </span>
                  <span style="position:relative;z-index:1;font-size:8.5px;padding:1px 5px;border-radius:4px;background:rgba(9,9,11,0.76);color:#d4d4d8;border:1px solid rgba(255,255,255,0.08);">${escapeHtml(p.badge || '')}</span>
                </div>
                <div>${escapeHtml(p.name)}</div>
              </button>
            `
              )
              .join('')}
          </div>
        </div>
        <div class="agy-inapp-card">
          <h4>Bảng Màu &amp; Độ Trong Suốt Kính Mờ</h4>
          <div class="agy-inapp-color-grid">
            ${inAppColorTokens
              .map(
                (t) => `
              <label class="agy-inapp-color-item ${t.span2 ? 'span-2' : ''}" for="${t.id}">
                <div class="agy-inapp-color-meta">
                  <span class="agy-inapp-color-lbl">${t.label}</span>
                  <span class="agy-inapp-color-hex" id="${t.id}-hex">${escapeHtml(t.val)}</span>
                </div>
                <input type="color" id="${t.id}" value="${escapeHtml(t.val)}" />
              </label>
            `
              )
              .join('')}
          </div>
          <div class="agy-inapp-row">
            <span>Độ đặc khung kính (<span id="inapp-glass-opacity-val">${Math.round(currentConfig.glass.panelOpacity * 100)}</span>%)</span>
            <input type="range" id="inapp-glass-opacity" min="0.15" max="0.98" step="0.02" value="${escapeHtml(currentConfig.glass.panelOpacity)}" />
          </div>
          <div class="agy-inapp-row">
            <span>Độ nhòe kính mờ (<span id="inapp-glass-blur-val">${escapeHtml(currentConfig.glass.backdropBlur)}</span>px)</span>
            <input type="range" id="inapp-glass-blur" min="0" max="32" step="1" value="${escapeHtml(currentConfig.glass.backdropBlur)}" />
          </div>
          <div class="agy-inapp-row">
            <span>Độ bo góc khung (<span id="inapp-glass-radius-val">${escapeHtml(currentConfig.glass.borderRadius ?? 14)}</span>px)</span>
            <input type="range" id="inapp-glass-radius" min="0" max="26" step="1" value="${escapeHtml(currentConfig.glass.borderRadius ?? 14)}" />
          </div>
          <div class="agy-inapp-row">
            <span>Viền nhấn ánh sáng dịu (Subtle Glow)</span>
            <input type="checkbox" id="inapp-glass-glow" ${currentConfig.glass.borderGlow ? 'checked' : ''} />
          </div>
          <div class="agy-inapp-row">
            <span>Cường độ ánh sáng viền (<span id="inapp-glass-glow-val">${Math.round(Number(currentConfig.glass.glowIntensity ?? 0.3) * 100)}</span>%)</span>
            <input type="range" id="inapp-glass-glow-intensity" min="0.1" max="1" step="0.05" value="${escapeHtml(Number(currentConfig.glass.glowIntensity ?? 0.3))}" />
          </div>
        </div>
      `;

      container.querySelectorAll('[data-preset]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const preset = PRESETS_DATA.THEME_PRESETS.find((p) => p.id === btn.dataset.preset);
          if (!preset) return;
          currentConfig.activePresetId = preset.id;
          currentConfig.colors = { ...preset.colors };
          currentConfig.glass = { ...preset.glass };
          if (preset.recommended) {
            currentConfig.wallpaper.enabled = preset.recommended.wallpaperType !== 'none';
            currentConfig.wallpaper.sourceType = preset.recommended.wallpaperType;
            currentConfig.wallpaper.builtinId = preset.recommended.wallpaperId;
            currentConfig.wallpaper.syncedForPath = currentConfig.wallpaper.customFilePath || '__preset__';
            currentConfig.effects.particles = preset.recommended.particleType;
            if (preset.recommended.musicId) {
              currentConfig.music.activeTrackId = preset.recommended.musicId;
            }
          }
          applyAllCurrentConfig();
          renderInAppTabContent();
        });
      });

      const bindInAppColor = (id, key) => {
        container.querySelector(id)?.addEventListener('input', (e) => {
          currentConfig.colors[key] = e.target.value;
          const hexEl = container.querySelector(`${id}-hex`);
          if (hexEl) hexEl.textContent = e.target.value;
          currentConfig.activePresetId = 'custom';
          if (currentConfig.wallpaper) {
            currentConfig.wallpaper.syncedForPath = currentConfig.wallpaper.customFilePath || '__manual__';
          }
          applyAllCurrentConfig();
        });
      };

      bindInAppColor('#inapp-col-bg', 'background');
      bindInAppColor('#inapp-col-fg', 'foreground');
      bindInAppColor('#inapp-col-sidebar', 'sidebar');
      bindInAppColor('#inapp-col-card', 'card');
      bindInAppColor('#inapp-col-user', 'userBubble');
      bindInAppColor('#inapp-col-ai', 'aiBubble');
      bindInAppColor('#inapp-col-primary', 'primary');
      bindInAppColor('#inapp-col-accent', 'accent');
      bindInAppColor('#inapp-col-border', 'border');

      container.querySelector('#inapp-glass-opacity')?.addEventListener('input', (e) => {
        currentConfig.glass.panelOpacity = parseFloat(e.target.value);
        const lbl = container.querySelector('#inapp-glass-opacity-val');
        if (lbl) lbl.textContent = String(Math.round(currentConfig.glass.panelOpacity * 100));
        applyAllCurrentConfig();
      });
      container.querySelector('#inapp-glass-blur')?.addEventListener('input', (e) => {
        currentConfig.glass.backdropBlur = parseInt(e.target.value, 10);
        const lbl = container.querySelector('#inapp-glass-blur-val');
        if (lbl) lbl.textContent = String(currentConfig.glass.backdropBlur);
        applyAllCurrentConfig();
      });
      container.querySelector('#inapp-glass-radius')?.addEventListener('input', (e) => {
        currentConfig.glass.borderRadius = parseInt(e.target.value, 10);
        const lbl = container.querySelector('#inapp-glass-radius-val');
        if (lbl) lbl.textContent = String(currentConfig.glass.borderRadius);
        applyAllCurrentConfig();
      });
      container.querySelector('#inapp-glass-glow')?.addEventListener('change', (e) => {
        currentConfig.glass.borderGlow = e.target.checked;
        applyAllCurrentConfig();
      });
      container.querySelector('#inapp-glass-glow-intensity')?.addEventListener('input', (e) => {
        currentConfig.glass.glowIntensity = parseFloat(e.target.value);
        const lbl = container.querySelector('#inapp-glass-glow-val');
        if (lbl) lbl.textContent = String(Math.round(currentConfig.glass.glowIntensity * 100));
        applyAllCurrentConfig();
      });
    } else if (activeInAppTab === 'wallpaper') {
      container.innerHTML = `
        <div class="agy-inapp-card">
          <h4>Kho Hình Nền Động Tích Hợp Sẵn</h4>
          <div class="agy-inapp-row" style="margin-bottom:8px;">
            <span>Bật hiển thị hình nền động</span>
            <input type="checkbox" id="inapp-wp-enable" ${currentConfig.wallpaper.enabled ? 'checked' : ''} />
          </div>
          <div class="agy-inapp-grid">
            ${(PRESETS_DATA.BUILTIN_WALLPAPERS || [])
              .map(
                (w) => `
              <button class="agy-inapp-preset-btn ${
                currentConfig.wallpaper.builtinId === w.id && currentConfig.wallpaper.sourceType === w.type ? 'active' : ''
              }" data-wp-id="${escapeHtml(w.id)}" data-wp-type="${escapeHtml(w.type)}">
                <div style="height:24px;border-radius:6px;background:${escapeHtml(w.preview)};margin-bottom:6px;border:1px solid rgba(255,255,255,0.08);"></div>
                <div>${escapeHtml(w.name)}</div>
              </button>
            `
              )
              .join('')}
          </div>
        </div>
        <div class="agy-inapp-card">
          <h4>Tải Ảnh / GIF / Video MP4 từ máy</h4>
          <button class="agy-inapp-btn agy-inapp-btn-primary" id="inapp-pick-wp" style="width:100%;margin-bottom:10px;">
            Chọn File Ảnh / GIF / Video nền từ máy tính
          </button>
          <div class="agy-inapp-row">
            <span>Tự động đồng bộ màu UI theo ảnh/video ngoài</span>
            <input type="checkbox" id="inapp-wp-autosync" ${currentConfig.wallpaper.autoSyncColors !== false ? 'checked' : ''} />
          </div>
          <button class="agy-inapp-btn" id="inapp-sync-wp-colors" style="width:100%;margin-bottom:10px;">
            Đồng bộ màu giao diện theo hình nền hiện tại
          </button>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;font-size:11px;color:#94a3b8;">
            <span>Bảng màu:</span>
            ${['sidebar', 'card', 'userBubble', 'primary', 'accent', 'border']
              .map(
                (k) =>
                  `<span title="${k}: ${escapeHtml(currentConfig.colors[k] || '')}" style="width:15px;height:15px;border-radius:4px;background:${escapeHtml(currentConfig.colors[k] || '#000')};border:1px solid rgba(255,255,255,0.24);display:inline-block;"></span>`
              )
              .join('')}
          </div>
          <div class="agy-inapp-row">
            <span>Độ tối lớp phủ (<span id="inapp-wp-dim-val">${Math.round(currentConfig.wallpaper.dimming * 100)}</span>%)</span>
            <input type="range" id="inapp-wp-dim" min="0" max="0.9" step="0.05" value="${escapeHtml(currentConfig.wallpaper.dimming)}" />
          </div>
          <div class="agy-inapp-row">
            <span>Làm mờ hình nền (<span id="inapp-wp-blur-val">${escapeHtml(currentConfig.wallpaper.blur)}</span>px)</span>
            <input type="range" id="inapp-wp-blur" min="0" max="24" step="1" value="${escapeHtml(currentConfig.wallpaper.blur)}" />
          </div>
          <div class="agy-inapp-row">
            <span>Độ rực màu Saturation (<span id="inapp-wp-sat-val">${escapeHtml(currentConfig.wallpaper.saturation ?? 115)}</span>%)</span>
            <input type="range" id="inapp-wp-sat" min="50" max="180" step="5" value="${escapeHtml(currentConfig.wallpaper.saturation ?? 115)}" />
          </div>
          <div class="agy-inapp-row">
            <span>Tốc độ chuyển động (<span id="inapp-wp-speed-val">${escapeHtml(currentConfig.wallpaper.playbackRate ?? 1)}</span>x)</span>
            <input type="range" id="inapp-wp-speed" min="0.25" max="2.5" step="0.25" value="${escapeHtml(currentConfig.wallpaper.playbackRate ?? 1)}" />
          </div>
        </div>
      `;

      container.querySelector('#inapp-wp-enable')?.addEventListener('change', (e) => {
        currentConfig.wallpaper.enabled = e.target.checked;
        applyAllCurrentConfig();
      });

      container.querySelectorAll('[data-wp-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          currentConfig.wallpaper.enabled = true;
          currentConfig.wallpaper.sourceType = btn.dataset.wpType;
          currentConfig.wallpaper.builtinId = btn.dataset.wpId;
          applyAllCurrentConfig();
          renderInAppTabContent();
        });
      });

      container.querySelector('#inapp-pick-wp')?.addEventListener('click', async () => {
        if (!bridge || !bridge.pickFile) return;
        const res = await bridge.pickFile('wallpaper');
        if (res && res.ok) {
          currentConfig.wallpaper.enabled = true;
          currentConfig.wallpaper.sourceType = 'custom-file';
          currentConfig.wallpaper.customFilePath = res.filePath;
          currentConfig.wallpaper.customFileMime = res.mime;
          if (currentConfig.wallpaper.autoSyncColors !== false) {
            await syncConfigColorsFromWallpaper(currentConfig);
          }
          applyAllCurrentConfig();
          renderInAppTabContent();
        }
      });

      container.querySelector('#inapp-wp-autosync')?.addEventListener('change', async (e) => {
        currentConfig.wallpaper.autoSyncColors = e.target.checked;
        if (e.target.checked && currentConfig.wallpaper.sourceType === 'custom-file') {
          await syncConfigColorsFromWallpaper(currentConfig);
          applyAllCurrentConfig();
          renderInAppTabContent();
        }
      });

      container.querySelector('#inapp-sync-wp-colors')?.addEventListener('click', async () => {
        const canvasEl = document.body.querySelector('.agy-custom-layers-root .agy-wp-canvas');
        const syncRes = await syncConfigColorsFromWallpaper(currentConfig, { canvasEl });
        if (syncRes && syncRes.ok) {
          applyAllCurrentConfig();
          renderInAppTabContent();
        }
      });

      container.querySelector('#inapp-wp-dim')?.addEventListener('input', (e) => {
        currentConfig.wallpaper.dimming = parseFloat(e.target.value);
        const lbl = container.querySelector('#inapp-wp-dim-val');
        if (lbl) lbl.textContent = String(Math.round(currentConfig.wallpaper.dimming * 100));
        applyAllCurrentConfig();
      });
      container.querySelector('#inapp-wp-blur')?.addEventListener('input', (e) => {
        currentConfig.wallpaper.blur = parseInt(e.target.value, 10);
        const lbl = container.querySelector('#inapp-wp-blur-val');
        if (lbl) lbl.textContent = String(currentConfig.wallpaper.blur);
        applyAllCurrentConfig();
      });
      container.querySelector('#inapp-wp-sat')?.addEventListener('input', (e) => {
        currentConfig.wallpaper.saturation = parseInt(e.target.value, 10);
        const lbl = container.querySelector('#inapp-wp-sat-val');
        if (lbl) lbl.textContent = String(currentConfig.wallpaper.saturation);
        applyAllCurrentConfig();
      });
      container.querySelector('#inapp-wp-speed')?.addEventListener('input', (e) => {
        currentConfig.wallpaper.playbackRate = parseFloat(e.target.value);
        const lbl = container.querySelector('#inapp-wp-speed-val');
        if (lbl) lbl.textContent = String(currentConfig.wallpaper.playbackRate);
        applyAllCurrentConfig();
      });
    } else if (activeInAppTab === 'music') {
      const mState = musicController.getState();
      const customIds = new Set((currentConfig.music?.customTracks || []).map((ct) => ct.id));
      container.innerHTML = `
        <div class="agy-inapp-card">
          <h4>Trình Phát Nhạc Nền AGY</h4>
          <div class="agy-inapp-row">
            <span>Bật nhạc nền</span>
            <input type="checkbox" id="inapp-music-enable" ${currentConfig.music.enabled ? 'checked' : ''} />
          </div>
          <div class="agy-inapp-row">
            <span>Tự động phát khi mở AGY App</span>
            <input type="checkbox" id="inapp-music-autoplay" ${currentConfig.music.autoplay ? 'checked' : ''} />
          </div>
          <div class="agy-inapp-row">
            <span>Lặp lại 1 bài (Loop)</span>
            <input type="checkbox" id="inapp-music-loop" ${currentConfig.music.loop !== false ? 'checked' : ''} />
          </div>
          <div class="agy-inapp-row">
            <span>Hiện thanh nhạc Mini góc trái</span>
            <input type="checkbox" id="inapp-music-mini" ${currentConfig.music.showMiniPlayer ? 'checked' : ''} />
          </div>
          <div class="agy-inapp-row">
            <span>Âm lượng nhạc (<span id="inapp-music-vol-val">${Math.round(currentConfig.music.volume * 100)}</span>%)</span>
            <input type="range" id="inapp-music-vol" min="0" max="1" step="0.02" value="${escapeHtml(currentConfig.music.volume)}" />
          </div>
          <div style="display:flex;gap:8px;margin:10px 0;">
            <button class="agy-inapp-btn" id="inapp-m-prev" style="flex:1;">⏮ Trước</button>
            <button class="agy-inapp-btn agy-inapp-btn-primary" id="inapp-m-play" style="flex:1;">${mState.isPlaying ? '⏸ Tạm dừng' : '▶ Phát nhạc'}</button>
            <button class="agy-inapp-btn" id="inapp-m-next" style="flex:1;">⏭ Tiếp</button>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;">
            ${mState.tracks
              .map(
                (t) => `
              <div style="display:flex;gap:6px;align-items:stretch;">
                <button class="agy-inapp-preset-btn ${t.id === currentConfig.music.activeTrackId ? 'active' : ''}" data-track-id="${escapeHtml(t.id)}" style="flex:1;">
                  ${escapeHtml(t.name)} <span style="font-weight:400;color:#8b95a7;font-size:10.5px;">(${escapeHtml(t.artist)})</span>
                </button>
                ${
                  customIds.has(t.id)
                    ? `<button class="agy-inapp-btn" data-remove-track-id="${escapeHtml(t.id)}" title="Xóa bài nhạc" style="padding:0 10px;">✕</button>`
                    : ''
                }
              </div>
            `
              )
              .join('')}
          </div>
          <button class="agy-inapp-btn" id="inapp-pick-audio" style="width:100%;margin-top:10px;">
            + Thêm file nhạc MP3 / WAV / OGG từ máy tính
          </button>
        </div>
        <div class="agy-inapp-card">
          <h4>Âm Thanh Bàn Phím Cơ Học Khi Gõ Chat</h4>
          <div class="agy-inapp-row">
            <span>Kiểu Switch âm thanh</span>
            <select id="inapp-typing-sound" style="background:#0b0d13;color:#f1f5f9;padding:5px 8px;border-radius:7px;border:1px solid rgba(255,255,255,0.14);font-size:11.5px;outline:none;">
              <option value="holy-panda" ${currentConfig.soundEffects.typingSound === 'holy-panda' ? 'selected' : ''}>Holy Panda (Thocky êm)</option>
              <option value="mx-blue" ${currentConfig.soundEffects.typingSound === 'mx-blue' ? 'selected' : ''}>Cherry MX Blue (Clicky)</option>
              <option value="typewriter" ${currentConfig.soundEffects.typingSound === 'typewriter' ? 'selected' : ''}>Máy đánh chữ cổ điển</option>
              <option value="scifi-bubble" ${currentConfig.soundEffects.typingSound === 'scifi-bubble' ? 'selected' : ''}>Sci-Fi Bubble</option>
              <option value="off" ${currentConfig.soundEffects.typingSound === 'off' ? 'selected' : ''}>Tắt âm bàn phím</option>
            </select>
          </div>
          <div class="agy-inapp-row">
            <span>Âm lượng gõ phím (<span id="inapp-sfx-vol-val">${Math.round(Number(currentConfig.soundEffects.typingVolume ?? 0.35) * 100)}</span>%)</span>
            <input type="range" id="inapp-sfx-vol" min="0.05" max="1" step="0.05" value="${escapeHtml(Number(currentConfig.soundEffects.typingVolume ?? 0.35))}" />
          </div>
          <div class="agy-inapp-row">
            <span>Âm báo khi nhấn Enter gửi tin nhắn</span>
            <input type="checkbox" id="inapp-sfx-send" ${currentConfig.soundEffects.sendSound ? 'checked' : ''} />
          </div>
        </div>
      `;

      container.querySelector('#inapp-music-enable')?.addEventListener('change', (e) => {
        currentConfig.music.enabled = e.target.checked;
        applyAllCurrentConfig();
      });
      container.querySelector('#inapp-music-autoplay')?.addEventListener('change', (e) => {
        currentConfig.music.autoplay = e.target.checked;
      });
      container.querySelector('#inapp-music-loop')?.addEventListener('change', (e) => {
        currentConfig.music.loop = e.target.checked;
        applyAllCurrentConfig();
      });
      container.querySelector('#inapp-music-mini')?.addEventListener('change', (e) => {
        currentConfig.music.showMiniPlayer = e.target.checked;
        applyAllCurrentConfig();
      });
      container.querySelector('#inapp-music-vol')?.addEventListener('input', (e) => {
        const vol = parseFloat(e.target.value);
        musicController.setVolume(vol);
        const lbl = container.querySelector('#inapp-music-vol-val');
        if (lbl) lbl.textContent = String(Math.round(vol * 100));
      });
      container.querySelector('#inapp-m-play')?.addEventListener('click', async () => {
        await musicController.togglePlay();
        renderInAppTabContent();
      });
      container.querySelector('#inapp-m-prev')?.addEventListener('click', async () => {
        await musicController.prevTrack();
        renderInAppTabContent();
      });
      container.querySelector('#inapp-m-next')?.addEventListener('click', async () => {
        await musicController.nextTrack();
        renderInAppTabContent();
      });
      container.querySelectorAll('[data-track-id]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          currentConfig.music.activeTrackId = btn.dataset.trackId;
          currentConfig.music.enabled = true;
          await musicController.loadAndSync(currentConfig, true);
          applyAllCurrentConfig();
          renderInAppTabContent();
        });
      });
      container.querySelectorAll('[data-remove-track-id]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const removeId = btn.dataset.removeTrackId;
          currentConfig.music.customTracks = (currentConfig.music.customTracks || []).filter((t) => t.id !== removeId);
          if (currentConfig.music.activeTrackId === removeId) {
            currentConfig.music.activeTrackId = PRESETS_DATA.DEFAULT_CONFIG?.music?.activeTrackId || 'lofi-chill-nights.wav';
          }
          applyAllCurrentConfig();
          renderInAppTabContent();
        });
      });
      container.querySelector('#inapp-pick-audio')?.addEventListener('click', async () => {
        if (!bridge || !bridge.pickFile) return;
        const res = await bridge.pickFile('audio');
        if (res && res.ok) {
          const id = 'custom-' + Date.now();
          if (!Array.isArray(currentConfig.music.customTracks)) {
            currentConfig.music.customTracks = [];
          }
          currentConfig.music.customTracks.push({
            id,
            name: res.fileName,
            filePath: res.filePath,
            mime: res.mime
          });
          currentConfig.music.activeTrackId = id;
          currentConfig.music.enabled = true;
          await musicController.loadAndSync(currentConfig, true);
          applyAllCurrentConfig();
          renderInAppTabContent();
        }
      });
      container.querySelector('#inapp-typing-sound')?.addEventListener('change', (e) => {
        currentConfig.soundEffects.typingSound = e.target.value;
        playKeySound(currentConfig.soundEffects.typingSound, currentConfig.soundEffects.typingVolume);
      });
      container.querySelector('#inapp-sfx-vol')?.addEventListener('input', (e) => {
        currentConfig.soundEffects.typingVolume = parseFloat(e.target.value);
        const lbl = container.querySelector('#inapp-sfx-vol-val');
        if (lbl) lbl.textContent = String(Math.round(currentConfig.soundEffects.typingVolume * 100));
        playKeySound(currentConfig.soundEffects.typingSound, currentConfig.soundEffects.typingVolume);
      });
      container.querySelector('#inapp-sfx-send')?.addEventListener('change', (e) => {
        currentConfig.soundEffects.sendSound = e.target.checked;
        if (e.target.checked) playSendChime(currentConfig.soundEffects.typingVolume);
      });
    } else if (activeInAppTab === 'effects') {
      const widthSpec = resolveChatWidthSpec(currentConfig.layout || {});
      const promptSpec = resolvePromptWidthSpec(currentConfig.layout || {});
      const getWidthHintHtml = (spec) =>
        spec.mode === 'auto'
          ? 'Đang nhường quyền chỉnh khung chat cho <b>Settings → Appearance → Chat Layout</b> gốc của AGY.'
          : `Đang chỉnh khung chat ở mức <b>${escapeHtml(spec.label)}</b>. Chọn <b>Theo AGY</b> nếu muốn dùng lại nút chỉnh trong Settings gốc của AGY.`;
      const getPromptWidthHintHtml = (pSpec, isDocked) =>
        isDocked
          ? 'Đang bật <b>Trải rộng sát đáy (Docked)</b> nên khung nhập lệnh giãn 100%. Chọn mức gọn hơn để tự chuyển sang Đảo nổi.'
          : pSpec.mode === 'match-chat'
            ? 'Khung nhập lệnh đang theo độ rộng khung Chat ở trên.'
            : `Khung nhập lệnh đang giữ gọn ở mức <b>${escapeHtml(pSpec.label)}</b> (tin nhắn ở trên vẫn giữ nguyên độ rộng).`;

      const selectStyle = 'background:#0b0d13;color:#f1f5f9;padding:5px 8px;border-radius:7px;border:1px solid rgba(255,255,255,0.14);font-size:11.5px;outline:none;';

      container.innerHTML = `
        <div class="agy-inapp-card">
          <h4>Khung Chat &amp; Bố Cục (Chat Layout)</h4>
          <div style="font-size:11px;color:#8b95a7;margin-bottom:8px;">
            Độ rộng khung hội thoại (Conversation Width):
          </div>
          <div class="agy-inapp-seg-group" id="inapp-chat-width-group">
            <button class="agy-inapp-seg-btn ${widthSpec.mode === 'auto' ? 'active' : ''}" data-chat-width="auto">
              Theo AGY<span class="agy-inapp-seg-sub">Mặc định app</span>
            </button>
            <button class="agy-inapp-seg-btn ${widthSpec.mode === 'narrow' ? 'active' : ''}" data-chat-width="narrow">
              Narrow<span class="agy-inapp-seg-sub">640px</span>
            </button>
            <button class="agy-inapp-seg-btn ${widthSpec.mode === 'default' ? 'active' : ''}" data-chat-width="default">
              Default<span class="agy-inapp-seg-sub">780px</span>
            </button>
            <button class="agy-inapp-seg-btn ${widthSpec.mode === 'wide' ? 'active' : ''}" data-chat-width="wide">
              Wide<span class="agy-inapp-seg-sub">1180px</span>
            </button>
            <button class="agy-inapp-seg-btn ${widthSpec.mode === 'fill' ? 'active' : ''}" data-chat-width="fill">
              Fill<span class="agy-inapp-seg-sub">98%</span>
            </button>
            <button class="agy-inapp-seg-btn ${widthSpec.mode === 'custom' ? 'active' : ''}" data-chat-width="custom">
              Custom<span class="agy-inapp-seg-sub" id="inapp-custom-width-chip">${widthSpec.customPx}px</span>
            </button>
          </div>
          <div class="agy-inapp-row">
            <span>Kéo độ rộng tùy chỉnh (<span id="inapp-layout-custom-width-val">${widthSpec.customPx}</span>px)</span>
            <input type="range" id="inapp-layout-custom-width" min="520" max="1600" step="10" value="${widthSpec.customPx}" />
          </div>
          <div class="agy-inapp-hint" id="inapp-layout-width-hint">${getWidthHintHtml(widthSpec)}</div>
          <div class="agy-inapp-row">
            <span>Kiểu khung nhập lệnh (Prompt)</span>
            <select id="inapp-layout-prompt" style="${selectStyle}">
              <option value="floating-island" ${currentConfig.layout.promptStyle !== 'docked' ? 'selected' : ''}>Đảo nổi (Floating Island)</option>
              <option value="docked" ${currentConfig.layout.promptStyle === 'docked' ? 'selected' : ''}>Trải rộng sát đáy (Docked)</option>
            </select>
          </div>
          <div class="agy-inapp-row">
            <span>Độ rộng khung nhập lệnh</span>
            <select id="inapp-layout-prompt-width" style="${selectStyle}">
              <option value="match-chat" ${promptSpec.mode === 'match-chat' ? 'selected' : ''}>Theo khung Chat</option>
              <option value="narrow" ${promptSpec.mode === 'narrow' ? 'selected' : ''}>Nhỏ gọn (640px)</option>
              <option value="compact" ${promptSpec.mode === 'compact' ? 'selected' : ''}>Cân đối (760px)</option>
              <option value="medium" ${promptSpec.mode === 'medium' ? 'selected' : ''}>Vừa (880px)</option>
              <option value="custom" ${promptSpec.mode === 'custom' ? 'selected' : ''}>Tùy chỉnh theo px</option>
            </select>
          </div>
          <div class="agy-inapp-row">
            <span>Kéo độ rộng khung nhập (<span id="inapp-layout-prompt-width-val">${promptSpec.customPx}</span>px)</span>
            <input type="range" id="inapp-layout-prompt-custom-width" min="460" max="1400" step="10" value="${promptSpec.customPx}" />
          </div>
          <div class="agy-inapp-hint" id="inapp-layout-prompt-hint">${getPromptWidthHintHtml(promptSpec, currentConfig.layout.promptStyle === 'docked')}</div>
          <div class="agy-inapp-row">
            <span>Kiểu khung tin nhắn (Message Style)</span>
            <select id="inapp-layout-msg-style" style="${selectStyle}">
              <option value="glass-cards" ${currentConfig.layout.messageStyle === 'glass-cards' ? 'selected' : ''}>Thẻ kính bo góc (Glass Cards)</option>
              <option value="chat-bubbles" ${currentConfig.layout.messageStyle === 'chat-bubbles' ? 'selected' : ''}>Bong bóng Chat (Chat Bubbles)</option>
              <option value="minimal" ${currentConfig.layout.messageStyle === 'minimal' ? 'selected' : ''}>Tối giản trong suốt (Minimal)</option>
            </select>
          </div>
          <div class="agy-inapp-row">
            <span>Vị trí thanh Sidebar</span>
            <select id="inapp-layout-sidebar" style="${selectStyle}">
              <option value="left" ${currentConfig.layout.sidebarPosition === 'left' ? 'selected' : ''}>Bên Trái (Mặc định)</option>
              <option value="right" ${currentConfig.layout.sidebarPosition === 'right' ? 'selected' : ''}>Đảo sang Bên Phải</option>
              <option value="floating-autohide" ${currentConfig.layout.sidebarPosition === 'floating-autohide' ? 'selected' : ''}>Làm mờ tự động (Auto-Fade)</option>
            </select>
          </div>
          <div class="agy-inapp-row">
            <span>Chế độ tập trung Zen Mode (Ẩn Sidebar)</span>
            <input type="checkbox" id="inapp-layout-zen" ${currentConfig.layout.zenMode ? 'checked' : ''} />
          </div>
          <div class="agy-inapp-row">
            <span>Hiện nút AGY Studio trên thanh tiêu đề (cạnh Open IDE)</span>
            <input type="checkbox" id="inapp-layout-btn" ${currentConfig.layout.showInAppButton !== false ? 'checked' : ''} />
          </div>
        </div>
        <div class="agy-inapp-card">
          <h4>Hiệu Ứng Hạt &amp; Con Trỏ Chuột</h4>
          <div class="agy-inapp-row">
            <span>Hiệu ứng hạt môi trường</span>
            <select id="inapp-fx-particles" style="${selectStyle}">
              <option value="fireflies" ${currentConfig.effects.particles === 'fireflies' ? 'selected' : ''}>Đom đóm dịu (Fireflies)</option>
              <option value="starfield" ${currentConfig.effects.particles === 'starfield' ? 'selected' : ''}>Sao băng thiên hà (Starfield)</option>
              <option value="sakura" ${currentConfig.effects.particles === 'sakura' ? 'selected' : ''}>Hoa anh đào rơi (Sakura)</option>
              <option value="snowfall" ${currentConfig.effects.particles === 'snowfall' ? 'selected' : ''}>Tuyết rơi mùa đông (Snowfall)</option>
              <option value="constellation" ${currentConfig.effects.particles === 'constellation' ? 'selected' : ''}>Mạng tinh vân (Constellation)</option>
              <option value="matrix" ${currentConfig.effects.particles === 'matrix' ? 'selected' : ''}>Mưa số Matrix</option>
              <option value="none" ${currentConfig.effects.particles === 'none' ? 'selected' : ''}>Tắt hiệu ứng hạt</option>
            </select>
          </div>
          <div class="agy-inapp-row">
            <span>Mật độ hạt (<span id="inapp-fx-density-val">${escapeHtml(currentConfig.effects.particleDensity ?? 35)}</span> hạt)</span>
            <input type="range" id="inapp-fx-density" min="15" max="120" step="5" value="${escapeHtml(currentConfig.effects.particleDensity ?? 35)}" />
          </div>
          <div class="agy-inapp-row">
            <span>Tốc độ hạt (<span id="inapp-fx-speed-val">${escapeHtml(currentConfig.effects.particleSpeed ?? 0.8)}</span>x)</span>
            <input type="range" id="inapp-fx-speed" min="0.3" max="2.5" step="0.1" value="${escapeHtml(currentConfig.effects.particleSpeed ?? 0.8)}" />
          </div>
          <div class="agy-inapp-row">
            <span>Hiệu ứng chuột</span>
            <select id="inapp-fx-cursor" style="${selectStyle}">
              <option value="neon-trail" ${currentConfig.effects.cursorEffect === 'neon-trail' ? 'selected' : ''}>Vệt sao chổi (Trail)</option>
              <option value="click-ripple" ${currentConfig.effects.cursorEffect === 'click-ripple' ? 'selected' : ''}>Gợn sóng khi Click</option>
              <option value="spotlight" ${currentConfig.effects.cursorEffect === 'spotlight' ? 'selected' : ''}>Đèn chiếu Spotlight</option>
              <option value="none" ${currentConfig.effects.cursorEffect === 'none' ? 'selected' : ''}>Tắt hiệu ứng chuột</option>
            </select>
          </div>
          <div class="agy-inapp-row">
            <span>Viền nhấn ánh sáng quanh ô nhập Chat</span>
            <input type="checkbox" id="inapp-fx-prompt-glow" ${currentConfig.effects.promptNeonGlow ? 'checked' : ''} />
          </div>
          <div class="agy-inapp-row">
            <span>Hiệu ứng trượt mượt khi có tin nhắn mới</span>
            <input type="checkbox" id="inapp-fx-msg-slide" ${currentConfig.effects.messageSlideAnimation ? 'checked' : ''} />
          </div>
          <div class="agy-inapp-row">
            <span>Lớp phủ dòng quét CRT Retro (Scanlines)</span>
            <input type="checkbox" id="inapp-fx-crt" ${currentConfig.effects.crtScanlines ? 'checked' : ''} />
          </div>
          <div class="agy-inapp-row">
            <span>Smart Eco Mode (Tự nghỉ khi ẩn cửa sổ)</span>
            <input type="checkbox" id="inapp-fx-eco" ${currentConfig.effects.smartEcoMode ? 'checked' : ''} />
          </div>
        </div>
        <div class="agy-inapp-card">
          <h4>Font Chữ &amp; CSS Tùy Chỉnh</h4>
          <div class="agy-inapp-row">
            <span>Tỷ lệ cỡ chữ (<span id="inapp-typo-scale-val">${escapeHtml(currentConfig.typography?.fontScale ?? 100)}</span>%)</span>
            <input type="range" id="inapp-typo-scale" min="85" max="125" step="5" value="${escapeHtml(currentConfig.typography?.fontScale ?? 100)}" />
          </div>
          <div style="margin-top:8px;">
            <div style="font-size:11px;color:#8b95a7;margin-bottom:4px;">Custom CSS:</div>
            <textarea id="inapp-custom-css" placeholder="/* CSS tùy chỉnh */" style="width:100%;min-height:64px;background:#0b0d13;color:#e2e8f0;border:1px solid rgba(255,255,255,0.14);border-radius:7px;padding:8px;font-family:Consolas,monospace;font-size:11.5px;resize:vertical;outline:none;">${escapeHtml(currentConfig.customCss || '')}</textarea>
          </div>
        </div>
      `;

      const syncWidthUi = () => {
        const nextSpec = resolveChatWidthSpec(currentConfig.layout || {});
        container.querySelectorAll('[data-chat-width]').forEach((b) => {
          b.classList.toggle('active', b.dataset.chatWidth === nextSpec.mode);
        });
        const valLbl = container.querySelector('#inapp-layout-custom-width-val');
        if (valLbl) valLbl.textContent = String(nextSpec.customPx);
        const chipLbl = container.querySelector('#inapp-custom-width-chip');
        if (chipLbl) chipLbl.textContent = `${nextSpec.customPx}px`;
        const hintEl = container.querySelector('#inapp-layout-width-hint');
        if (hintEl) hintEl.innerHTML = getWidthHintHtml(nextSpec);
      };

      const syncPromptWidthUi = () => {
        const nextPSpec = resolvePromptWidthSpec(currentConfig.layout || {});
        const isDocked = currentConfig.layout.promptStyle === 'docked';
        const styleSel = container.querySelector('#inapp-layout-prompt');
        if (styleSel) styleSel.value = isDocked ? 'docked' : 'floating-island';
        const widthSel = container.querySelector('#inapp-layout-prompt-width');
        if (widthSel) widthSel.value = nextPSpec.mode;
        const pValLbl = container.querySelector('#inapp-layout-prompt-width-val');
        if (pValLbl) pValLbl.textContent = String(nextPSpec.customPx);
        const pHintEl = container.querySelector('#inapp-layout-prompt-hint');
        if (pHintEl) pHintEl.innerHTML = getPromptWidthHintHtml(nextPSpec, isDocked);
      };

      container.querySelectorAll('[data-chat-width]').forEach((btn) => {
        btn.addEventListener('click', () => {
          currentConfig.layout.chatWidth = btn.dataset.chatWidth;
          applyAllCurrentConfig();
          syncWidthUi();
        });
      });
      container.querySelector('#inapp-layout-custom-width')?.addEventListener('input', (e) => {
        currentConfig.layout.chatCustomWidth = parseInt(e.target.value, 10);
        currentConfig.layout.chatWidth = 'custom';
        applyAllCurrentConfig();
        syncWidthUi();
      });
      container.querySelector('#inapp-layout-prompt')?.addEventListener('change', (e) => {
        currentConfig.layout.promptStyle = e.target.value;
        applyAllCurrentConfig();
        syncPromptWidthUi();
      });
      container.querySelector('#inapp-layout-prompt-width')?.addEventListener('change', (e) => {
        currentConfig.layout.promptWidth = e.target.value;
        if (e.target.value !== 'match-chat' && currentConfig.layout.promptStyle === 'docked') {
          currentConfig.layout.promptStyle = 'floating-island';
        }
        applyAllCurrentConfig();
        syncPromptWidthUi();
      });
      container.querySelector('#inapp-layout-prompt-custom-width')?.addEventListener('input', (e) => {
        currentConfig.layout.promptCustomWidth = parseInt(e.target.value, 10);
        currentConfig.layout.promptWidth = 'custom';
        currentConfig.layout.promptStyle = 'floating-island';
        applyAllCurrentConfig();
        syncPromptWidthUi();
      });
      container.querySelector('#inapp-fx-particles')?.addEventListener('change', (e) => {
        currentConfig.effects.particles = e.target.value;
        applyAllCurrentConfig();
      });
      container.querySelector('#inapp-fx-density')?.addEventListener('input', (e) => {
        currentConfig.effects.particleDensity = parseInt(e.target.value, 10);
        const lbl = container.querySelector('#inapp-fx-density-val');
        if (lbl) lbl.textContent = String(currentConfig.effects.particleDensity);
        applyAllCurrentConfig();
      });
      container.querySelector('#inapp-fx-speed')?.addEventListener('input', (e) => {
        currentConfig.effects.particleSpeed = parseFloat(e.target.value);
        const lbl = container.querySelector('#inapp-fx-speed-val');
        if (lbl) lbl.textContent = String(currentConfig.effects.particleSpeed);
        applyAllCurrentConfig();
      });
      container.querySelector('#inapp-fx-cursor')?.addEventListener('change', (e) => {
        currentConfig.effects.cursorEffect = e.target.value;
        applyAllCurrentConfig();
      });
      container.querySelector('#inapp-fx-prompt-glow')?.addEventListener('change', (e) => {
        currentConfig.effects.promptNeonGlow = e.target.checked;
        applyAllCurrentConfig();
      });
      container.querySelector('#inapp-fx-msg-slide')?.addEventListener('change', (e) => {
        currentConfig.effects.messageSlideAnimation = e.target.checked;
        applyAllCurrentConfig();
      });
      container.querySelector('#inapp-fx-crt')?.addEventListener('change', (e) => {
        currentConfig.effects.crtScanlines = e.target.checked;
        applyAllCurrentConfig();
      });
      container.querySelector('#inapp-fx-eco')?.addEventListener('change', (e) => {
        currentConfig.effects.smartEcoMode = e.target.checked;
        applyAllCurrentConfig();
      });
      container.querySelector('#inapp-layout-msg-style')?.addEventListener('change', (e) => {
        currentConfig.layout.messageStyle = e.target.value;
        applyAllCurrentConfig();
      });
      container.querySelector('#inapp-layout-sidebar')?.addEventListener('change', (e) => {
        currentConfig.layout.sidebarPosition = e.target.value;
        applyAllCurrentConfig();
      });
      container.querySelector('#inapp-layout-zen')?.addEventListener('change', (e) => {
        currentConfig.layout.zenMode = e.target.checked;
        applyAllCurrentConfig();
      });
      container.querySelector('#inapp-layout-btn')?.addEventListener('change', (e) => {
        currentConfig.layout.showInAppButton = e.target.checked;
        applyAllCurrentConfig();
      });
      container.querySelector('#inapp-typo-scale')?.addEventListener('input', (e) => {
        if (!currentConfig.typography) currentConfig.typography = {};
        currentConfig.typography.fontScale = parseInt(e.target.value, 10);
        const lbl = container.querySelector('#inapp-typo-scale-val');
        if (lbl) lbl.textContent = String(currentConfig.typography.fontScale);
        applyAllCurrentConfig();
      });
      container.querySelector('#inapp-custom-css')?.addEventListener('input', (e) => {
        currentConfig.customCss = e.target.value;
        applyAllCurrentConfig();
      });
    }
  }

  function getDrawerSafeTopPx() {
    let topPx = 0;
    try {
      const menuBar = document.querySelector('[data-testid="title-menu-bar"]');
      if (menuBar && isVisibleElement(menuBar)) {
        const rect = menuBar.getBoundingClientRect();
        if (rect.height > 0 && rect.bottom > topPx && rect.bottom <= 80) {
          topPx = Math.ceil(rect.bottom);
        }
      }
      if (navigator.windowControlsOverlay && navigator.windowControlsOverlay.visible) {
        const wcoRect = navigator.windowControlsOverlay.getTitlebarAreaRect();
        if (wcoRect && wcoRect.bottom > topPx) {
          topPx = Math.ceil(wcoRect.bottom);
        }
      }
      if (topPx === 0 && !document.fullscreenElement && /Win/i.test(navigator.platform || '')) {
        topPx = 36;
      }
    } catch (_) {
      topPx = 36;
    }
    return topPx;
  }

  function syncDrawerSafeTop() {
    drawerBackdrop.style.setProperty('--agy-drawer-top', `${getDrawerSafeTopPx()}px`);
  }

  function openInAppDrawer() {
    syncDrawerSafeTop();
    drawerBackdrop.classList.add('open');
    renderInAppTabContent();
  }

  function closeInAppDrawer() {
    drawerBackdrop.classList.remove('open');
  }

  window.addEventListener('resize', () => {
    if (drawerBackdrop.classList.contains('open')) {
      syncDrawerSafeTop();
    }
  });

  floatingBtn.addEventListener('click', openInAppDrawer);

  drawerBackdrop.querySelector('.agy-inapp-close').addEventListener('click', closeInAppDrawer);

  drawerBackdrop.addEventListener('click', (e) => {
    if (e.target === drawerBackdrop) closeInAppDrawer();
  });

  drawerBackdrop.querySelectorAll('.agy-inapp-tab').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      drawerBackdrop.querySelectorAll('.agy-inapp-tab').forEach((b) => b.classList.remove('active'));
      tabBtn.classList.add('active');
      activeInAppTab = tabBtn.dataset.tab;
      renderInAppTabContent();
    });
  });

  drawerBackdrop.querySelector('#agy-inapp-master-toggle').addEventListener('change', (e) => {
    currentConfig.enabled = e.target.checked;
    applyAllCurrentConfig();
  });

  let lastConfigJson = JSON.stringify(currentConfig);

  drawerBackdrop.querySelector('#agy-inapp-save-btn').addEventListener('click', async () => {
    const saveBtn = drawerBackdrop.querySelector('#agy-inapp-save-btn');
    if (bridge && typeof bridge.saveConfig === 'function') {
      await bridge.saveConfig(currentConfig);
      lastConfigJson = JSON.stringify(currentConfig);
      saveBtn.textContent = '✓ Đã lưu vĩnh viễn';
      setTimeout(() => {
        saveBtn.textContent = 'Lưu Vĩnh Viễn';
      }, 1800);
    }
  });

  // Global Hotkey: Ctrl + Shift + Y to toggle In-App Customizer Drawer, Esc to close
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawerBackdrop.classList.contains('open')) {
      e.preventDefault();
      closeInAppDrawer();
      return;
    }
    if (e.ctrlKey && e.shiftKey && (e.key === 'Y' || e.key === 'y')) {
      e.preventDefault();
      if (drawerBackdrop.classList.contains('open')) {
        closeInAppDrawer();
      } else {
        openInAppDrawer();
      }
      return;
    }

    // Typing Sound FX
    if (currentConfig.enabled && currentConfig.soundEffects?.typingSound !== 'off') {
      const tag = (e.target && e.target.tagName ? e.target.tagName : '').toLowerCase();
      const isEditable = tag === 'textarea' || tag === 'input' || e.target?.isContentEditable;
      if (isEditable && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (e.key === 'Enter' && !e.shiftKey && currentConfig.soundEffects?.sendSound) {
          playSendChime(currentConfig.soundEffects.typingVolume);
        } else if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Enter') {
          playKeySound(
            currentConfig.soundEffects.typingSound,
            currentConfig.soundEffects.typingVolume,
            e.key === 'Enter'
          );
        }
      }
    }
  });

  function normalizeHex6(color, fallback = '#0e071c') {
    const str = String(color || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(str)) return str;
    if (/^#[0-9a-f]{3}$/i.test(str)) {
      return `#${str[1]}${str[1]}${str[2]}${str[2]}${str[3]}${str[3]}`;
    }
    return fallback;
  }

  let lastTitleBarOverlayKey = '';

  function syncNativeWindowChrome(cfg, force = false) {
    try {
      if (window.electronNative && typeof window.electronNative.setTitleBarOverlay === 'function') {
        const nextOpts =
          cfg && cfg.enabled
            ? {
                color: normalizeHex6((cfg.colors || {}).sidebar || (cfg.colors || {}).background, '#0e071c'),
                symbolColor: normalizeHex6((cfg.colors || {}).foreground, '#f8fafc')
              }
            : {
                color: '#111114',
                symbolColor: '#ffffff'
              };
        const nextKey = `${nextOpts.color}|${nextOpts.symbolColor}`;
        if (!force && nextKey === lastTitleBarOverlayKey) {
          return;
        }
        lastTitleBarOverlayKey = nextKey;
        window.electronNative.setTitleBarOverlay(nextOpts);
      }
    } catch (_) {}
  }

  function parseLengthPx(raw) {
    if (!raw || raw === 'none' || raw === 'auto') return 0;
    const str = String(raw).trim();
    if (str.endsWith('%')) return 0;
    if (str.endsWith('rem')) return parseFloat(str) * 16;
    if (str.endsWith('ch')) return parseFloat(str) * 8;
    const num = parseFloat(str);
    return Number.isFinite(num) ? num : 0;
  }

  let checkedChatNodes = new WeakSet();

  function syncChatFrameTargets(cfg, forceReset = true) {
    const spec = resolveChatWidthSpec(cfg?.layout || {});
    const promptSpec = resolvePromptWidthSpec(cfg?.layout || {});
    const isEnabled = Boolean(cfg?.enabled);
    const shouldOverride = Boolean(isEnabled && spec.cssMaxWidth);
    const isDockedPrompt = cfg?.layout?.promptStyle === 'docked';
    const excludeComposerFromChatWidth = isDockedPrompt || Boolean(promptSpec.cssMaxWidth);

    if (forceReset) {
      checkedChatNodes = new WeakSet();
      document.querySelectorAll('[data-agy-composer-wrap], [data-agy-composer-outer]').forEach((el) => {
        el.removeAttribute('data-agy-composer-wrap');
        el.removeAttribute('data-agy-composer-outer');
        el.style.removeProperty('--agy-dock-pad-l');
        el.style.removeProperty('--agy-dock-pad-r');
        el.style.removeProperty('--agy-dock-pad-b');
      });
    }

    if (!isEnabled) {
      document.querySelectorAll('[data-agy-chat-frame]').forEach((el) => {
        el.removeAttribute('data-agy-chat-frame');
      });
      return;
    }

    const rootSelector = '[data-main-content-body], [data-tiling-pane], [data-side-panel-body], main';
    const paneSelector = '[data-main-content-body], [data-tiling-pane], [data-side-panel-body]';
    const ignoreClosest =
      '[role="dialog"], .agy-dialog, [role="menu"], [role="listbox"], [role="tooltip"], [data-select-popup], .agy-inapp-drawer-backdrop, .agy-mini-music-widget';
    const skipContainerClosest =
      `${ignoreClosest}, [data-main-content-header], [data-testid="pane-titlebar-toolbar"], [data-testid="title-menu-bar"], [role="navigation"], aside, nav, [data-sidebar]`;

    // 1. Tag dedicated Prompt Composer wrappers (for both Floating Island width sync & Docked full-width mode)
    document.querySelectorAll('.surface-composer, #antigravity\\.agentSidePanelInputBox').forEach((composer) => {
      if (composer.closest(ignoreClosest)) return;
      if (!forceReset && composer.parentElement?.getAttribute('data-agy-composer-wrap') === 'true') {
        return;
      }
      const root = composer.closest(paneSelector) || composer.closest(rootSelector);
      if (!root || root.closest(ignoreClosest)) return;

      let cur = composer.parentElement;
      let depth = 0;
      let outerWrap = null;
      while (cur && cur !== root && depth < 5) {
        if (cur.closest(ignoreClosest)) break;
        const hasOtherContent =
          Boolean(cur.querySelector('article, [data-message-role], .agy-user-bubble, .agy-home')) ||
          (depth > 0 && cur.scrollHeight > composer.offsetHeight + 180);
        if (hasOtherContent) break;
        cur.setAttribute('data-agy-composer-wrap', 'true');
        outerWrap = cur;
        cur = cur.parentElement;
        depth += 1;
      }

      if (isDockedPrompt && outerWrap) {
        outerWrap.setAttribute('data-agy-composer-outer', 'true');
        let padL = 0;
        let padR = 0;
        let padB = 0;
        let anc = outerWrap.parentElement;
        while (anc) {
          try {
            const cs = window.getComputedStyle(anc);
            padL += parseFloat(cs.paddingLeft) || 0;
            padR += parseFloat(cs.paddingRight) || 0;
            padB += parseFloat(cs.paddingBottom) || 0;
          } catch (_) {}
          if (anc === root) break;
          anc = anc.parentElement;
        }
        outerWrap.style.setProperty('--agy-dock-pad-l', `${Math.round(padL)}px`);
        outerWrap.style.setProperty('--agy-dock-pad-r', `${Math.round(padR)}px`);
        outerWrap.style.setProperty('--agy-dock-pad-b', `${Math.round(padB)}px`);
      }
    });

    if (!shouldOverride) {
      document.querySelectorAll('[data-agy-chat-frame]').forEach((el) => {
        el.removeAttribute('data-agy-chat-frame');
      });
      return;
    }

    if (excludeComposerFromChatWidth) {
      document.querySelectorAll('[data-agy-composer-wrap="true"][data-agy-chat-frame]').forEach((el) => {
        el.removeAttribute('data-agy-chat-frame');
      });
    }

    // 2. Tag Chat Content Frames (and Composer wrappers only when matching chat width)
    const roots = document.querySelectorAll(rootSelector);
    const skipTags = new Set(['BUTTON', 'A', 'SPAN', 'IMG', 'SVG', 'INPUT', 'TEXTAREA', 'SELECT', 'LABEL']);

    roots.forEach((root) => {
      if (root.closest(ignoreClosest)) return;
      const candidates = root.querySelectorAll('div, section, article, form');
      candidates.forEach((el) => {
        if (!forceReset && checkedChatNodes.has(el)) return;
        checkedChatNodes.add(el);
        if (skipTags.has(el.tagName)) return;
        if (el.closest(skipContainerClosest)) return;

        const isComposerWrap = el.getAttribute('data-agy-composer-wrap') === 'true';
        if (isComposerWrap && excludeComposerFromChatWidth) {
          el.removeAttribute('data-agy-chat-frame');
          return;
        }
        if (el.getAttribute('data-agy-chat-frame') === 'true') return;
        if (el.matches('article, [data-message-role], .agy-user-bubble, .agy-card, .artifact-card')) return;

        const inlineMaxW = el.style && el.style.maxWidth ? el.style.maxWidth : '';
        let matches = isComposerWrap || parseLengthPx(inlineMaxW) >= 440;
        if (!matches) {
          try {
            const compMaxW = parseLengthPx(window.getComputedStyle(el).maxWidth);
            if (compMaxW >= 440 && compMaxW <= 2400) {
              matches = true;
            }
          } catch (_) {}
        }

        if (matches) {
          el.setAttribute('data-agy-chat-frame', 'true');
        }
      });
    });
  }

  function applyAllCurrentConfig() {
    styleEl.textContent = buildDynamicStylesheet(currentConfig);
    // Keep our style tag at the very end of <head> so it always wins specificity/order ties
    if (document.head && styleEl.parentNode === document.head && document.head.lastElementChild !== uiStyleEl) {
      document.head.appendChild(styleEl);
      document.head.appendChild(uiStyleEl);
    }
    syncNativeWindowChrome(currentConfig);
    syncChatFrameTargets(currentConfig, true);
    mountStudioButtonInHeader();
    syncStudioButtonDisplay();
    miniMusicEl.style.display =
      currentConfig.enabled && currentConfig.music?.enabled && currentConfig.music?.showMiniPlayer !== false
        ? 'flex'
        : 'none';
    void visualEngine.syncConfig(currentConfig);
    visualEngine.syncBrowserHoleMask();
    void musicController.loadAndSync(currentConfig, false);
  }

  // Track active pointer presses passively so DOM observers never mutate the header mid-click
  window.addEventListener(
    'pointerdown',
    () => {
      isPointerPressed = true;
    },
    { capture: true, passive: true }
  );
  const clearPointerPressed = () => {
    isPointerPressed = false;
  };
  window.addEventListener('pointerup', clearPointerPressed, { capture: true, passive: true });
  window.addEventListener('pointercancel', clearPointerPressed, { capture: true, passive: true });
  window.addEventListener('blur', clearPointerPressed, { passive: true });

  // Re-sync native titleBarOverlay only when Antigravity's theme attributes change (never on html[style] scroll-locks!),
  // and keep the AGY Studio button anchored next to the 3-dot menu beside Open IDE across React route updates.
  if (typeof MutationObserver !== 'undefined') {
    let syncTimer = null;
    const bootObserver = new MutationObserver(() => {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        if (currentConfig && currentConfig.enabled && !hasActivePopupOrMenu()) {
          syncNativeWindowChrome(currentConfig, true);
          visualEngine.resize();
        }
      }, 220);
    });
    if (document.documentElement) {
      bootObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme']
      });
    }
    if (document.body) {
      bootObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ['data-agy-theme', 'data-newux-theme']
      });
    }

    let mountScheduled = false;
    let lastChatFrameSyncAt = 0;
    let chatFrameTimer = null;
    const scheduleHeaderMount = () => {
      if (mountScheduled || isPointerPressed) return;
      mountScheduled = true;
      const run = () => {
        mountScheduled = false;
        if (isPointerPressed) return;
        mountStudioButtonInHeader();
        visualEngine.syncBrowserHoleMask();
        const now = performance.now();
        if (now - lastChatFrameSyncAt >= 280) {
          lastChatFrameSyncAt = now;
          syncChatFrameTargets(currentConfig, false);
        } else if (!chatFrameTimer) {
          chatFrameTimer = setTimeout(() => {
            chatFrameTimer = null;
            if (isPointerPressed || hasActivePopupOrMenu()) return;
            lastChatFrameSyncAt = performance.now();
            syncChatFrameTargets(currentConfig, false);
          }, 280);
        }
      };
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(run);
      } else {
        setTimeout(run, 16);
      }
    };

    const isPopupOrCustomNode = (node) => {
      if (!node || node.nodeType !== 1) return false;
      if (
        node === floatingBtn ||
        node.classList?.contains('agy-custom-layers-root') ||
        node.matches?.(POPUP_OR_GUARD_SELECTOR) ||
        node.closest?.(`.agy-inapp-drawer-backdrop, .agy-mini-music-widget, .agy-custom-layers-root, ${POPUP_OR_GUARD_SELECTOR}`)
      ) {
        return true;
      }
      return false;
    };

    const headerObserver = new MutationObserver((mutations) => {
      if (isMountingStudioBtn || isPointerPressed) return;
      for (const m of mutations) {
        const target = m.target;
        if (isPopupOrCustomNode(target)) {
          continue;
        }
        // Ignore mutations that only add/remove popups, menus, portals, or focus guards
        const changedNodes = [...(m.addedNodes || []), ...(m.removedNodes || [])];
        if (changedNodes.length > 0 && changedNodes.every((n) => n.nodeType !== 1 || isPopupOrCustomNode(n))) {
          continue;
        }
        scheduleHeaderMount();
        break;
      }
    });
    if (document.body) {
      headerObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (bridge && typeof bridge.onConfigUpdated === 'function') {
    bridge.onConfigUpdated((updatedCfg) => {
      if (updatedCfg) {
        currentConfig = deepMerge(PRESETS_DATA.DEFAULT_CONFIG, updatedCfg);
        lastConfigJson = JSON.stringify(currentConfig);
        applyAllCurrentConfig();
      }
    });
  }

  // Live-sync config from disk whenever Antigravity is visible or regains focus/pointer
  // (so clicking Apply in standalone AGY UI Studio updates the running AGY App automatically within ~1s)
  if (bridge && typeof bridge.getBundle === 'function') {
    let syncingFromDisk = false;
    const syncConfigFromDisk = async () => {
      if (syncingFromDisk) return;
      if (drawerBackdrop && drawerBackdrop.classList.contains('open')) return;
      syncingFromDisk = true;
      try {
        const bundle = await bridge.getBundle();
        if (bundle && bundle.ok && bundle.config) {
          const nextJson = JSON.stringify(bundle.config);
          if (nextJson !== lastConfigJson) {
            lastConfigJson = nextJson;
            currentConfig = deepMerge(PRESETS_DATA.DEFAULT_CONFIG, bundle.config);
            applyAllCurrentConfig();
          }
        }
      } catch (_) {
      } finally {
        syncingFromDisk = false;
      }
    };

    window.addEventListener('focus', () => void syncConfigFromDisk());
    window.addEventListener('mouseenter', () => void syncConfigFromDisk());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void syncConfigFromDisk();
    });
    setInterval(() => {
      if (!document.hidden) void syncConfigFromDisk();
    }, 1200);
  }

  applyAllCurrentConfig();

  // If an external custom wallpaper is active with autoSyncColors enabled and hasn't been synced yet,
  // extract its color palette asynchronously and refresh the UI seamlessly.
  if (
    currentConfig.enabled &&
    currentConfig.wallpaper?.enabled &&
    currentConfig.wallpaper?.sourceType === 'custom-file' &&
    currentConfig.wallpaper?.autoSyncColors !== false &&
    currentConfig.wallpaper?.customFilePath &&
    currentConfig.wallpaper?.syncedForPath !== currentConfig.wallpaper?.customFilePath
  ) {
    void syncConfigColorsFromWallpaper(currentConfig).then((syncRes) => {
      if (syncRes && syncRes.ok) {
        applyAllCurrentConfig();
        if (bridge && typeof bridge.saveConfig === 'function') {
          lastConfigJson = JSON.stringify(currentConfig);
          void bridge.saveConfig(currentConfig);
        }
      }
    });
  }
})();
