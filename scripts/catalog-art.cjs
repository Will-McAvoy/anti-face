// Procedural wallpapers for the bundled catalog. Every scene is deterministic so manifest hashes stay stable.
const { PNG } = require('pngjs');

const hex = value => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255);
const clamp = (x, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const add = (a, b, t = 1) => [a[0] + b[0] * t, a[1] + b[1] * t, a[2] + b[2] * t];
const screen = (a, b, t = 1) => mix(a, [1 - (1 - a[0]) * (1 - b[0]), 1 - (1 - a[1]) * (1 - b[1]), 1 - (1 - a[2]) * (1 - b[2])], t);
const glow = (x, y, cx, cy, r) => Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (r * r));
const fract = x => x - Math.floor(x);

function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noiseField(seed) {
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
    const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, y, octaves = 5) => {
    let sum = 0, amp = 0.5, norm = 0;
    for (let i = 0; i < octaves; i += 1) {
      sum += amp * noise(x, y);
      norm += amp;
      x = x * 2.03 + 17.1;
      y = y * 2.03 + 9.7;
      amp *= 0.5;
    }
    return sum / norm;
  };
  return { noise, fbm };
}

function stars(x, y, seed, density, size) {
  const scale = 1 / size;
  const gx = Math.floor(x * scale), gy = Math.floor(y * scale);
  const h = hash2(gx, gy, seed);
  if (h > density) return 0;
  const cx = (gx + 0.2 + 0.6 * hash2(gx, gy, seed + 1)) / scale;
  const cy = (gy + 0.2 + 0.6 * hash2(gx, gy, seed + 2)) / scale;
  const r = size * (0.04 + 0.08 * hash2(gx, gy, seed + 3));
  return Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (r * r)) * (0.4 + 0.6 * hash2(gx, gy, seed + 4));
}

function ridge(fbm, x, base, amp, freq, offset) {
  return base - amp * (fbm(x * freq + offset, offset * 0.37, 5) - 0.35);
}

// palette order: accent, background, panel, foreground, muted, border, selection
const scenes = [
  // 01 石墨夜读: window light falling across a slate wall, a reading lamp, drifting dust
  ({ P, fbm, rand }) => {
    const motes = Array.from({ length: 80 }, () => [0.08 + rand() * 0.8, 0.08 + rand() * 0.8, 0.0012 + rand() * 0.0035, 0.3 + rand() * 0.7]);
    const warm = mix(P.accent, [1, 0.86, 0.62], 0.55);
    return (x, y) => {
      let c = mix(P.bg, P.panel, smooth(-0.2, 1.3, y * 0.7 + x * 0.25));
      c = mix(c, P.bg, (fbm(x * 2.5, y * 2.5) - 0.5) * 0.5);
      c = mix(c, P.panel, (fbm(x * 40, y * 40, 3) - 0.5) * 0.12);
      const u = (x - 0.12 - (y - 0.1) * 0.5) / 0.58, v = (y - 0.1) / 0.66;
      // Penumbra widens with distance from the window, and the patch fades towards its far edge.
      const blur = 0.03 + 0.06 * clamp(v);
      const inWin = smooth(-blur, blur, u) * smooth(1 + blur, 1 - blur, u) * smooth(-0.04, 0.04, v) * smooth(1.06, 0.9, v);
      const bar = Math.max(Math.exp(-(((u - 0.5) / (0.02 + blur * 0.4)) ** 2)), Math.exp(-(((v - 0.48) / (0.026 + blur * 0.4)) ** 2)));
      const dapple = 0.6 + 0.4 * smooth(0.35, 0.7, fbm(x * 5 + 2, y * 5));
      c = screen(c, warm, inWin * (1 - bar * 0.85) * dapple * (0.2 - 0.08 * clamp(v)));
      c = screen(c, mix(P.sel, P.accent, 0.4), glow(x, y, 0.3, 0.18, 0.62) * 0.42);
      for (const [mx, my, mr, a] of motes) {
        if (Math.abs(x - mx) > mr * 4 || Math.abs(y - my) > mr * 4) continue;
        c = screen(c, warm, glow(x, y, mx, my, mr) * a * (0.15 + 0.6 * inWin));
      }
      const vignette = smooth(1.3, 0.35, Math.hypot((x - 0.89) * 0.75, y - 0.5));
      return mix([c[0] * 0.5, c[1] * 0.5, c[2] * 0.5], c, vignette);
    };
  },
  // 02 珍珠页边: thin-film pearl sheen on fibrous paper with a margin rule
  ({ P, fbm }) => (x, y) => {
    let c = mix([1, 1, 1], P.bg, smooth(0, 1.1, y * 0.8 + x * 0.15));
    const t = fbm(x * 0.9 + fbm(x * 1.7, y * 1.7) * 0.9, y * 0.9) * 6 + x * 0.6;
    const film = [0.5 + 0.5 * Math.cos(t), 0.5 + 0.5 * Math.cos(t + 2.1), 0.5 + 0.5 * Math.cos(t + 4.2)];
    c = mix(c, mix(film, [1, 1, 1], 0.55), smooth(0.35, 0.85, fbm(x * 0.7 + 3, y * 0.7 + 1)) * 0.24);
    c = mix(c, P.sel, smooth(0.55, 0.9, fbm(x * 1.3 + 7, y * 1.3)) * 0.25);
    c = mix(c, P.border, (fbm(x * 260, y * 18, 2) - 0.5) * 0.08 + (fbm(x * 120, y * 120, 2) - 0.5) * 0.06);
    c = mix(c, mix(P.accent, [0.85, 0.35, 0.35], 0.4), Math.exp(-(((x - 0.2) / 0.0011) ** 2)) * 0.24);
    const rule = Math.exp(-(((fract(y * 22) - 0.5) / 0.018) ** 2)) * smooth(0.12, 0.2, y) * smooth(1.78, 1.3, x);
    return mix(c, P.border, rule * 0.07);
  },
  // 03 极光悬浮: rayed aurora curtains, green at the foot and violet above, over twin ridges
  ({ P, fbm, noise }) => (x, y) => {
    let c = mix([P.bg[0] * 0.45, P.bg[1] * 0.5, P.bg[2] * 0.65], mix(P.panel, P.sel, 0.3), smooth(0, 1, y));
    c = add(c, [0.9, 0.95, 1], (stars(x, y, 3, 0.3, 0.011) * 0.9 + stars(x, y, 33, 0.06, 0.04) * 0.5) * (1 - y));
    for (let k = 0; k < 3; k += 1) {
      const foot = 0.42 + k * 0.06 + 0.07 * Math.sin(x * (1.9 + k * 0.5) + k * 1.7) + 0.08 * (fbm(x * 1.2 + k * 5, k * 3) - 0.5);
      const d = foot - y;
      if (d < -0.06) continue;
      const base = Math.exp(-((Math.min(d, 0) / 0.012) ** 2));
      const rise = d > 0 ? Math.exp(-d / (0.16 + 0.1 * noise(x * 3 + k, 0))) : 1;
      const rays = 0.55 + 0.45 * Math.pow(noise(x * 38 + k * 11, y * 0.8 + k), 1.6);
      const fade = smooth(-0.1, 0.4, x) * smooth(1.9, 1.25, x);
      const tint = mix(mix(P.accent, [0.55, 1, 0.8], 0.3), k === 2 ? P.sel : [0.75, 0.45, 1], smooth(0.04, 0.28, d));
      c = screen(c, tint, base * rise * rays * fade * (0.85 - k * 0.2));
    }
    const hill = ridge(fbm, x, 0.82, 0.14, 1.5, 2);
    if (y > hill) {
      c = mix([0.015, 0.03, 0.04], [0.05, 0.09, 0.1], smooth(hill, 1, y) * 0.5);
      c = screen(c, P.accent, Math.exp(-(y - hill) / 0.004) * 0.22);
    }
    if (y > ridge(fbm, x, 0.93, 0.08, 2.3, 9)) c = [0.01, 0.018, 0.022];
    return c;
  },
  // 04 午夜窄栏: crescent moon in a starfield with thin cloud bands
  ({ P, fbm }) => (x, y) => {
    let c = mix([P.bg[0] * 0.7, P.bg[1] * 0.7, P.bg[2] * 0.75], P.sel, smooth(0.2, 1.3, y) * 0.7);
    c = add(c, [0.85, 0.9, 1], stars(x, y, 4, 0.3, 0.01) + stars(x, y, 44, 0.08, 0.03) * 0.6);
    const mx = 0.36, my = 0.27, r = 0.065;
    const disc = smooth(r + 0.003, r - 0.003, Math.hypot(x - mx, y - my));
    const bite = smooth(r - 0.004, r + 0.004, Math.hypot(x - mx - 0.03, y - my + 0.018));
    c = screen(c, P.accent, glow(x, y, mx, my, 0.22) * 0.35);
    c = mix(c, [0.93, 0.95, 1], disc * bite);
    const cloud = smooth(0.55, 0.8, fbm(x * 1.2, y * 7));
    return mix(c, P.border, cloud * 0.35 * smooth(0.3, 0.7, y));
  },
  // 05 抹茶卡片: layered paper-cut matcha hills with cast shadows under a pale sun
  ({ P, fbm }) => {
    const tones = [mix(P.sel, P.bg, 0.45), P.sel, mix(P.sel, P.accent, 0.35), mix(P.sel, P.accent, 0.62), mix(P.accent, [0.2, 0.3, 0.2], 0.2)];
    return (x, y) => {
      let c = mix(mix(P.panel, [1, 1, 1], 0.3), P.bg, smooth(0, 0.6, y));
      c = screen(c, [1, 0.97, 0.85], glow(x, y, 0.42, 0.28, 0.16) * 0.45);
      c = mix(c, mix(P.sel, [1, 0.98, 0.9], 0.45), smooth(0.074, 0.07, Math.hypot(x - 0.42, y - 0.28)) * 0.85);
      for (let i = 0; i < tones.length; i += 1) {
        const h = 0.5 + i * 0.1 - 0.18 * (fbm(x * (0.9 + i * 0.35) + i * 4.1, i * 1.3, 4) - 0.5);
        if (y > h) {
          const t = tones[i];
          c = mix(t, [t[0] * 0.93, t[1] * 0.93, t[2] * 0.93], smooth(h, h + 0.25, y));
          c = screen(c, [1, 1, 1], Math.exp(-(y - h) / 0.0025) * 0.18);
        } else {
          c = mix(c, [c[0] * 0.8, c[1] * 0.83, c[2] * 0.8], Math.exp(-(h - y) / 0.012) * 0.5);
        }
      }
      return mix(c, P.border, (fbm(x * 150, y * 150, 2) - 0.5) * 0.08);
    };
  },
  // 06 玫瑰雾面: rose haze with drifting bokeh
  ({ P, fbm, rand }) => {
    const dots = Array.from({ length: 34 }, () => [rand() * 1.78, rand(), 0.02 + rand() ** 2 * 0.12, 0.15 + rand() * 0.35]);
    return (x, y) => {
      let c = mix(P.panel, P.sel, smooth(0.1, 1.2, y + 0.3 * (1.78 - x) / 1.78));
      c = mix(c, [1, 1, 1], smooth(0.5, 0.8, fbm(x * 1.5, y * 1.5)) * 0.4);
      for (const [bx, by, br, a] of dots) {
        const d = Math.hypot(x - bx, y - by);
        const disc = smooth(br, br * 0.85, d);
        const rim = Math.exp(-(((d - br * 0.9) / (br * 0.08)) ** 2));
        c = screen(c, [1, 0.94, 0.96], disc * a * 0.6 + rim * a * 0.4);
      }
      return mix(c, P.accent, glow(x, y, 0.3, 0.3, 0.5) * 0.08);
    };
  },
  // 07 北欧静音: layered mountain ridges in cold haze
  ({ P, fbm }) => (x, y) => {
    let c = mix(mix(P.sel, P.accent, 0.35), P.bg, smooth(0.55, 0, y));
    c = screen(c, P.accent, glow(x, y, 0.38, 0.32, 0.08) * 0.6 + glow(x, y, 0.38, 0.32, 0.4) * 0.12);
    for (let i = 0; i < 5; i += 1) {
      const h = ridge(fbm, x, 0.48 + i * 0.1, 0.18 - i * 0.015, 1.2 + i * 0.5, i * 7.3);
      if (y > h) {
        const tone = mix(mix(P.sel, P.accent, 0.2), P.bg, (i + 1) / 5);
        c = mix(tone, [tone[0] * 0.9, tone[1] * 0.9, tone[2] * 0.92], smooth(h, h + 0.3, y));
      }
    }
    return c;
  },
  // 08 拿铁纸感: warm latte swirl on paper
  ({ P, fbm }) => (x, y) => {
    const dx = x - 0.4, dy = y - 0.5;
    const r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    const swirl = Math.sin(a * 2 + r * 9 + fbm(x * 2, y * 2) * 3);
    let c = mix(P.panel, P.bg, smooth(0, 1, y));
    const cup = smooth(0.75, 0.2, r);
    c = mix(c, P.sel, cup * (0.35 + 0.25 * swirl));
    c = mix(c, P.accent, cup * smooth(0.6, 1, swirl) * 0.18);
    return mix(c, P.border, (fbm(x * 140, y * 140, 2) - 0.5) * 0.12);
  },
  // 09 紫罗兰焦点: a violet focus orb with orbit arcs
  ({ P, fbm }) => (x, y) => {
    let c = mix(P.bg, P.panel, smooth(0, 1.4, x * 0.4 + y * 0.6));
    c = mix(c, P.sel, smooth(0.5, 0.85, fbm(x * 1.3, y * 1.3)) * 0.4);
    const ox = 0.4, oy = 0.36;
    c = screen(c, P.sel, glow(x, y, ox, oy, 0.45) * 0.7);
    c = screen(c, P.accent, glow(x, y, ox, oy, 0.12) * 0.8);
    c = screen(c, [1, 1, 1], glow(x, y, ox, oy, 0.035));
    for (const [rx, ry, t] of [[0.32, 0.12, 0.25], [0.52, 0.2, -0.35]]) {
      const cs = Math.cos(t), sn = Math.sin(t);
      const px = (x - ox) * cs + (y - oy) * sn, py = -(x - ox) * sn + (y - oy) * cs;
      const e = Math.abs(Math.hypot(px / rx, py / ry) - 1);
      c = screen(c, P.accent, Math.exp(-((e / 0.012) ** 2)) * 0.35);
    }
    return c;
  },
  // 10 海面横幅: horizon band with a lit sea
  ({ P, fbm, noise }) => (x, y) => {
    const horizon = 0.46;
    if (y < horizon) {
      let c = mix(P.bg, mix(P.sel, P.accent, 0.4), smooth(0, horizon, y));
      c = mix(c, P.border, smooth(0.6, 0.8, fbm(x * 1.5, y * 9)) * 0.4);
      return screen(c, P.accent, glow(x, y, 0.3, horizon, 0.25) * 0.4);
    }
    const t = (y - horizon) / (1 - horizon);
    let c = mix(mix(P.sel, P.accent, 0.25), P.bg, smooth(0, 0.9, t));
    const wave = noise(x * (14 / (t + 0.08)), y * (180 / (t + 0.25)));
    c = add(c, P.accent, (wave - 0.5) * 0.12 * (1 - t * 0.6));
    const glint = Math.exp(-(((x - 0.3) / (0.04 + t * 0.2)) ** 2)) * smooth(0.55, 0.85, wave) * (1 - t);
    return screen(c, [1, 1, 0.95], glint * 0.7);
  },
  // 11 日落余温: sinking sun behind dark hills
  ({ P, fbm }) => (x, y) => {
    const top = [0.16, 0.09, 0.16];
    let c = mix(top, mix(P.accent, [0.92, 0.45, 0.35], 0.35), smooth(0.05, 0.62, y));
    const sx = 0.32, sy = 0.56;
    c = screen(c, P.accent, glow(x, y, sx, sy, 0.35) * 0.6);
    c = mix(c, [1, 0.88, 0.7], smooth(0.062, 0.058, Math.hypot(x - sx, y - sy)));
    const cloud = smooth(0.58, 0.78, fbm(x * 1.2, y * 10));
    c = mix(c, mix(P.sel, P.accent, 0.5), cloud * 0.5 * smooth(0.6, 0.15, y));
    for (let i = 0; i < 3; i += 1) {
      const h = ridge(fbm, x, 0.66 + i * 0.1, 0.1, 1.4 + i * 0.7, 3 + i * 5);
      if (y > h) c = mix(mix(P.sel, P.bg, 0.4 + i * 0.25), P.bg, smooth(h, h + 0.4, y) * 0.6);
    }
    return c;
  },
  // 12 墨线编辑: faint topographic ink lines on near-black
  ({ P, fbm }) => (x, y) => {
    let c = mix(P.bg, P.panel, smooth(0, 1.6, x * 0.5 + y * 0.5));
    const h = fbm(x * 1.1, y * 1.1, 4) * 14;
    const line = Math.exp(-(((fract(h) - 0.5) / 0.035) ** 2));
    const major = Math.exp(-(((fract(h / 5) - 0.5) / 0.01) ** 2));
    const calm = 1 - 0.7 * smooth(0.3, 0, Math.hypot((x - 1.1) * 0.8, y - 0.42));
    c = add(c, P.muted, (line * 0.07 + major * 0.1) * calm);
    return screen(c, P.accent, glow(x, y, 0.15, 0.1, 0.4) * 0.06);
  },
  // 13 樱花浅窗: a blossoming branch from the corner, sharp mid-ground petals and blurred near petals
  ({ P, fbm, rand }) => {
    const segments = [], flowers = [];
    const grow = (x0, y0, angle, length, width, depth) => {
      const x1 = x0 + Math.cos(angle) * length, y1 = y0 + Math.sin(angle) * length;
      segments.push([x0, y0, x1, y1, width, width * 0.68]);
      if (depth <= 0 || length < 0.04) { flowers.push([x1, y1, 0.024 + rand() * 0.014, rand() * 6]); return; }
      grow(x1, y1, angle + (rand() - 0.5) * 0.5, length * 0.8, width * 0.7, depth - 1);
      if (rand() < 0.8) grow(x1, y1, angle + (rand() < 0.5 ? -1 : 1) * (0.45 + rand() * 0.5), length * 0.6, width * 0.6, depth - 2);
      for (let i = 0; i < 3; i += 1) if (rand() < 0.65) flowers.push([x1 + (rand() - 0.5) * 0.07, y1 + (rand() - 0.5) * 0.07, 0.018 + rand() * 0.016, rand() * 6]);
    };
    grow(-0.06, 0.04, 0.34, 0.3, 0.024, 6);
    const petal = (spread, count, size, soft, alpha) => Array.from({ length: count }, () => [spread(), size[0] + rand() * size[1], rand() * Math.PI, soft, alpha * (0.7 + rand() * 0.3)]);
    const far = petal(() => [rand() < 0.7 ? rand() * 0.9 : rand() * 1.78, rand()], 34, [0.008, 0.012], 0.1, 0.75);
    const near = petal(() => [rand() < 0.5 ? rand() * 0.5 : 1.3 + rand() * 0.48, 0.55 + rand() * 0.45], 7, [0.04, 0.05], 0.9, 0.32);
    const drawPetals = (c, x, y, list) => {
      for (const [[px, py], s, rot, soft, a] of list) {
        const dx = x - px, dy = y - py;
        if (Math.abs(dx) > s * 2.6 || Math.abs(dy) > s * 2.6) continue;
        const u = (dx * Math.cos(rot) + dy * Math.sin(rot)) / s;
        const v = (-dx * Math.sin(rot) + dy * Math.cos(rot)) / (s * 0.62);
        const notch = Math.exp(-(((u - 1) / 0.25) ** 2) - (v / 0.25) ** 2);
        const shape = smooth(1 + soft, 1 - Math.min(soft, 0.9), u * u + v * v) * (1 - notch);
        c = mix(c, mix(P.accent, [1, 0.93, 0.95], clamp((u + 1) * 0.3)), shape * a);
      }
      return c;
    };
    const bark = mix([0.3, 0.2, 0.22], P.fg, 0.3);
    return (x, y) => {
      let c = mix(P.bg, [1, 1, 1], smooth(0, 1, y) * 0.6);
      c = mix(c, P.sel, smooth(0.5, 0.85, fbm(x * 1.2, y * 1.2)) * 0.45);
      c = screen(c, [1, 0.98, 0.96], glow(x, y, 1.2, 0.2, 0.5) * 0.4);
      c = drawPetals(c, x, y, far);
      let wood = 0;
      for (const [x0, y0, x1, y1, w0, w1] of segments) {
        if (x < Math.min(x0, x1) - 0.02 || x > Math.max(x0, x1) + 0.02 || y < Math.min(y0, y1) - 0.02 || y > Math.max(y0, y1) + 0.02) continue;
        const vx = x1 - x0, vy = y1 - y0;
        const t = clamp(((x - x0) * vx + (y - y0) * vy) / (vx * vx + vy * vy));
        const half = (w0 + (w1 - w0) * t) / 2;
        wood = Math.max(wood, smooth(half + 0.0008, half - 0.0008, Math.hypot(x - x0 - vx * t, y - y0 - vy * t)));
      }
      c = mix(c, bark, wood * 0.88);
      for (const [fx, fy, fs, rot] of flowers) {
        const dx = x - fx, dy = y - fy;
        if (Math.abs(dx) > fs * 1.2 || Math.abs(dy) > fs * 1.2) continue;
        const r = Math.hypot(dx, dy) / fs, lobe = Math.abs(Math.cos((Math.atan2(dy, dx) + rot) * 2.5));
        const edge = (0.62 + 0.38 * lobe) * (1 - 0.16 * Math.pow(lobe, 40));
        const bloom = mix(mix([1, 0.94, 0.96], P.accent, 0.3 + 0.45 * r), [0.82, 0.32, 0.45], smooth(0.3, 0.16, r) * 0.7);
        c = mix(c, bloom, smooth(edge + 0.05, edge - 0.05, r));
      }
      return drawPetals(c, x, y, near);
    };
  },
  // 14 林间遮罩: misty conifer layers with light shafts
  ({ P, fbm, rand }) => {
    const layers = Array.from({ length: 4 }, (_, i) => Array.from({ length: 34 - i * 5 }, () => [rand() * 1.9 - 0.06, 0.38 + i * 0.12 + rand() * 0.1, 0.18 + rand() * 0.1]));
    return (x, y) => {
      let c = mix(mix(P.sel, P.accent, 0.3), P.bg, smooth(0.1, 0.9, y) * 0.6);
      const shaft = Math.pow(Math.max(0, Math.sin((x + y * 0.55) * 8)), 8) * smooth(0.9, 0.1, y) * smooth(1.4, 0.2, x);
      c = screen(c, P.accent, shaft * 0.12);
      layers.forEach((trees, i) => {
        let inside = 0;
        for (const [tx, ty, slope] of trees) {
          if (y < ty) continue;
          const half = (y - ty) * slope * (1 + 0.15 * Math.sin((y - ty) * 140));
          inside = Math.max(inside, smooth(half + 0.002, half - 0.002, Math.abs(x - tx)));
        }
        const ground = y > 0.72 + i * 0.07 ? 1 : 0;
        const tone = mix(mix(P.sel, P.muted, 0.2), [0.03, 0.05, 0.035], (i + 1) / 4);
        c = mix(c, tone, Math.max(inside, ground));
        c = mix(c, P.border, smooth(0.45, 0.7, fbm(x * 2 + i, y * 6)) * 0.12);
      });
      return c;
    };
  },
  // 15 银白表格: quiet silver grid with a diagonal sheen
  ({ P }) => (x, y) => {
    let c = mix([1, 1, 1], P.bg, smooth(0, 1.6, x * 0.6 + y));
    const minor = (v, s) => Math.exp(-(((fract(v / s) - 0.5) * s / 0.0009) ** 2) / 4);
    const gx = Math.max(minor(x + 0.0125, 0.025), minor(y + 0.0125, 0.025));
    const gX = Math.max(minor(x + 0.0625, 0.125), minor(y + 0.0625, 0.125));
    c = mix(c, P.border, gx * 0.35 + gX * 0.45);
    const sheen = Math.exp(-(((x - y * 1.2 - 0.6) / 0.25) ** 2));
    c = mix(c, [1, 1, 1], sheen * 0.35);
    return mix(c, P.accent, glow(x, y, 0.2, 0.2, 0.35) * 0.08);
  },
  // 16 石墨玻璃: frosted glass tiles over soft colour fields
  ({ P, fbm }) => {
    const tiles = [[0.12, 0.16, 0.42, 0.42], [0.36, 0.48, 0.38, 0.36], [1.2, 0.12, 0.44, 0.3], [1.05, 0.58, 0.5, 0.32]];
    const field = (x, y, f) => {
      let c = P.bg;
      c = screen(c, P.sel, glow(x, y, 0.35, 0.4, 0.42) * 1.2);
      c = screen(c, P.accent, glow(x, y, 1.3, 0.3, 0.3) * 0.55);
      c = screen(c, mix(P.sel, [0.4, 0.5, 0.7], 0.5), glow(x, y, 1.0, 0.85, 0.35) * 0.7);
      return mix(c, P.bg, (fbm(x * f, y * f, 3) - 0.5) * 0.6);
    };
    return (x, y) => {
      let c = field(x, y, 3);
      for (const [tx, ty, tw, th] of tiles) {
        const qx = Math.abs(x - tx - tw / 2) - tw / 2 + 0.03, qy = Math.abs(y - ty - th / 2) - th / 2 + 0.03;
        const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 0.03;
        const inside = smooth(0.002, -0.002, d);
        if (inside > 0) c = mix(c, mix(field(x * 0.97 + 0.02, y * 0.97, 0.8), [1, 1, 1], 0.08), inside);
        c = screen(c, P.accent, Math.exp(-((d / 0.0025) ** 2)) * 0.25);
      }
      return c;
    };
  },
  // 17 珍珠低干扰: an almost-flat pearl gradient with one quiet arc
  ({ P, fbm }) => (x, y) => {
    let c = mix([1, 1, 1], P.bg, smooth(0, 1.2, y + x * 0.2));
    c = mix(c, P.sel, smooth(0.62, 0.9, fbm(x * 0.8, y * 0.8, 3)) * 0.25);
    const arc = Math.exp(-(((Math.hypot(x + 0.2, y - 1.4) - 1.25) / 0.003) ** 2));
    return mix(c, P.accent, arc * 0.12);
  },
  // 18 极光阅读: a restrained aurora mirrored in a still lake
  ({ P, fbm, noise }) => (x, y) => {
    const shore = 0.7;
    const mirrored = y > shore;
    // The lake is a vertically compressed reflection with horizontal ripple displacement.
    const ripple = mirrored ? noise(x * 7, y * 160) - 0.5 : 0;
    const sx = x + ripple * 0.012 * (y - shore) * 6;
    const sy = mirrored ? shore - (y - shore) * 1.5 : y;
    let c = mix([P.bg[0] * 0.5, P.bg[1] * 0.55, P.bg[2] * 0.6], P.panel, smooth(0, 1, sy));
    c = add(c, [0.9, 0.95, 1], stars(sx, sy, 18, 0.22, 0.011) * 0.7 * (1 - sy));
    const foot = 0.3 + 0.05 * Math.sin(sx * 2.4 + 1) + 0.05 * (fbm(sx * 1.2, 2) - 0.5);
    const d = foot - sy;
    if (d > -0.05) {
      const base = Math.exp(-((Math.min(d, 0) / 0.01) ** 2));
      const rise = d > 0 ? Math.exp(-d / 0.13) : 1;
      const rays = 0.6 + 0.4 * Math.pow(noise(sx * 34, sy * 0.8), 1.6);
      const tint = mix(mix(P.accent, P.sel, 0.3), [0.6, 0.5, 0.95], smooth(0.05, 0.25, d));
      c = screen(c, tint, base * rise * rays * 0.68 * smooth(-0.1, 0.5, sx) * smooth(1.9, 1.3, sx));
    }
    if (sy > ridge(fbm, sx, shore - 0.025, 0.07, 2.2, 11)) c = [0.012, 0.03, 0.032];
    if (mirrored) {
      c = mix(c, P.bg, 0.4 + 0.12 * ripple);
      c = screen(c, [1, 1, 1], Math.pow(ripple + 0.5, 10) * 0.05);
      c = screen(c, P.accent, Math.exp(-(y - shore) / 0.003) * 0.08);
    }
    return c;
  },
  // 19 午夜玻璃: blue-violet glass bokeh at night
  ({ P, rand }) => {
    const dots = Array.from({ length: 30 }, () => [rand() * 1.78, rand(), 0.03 + rand() ** 2 * 0.13, rand()]);
    return (x, y) => {
      let c = mix([P.bg[0] * 0.8, P.bg[1] * 0.8, P.bg[2] * 0.8], P.sel, smooth(-0.2, 1.4, x * 0.3 + y * 0.7) * 0.6);
      for (const [bx, by, br, hue] of dots) {
        const d = Math.hypot(x - bx, y - by);
        const tint = mix(P.accent, [0.75, 0.55, 1], hue);
        c = screen(c, tint, smooth(br, br * 0.8, d) * 0.16 + Math.exp(-(((d - br * 0.95) / (br * 0.08)) ** 2)) * 0.1);
      }
      return screen(c, P.accent, glow(x, y, 0.3, 0.3, 0.5) * 0.15);
    };
  },
  // 20 北欧浅读: pale fjord with reflected ridges
  ({ P, fbm, noise }) => (x, y) => {
    const shore = 0.62;
    const sy = y < shore ? y : shore - (y - shore) * 1.2;
    let c = mix([1, 1, 1], P.sel, smooth(0, shore, sy));
    for (let i = 0; i < 3; i += 1) {
      const h = ridge(fbm, x, 0.42 + i * 0.07, 0.16 - i * 0.03, 1.3 + i * 0.6, 4 + i * 6);
      if (sy > h) c = mix(mix(P.sel, P.accent, 0.25 + i * 0.2), P.sel, smooth(h, shore, sy) * 0.5);
    }
    c = mix(c, [1, 1, 1], smooth(0.5, 0.75, fbm(x * 1.5, y * 6)) * 0.35 * smooth(0.25, 0.55, y));
    if (y > shore) c = mix(c, mix(P.bg, P.sel, 0.5), 0.35 + 0.08 * (noise(x * 8, y * 140) - 0.5));
    return c;
  }
];

// Rotated-grid 4x supersampling: cleaner edges than an ordered 2x2 grid at the same cost.
const RGSS = [[0.375, 0.125], [0.875, 0.375], [0.125, 0.625], [0.625, 0.875]];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16 - 0.5);

function ditherAt(mode, px, py) {
  if (mode === 'bayer') return BAYER[(py & 3) * 4 + (px & 3)];
  if (mode === 'random') return hash2(px, py, 7) - 0.5;
  return 0;
}

function render(index, palette, width, height, { dither = 'bayer', samples = RGSS } = {}) {
  const [accent, bg, panel, fg, muted, border, sel] = palette.map(hex);
  const P = { accent, bg, panel, fg, muted, border, sel };
  const { noise, fbm } = noiseField(1000 + index * 7919);
  const shade = scenes[index]({ P, fbm, noise, rand: random(424242 + index * 31) });
  const aspect = width / height;
  const data = Buffer.alloc(width * height * 4);
  const n = samples.length;
  // Floyd-Steinberg only flips a rounding where the true colour sits between two levels, so flat and
  // textured areas stay compressible while gradients lose their 8-bit bands.
  const diffuse = dither === 'diffuse';
  let errNow = new Float32Array((width + 2) * 3), errNext = new Float32Array((width + 2) * 3);
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      let r = 0, g = 0, b = 0;
      for (const [sx, sy] of samples) {
        const c = shade(((px + sx) / width) * aspect, (py + sy) / height);
        r += c[0]; g += c[1]; b += c[2];
      }
      const i = (py * width + px) * 4;
      const want = [clamp(r / n) * 255, clamp(g / n) * 255, clamp(b / n) * 255];
      if (diffuse) {
        const e = (px + 1) * 3;
        for (let ch = 0; ch < 3; ch += 1) {
          const value = want[ch] + errNow[e + ch];
          const out = Math.max(0, Math.min(255, Math.round(value)));
          const err = value - out;
          data[i + ch] = out;
          errNow[e + 3 + ch] += err * 7 / 16;
          errNext[e - 3 + ch] += err * 3 / 16;
          errNext[e + ch] += err * 5 / 16;
          errNext[e + 3 + ch] += err * 1 / 16;
        }
      } else {
        const d = ditherAt(dither, px, py);
        for (let ch = 0; ch < 3; ch += 1) data[i + ch] = Math.max(0, Math.min(255, Math.round(want[ch] + d)));
      }
      data[i + 3] = 255;
    }
    [errNow, errNext] = [errNext, errNow];
    errNext.fill(0);
  }
  return data;
}

function downscale(data, width, height, factor) {
  const w = Math.floor(width / factor), h = Math.floor(height / factor);
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const sum = [0, 0, 0];
      for (let dy = 0; dy < factor; dy += 1) {
        for (let dx = 0; dx < factor; dx += 1) {
          const i = ((y * factor + dy) * width + x * factor + dx) * 4;
          sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2];
        }
      }
      const o = (y * w + x) * 4, n = factor * factor;
      out[o] = Math.round(sum[0] / n); out[o + 1] = Math.round(sum[1] / n); out[o + 2] = Math.round(sum[2] / n); out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

function encodeRgbPng(width, height, data) {
  const png = new PNG({ width, height, colorType: 2, inputHasAlpha: true });
  data.copy(png.data, 0, 0, width * height * 4);
  return PNG.sync.write(png, { colorType: 2, inputHasAlpha: true, deflateLevel: 9 });
}

module.exports = { render, downscale, encodeRgbPng, sceneCount: scenes.length, RGSS };
