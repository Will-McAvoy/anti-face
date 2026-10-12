class ShortcutService {
  constructor(deps = {}) {
    this.globalShortcut = deps.globalShortcut;
    this.onAction = deps.onAction || (() => {});
    this.active = {};
    this.handlers = new Map();
  }

  status(saved) {
    return {
      enabled: saved?.enabled === true,
      saved: saved?.bindings || {},
      registered: { ...this.active }
    };
  }

  apply(preferences) {
    if (!preferences?.shortcuts?.enabled) {
      this.stop();
      return { ok: true, active: {}, failed: null };
    }
    return this.register(preferences.shortcuts.bindings || {});
  }

  register(bindings) {
    const previous = { ...this.active };
    const added = [];
    const next = {};
    for (const [action, accelerator] of Object.entries(bindings)) {
      if (!accelerator) continue;
      if (previous[action] === accelerator && this.handlers.has(accelerator)) {
        next[action] = accelerator;
        continue;
      }
      const handler = () => this.onAction(action);
      const ok = this.globalShortcut.register(accelerator, handler);
      if (!ok) {
        for (const item of added) {
          this.globalShortcut.unregister(item.accelerator);
          this.handlers.delete(item.accelerator);
        }
        return { ok: false, code: 'SHORTCUT_UNAVAILABLE', failed: accelerator, active: previous };
      }
      added.push({ action, accelerator, handler });
      next[action] = accelerator;
    }
    for (const [action, accelerator] of Object.entries(previous)) {
      if (next[action] !== accelerator) {
        this.globalShortcut.unregister(accelerator);
        this.handlers.delete(accelerator);
      }
    }
    for (const item of added) this.handlers.set(item.accelerator, item.handler);
    this.active = next;
    return { ok: true, active: { ...next }, failed: null };
  }

  stop() {
    for (const accelerator of Object.values(this.active)) {
      this.globalShortcut.unregister(accelerator);
      this.handlers.delete(accelerator);
    }
    this.active = {};
  }

  get handlerCount() {
    return this.handlers.size;
  }
}

module.exports = { ShortcutService };
