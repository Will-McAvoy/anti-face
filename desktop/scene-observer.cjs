const { classifyScene, createSceneState, stepScene } = require('../core/scene-policy.cjs');

class SceneObserver {
  constructor(deps = {}) {
    this.clock = deps.clock || Date.now;
    this.schedule = deps.schedule || ((fn, ms) => setInterval(fn, ms));
    this.clear = deps.clear || (id => clearInterval(id));
    this.intervalMs = deps.intervalMs ?? 2000;
    this.stableMs = deps.stableMs ?? 500;
    this.minIntervalMs = deps.minIntervalMs ?? 500;
    this.targets = new Map();
    this.onScene = deps.onScene || (() => {});
  }

  activeTimers() {
    let count = 0;
    for (const entry of this.targets.values()) if (entry.timer) count += 1;
    return count;
  }

  watch(targetId, readProbe) {
    this.unwatch(targetId);
    const entry = { state: createSceneState(), readProbe, timer: null, scene: 'unknown' };
    entry.timer = this.schedule(() => { void this.poll(targetId); }, this.intervalMs);
    this.targets.set(targetId, entry);
    return entry.scene;
  }

  unwatch(targetId) {
    const entry = this.targets.get(targetId);
    if (!entry) return;
    if (entry.timer) this.clear(entry.timer);
    this.targets.delete(targetId);
  }

  stop() {
    for (const targetId of [...this.targets.keys()]) this.unwatch(targetId);
  }

  current(targetId) {
    return this.targets.get(targetId)?.scene || 'unknown';
  }

  observe(targetId, probe, now = this.clock()) {
    const entry = this.targets.get(targetId) || { state: createSceneState(), scene: 'unknown', timer: null, readProbe: null };
    if (!this.targets.has(targetId)) this.targets.set(targetId, entry);
    const classified = classifyScene(probe);
    const stepped = stepScene(entry.state, { scene: classified.scene, now }, { stableMs: this.stableMs, minIntervalMs: this.minIntervalMs });
    entry.state = stepped.state;
    const previous = entry.scene;
    entry.scene = stepped.scene;
    if (stepped.changed && previous !== entry.scene) this.onScene(targetId, entry.scene);
    return { scene: entry.scene, changed: stepped.changed, evidence: classified.evidence };
  }

  async poll(targetId) {
    const entry = this.targets.get(targetId);
    if (!entry?.readProbe) return this.current(targetId);
    const probe = await entry.readProbe().catch(() => null);
    return this.observe(targetId, probe || {}, this.clock());
  }
}

module.exports = { SceneObserver };
