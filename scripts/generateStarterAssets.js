/**
 * Generates real, verified Starter Pack media files (WAV music tracks, Animated SVG wallpapers,
 * and application icons .ico / .png) so all Starter Pack assets work 100% offline without
 * any external network dependencies or broken URLs.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT_DIR = path.resolve(__dirname, '..');
const MUSIC_DIR = path.join(ROOT_DIR, 'assets', 'starter-pack', 'music');
const WALLPAPER_DIR = path.join(ROOT_DIR, 'assets', 'starter-pack', 'wallpapers');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');

function ensureDirs() {
  [ASSETS_DIR, MUSIC_DIR, WALLPAPER_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

/**
 * Writes a valid 16-bit Stereo PCM WAV file from left/right Float32 sample arrays (-1..1).
 */
function writeStereoWav(filePath, leftSamples, rightSamples, sampleRate = 22050) {
  const numFrames = leftSamples.length;
  const numChannels = 2;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt subchunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20);  // AudioFormat = 1 (PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);

  // data subchunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    // Seamless loop crossfade at edges (first/last 0.15s)
    let env = 1.0;
    const fadeSamples = Math.floor(sampleRate * 0.15);
    if (i < fadeSamples) env = i / fadeSamples;
    else if (i > numFrames - fadeSamples) env = (numFrames - i) / fadeSamples;

    const l = Math.max(-0.98, Math.min(0.98, leftSamples[i] * env));
    const r = Math.max(-0.98, Math.min(0.98, rightSamples[i] * env));
    buffer.writeInt16LE(Math.round(l * 32767), offset);
    buffer.writeInt16LE(Math.round(r * 32767), offset + 2);
    offset += 4;
  }

  fs.writeFileSync(filePath, buffer);
}

function generateMusicTracks() {
  const sampleRate = 22050;
  const durationSec = 16; // 16-second seamless musical loop per track
  const totalSamples = sampleRate * durationSec;

  // 1. Lo-Fi Chill Study Beats (Warm Rhodes progression: Dm9 -> G13 -> Cmaj9 -> A7alt)
  {
    const L = new Float32Array(totalSamples);
    const R = new Float32Array(totalSamples);
    const chords = [
      [146.83, 220.0, 261.63, 329.63, 440.0], // Dm9
      [196.0, 246.94, 293.66, 349.23, 440.0], // G13
      [130.81, 196.0, 246.94, 293.66, 392.0], // Cmaj9
      [110.0, 207.65, 261.63, 329.63, 415.3], // A7#5#9
    ];
    let vinylState = 0;
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      const bar = Math.floor(t / 4) % 4;
      const barT = t % 4;
      const chord = chords[bar];

      // Rhodes electric piano with tremolo
      const tremoloL = 0.75 + 0.25 * Math.sin(2 * Math.PI * 3.5 * t);
      const tremoloR = 0.75 + 0.25 * Math.cos(2 * Math.PI * 3.5 * t);
      const chordEnv = Math.exp(-barT * 0.65) * (1 - Math.exp(-barT * 35));

      let sum = 0;
      for (let c = 0; c < chord.length; c++) {
        const f = chord[c];
        // Detuned warm sine + 2nd harmonic bell
        sum += Math.sin(2 * Math.PI * f * t) * 0.12;
        sum += Math.sin(2 * Math.PI * (f * 1.002) * t) * 0.08;
        sum += Math.sin(2 * Math.PI * (f * 2) * t) * 0.03 * Math.exp(-barT * 2.5);
      }

      // Sub bass
      const bassFreq = chord[0] * 0.5;
      const beatT = t % 1.0;
      const bassEnv = Math.exp(-beatT * 2.2) * (1 - Math.exp(-beatT * 60));
      const bass = Math.sin(2 * Math.PI * bassFreq * t) * 0.22 * bassEnv;

      // Soft Lo-Fi Kick (beats 0 and 2) & Snare brush (beats 1 and 3)
      const beatIdx = Math.floor(t * 2) % 4;
      const subBeatT = (t * 2) % 1.0;
      let drum = 0;
      if (beatIdx === 0 || beatIdx === 2) {
        const kickFreq = 55 + 90 * Math.exp(-subBeatT * 28);
        drum += Math.sin(2 * Math.PI * kickFreq * subBeatT) * Math.exp(-subBeatT * 9) * 0.25;
      } else {
        const noise = (Math.sin(i * 12.9898) * 43758.5453) % 1;
        drum += noise * Math.exp(-subBeatT * 16) * 0.07;
      }

      // Gentle vinyl warmth crackle
      vinylState = vinylState * 0.92 + (((Math.sin(i * 78.233) * 43758.5453) % 1) - 0.5) * 0.008;

      L[i] = sum * chordEnv * tremoloL + bass + drum + vinylState;
      R[i] = sum * chordEnv * tremoloR + bass + drum - vinylState;
    }
    writeStereoWav(path.join(MUSIC_DIR, 'lofi-chill-nights.wav'), L, R, sampleRate);
  }

  // 2. Cyberpunk 2077 Synthwave (Driving 16th-note arpeggio + neon synth pad)
  {
    const L = new Float32Array(totalSamples);
    const R = new Float32Array(totalSamples);
    const bassRoots = [110.0, 87.31, 130.81, 98.0]; // Am - F - C - G
    const arpOffsets = [1, 1.5, 2, 1.5, 1, 1.5, 2, 2.4];
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      const bar = Math.floor(t / 4) % 4;
      const root = bassRoots[bar];

      // 8th/16th note synthwave arpeggio
      const step = Math.floor(t * 8) % 8;
      const stepT = (t * 8) % 1.0;
      const arpFreq = root * arpOffsets[step];
      const arpEnv = Math.exp(-stepT * 4.5) * (1 - Math.exp(-stepT * 80));

      // Rich saw-like harmonics
      let arp = 0;
      for (let h = 1; h <= 4; h++) {
        arp += (Math.sin(2 * Math.PI * arpFreq * h * t) / h) * 0.14;
      }
      arp *= arpEnv;

      // Stereo detuned atmospheric pad
      const padL =
        Math.sin(2 * Math.PI * (root * 2.003) * t) * 0.09 +
        Math.sin(2 * Math.PI * (root * 3.005) * t) * 0.07;
      const padR =
        Math.sin(2 * Math.PI * (root * 1.997) * t) * 0.09 +
        Math.sin(2 * Math.PI * (root * 2.995) * t) * 0.07;

      // Four-on-the-floor synth punch kick
      const beatT = (t * 2) % 1.0;
      const kick = Math.sin(2 * Math.PI * (50 + 110 * Math.exp(-beatT * 32)) * beatT) * Math.exp(-beatT * 8) * 0.24;

      const pan = Math.sin(2 * Math.PI * 0.5 * t) * 0.3;
      L[i] = arp * (1 - pan) + padL + kick;
      R[i] = arp * (1 + pan) + padR + kick;
    }
    writeStereoWav(path.join(MUSIC_DIR, 'cyberpunk-synthwave.wav'), L, R, sampleRate);
  }

  // 3. Deep Space Cosmic Ambient (Celestial harmonic pads + shimmer)
  {
    const L = new Float32Array(totalSamples);
    const R = new Float32Array(totalSamples);
    const freqs = [130.81, 196.0, 246.94, 293.66, 392.0, 587.33]; // Cmaj9#11 cosmic voicing
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      let sL = 0;
      let sR = 0;
      for (let k = 0; k < freqs.length; k++) {
        const f = freqs[k];
        const lfoL = 0.55 + 0.45 * Math.sin(2 * Math.PI * (0.12 + k * 0.05) * t + k);
        const lfoR = 0.55 + 0.45 * Math.cos(2 * Math.PI * (0.12 + k * 0.05) * t + k * 1.7);
        sL += Math.sin(2 * Math.PI * (f * 1.0015) * t) * 0.095 * lfoL;
        sR += Math.sin(2 * Math.PI * (f * 0.9985) * t) * 0.095 * lfoR;
      }
      // Deep sub pulse
      const sub = Math.sin(2 * Math.PI * 65.41 * t) * (0.12 + 0.05 * Math.sin(2 * Math.PI * 0.25 * t));
      L[i] = sL + sub;
      R[i] = sR + sub;
    }
    writeStereoWav(path.join(MUSIC_DIR, 'deep-space-ambient.wav'), L, R, sampleRate);
  }

  // 4. Rainy Tokyo Night Piano (Pentatonic gentle notes + soothing rain stereo texture)
  {
    const L = new Float32Array(totalSamples);
    const R = new Float32Array(totalSamples);
    const notes = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 392.0, 329.63];
    let rainFilterL = 0;
    let rainFilterR = 0;
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      const noteIdx = Math.floor(t / 2) % notes.length;
      const noteT = t % 2.0;
      const f = notes[noteIdx];
      const env = Math.exp(-noteT * 1.8) * (1 - Math.exp(-noteT * 90));

      const piano =
        (Math.sin(2 * Math.PI * f * t) * 0.18 +
          Math.sin(2 * Math.PI * f * 2 * t) * 0.06 * Math.exp(-noteT * 3) +
          Math.sin(2 * Math.PI * f * 3 * t) * 0.02 * Math.exp(-noteT * 5)) *
        env;

      // Warm low-passed rain soundscape
      const rawL = ((Math.sin(i * 12.9898 + 1.1) * 43758.5453) % 1) - 0.5;
      const rawR = ((Math.sin(i * 78.233 + 2.3) * 43758.5453) % 1) - 0.5;
      rainFilterL = rainFilterL * 0.93 + rawL * 0.018;
      rainFilterR = rainFilterR * 0.93 + rawR * 0.018;

      L[i] = piano * 0.95 + rainFilterL;
      R[i] = piano * 0.95 + rainFilterR;
    }
    writeStereoWav(path.join(MUSIC_DIR, 'zen-rain-piano.wav'), L, R, sampleRate);
  }
}

function generateAnimatedSvgWallpapers() {
  // 1. Cosmic Nebula Animated SVG
  const cosmicSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
  <defs>
    <radialGradient id="bg" cx="50%" cy="50%" r="75%">
      <stop offset="0%" stop-color="#14092b"/>
      <stop offset="50%" stop-color="#090514"/>
      <stop offset="100%" stop-color="#030108"/>
    </radialGradient>
    <radialGradient id="nebula1" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.45"/>
      <stop offset="55%" stop-color="#3b82f6" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="nebula2" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ec4899" stop-opacity="0.38"/>
      <stop offset="60%" stop-color="#6366f1" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#bg)"/>
  <circle cx="650" cy="420" r="550" fill="url(#nebula1)">
    <animate attributeName="cx" values="650;820;650" dur="18s" repeatCount="indefinite"/>
    <animate attributeName="cy" values="420;520;420" dur="14s" repeatCount="indefinite"/>
    <animate attributeName="r" values="550;640;550" dur="12s" repeatCount="indefinite"/>
  </circle>
  <circle cx="1320" cy="640" r="520" fill="url(#nebula2)">
    <animate attributeName="cx" values="1320;1120;1320" dur="20s" repeatCount="indefinite"/>
    <animate attributeName="cy" values="640;460;640" dur="16s" repeatCount="indefinite"/>
  </circle>
  <g stroke="#a855f7" stroke-opacity="0.2" fill="none">
    <ellipse cx="960" cy="540" rx="680" ry="220" transform="rotate(-18 960 540)">
      <animateTransform attributeName="transform" type="rotate" from="0 960 540" to="360 960 540" dur="65s" repeatCount="indefinite"/>
    </ellipse>
    <ellipse cx="960" cy="540" rx="460" ry="150" stroke="#38bdf8" stroke-opacity="0.25">
      <animateTransform attributeName="transform" type="rotate" from="360 960 540" to="0 960 540" dur="45s" repeatCount="indefinite"/>
    </ellipse>
  </g>
</svg>`;
  fs.writeFileSync(path.join(WALLPAPER_DIR, 'cosmic-nebula.svg'), cosmicSvg, 'utf8');

  // 2. Cyberpunk Synthwave Grid Animated SVG
  const cyberSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#070210"/>
      <stop offset="55%" stop-color="#1f093d"/>
      <stop offset="65%" stop-color="#701a75"/>
      <stop offset="100%" stop-color="#090314"/>
    </linearGradient>
    <linearGradient id="sun" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#facc15"/>
      <stop offset="50%" stop-color="#f97316"/>
      <stop offset="100%" stop-color="#ec4899"/>
    </linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#sky)"/>
  <circle cx="960" cy="580" r="210" fill="url(#sun)" opacity="0.88">
    <animate attributeName="r" values="208;218;208" dur="6s" repeatCount="indefinite"/>
  </circle>
  <rect y="640" width="1920" height="440" fill="#080212" opacity="0.92"/>
  <g stroke="#06b6d4" stroke-width="2" stroke-opacity="0.45">
    <line x1="0" y1="640" x2="1920" y2="640" stroke="#f43f5e" stroke-width="3"/>
    <line x1="960" y1="640" x2="-400" y2="1080"/>
    <line x1="960" y1="640" x2="100" y2="1080"/>
    <line x1="960" y1="640" x2="500" y2="1080"/>
    <line x1="960" y1="640" x2="800" y2="1080"/>
    <line x1="960" y1="640" x2="1120" y2="1080"/>
    <line x1="960" y1="640" x2="1420" y2="1080"/>
    <line x1="960" y1="640" x2="1820" y2="1080"/>
    <line x1="960" y1="640" x2="2320" y2="1080"/>
    <line x1="0" y1="690" x2="1920" y2="690">
      <animate attributeName="y1" values="650;1080" dur="4s" repeatCount="indefinite"/>
      <animate attributeName="y2" values="650;1080" dur="4s" repeatCount="indefinite"/>
    </line>
    <line x1="0" y1="780" x2="1920" y2="780">
      <animate attributeName="y1" values="650;1080" dur="4s" begin="1.3s" repeatCount="indefinite"/>
      <animate attributeName="y2" values="650;1080" dur="4s" begin="1.3s" repeatCount="indefinite"/>
    </line>
    <line x1="0" y1="900" x2="1920" y2="900">
      <animate attributeName="y1" values="650;1080" dur="4s" begin="2.6s" repeatCount="indefinite"/>
      <animate attributeName="y2" values="650;1080" dur="4s" begin="2.6s" repeatCount="indefinite"/>
    </line>
  </g>
</svg>`;
  fs.writeFileSync(path.join(WALLPAPER_DIR, 'cyberpunk-grid.svg'), cyberSvg, 'utf8');

  // 3. Aurora Borealis Animated SVG
  const auroraSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="abg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#020617"/>
      <stop offset="60%" stop-color="#082f49"/>
      <stop offset="100%" stop-color="#042f2e"/>
    </linearGradient>
    <linearGradient id="wave1" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#10b981" stop-opacity="0"/>
      <stop offset="50%" stop-color="#34d399" stop-opacity="0.42"/>
      <stop offset="100%" stop-color="#06b6d4" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="wave2" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0"/>
      <stop offset="50%" stop-color="#38bdf8" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#10b981" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#abg)"/>
  <path d="M-200,350 Q480,120 960,360 T2120,300 L2120,750 L-200,750 Z" fill="url(#wave1)">
    <animate attributeName="d" values="M-200,350 Q480,120 960,360 T2120,300 L2120,750 L-200,750 Z;M-200,280 Q480,460 960,240 T2120,380 L2120,750 L-200,750 Z;M-200,350 Q480,120 960,360 T2120,300 L2120,750 L-200,750 Z" dur="14s" repeatCount="indefinite"/>
  </path>
  <path d="M-200,450 Q520,240 1060,440 T2120,360 L2120,850 L-200,850 Z" fill="url(#wave2)">
    <animate attributeName="d" values="M-200,450 Q520,240 1060,440 T2120,360 L2120,850 L-200,850 Z;M-200,360 Q520,540 1060,320 T2120,460 L2120,850 L-200,850 Z;M-200,450 Q520,240 1060,440 T2120,360 L2120,850 L-200,850 Z" dur="18s" repeatCount="indefinite"/>
  </path>
</svg>`;
  fs.writeFileSync(path.join(WALLPAPER_DIR, 'aurora-borealis.svg'), auroraSvg, 'utf8');

  // 4. Sakura Moonlight Animated SVG
  const sakuraSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="sbg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#12071f"/>
      <stop offset="55%" stop-color="#271033"/>
      <stop offset="100%" stop-color="#3b1236"/>
    </linearGradient>
    <radialGradient id="moon" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fff1f2" stop-opacity="0.95"/>
      <stop offset="65%" stop-color="#fda4af" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#fda4af" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#sbg)"/>
  <circle cx="1440" cy="300" r="240" fill="url(#moon)">
    <animate attributeName="r" values="235;255;235" dur="8s" repeatCount="indefinite"/>
  </circle>
  <circle cx="1440" cy="300" r="105" fill="#fff1f2" opacity="0.88"/>
</svg>`;
  fs.writeFileSync(path.join(WALLPAPER_DIR, 'sakura-moonlight.svg'), sakuraSvg, 'utf8');
}

/**
 * Generates a valid PNG image buffer and wraps it inside a standard Windows .ico file
 * so both Electron and the Windows C# .exe compiler have a valid icon.
 */
function generateAppIcons() {
  const width = 64;
  const height = 64;

  // Build raw RGBA scanlines (filter byte 0 per row)
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    rawData[rowStart] = 0; // No filter
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 4;
      const dx = x - 31.5;
      const dy = y - 31.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 30) {
        rawData[px] = 0;
        rawData[px + 1] = 0;
        rawData[px + 2] = 0;
        rawData[px + 3] = 0;
      } else {
        // Glowing purple-cyan gradient orb with an 'A' center emblem
        const isRing = Math.abs(dist - 22) < 2.2;
        const isCenter = dist < 9;
        if (isRing) {
          rawData[px] = 56;
          rawData[px + 1] = 189;
          rawData[px + 2] = 248;
          rawData[px + 3] = 255;
        } else if (isCenter) {
          rawData[px] = 244;
          rawData[px + 1] = 114;
          rawData[px + 2] = 182;
          rawData[px + 3] = 255;
        } else {
          rawData[px] = Math.round(25 + (x / width) * 90);
          rawData[px + 1] = Math.round(15 + (y / height) * 50);
          rawData[px + 2] = Math.round(65 + ((width - x) / width) * 165);
          rawData[px + 3] = 255;
        }
      }
    }
  }

  // Helper to build PNG chunk
  function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) {
      c = (c >>> 8) ^ crcTable[(c ^ buf[i]) & 0xff];
    }
    return (c ^ -1) >>> 0;
  }
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcInput = Buffer.concat([typeBuf, data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(crcInput), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const pngSig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idatData = zlib.deflateSync(rawData);
  const pngBuffer = Buffer.concat([
    pngSig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idatData),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);

  fs.writeFileSync(path.join(ASSETS_DIR, 'icon.png'), pngBuffer);

  // Wrap PNG inside ICO header
  const icoHeader = Buffer.alloc(22);
  icoHeader.writeUInt16LE(0, 0); // Reserved
  icoHeader.writeUInt16LE(1, 2); // Type = 1 (ICO)
  icoHeader.writeUInt16LE(1, 4); // Count = 1
  icoHeader[6] = width;
  icoHeader[7] = height;
  icoHeader[8] = 0;
  icoHeader[9] = 0;
  icoHeader.writeUInt16LE(1, 10);  // Color planes
  icoHeader.writeUInt16LE(32, 12); // Bits per pixel
  icoHeader.writeUInt32LE(pngBuffer.length, 14);
  icoHeader.writeUInt32LE(22, 18); // Offset

  const icoBuffer = Buffer.concat([icoHeader, pngBuffer]);
  fs.writeFileSync(path.join(ASSETS_DIR, 'icon.ico'), icoBuffer);
}

function main() {
  ensureDirs();
  generateMusicTracks();
  generateAnimatedSvgWallpapers();
  generateAppIcons();
  console.log('[StarterAssets] Successfully generated Starter Pack music (.wav), animated wallpapers (.svg), and icons (.png/.ico).');
}

if (require.main === module) {
  main();
}

module.exports = { main };
