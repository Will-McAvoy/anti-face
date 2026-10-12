// Test entry only: real main/preload/services, simulated host and clock boundaries.
const path = require('node:path');
const { PNG } = require('pngjs');
const { SELECTORS, VARIABLES, REGION_SELECTORS } = require('../../core/runtime.cjs');

function tinyPng(red, green, blue) {
  const png = new PNG({ width: 2, height: 2 });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = red;
    png.data[index + 1] = green;
    png.data[index + 2] = blue;
    png.data[index + 3] = 255;
  }
  return PNG.sync.write(png);
}

function parseJsonObject(text, index) {
  if (text[index] !== '{') return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let cursor = index; cursor < text.length; cursor += 1) {
    const char = text[cursor];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(text.slice(index, cursor + 1));
    }
  }
  return null;
}

function parseAssignedString(expression, marker) {
  const at = expression.indexOf(marker);
  if (at < 0 || expression[at + marker.length] !== '"') return null;
  let cursor = at + marker.length + 1;
  let raw = '"';
  while (cursor < expression.length) {
    const char = expression[cursor];
    raw += char;
    if (char === '\\') {
      cursor += 1;
      raw += expression[cursor] || '';
      cursor += 1;
      continue;
    }
    if (char === '"') return JSON.parse(raw);
    cursor += 1;
  }
  return null;
}

function bodyColor(css) {
  const match = /html body \{[^}]*color:(#[0-9a-fA-F]{6})/.exec(css || '');
  return match ? match[1].toLowerCase() : null;
}

function radiusFor(css, id) {
  const prefix = String(id || '').replace(/^region-/, '').replace(/-radius$/, '');
  const match = new RegExp(`--af-${prefix}-radius:([\\d.]+)px`).exec(css || '');
  return match ? `${match[1]}px` : null;
}

function observation(plan, target, failColor, lineHeightCheck) {
  const css = target.css || '';
  const present = !!target.owner;
  const checks = (plan.checks || []).map(item => {
    if (item.kind === 'owned') {
      return { id: item.id, state: present ? 'present' : 'missing', rules: present ? 5 : 0, ownerMatch: present && target.owner === plan.owner };
    }
    if (item.kind === 'reachable') return { id: item.id, state: 'present', reachable: true };
    if (item.kind === 'color') {
      const actual = failColor || bodyColor(css) || '';
      return { id: item.id, state: actual ? 'present' : 'missing', actual };
    }
    if (item.kind === 'keyword' && item.property === 'filter') return { id: item.id, state: 'present', actual: 'none' };
    if (item.kind === 'keyword') {
      const actual = /html body::before \{[^}]*pointer-events:none/.test(css) ? 'none' : 'auto';
      return { id: item.id, state: 'present', actual };
    }
    if (item.kind === 'region') {
      const actual = radiusFor(css, item.id);
      return actual ? { id: item.id, state: 'present', actual } : { id: item.id, state: 'missing' };
    }
    if (item.kind === 'background-image') {
      const actual = /html body::before \{[^}]*background-image:/.test(css) ? 'url("...")' : 'none';
      return { id: item.id, state: actual !== 'none' ? 'present' : 'missing', actual };
    }
    if (item.kind === 'filter-blur') {
      const match = /html body::before \{[^}]*filter:(blur\([\d.]+px\)[^;}]*)/.exec(css);
      return match ? { id: item.id, state: 'present', actual: match[1] } : { id: item.id, state: 'missing', reason: 'missing-blur' };
    }
    if (item.kind === 'background-color') {
      const region = String(item.id || '').replace(/^region-/, '').replace(/-background$/, '');
      const panel = /--af-panel:(#[0-9a-fA-F]{6})/.exec(css);
      const opacity = new RegExp(`--af-${region}-opacity:([\\d.]+)%`).exec(css);
      if (!panel || !opacity) return { id: item.id, state: 'missing', reason: 'missing-background' };
      const hex = panel[1];
      const actual = [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
        Number(opacity[1]) / 100
      ];
      return { id: item.id, state: 'present', actual };
    }
    if (item.kind === 'image-load') {
      const match = /html body::before \{[^}]*background-image:url\(([^)]+)\)/.exec(css);
      return match ? { id: item.id, state: 'loaded', actual: { loaded: true } } : { id: item.id, state: 'failed', reason: 'missing' };
    }
    if (item.kind === 'mask-opacity') {
      const match = /html body::after \{[^}]*opacity:([\d.]+)/.exec(css);
      return match ? { id: item.id, state: 'present', actual: match[1] } : { id: item.id, state: 'missing', reason: 'missing-mask' };
    }
    if (item.kind === 'opacity') {
      const match = /html body::after \{[^}]*opacity:([\d.]+)/.exec(css);
      return match ? { id: item.id, state: 'present', actual: match[1] } : { id: item.id, state: 'missing', reason: 'missing-opacity' };
    }
    if (item.kind === 'length') {
      const match = /font-size:([\d.]+)px/.exec(css);
      return match ? { id: item.id, state: 'present', actual: `${match[1]}px` } : { id: item.id, state: 'missing', reason: 'missing-length' };
    }
    if (item.kind === 'number') {
      const match = /line-height:([\d.]+)/.exec(css);
      return match ? { id: item.id, state: 'present', actual: match[1] } : { id: item.id, state: 'missing', reason: 'missing-number' };
    }
    if (item.kind === 'line-height') {
      if (lineHeightCheck) return { id: item.id, ...lineHeightCheck };
      const chat = /\.flex-1\.min-h-0 \{([^}]*)\}/.exec(css);
      const body = chat ? chat[1] : '';
      const font = /font-size:([\d.]+)px/.exec(body);
      const line = /line-height:([\d.]+)/.exec(body);
      if (!line || !font) return { id: item.id, state: 'missing', reason: 'missing-line-height' };
      const fontSizePx = Number(font[1]);
      const ratio = Number(line[1]);
      return { id: item.id, state: 'present', actual: { fontSizePx, lineHeightPx: fontSizePx * ratio, ratio } };
    }
    return { id: item.id, state: 'missing' };
  });
  return { kind: 'anti-face-verify', checks };
}

async function measureChatLineHeight(css) {
  if (!global.round5Mock.lineWindowPromise) {
    const { BrowserWindow } = require('electron');
    const win = new BrowserWindow({
      show: false,
      focusable: false,
      width: 800,
      height: 600,
      webPreferences: { backgroundThrottling: false }
    });
    const html = '<head></head><body style="margin:0;font-size:16px"><div class="flex-1 flex flex-col min-w-0" style="display:block;width:420px;height:320px"><div class="flex-1 min-h-0" style="display:block;width:380px;height:240px">chat</div></div></body>';
    global.round5Mock.lineWindowPromise = win.loadURL('about:blank').then(() => win.webContents.executeJavaScript(
      `document.open(); document.write(${JSON.stringify(html)}); document.close();`
    )).then(() => win);
  }
  const win = await global.round5Mock.lineWindowPromise;
  const forced = global.round5Mock.forceLineRatio;
  if (global.round5Mock.forceLineOnce) global.round5Mock.forceLineRatio = null;
  const extra = forced ? `\n.flex-1.flex.flex-col.min-w-0 > .flex-1.min-h-0 { line-height:${Number(forced)} !important; }` : '';
  const payload = JSON.stringify(String(css || '') + extra);
  return win.webContents.executeJavaScript(`(() => {
    let style = document.getElementById('anti-face-runtime-theme-v1');
    if (!style) {
      style = document.createElement('style');
      style.id = 'anti-face-runtime-theme-v1';
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = ${payload};
    const element = document.querySelector('.flex-1.flex.flex-col.min-w-0 > .flex-1.min-h-0');
    if (!element) return { state: 'missing', reason: 'missing' };
    const box = element.getBoundingClientRect();
    const computed = getComputedStyle(element);
    const visible = box.width > 0 && box.height > 0 && computed.visibility !== 'hidden' && computed.display !== 'none';
    if (!visible) return { state: 'hidden', reason: 'hidden' };
    const fontRaw = String(computed.fontSize || '').trim();
    const lineRaw = String(computed.lineHeight || '').trim();
    const fontSizePx = parseFloat(fontRaw);
    const lineHeightPx = parseFloat(lineRaw);
    if (!(fontSizePx > 0) || !/px$/i.test(fontRaw) || lineRaw === 'normal' || !/px$/i.test(lineRaw) || !(lineHeightPx > 0)) {
      return { state: 'unverifiable', actual: lineRaw || null, reason: 'unverifiable' };
    }
    return { state: 'present', actual: { fontSizePx, lineHeightPx, ratio: lineHeightPx / fontSizePx } };
  })()`);
}

function sceneProbe(id) {
  const scene = global.round5Mock.scenes[id] || 'unknown';
  if (scene === 'chat') return { routeHint: 'chat', hasTranscript: true, hasConversation: true };
  if (scene === 'home') return { routeHint: 'home', hasTranscript: false, hasConversation: true };
  return { routeHint: '', hasTranscript: false, hasConversation: false };
}

const host = { installed: true, path: 'mock.exe', version: 'test', fingerprint: 'test' };
const windows = {
  A: { owner: null, writes: 0, css: '', shots: 0, viewport: { width: 1280, height: 800 }, masked: false },
  B: { owner: null, writes: 0, css: '', shots: 0, viewport: { width: 900, height: 700 }, masked: false }
};
global.round5Require = require;
global.round5Mock = {
  windows,
  connected: true,
  delayB: 0,
  delayRead: 0,
  failVerifies: 0,
  now: 1000000,
  nowDate: new Date('2026-10-05T09:00:00'),
  autoScene: false,
  scenes: { A: 'unknown', B: 'unknown' }
};

const sceneModule = require('../../desktop/scene-observer.cjs');
const RealScene = sceneModule.SceneObserver;
sceneModule.SceneObserver = class extends RealScene {
  constructor(deps = {}) {
    super({
      ...deps,
      clock: () => global.round5Mock.now,
      schedule: (fn, ms) => setInterval(() => { if (global.round5Mock.autoScene) fn(); }, ms),
      intervalMs: 40,
      stableMs: 500,
      minIntervalMs: 500
    });
  }
};
const autoModule = require('../../desktop/automation-service.cjs');
const RealAuto = autoModule.AutomationService;
autoModule.AutomationService = class extends RealAuto {
  constructor(deps = {}) {
    super({ ...deps, clock: () => global.round5Mock.nowDate, intervalMs: 60000 });
    global.round5Mock.automation = this;
  }
};
const studioModule = require('../../desktop/studio-service.cjs');
const RealStudio = studioModule.StudioService;
studioModule.StudioService = class extends RealStudio {
  constructor(deps) {
    super(deps);
    const read = this.assets.read.bind(this.assets);
    this.assets.read = async id => {
      if (global.round5Mock.delayRead) await new Promise(resolve => setTimeout(resolve, global.round5Mock.delayRead));
      return read(id);
    };
    const save = this.saveDocument.bind(this);
    this.saveDocument = async document => {
      const rootDir = process.env.ANTI_FACE_TEST_USER_DATA;
      const arm = rootDir && path.join(rootDir, 'hold-save.flag');
      if (arm && require('node:fs').existsSync(arm)) {
        require('node:fs').unlinkSync(arm);
        require('node:fs').writeFileSync(path.join(rootDir, 'save-held.flag'), 'held');
        const release = path.join(rootDir, 'release-save.flag');
        await new Promise(resolve => {
          const timer = setInterval(() => {
            if (require('node:fs').existsSync(release)) {
              clearInterval(timer);
              resolve();
            }
          }, 20);
        });
      }
      return save(document);
    };
    const applyEditor = this.applyEditorDocument.bind(this);
    this.applyEditorDocument = async (...args) => {
      global.round5Mock.editorApplyStarted = (global.round5Mock.editorApplyStarted || 0) + 1;
      try {
        return await applyEditor(...args);
      } finally {
        global.round5Mock.editorApplyFinished = (global.round5Mock.editorApplyFinished || 0) + 1;
        const rootDir = process.env.ANTI_FACE_TEST_USER_DATA;
        if (rootDir) require('node:fs').writeFileSync(path.join(rootDir, 'apply-finished.txt'), String(global.round5Mock.editorApplyFinished));
      }
    };
    global.round5Mock.studio = this;
  }
};
const serviceModule = require('../../desktop/theme-service.cjs');
const RealService = serviceModule.ThemeService;
serviceModule.ThemeService = class extends RealService {
  constructor(options) {
    super({ ...options,
      inspectHost: async () => host,
      discoverEndpoint: async () => ({ port: 9 }),
      getJSON: async () => {
        if (!global.round5Mock.connected) throw new Error('offline');
        return Object.keys(windows).map(id => ({ id, title: `Mock ${id}`, type: 'page', url: `https://127.0.0.1/c/${id}`, webSocketDebuggerUrl: `ws://127.0.0.1/${id}` }));
      },
      connect: async address => {
        const id = address.split('/').pop();
        const target = windows[id];
        return {
          close() {},
          async captureScreenshot() {
            target.shots += 1;
            const base = id === 'A' ? 20 : 180;
            return { png: tinyPng(base, target.shots, id === 'A' ? 40 : 90), width: 2, height: 2 };
          },
          async evaluate(expression) {
            if (expression.includes('conversation-turn')) return sceneProbe(id);
            if (expression.includes('anti-face-capture-mask') && expression.includes('appendChild')) {
              target.masked = true;
              return true;
            }
            if (expression.includes('anti-face-capture-mask') && expression.includes('removeChild')) {
              target.masked = false;
              return true;
            }
            if (expression.includes('selectors:')) {
              if (id === 'B' && global.round5Mock.delayB) await new Promise(resolve => setTimeout(resolve, global.round5Mock.delayB));
              return {
                title: 'Antigravity',
                selectors: Object.fromEntries(SELECTORS.map(key => [key, true])),
                regions: Object.fromEntries(REGION_SELECTORS.map(key => [key, true])),
                variables: Object.fromEntries(VARIABLES.map(key => [key, true])),
                supportsBackdropFilter: true,
                sessionId: target.owner,
                viewport: target.viewport
              };
            }
            if (expression.includes('const plan = ')) {
              const plan = parseJsonObject(expression, expression.indexOf('const plan = ') + 'const plan = '.length);
              const fail = global.round5Mock.failVerifies > 0;
              if (fail) global.round5Mock.failVerifies -= 1;
              let lineHeightCheck = null;
              if (global.round5Mock.realLineHeight && (plan.checks || []).some(item => item.kind === 'line-height')) {
                lineHeightCheck = await measureChatLineHeight(target.css);
                global.round5Mock.lastLineHeight = lineHeightCheck;
                global.round5Mock.lineHeightLog = global.round5Mock.lineHeightLog || [];
                global.round5Mock.lineHeightLog.push(lineHeightCheck);
              }
              return observation(plan, target, fail ? '#ffffff' : null, lineHeightCheck);
            }
            if(expression.includes('antiFaceHostContext')) return {...(target.viewport || {width:800,height:600,dpr:1}),visible:true,focused:global.round5Mock.foreground === id};
            if (expression.includes('getBoundingClientRect')) {
              const width = Math.max(40, Math.round((target.viewport?.width || 800) * 0.5));
              const height = Math.max(40, Math.round((target.viewport?.height || 600) * 0.4));
              return { ok: true, clip: { x: 8, y: 8, width, height, scale: 1 }, dpr: target.viewport?.dpr || 1 };
            }
            if (expression.includes('style.textContent')) {
              const owner = expression.match(/owner = "([^"]+)"/);
              target.owner = owner ? owner[1] : target.owner;
              target.css = parseAssignedString(expression, 'style.textContent = ') || target.css;
              target.writes += 1;
              return { sessionId: target.owner, rules: 5 };
            }
            if (expression.includes('s.textContent')) {
              if (!target.owner) return false;
              target.css = parseAssignedString(expression, 's.textContent = ') || target.css;
              target.writes += 1;
              return true;
            }
            if (expression.includes('s.remove()')) {
              target.owner = null;
              target.css = '';
              return true;
            }
            if (expression.includes('dataset.antiFaceOwner') && expression.includes('getElementById')) return target.owner || '';
            return !!target.owner;
          }
        };
      },
      manifest: { adapters: [{ id: 'test', platform: process.platform, status: 'ready', verifiedHosts: [host] }] }
    });
    global.round5Mock.service = this;
  }
};
const telemetry = require('../../desktop/telemetry-sources.cjs');
const RealTelemetry = telemetry.TelemetryManager;
telemetry.TelemetryManager = class extends RealTelemetry {
  constructor(deps) {
    super({ ...deps, appDataDir: path.join(process.env.ANTI_FACE_TEST_USER_DATA, 'synthetic-logs') });
  }
};
require('../../desktop/main.cjs');
