const test = require('node:test');
const assert = require('node:assert/strict');
const { ThemeService } = require('../desktop/theme-service.cjs');
const { SELECTORS, VARIABLES, compatibleProbe } = require('../core/runtime.cjs');
const { DEFAULT_APPEARANCE } = require('../core/theme.cjs');
const baseHost = { installed: true, path: 'test.exe', version: '1', fingerprint: 'abc' };
const manifest = { adapters: [{ id: 'test', platform: process.platform, status: 'ready', verifiedHosts: [baseHost] }] };
const settings = { schemaVersion: 1, themeId: 'graphite', appearance: DEFAULT_APPEARANCE };
function fixture(overrides = {}) {
  const state = { host: { ...baseHost }, owner: null, closed: false, writes: 0, selectors: true };
  const probe = () => ({ title: 'Workspace - Antigravity', selectors: Object.fromEntries(SELECTORS.map(s => [s, state.selectors])), variables: Object.fromEntries(VARIABLES.map(s => [s, true])), supportsBackdropFilter: true, sessionId: state.owner });
  const client = {
    close: () => { state.closed = true; },
    evaluate: async expression => {
      if (expression.includes('selectors:')) return probe();
      if (expression.includes('style.textContent')) { state.writes++; state.owner = expression.match(/owner = "([^"]+)"/)[1]; return { sessionId: state.owner, rules: 4 }; }
      if (expression.includes('s.remove()')) { state.owner = null; return true; }
      return !!state.owner;
    },
  };
  const service = new ThemeService({ inspectHost: async () => state.host, discoverEndpoint: async () => ({ port: 1234 }), getJSON: async () => [{ id: 'target', type: 'page', url: 'https://127.0.0.1:1235', webSocketDebuggerUrl: 'ws://127.0.0.1:1234/devtools/page/target' }], connect: async () => client, manifest, ...overrides });
  return { service, state, probe };
}
test('host updates restore the active style and suspend the session', async () => {
  const { service, state } = fixture();
  assert.equal((await service.apply(settings)).state, 'applied');
  state.host = { ...baseHost, fingerprint: 'changed' };
  assert.equal((await service.tick()).state, 'suspended');
  assert.equal(state.owner, null);
  assert.equal(service.session, null);
});
test('unverified hosts and unsupported structures cannot write CSS', async () => {
  const { service, state } = fixture({ manifest: { adapters: [] } });
  await assert.rejects(service.apply(settings), /尚未验证/);
  assert.equal(state.writes, 0);
  state.selectors = false;
  assert.equal((await service.inspect()).state, 'unsupported');
});
test('reload clears applied state; apply/restore requests are serialized', async () => {
  const { service, state } = fixture();
  await Promise.all([service.apply(settings), service.restore()]);
  assert.equal(state.owner, null);
  await service.apply(settings);
  state.owner = null;
  assert.equal((await service.tick()).state, 'ready');
  assert.equal(service.session, null);
});
test('active foreign sessions are not overwritten and title suffix is accepted', async () => {
  const { service, state, probe } = fixture();
  assert.equal(compatibleProbe(probe()), true);
  state.owner = 'foreign';
  await assert.rejects(service.apply(settings), /另一个主题会话/);
  assert.equal(state.writes, 0);
  await service.dispose();
  assert.equal(state.owner, 'foreign');
});
