const test = require('node:test');
const assert = require('node:assert/strict');
const { ThemeService } = require('../desktop/theme-service.cjs');
const { SELECTORS, VARIABLES } = require('../core/runtime.cjs');
const { documentFromLegacy, validateThemeDocument } = require('../core/theme-schema.cjs');
const { buildDocumentCSS } = require('../core/theme-css.cjs');
const { buildVerificationPlan } = require('../core/apply-verification.cjs');
const { redactDiagnostics } = require('../desktop/diagnostics-service.cjs');
const { encodePng } = require('../core/image-decode.cjs');
const { AssetStore } = require('../desktop/asset-store.cjs');
const { ThemeLibrary } = require('../desktop/theme-library.cjs');
const { Round5Service } = require('../desktop/round5-service.cjs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const baseHost = { installed: true, path: 'test.exe', version: '1', fingerprint: 'abc' };
const manifest = { adapters: [{ id: 'test', platform: process.platform, status: 'ready', verifiedHosts: [baseHost] }] };

function legacyDocument() {
  return validateThemeDocument(documentFromLegacy({
    schemaVersion: 1,
    themeId: 'graphite',
    appearance: { blur: 18, opacity: 88, radius: 14, wallpaper: null }
  }));
}

test('E07 写入成功但颜色被盖住时要失败并确认恢复', async () => {
  const document = legacyDocument();
  const plan = buildVerificationPlan(buildDocumentCSS(document).resolved, { wallpaper: false });
  const state = { host: { ...baseHost }, owner: null, styleOn: false, writes: 0, restores: 0, verifies: 0 };
  const probe = () => ({
    title: 'Workspace - Antigravity',
    selectors: Object.fromEntries(SELECTORS.map(item => [item, true])),
    regions: {},
    variables: Object.fromEntries(VARIABLES.map(item => [item, true])),
    supportsBackdropFilter: true,
    sessionId: state.owner
  });
  const client = {
    close() {},
    evaluate: async expression => {
      if (expression.includes('const plan')) {
        state.verifies += 1;
        const overridden = state.verifies === 2;
        return {
          kind: 'anti-face-verify',
          checks: plan.checks.map(item => {
            if (item.id === 'owned-style') return { id: item.id, state: state.styleOn ? 'present' : 'missing', rules: state.styleOn ? 4 : 0, ownerMatch: state.styleOn };
            if (item.kind === 'reachable') return { id: item.id, state: 'present', reachable: true };
            return { id: item.id, state: 'present', actual: overridden && item.id === 'body-color' ? '#ffffff' : item.expected };
          })
        };
      }
      if (expression.includes('s.remove()')) {
        state.styleOn = false;
        state.owner = null;
        state.restores += 1;
        return true;
      }
      if (expression.includes('s.textContent')) return state.styleOn;
      if (expression.includes('style.textContent')) {
        state.writes += 1;
        state.styleOn = true;
        state.owner = expression.match(/owner = "([^"]+)"/)[1];
        return { sessionId: state.owner, rules: 4 };
      }
      if (expression.includes('selectors:')) return probe();
      return !!state.owner;
    }
  };
  const service = new ThemeService({
    inspectHost: async () => state.host,
    discoverEndpoint: async () => ({ port: 1234 }),
    getJSON: async () => [{ id: 'target', type: 'page', url: 'https://127.0.0.1:1235', webSocketDebuggerUrl: 'ws://127.0.0.1:1234/devtools/page/target' }],
    connect: async () => client,
    manifest
  });
  const first = await service.applyDocument(document, null, { verify: true });
  assert.equal(first.state, 'applied');
  await assert.rejects(service.applyDocument(document, null, { verify: true }), error => error.code === 'VERIFY_FAILED');
  assert.equal(state.writes, 2);
  assert.equal(service.session == null, false);
  assert.equal(service.targets.values().next().value.state, 'ready');
  assert.match(service.targets.values().next().value.message, /恢复/);
  assert.equal(state.restores, 0);
});

async function tempStudio() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-r5s-'));
  const assets = new AssetStore(path.join(dir, 'assets'));
  await assets.init();
  const library = new ThemeLibrary(path.join(dir, 'library.json'), { assets });
  await library.load();
  const studio = {
    userData: dir,
    assets,
    library,
    theme: { targets: new Map(), statusFor: () => ({ state: 'detached', message: '没有连接' }), applyDocument: async () => ({ state: 'applied' }) },
    preview: { state: () => ({ phase: 'idle' }) },
    selectedTargetId: null,
    document: legacyDocument(),
    automation: {},
    async _assetUrl() { return null; },
    async saveDocument(document) { this.document = document; return document; }
  };
  const round5 = new Round5Service(studio, { catalogRoot: path.join(__dirname, '../assets/catalog') });
  await round5.start();
  return { dir, studio, round5, assets };
}

test('E02 两个窗口绑定不同项目主题', async () => {
  const { dir, round5 } = await tempStudio();
  try {
    const left = round5.rememberProject('window-a', { projectPath: 'D:/work/alpha' });
    const right = round5.rememberProject('window-b', { projectPath: 'D:/work/beta' });
    await round5.saveBinding({ projectKey: left.projectKey, themeId: 'ink', targetId: 'window-a' });
    await round5.saveBinding({ projectKey: right.projectKey, themeId: 'pearl', targetId: 'window-b' });
    assert.equal(round5.projectDecision('window-a').themeId, 'ink');
    assert.equal(round5.projectDecision('window-b').themeId, 'pearl');
    assert.notEqual(left.projectKey, right.projectKey);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('E04 场景稳定后才切换，手动固定不再自动应用', async () => {
  const { dir, studio, round5 } = await tempStudio();
  try {
    const applied = [];
    studio.theme.applyDocument = async (_document, targetId) => {
      applied.push(targetId);
      return { state: 'applied' };
    };
    studio.document = validateThemeDocument({
      ...studio.document,
      sceneAppearance: {
        mode: 'auto',
        home: { maskStrength: 10, opacity: null },
        chat: { maskStrength: 60, opacity: null }
      }
    });
    round5.setActiveDocument('window-a', studio.document);
    const jobs = [];
    round5.scenes.onScene = (targetId, scene) => { jobs.push(round5.onAutoScene(targetId, scene)); };
    round5.scenes.observe('window-a', { title: '聊天' }, 0);
    assert.equal(round5.scenes.current('window-a'), 'unknown');
    round5.scenes.observe('window-a', { routeHint: 'home' }, 0);
    round5.scenes.observe('window-a', { routeHint: 'home' }, 500);
    await Promise.all(jobs);
    assert.equal(round5.scenes.current('window-a'), 'home');
    assert.equal(applied.length, 1);
    round5.scenes.observe('window-a', { routeHint: 'chat' }, 600);
    round5.scenes.observe('window-a', { routeHint: 'chat' }, 1100);
    await Promise.all(jobs);
    assert.equal(round5.scenes.current('window-a'), 'chat');
    assert.equal(applied.length, 2);
    round5.hold('window-a');
    round5.scenes.observe('window-a', { hasConversation: true }, 1200);
    round5.scenes.observe('window-a', { hasConversation: true }, 1800);
    await Promise.all(jobs);
    assert.equal(round5.scenes.current('window-a'), 'home');
    assert.equal(applied.length, 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('E06 取消先到或中途取消都不会留下候选和采样', async () => {
  const { dir, round5, assets } = await tempStudio();
  try {
    const data = Buffer.alloc(8 * 8 * 4, 0);
    for (let i = 0; i < data.length; i += 4) data[i] = 20;
    const imported = await assets.importImage(encodePng(8, 8, data), assets.beginImport());
    round5.cancelGenerate('req-early');
    const early = await round5.generate(imported.record.id, {}, 'req-early');
    assert.equal(early.code, 'CANCELLED');
    const pending = round5.generate(imported.record.id, {}, 'req-live');
    round5.cancelGenerate('req-live');
    const live = await pending;
    assert.equal(live.code, 'CANCELLED');
    assert.equal(round5.jobs.size, 0);
    assert.equal(round5.pixelCache.has(imported.record.id), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('E01 阅读建议不改原文档，同一内容只记一次版本', async () => {
  const { dir, round5, studio } = await tempStudio();
  try {
    const source = validateThemeDocument({
      ...studio.document,
      readability: { mode: 'suggest', targetContrast: 4.5, locks: [] }
    });
    const before = JSON.stringify(source);
    const explained = await round5.explain(source, null, { viewport: { width: 800, height: 600 } });
    assert.equal(JSON.stringify(source), before);
    assert.ok(explained.readability);
    const first = await round5.remember(source, { source: 'save', themeId: source.id });
    const second = await round5.remember(source, { source: 'save', themeId: source.id });
    assert.equal(first.deduped, false);
    assert.equal(second.deduped, true);
    assert.equal((await round5.revisionsFor(source.id)).length, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('E12 诊断导出去掉路径、标题和令牌', () => {
  const clean = redactDiagnostics({
    token: 'test-secret',
    title: '客户聊天全文',
    path: 'D:\\secret\\client-alpha',
    url: 'https://example.test/chat',
    project: { displayHint: 'client-alpha', normalizedPath: 'D:\\secret\\client-alpha', projectKey: 'path:abc' },
    connection: { state: 'detached' }
  });
  const text = JSON.stringify(clean);
  assert.equal(clean.token, undefined);
  assert.equal(clean.title, undefined);
  assert.equal(clean.path, undefined);
  assert.equal(clean.project.normalizedPath, undefined);
  assert.equal(clean.project.displayHint, 'client-alpha');
  assert.equal(text.includes('test-secret'), false);
  assert.equal(text.includes('D:\\\\secret'), false);
  assert.equal(text.includes('客户聊天'), false);
});
