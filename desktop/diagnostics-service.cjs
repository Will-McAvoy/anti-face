const { classifyScene } = require('../core/scene-policy.cjs');
const { identifyProject } = require('../core/project-identity.cjs');
const { REGION_IDS } = require('../core/regions.cjs');

function stamp(now) {
  return typeof now === 'function' ? now() : now;
}

class DiagnosticsService {
  constructor(deps = {}) {
    this.theme = deps.theme || null;
    this.now = deps.now || (() => new Date().toISOString());
    this.cache = new Map();
    this.inflight = new Map();
  }

  invalidate(targetId) {
    if (targetId) this.cache.delete(targetId);
    else this.cache.clear();
  }

  inspect(targetId, extras = {}) {
    const key = targetId || 'none';
    if (this.inflight.has(key)) return this.inflight.get(key);
    const job = this._inspect(targetId, extras).finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  async _inspect(targetId, extras) {
    const checkedAt = stamp(this.now);
    const status = this.theme?.statusFor ? this.theme.statusFor(targetId) : (this.theme?.status || null);
    const host = status?.host || null;
    const probe = extras.probe || status?.probe || null;
    const navigation = extras.navigationId || probe?.navigationId || status?.probe?.navigationId || '0';
    const fingerprint = host?.fingerprint || 'none';
    const previous = this.cache.get(targetId || 'none');
    if (previous && (previous.fingerprint !== fingerprint || previous.navigationId !== navigation)) previous.fresh = false;
    const regionRows = REGION_IDS.filter(id => id !== 'global').map(id => {
      const selectors = probe?.regions || {};
      const hits = Object.entries(selectors).filter(([, present]) => present === true);
      const present = extras.regionPresence ? extras.regionPresence[id] : undefined;
      let state = 'unknown';
      if (present === true || (probe && hits.length && id === 'sidebar' && probe.regions?.['[data-testid="conversation-list-sidebar"]'] === true)) state = 'supported';
      if (present === false) state = 'not-present';
      if (extras.regionSupport && extras.regionSupport[id] === 'unsupported') state = 'unsupported';
      return { id, state, checkedAt, evidence: state === 'unknown' ? '没有被动探针结果' : '来自当前页面结构' };
    });
    const scene = classifyScene(probe || extras.sceneProbe || {});
    const project = identifyProject(extras.project || {});
    const report = {
      targetId: targetId || null,
      checkedAt,
      fingerprint,
      navigationId: navigation,
      fresh: status?.state !== 'detached',
      host: host ? { installed: host.installed === true, version: host.version || null, compatibility: host.compatibility || null, fingerprint } : { installed: false, version: null, compatibility: 'not-installed', fingerprint: null },
      connection: { state: status?.state || 'detached', message: status?.message || '没有连接' },
      regions: regionRows,
      capture: { state: extras.captureSupported === true ? 'supported' : extras.captureSupported === false ? 'unsupported' : 'unknown', checkedAt },
      scene: { state: scene.scene === 'unknown' ? 'unknown' : 'supported', scene: scene.scene, evidence: scene.evidence, checkedAt },
      project: { state: project.reliable ? 'supported' : 'unknown', confidence: project.confidence, displayHint: project.displayHint || null, checkedAt },
      actions: []
    };
    if (!host?.installed) report.actions.push({ id: 'install', label: '先安装并打开 Antigravity，再重新检查' });
    if (status?.state === 'detached') report.actions.push({ id: 'reconnect', label: '重新检测当前窗口' });
    if (scene.scene === 'unknown') report.actions.push({ id: 'scene', label: '打开首页或聊天页后再识别场景' });
    this.cache.set(targetId || 'none', report);
    return report;
  }

  cached(targetId) {
    return this.cache.get(targetId || 'none') || null;
  }

  exportable(targetId) {
    const report = this.cached(targetId);
    if (!report) return { ok: false, code: 'DIAGNOSTIC_STALE', message: '还没有诊断结果', retryable: true };
    return { ok: true, preview: redactDiagnostics(report), report: redactDiagnostics(report) };
  }
}

function redactDiagnostics(report) {
  const copy = JSON.parse(JSON.stringify(report || {}));
  delete copy.url;
  delete copy.title;
  delete copy.path;
  delete copy.token;
  if (copy.project) {
    delete copy.project.normalizedPath;
    delete copy.project.projectKey;
  }
  return copy;
}

module.exports = { DiagnosticsService, redactDiagnostics };
