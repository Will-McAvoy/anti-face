// Isolated Electron entry: real application/IPC/service with two synthetic CDP targets.
const path = require('node:path');
const { SELECTORS, VARIABLES } = require('../../core/runtime.cjs');
const serviceModule = require('../../desktop/theme-service.cjs');
const RealService = serviceModule.ThemeService;
const host = { installed: true, path: 'mock.exe', version: 'test', fingerprint: 'test' };
const windows = { A: { owner: null, writes: 0 }, B: { owner: null, writes: 0 } };
global.round3Mock = { windows, connected: true, delayB: 0 };
serviceModule.ThemeService = class extends RealService {
  constructor(options) {
    super({ ...options,
      inspectHost: async () => host,
      discoverEndpoint: async () => ({ port: 9 }),
      getJSON: async () => {
        if (!global.round3Mock.connected) throw new Error('offline');
        return Object.keys(windows).map(id => ({ id, title: `Mock ${id}`, type: 'page', url: `https://127.0.0.1/c/${id}`, webSocketDebuggerUrl: `ws://127.0.0.1/${id}` }));
      },
      connect: async address => {
        const id = address.split('/').pop();
        const target = windows[id];
        return { close() {}, async evaluate(expression) {
          if (expression.includes('selectors:')) {
            if (id === 'B' && global.round3Mock.delayB) await new Promise(resolve => setTimeout(resolve, global.round3Mock.delayB));
            return { title: 'Antigravity', selectors: Object.fromEntries(SELECTORS.map(k => [k, true])), variables: Object.fromEntries(VARIABLES.map(k => [k, true])), supportsBackdropFilter: true, sessionId: target.owner };
          }
          if (expression.includes('style.textContent')) {
            target.owner = expression.match(/owner = "([^"]+)"/)[1];
            target.writes++;
            return { sessionId: target.owner, rules: 5 };
          }
          if (expression.includes('s.remove()')) { target.owner = null; return true; }
          return !!target.owner;
        } };
      },
      manifest: { adapters: [{ id: 'test', platform: process.platform, status: 'ready', verifiedHosts: [host] }] }
    });
    global.round3Mock.service = this;
  }
};
const telemetry = require('../../desktop/telemetry-sources.cjs');
const RealTelemetry = telemetry.TelemetryManager;
telemetry.TelemetryManager = class extends RealTelemetry {
  constructor(deps) {
    super({ ...deps, appDataDir: path.join(process.env.ANTI_FACE_TEST_USER_DATA, 'synthetic-logs') });
    global.round3Mock.telemetry = this;
  }
};
require('../../desktop/main.cjs');
