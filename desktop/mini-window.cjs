const path = require('node:path');
const { clampBounds } = require('../core/bounds.cjs');

class MiniWindowController {
  constructor(deps = {}) {
    this.BrowserWindow = deps.BrowserWindow;
    this.screen = deps.screen || { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1280, height: 800 } }] };
    this.getSnapshot = deps.getSnapshot || (() => ({}));
    this.entry = deps.entry || path.join(__dirname, 'mini.html');
    this.preload = deps.preload || path.join(__dirname, 'mini-preload.cjs');
    this.onBoundsPersist = deps.onBoundsPersist || null;
    this.window = null;
    this.timer = null;
    this.schedule = deps.schedule || ((fn, ms) => setInterval(fn, ms));
    this.clear = deps.clear || (id => clearInterval(id));
    this.bounds = null;
    this.subscriptions = 0;
    this._saveTimer = null;
    this._onDisplayChange = () => this.clampToScreens();
    if (this.screen.on) {
      this.screen.on('display-metrics-changed', this._onDisplayChange);
      this.screen.on('display-removed', this._onDisplayChange);
    }
  }

  get open() {
    return !!this.window && !this.window.isDestroyed?.();
  }

  clampToScreens() {
    if (!this.open) return;
    const current = this.window.getBounds();
    const clamped = clampBounds(current, this.screen.getAllDisplays());
    if (clamped.x !== current.x || clamped.y !== current.y || clamped.width !== current.width || clamped.height !== current.height) {
      this.bounds = clamped;
      this.window.setBounds(clamped);
      this._notifyBoundsChanged(clamped);
    }
  }

  _notifyBoundsChanged(bounds) {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      if (this.onBoundsPersist) this.onBoundsPersist(bounds);
    }, 300);
  }

  setAlwaysOnTop(alwaysOnTop) {
    if (this.open) {
      this.window.setAlwaysOnTop?.(!!alwaysOnTop);
    }
  }

  async show(options = {}) {
    if (this.open) {
      if (this.window.showInactive) this.window.showInactive();
      else this.window.show?.();
      return this.bounds;
    }
    const bounds = clampBounds(options.bounds || this.bounds, this.screen.getAllDisplays());
    this.bounds = bounds;
    this.window = new this.BrowserWindow({
      ...bounds,
      frame: false,
      show: false,
      alwaysOnTop: options.alwaysOnTop === true,
      skipTaskbar: true,
      focusable: true,
      title: 'Anti Face 迷你状态',
      webPreferences: {
        preload: this.preload,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });
    this.window.setMenuBarVisibility?.(false);
    this.window.webContents?.setWindowOpenHandler?.(() => ({ action: 'deny' }));
    this.window.webContents?.on?.('will-navigate', event => event.preventDefault());

    this.window.on?.('moved', () => {
      if (this.open) {
        const next = this.window.getBounds();
        this.bounds = next;
        this._notifyBoundsChanged(next);
      }
    });

    this.window.on?.('resized', () => {
      if (this.open) {
        const next = this.window.getBounds();
        this.bounds = next;
        this._notifyBoundsChanged(next);
      }
    });

    this.window.on?.('close', () => {
      this._detach();
    });
    this.window.on?.('closed', () => {
      this.window = null;
    });
    await this.window.loadFile?.(this.entry);
    this._attach();
    if (this.window.showInactive) this.window.showInactive();
    else this.window.show?.();
    return bounds;
  }

  _attach() {
    if (this.timer) return;
    this.subscriptions += 1;
    this.timer = this.schedule(() => {
      if (!this.open) return;
      this.window.webContents?.send?.('mini:update', this.getSnapshot());
    }, 2000);
  }

  _detach() {
    if (this.timer) this.clear(this.timer);
    this.timer = null;
    this.subscriptions = Math.max(0, this.subscriptions - 1);
  }

  hideRefresh() {
    if (this.timer) this.clear(this.timer);
    this.timer = this.schedule(() => {
      if (!this.open) return;
      this.window.webContents?.send?.('mini:update', this.getSnapshot());
    }, 10000);
  }

  dispose(){
    for(const event of ['display-metrics-changed','display-removed'])this.screen.removeListener?.(event,this._onDisplayChange);
    if(this._saveTimer)clearTimeout(this._saveTimer);this._saveTimer=null;return this.close();
  }

  close() {
    this._detach();
    if (this.window && !this.window.isDestroyed?.()) this.window.close?.();
    this.window = null;
    return { closed: true, quit: false };
  }

  move(bounds) {
    const next = clampBounds(bounds, this.screen.getAllDisplays());
    this.bounds = next;
    this.window?.setBounds?.(next);
    this._notifyBoundsChanged(next);
    return next;
  }

  get activeTimers() {
    return this.timer ? 1 : 0;
  }
}

module.exports = { MiniWindowController };
