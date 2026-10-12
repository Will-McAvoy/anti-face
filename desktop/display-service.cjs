const { clampBoundsToWorkAreas, computeDisplayContextHash } = require('../core/display-context.cjs');

class DisplayService {
  constructor(deps = {}) {
    this.screen = deps.screen || null;
    this.onDisplaysChanged = deps.onDisplaysChanged || (() => {});
    this.debounceTimer = null;
    this.targetContexts = new Map();
  }

  start() {
    if (!this.screen || this.trigger) return;
    const trigger = () => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.onDisplaysChanged(this.getDisplays());
      }, 150);
    };

    this.trigger = trigger;
    try {
      this.screen.on('display-added', trigger);
      this.screen.on('display-removed', trigger);
      this.screen.on('display-metrics-changed', trigger);
    } catch {}
  }

  stop() {
    if(this.trigger) for(const event of ['display-added','display-removed','display-metrics-changed']) this.screen?.removeListener(event,this.trigger);
    this.trigger=null;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  getDisplays() {
    if (!this.screen) {
      return [{ id: 'default', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 }];
    }
    try {
      return this.screen.getAllDisplays().map(d => ({
        id: String(d.id),
        bounds: d.bounds,
        workArea: d.workArea,
        scaleFactor: d.scaleFactor
      }));
    } catch {
      return [{ id: 'fallback', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 }];
    }
  }

  getPrimaryDisplay() {
    if (!this.screen) {
      return { id: 'default', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 };
    }
    try {
      const d = this.screen.getPrimaryDisplay();
      return { id: String(d.id), bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor };
    } catch {
      return { id: 'fallback', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 };
    }
  }

  clampBounds(bounds) {
    const displays = this.getDisplays();
    const workAreas = displays.map(d => d.workArea);
    const primary = this.getPrimaryDisplay().workArea;
    return clampBoundsToWorkAreas(bounds, workAreas, primary);
  }

  updateTargetViewport(targetId, viewport, dpr = 1) {
    if (!targetId) return null;
    const hash = computeDisplayContextHash(viewport, dpr);
    const prev = this.targetContexts.get(targetId);
    const changed = !prev || prev.hash !== hash;
    const version = changed ? (prev ? prev.version + 1 : 1) : prev.version;

    const record = {
      targetId,
      viewport: viewport ? { width: viewport.width, height: viewport.height } : null,
      dpr: Number(dpr) || 1,
      hash,
      version,
      changed
    };

    this.targetContexts.set(targetId, record);
    return record;
  }

  getTargetContext(targetId) {
    return this.targetContexts.get(targetId) || null;
  }
}

module.exports = { DisplayService };
