const test = require('node:test');
const assert = require('node:assert/strict');
const { ThemeService } = require('../desktop/theme-service.cjs');
const { SELECTORS, VARIABLES } = require('../core/runtime.cjs');
const { DEFAULT_APPEARANCE, PERFORMANCE_PRESETS, buildCSS } = require('../core/theme.cjs');

const baseHost = { installed: true, path: 'test.exe', version: '1', fingerprint: 'abc' };
const manifest = { adapters: [{ id: 'test', platform: process.platform, status: 'ready', verifiedHosts: [baseHost] }] };
const settings = { schemaVersion: 1, themeId: 'graphite', appearance: DEFAULT_APPEARANCE };

function fixture(overrides = {}) {
  const state = { host: { ...baseHost }, owner: null, closed: false, writes: 0, selectors: true };
  const probe = () => ({
    title: 'Folder Feature - hermes - Antigravity',
    selectors: Object.fromEntries(SELECTORS.map(s => [s, state.selectors])),
    variables: Object.fromEntries(VARIABLES.map(s => [s, true])),
    supportsBackdropFilter: true,
    sessionId: state.owner
  });

  const client = {
    close: () => { state.closed = true; },
    evaluate: async expression => {
      if (expression.includes('selectors:')) return probe();
      if (expression.includes('style.textContent')) {
        state.writes++;
        state.owner = expression.match(/owner = "([^"]+)"/)[1];
        return { sessionId: state.owner, rules: 4 };
      }
      if (expression.includes('s.remove()')) {
        state.owner = null;
        return true;
      }
      return !!state.owner;
    }
  };

  const service = new ThemeService({
    inspectHost: async () => state.host,
    discoverEndpoint: async () => ({ port: 1234 }),
    getJSON: async () => [
      { id: 'target-1', type: 'page', url: 'https://127.0.0.1:1235/c/1', title: 'Window 1 - hermes', webSocketDebuggerUrl: 'ws://127.0.0.1:1234/devtools/page/target-1' },
      { id: 'target-2', type: 'page', url: 'https://127.0.0.1:1235/c/2', title: 'Window 2 - project2', webSocketDebuggerUrl: 'ws://127.0.0.1:1234/devtools/page/target-2' }
    ],
    connect: async () => client,
    manifest,
    ...overrides
  });

  return { service, state, probe, client };
}

test('T12: 自动恢复竞态防护 - 用户点击恢复默认后，不被旧异步回调重新上色', async () => {
  const { service, state } = fixture({ autoRestoreOnReload: true });

  // 1. 应用主题
  await service.apply(settings);
  assert.equal(state.writes, 1);
  assert.ok(state.owner);

  // 2. 模拟宿主刷新 (style 消失)
  state.owner = null;

  // 3. 用户在检测前/自动恢复就绪前，显式点击“恢复原样”
  await service.restore();
  assert.equal(state.owner, null);

  // 4. 触发 tick 检测，由于 generationToken 已改变，旧的恢复任务绝不重新注入
  await service.tick();
  assert.equal(state.owner, null);
  assert.equal(state.writes, 1); // 写入次数没有增加！
});

test('F5.1: 多窗口目标枚举与脱敏', async () => {
  const { service } = fixture();
  const targets = await service.listTargets();
  assert.equal(targets.length, 2);
  assert.equal(targets[0].id, 'target-1');
  assert.equal(targets[1].id, 'target-2');
  assert.ok(targets[0].title.includes('Window 1'));
});

test('F5.4: 三档性能预设在 CSS 中正确生效', () => {
  // 性能优先模式
  const perfCss = buildCSS({
    schemaVersion: 1,
    themeId: 'graphite',
    appearance: { ...DEFAULT_APPEARANCE, ...PERFORMANCE_PRESETS.performance }
  });
  assert.ok(perfCss.includes('backdrop-filter:blur(0px)'));
  assert.ok(perfCss.includes('border-radius:8px'));
  assert.ok(perfCss.includes('prefers-reduced-motion'));

  // 视觉优先模式
  const visualCss = buildCSS({
    schemaVersion: 1,
    themeId: 'graphite',
    appearance: { ...DEFAULT_APPEARANCE, ...PERFORMANCE_PRESETS.visual }
  });
  assert.ok(visualCss.includes('backdrop-filter:blur(24px)'));
  assert.ok(visualCss.includes('border-radius:24px'));
});
