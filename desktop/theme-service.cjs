const { randomUUID } = require('node:crypto');
const { inspectHost, discoverEndpoint } = require('./host.cjs');
const { CDP, getJSON } = require('./cdp.cjs');
const { checkCompatibility } = require('../core/compatibility.cjs');
const { buildCSS, validateSettings } = require('../core/theme.cjs');
const { buildDocumentCSS } = require('../core/theme-css.cjs');
const { validateThemeDocument } = require('../core/theme-schema.cjs');
const { buildVerificationPlan, compareObservation, verifyExpression } = require('../core/apply-verification.cjs');
const {
  probeExpression,
  applyExpression,
  setStyleExpression,
  heartbeatExpression,
  restoreExpression,
  readStyleOwnerExpression,
  compatibleProbe,
  STYLE_ID
} = require('../core/runtime.cjs');
const manifest = require('../compatibility/manifest.json');

class ThemeService {
  constructor(deps = {}) {
    this.inspectHost = deps.inspectHost || inspectHost;
    this.discoverEndpoint = deps.discoverEndpoint || discoverEndpoint;
    this.getJSON = deps.getJSON || getJSON;
    this.connect = deps.connect || CDP.connect;
    this.manifest = deps.manifest || manifest;
    this.autoRestoreOnReload = !!deps.autoRestoreOnReload;
    this.retryDelayMs = Number.isFinite(deps.retryDelayMs) ? deps.retryDelayMs : 500;
    this.queue = Promise.resolve();
    this.targets = new Map();
    this.focusId = null;
    this.status = {
      state: 'detached',
      message: '检测 Antigravity 后即可连接',
      host: null,
      probe: null,
      session: null
    };
    this._portCache = null;
    this._portCacheExpires = 0;
  }

  /** 当前焦点窗口的会话。每个窗口的真实状态在 targets 里，这里不再另存一份主会话。 */
  get session() {
    if (!this.focusId) return null;
    return this.targets.get(this.focusId)?.session || null;
  }

  exclusive(fn) {
    const task = this.queue.catch(() => {}).then(fn);
    this.queue = task;
    return task;
  }

  async getPort(host) {
    if (this._portCache && Date.now() < this._portCacheExpires) return this._portCache;
    const { port } = await this.discoverEndpoint(host);
    this._portCache = port;
    // Ownership is re-verified on expiry; a failed CDP request clears the cache immediately.
    this._portCacheExpires = Date.now() + 30000;
    return port;
  }

  setAutoRestore(enabled) {
    const next = !!enabled && !this.round5?.studio?.safeMode && !this.round5?.studio?.migrationActive;
    if (this.autoRestoreOnReload && !next) {
      for (const entry of this.targets.values()) entry.autoGeneration += 1;
    }
    this.autoRestoreOnReload = next;
  }

  _invalidate(targetId) {
    const entry = targetId ? this.targets.get(targetId) : null;
    if (entry) entry.generation += 1;
  }

  _still(entry, epoch, autoEpoch) {
    return !!entry && entry.generation === epoch && entry.autoGeneration === autoEpoch;
  }

  _publish(entry) {
    const status = {
      state: entry.state,
      message: entry.message,
      host: entry.host || null,
      probe: entry.probe || null,
      session: entry.session || null,
      verification: entry.verification || null
    };
    entry.status = status;
    if (!this.focusId || this.focusId === entry.id) this.status = status;
    return status;
  }

  _pages(raw) {
    return (raw || []).filter(target => {
      try {
        const url = new URL(target.url);
        return target.type === 'page' && url.protocol === 'https:' && url.hostname === '127.0.0.1';
      } catch {
        return false;
      }
    });
  }

  async _rawTargets(host) {
    const port = await this.getPort(host);
    try {
      return { port, raw: await this.getJSON(port, '/json/list') };
    } catch (error) {
      this._portCache = null;
      throw error;
    }
  }

  _blankEntry(target, client) {
    return {
      id: target.id,
      client,
      session: null,
      desiredSettings: null,
      generation: 0,
      autoGeneration: 0,
      state: 'probing',
      message: '正在检测连接',
      host: null,
      probe: null,
      identity: {
        url: target.url,
        title: target.title || '',
        ws: target.webSocketDebuggerUrl
      },
      status: null,
      verification: null,
      lastConfirmed: null
    };
  }

  async _dropEntry(entry, message) {
    entry.generation += 1;
    if (entry.session && entry.client) {
      await entry.client.evaluate(restoreExpression(entry.session.id)).catch(() => {});
    }
    entry.session = null;
    try { entry.client?.close(); } catch { /* already closed */ }
    entry.client = null;
    this.targets.delete(entry.id);
    this.round5?.dropTarget?.(entry.id);
    if (this.focusId === entry.id) {
      this.focusId = null;
      this.status = {
        state: 'detached',
        message: message || '窗口已关闭',
        host: this.status.host,
        probe: null,
        session: null
      };
    }
  }

  /**
   * 连接指定窗口，或在未指定时寻找第一个结构兼容的窗口。
   * 每个 targetId 使用自己的 client，不会复用其他窗口的连接。
   */
  async _ensureEntry(specificTargetId = null) {
    const host = await this.inspectHost();
    let port;
    let raw;
    try {
      ({ port, raw } = await this._rawTargets(host));
    } catch (error) {
      this.status = { state: 'detached', message: error.message, host, probe: null, session: null };
      return null;
    }
    const pages = this._pages(raw);
    if (specificTargetId && !pages.some(page => page.id === specificTargetId)) {
      const existing = this.targets.get(specificTargetId);
      if (existing) await this._dropEntry(existing, '所选窗口已关闭');
      else {
        this.status = { state: 'detached', message: '未找到指定窗口', host, probe: null, session: null };
      }
      return null;
    }
    const candidates = specificTargetId ? pages.filter(page => page.id === specificTargetId) : pages;
    for (const target of candidates) {
      let entry = this.targets.get(target.id);
      if (!entry || !entry.client) {
        let client;
        try {
          client = await this.connect(target.webSocketDebuggerUrl, port);
        } catch {
          continue;
        }
        if (entry) {
          entry.generation += 1;
          entry.client = client;
          entry.identity = { url: target.url, title: target.title || '', ws: target.webSocketDebuggerUrl };
          this.round5?.noteNavigation?.(entry.id);
        } else {
          entry = this._blankEntry(target, client);
          this.targets.set(target.id, entry);
          this.round5?.replaceTarget?.(target.id);
        }
      } else if (entry.identity?.url && entry.identity.url !== target.url) {
        entry.identity = { url: target.url, title: target.title || '', ws: target.webSocketDebuggerUrl };
        this.round5?.noteNavigation?.(entry.id);
      } else {
        entry.identity = { url: target.url, title: target.title || '', ws: target.webSocketDebuggerUrl };
      }

      let probe;
      try {
        probe = await entry.client.evaluate(probeExpression());
      } catch {
        try { entry.client.close(); } catch { /* ignore */ }
        entry.client = null;
        entry.state = 'detached';
        entry.message = '页面暂时无法检查';
        if (specificTargetId) {
          this.focusId = entry.id;
          this._publish(entry);
          return entry;
        }
        continue;
      }

      entry.probe = probe;
      entry.host = host;
      this.focusId = entry.id;
      if (!compatibleProbe(probe)) {
        try { entry.client.close(); } catch { /* ignore */ }
        entry.client = null;
        entry.state = 'unsupported';
        entry.message = '未找到支持的 Antigravity 主界面，请等待客户端加载完成后重试';
        if (specificTargetId) {
          this._publish(entry);
          return entry;
        }
        continue;
      }

      if (probe.sessionId && entry.session?.id !== probe.sessionId) {
        entry.state = 'suspended';
        entry.message = '另一个主题会话仍在生效，请关闭其他 Anti Face 窗口，等待 35 秒后重试';
        this._publish(entry);
        return entry;
      }

      const check = checkCompatibility(host, this.manifest);
      if (!check.allowed) {
        entry.state = 'unsupported';
        entry.message = '当前 Antigravity 版本尚未验证，可以预览和导出主题';
        this._publish(entry);
        return entry;
      }

      if (!entry.session) {
        entry.state = 'ready';
        entry.message = '已连接 Antigravity，可以应用到当前窗口';
      }
      this._publish(entry);
      return entry;
    }

    this.status = {
      state: 'unsupported',
      message: '未找到支持的 Antigravity 主界面，请等待客户端加载完成后重试',
      host,
      probe: null,
      session: this.session
    };
    return null;
  }

  async _listTargets() {
    const host = await this.inspectHost();
    let raw;
    try {
      if (!host.installed) throw new Error('宿主不存在');
      ({ raw } = await this._rawTargets(host));
    } catch {
      // A dead endpoint cannot restore styles. Close immediately; injected leases expire.
      for (const entry of this.targets.values()) {
        entry.generation += 1;
        try { entry.client?.close(); } catch { /* disconnected */ }
        this.round5?.dropTarget?.(entry.id);
      }
      this.targets.clear();
      this.focusId = null;
      this.status = { state: 'detached', message: '宿主连接已断开，请重新检查', host, probe: null, session: null };
      this._portCache = null;
      return [];
    }
    const pages = this._pages(raw);
    const live = new Set(pages.map(page => page.id));
    for (const entry of [...this.targets.values()]) {
      if (!live.has(entry.id)) await this._dropEntry(entry, '窗口已关闭');
    }
    return pages.map((target, index) => {
      let title = target.title || `Antigravity 窗口 ${index + 1}`;
      if (title.length > 50) title = title.slice(0, 47) + '...';
      const entry = this.targets.get(target.id);
      return {
        id: target.id,
        title,
        url: target.url,
        state: entry?.state || 'detected',
        isCurrent: this.focusId === target.id
      };
    });
  }

  listTargets() {
    return this.exclusive(() => this._listTargets());
  }

  inspect(targetId = null) {
    return this.exclusive(() => this._inspect(targetId));
  }

  async _inspect(specificTargetId = null) {
    const entry = await this._ensureEntry(specificTargetId);
    if (!entry) return this.status;
    if (entry.session && entry.client) return this._tickEntry(entry);
    return entry.status || this.status;
  }

  apply(value, targetId = null) {
    if(this.round5?.studio?.safeMode || this.round5?.studio?.migrationActive) return Promise.resolve({state:'blocked',ok:false,code:'SAFE_MODE',applied:false});
    const operation=this.round5?.studio?.applicationGeneration || 0;
    const allowed=()=>!this.round5?.studio?.safeMode && !this.round5?.studio?.migrationActive && (this.round5?.studio?.applicationGeneration || 0)===operation;
    return this.exclusive(async () => {
      if(!allowed()) return {state:'cancelled',ok:false,code:'STALE'};
      const settings = validateSettings(value);
      const css = buildCSS(settings);
      const entry = await this._ensureEntry(targetId);
      if (!entry || !['ready', 'applied'].includes(entry.state)) {
        throw new Error(entry?.message || this.status.message);
      }
      const epoch = entry.generation;
      const host = await this.inspectHost();
      if (!this._still(entry, epoch, entry.autoGeneration)) return this._publish(entry);
      const check = checkCompatibility(host, this.manifest, entry.session?.host || null);
      if (!check.allowed) {
        if (entry.session) await this._restoreEntry(entry);
        entry.state = 'suspended';
        entry.message = 'Antigravity 版本已变化，请重新检测';
        this._publish(entry);
        throw new Error(entry.message);
      }
      const probe = await entry.client.evaluate(probeExpression());
      if (!this._still(entry, epoch, entry.autoGeneration)) {
        return this._publish(entry);
      }
      if (!compatibleProbe(probe)) {
        if (entry.session) await this._restoreEntry(entry);
        entry.state = 'suspended';
        entry.message = '页面结构发生变化，已暂停换肤';
        this._publish(entry);
        throw new Error(entry.message);
      }
      if (probe.sessionId && entry.session?.id !== probe.sessionId) {
        entry.state = 'suspended';
        entry.message = '另一个主题会话仍在生效，请关闭其他 Anti Face 窗口，等待 35 秒后重试';
        this._publish(entry);
        throw new Error(entry.message);
      }
      const id = entry.session?.id || randomUUID();
      try {
        if (!this._still(entry, epoch, entry.autoGeneration)) return this._publish(entry);
        if(typeof allowed==='function' && !allowed()) return {state:'cancelled',ok:false,code:'STALE'};
        const result = await entry.client.evaluate(applyExpression(css, id));
        if (!this._still(entry, epoch, entry.autoGeneration)) {
          await entry.client.evaluate(restoreExpression(id)).catch(() => {});
          entry.session = null;
          entry.state = 'ready';
          entry.message = '应用已取消';
          return this._publish(entry);
        }
        if (result?.sessionId !== id || !result.rules) throw new Error('主题未能写入目标页面');
        entry.session = {
          id,
          host,
          hostFingerprint: host.fingerprint,
          targetId: entry.id,
          styleId: STYLE_ID,
          themeId: settings.themeId,
          appliedAt: new Date().toISOString()
        };
        entry.desiredSettings = settings;
        entry.host = host;
        entry.state = 'applied';
        entry.message = '主题已应用；关闭 Anti Face 后会恢复原样';
        this.focusId = entry.id;
        return this._publish(entry);
      } catch (error) {
        await entry.client?.evaluate(restoreExpression(id)).catch(() => {});
        entry.session = null;
        entry.state = 'error';
        entry.message = error.message;
        this._publish(entry);
        throw error;
      }
    });
  }

  applyDocument(document, targetId = null, meta = {}) {
    if(this.round5?.studio?.safeMode || this.round5?.studio?.migrationActive) return Promise.resolve({state:'blocked',ok:false,code:'SAFE_MODE',applied:false});
    return this.exclusive(async () => {
      const validated = validateThemeDocument(document);
      const entry = await this._ensureEntry(targetId);
      const regions = entry?.probe?.regions || null;
      const built = buildDocumentCSS(validated, { assetUrl: meta.assetUrl || null, regions, resolved: meta.resolved || null });
      const plan = meta.plan || (meta.verify ? buildVerificationPlan(meta.resolved || built.resolved, { wallpaper: !!(meta.assetUrl || validated.wallpaper?.legacyDataUrl || validated.wallpaper?.assetId) }) : null);
      const status = await this._applyCss(built.css, {
        themeId: validated.baseThemeId,
        document: validated,
        source: meta.source || 'editor'
      }, targetId, { ...meta, plan });
      return { ...status, regions: built.skipped.length ? { skipped: built.skipped, code: 'REGION_UNSUPPORTED' } : { skipped: [] } };
    });
  }

  async _applyCss(css, meta, targetId = null, token = {}) {
    const entry = await this._ensureEntry(targetId);
    if (!entry || !['ready', 'applied'].includes(entry.state)) {
      const error = new Error(entry?.message || this.status.message || '没有可应用的窗口');
      error.code = 'HOST_UNAVAILABLE';
      throw error;
    }
    const epoch = entry.generation;
    const current = () => !this.round5?.studio?.safeMode && !this.round5?.studio?.migrationActive && (token.isCurrent ? token.isCurrent() : true);
    const staleStatus = () => ({ ...this._publish(entry), stale: true });
    if (!current()) return staleStatus();
    const host = await this.inspectHost();
    if (!current()) return staleStatus();
    if (!this._still(entry, epoch, entry.autoGeneration)) return this._publish(entry);
    const check = checkCompatibility(host, this.manifest, entry.session?.host || null);
    if (!check.allowed) {
      if (entry.session) await this._restoreEntry(entry);
      entry.state = 'suspended';
      entry.message = 'Antigravity 版本已变化，请重新检测';
      this._publish(entry);
      const error = new Error(entry.message);
      error.code = 'HOST_INCOMPATIBLE';
      throw error;
    }
    const probe = await entry.client.evaluate(probeExpression());
    if (!current()) return staleStatus();
    if (!this._still(entry, epoch, entry.autoGeneration)) return this._publish(entry);
    if (!compatibleProbe(probe)) {
      if (entry.session) await this._restoreEntry(entry);
      entry.state = 'suspended';
      entry.message = '页面结构发生变化，已暂停换肤';
      this._publish(entry);
      const error = new Error(entry.message);
      error.code = 'HOST_INCOMPATIBLE';
      throw error;
    }
    entry.probe = probe;
    if (probe.sessionId && entry.session?.id !== probe.sessionId) {
      entry.state = 'suspended';
      entry.message = '另一个主题会话仍在生效，请关闭其他 Anti Face 窗口，等待 35 秒后重试';
      this._publish(entry);
      throw new Error(entry.message);
    }
    const id = entry.session?.id || randomUUID();
    if (entry.lastConfirmed?.css && entry.session?.id === id) token.previousCss = entry.lastConfirmed.css;
    try {
      if (!current()) return staleStatus();
      if (!this._still(entry, epoch, entry.autoGeneration)) return this._publish(entry);
      const result = await entry.client.evaluate(applyExpression(css, id));
      if (!current()) {
        await this._abandonStaleWrite(entry, id);
        return staleStatus();
      }
      if (!this._still(entry, epoch, entry.autoGeneration)) {
        await entry.client.evaluate(restoreExpression(id)).catch(() => {});
        entry.session = null;
        entry.state = 'ready';
        entry.message = '应用已取消';
        return this._publish(entry);
      }
      if (result?.sessionId !== id || !result.rules) throw new Error('主题未能写入目标页面');
      if (token.plan) {
        const observation = await entry.client.evaluate(verifyExpression(token.plan, id)).catch(() => null);
        if (!current()) {
          await this._abandonStaleWrite(entry, id);
          return staleStatus();
        }
        if (!this._still(entry, epoch, entry.autoGeneration)) {
          await entry.client.evaluate(restoreExpression(id)).catch(() => {});
          entry.session = null;
          entry.state = 'ready';
          entry.message = '应用已取消';
          return this._publish(entry);
        }
        const verdict = compareObservation(token.plan, observation);
        entry.verification = verdict;
        if (verdict.status === 'failed') {
          const recovery = await this._rollbackVerified(entry, id, token);
          entry.verification = { ...verdict, recovery: recovery.status };
          entry.message = recovery.message;
          entry.state = recovery.status === 'restored' ? 'ready' : 'error';
          if (recovery.status !== 'restored') {
            entry.verification = { ...entry.verification, status: 'restore-unconfirmed', code: 'RESTORE_UNCONFIRMED' };
          } else if (!token.previousCss) {
            entry.session = null;
          }
          const error = new Error(entry.message);
          error.code = recovery.status === 'restored' ? 'VERIFY_FAILED' : 'RESTORE_UNCONFIRMED';
          throw error;
        }
        if (verdict.status === 'verified') {
          entry.lastConfirmed = { css, owner: id, plan: token.plan };
        }
      }
      entry.session = {
        id,
        host,
        hostFingerprint: host.fingerprint,
        targetId: entry.id,
        styleId: STYLE_ID,
        themeId: meta.themeId,
        source: meta.source || 'editor',
        appliedAt: new Date().toISOString()
      };
      entry.desiredSettings = meta.document || meta.settings || entry.desiredSettings;
      entry.host = host;
      entry.state = 'applied';
      entry.message = '主题已应用；关闭 Anti Face 后会恢复原样';
      this.focusId = entry.id;
      return this._publish(entry);
    } catch (error) {
      if (error.code === 'VERIFY_FAILED' || error.code === 'RESTORE_UNCONFIRMED') {
        this._publish(entry);
        throw error;
      }
      if (!current()) {
        await this._abandonStaleWrite(entry, id);
        return staleStatus();
      }
      await entry.client?.evaluate(restoreExpression(id)).catch(() => {});
      entry.session = null;
      entry.state = 'error';
      entry.message = error.message;
      this._publish(entry);
      throw error;
    }
  }

  async _abandonStaleWrite(entry, id) {
    if (!entry?.client) return false;
    let owner = null;
    try { owner = await entry.client.evaluate(readStyleOwnerExpression()); } catch { owner = null; }
    if (owner && owner !== id) return false;
    await entry.client.evaluate(restoreExpression(id)).catch(() => {});
    if (entry.session?.id === id) entry.session = null;
    if (!entry.session) {
      entry.state = 'ready';
      entry.message = '应用已取消';
    }
    return true;
  }

  async _rollbackVerified(entry, owner, token) {
    if (token.isCurrent && !token.isCurrent()) {
      return { status: 'restore-unconfirmed', message: '窗口目标已变化，没有回滚新的主题' };
    }
    if (!entry.client) return { status: 'restore-unconfirmed', message: '连接已断开，恢复未确认' };
    try {
      if (token.previousCss && entry.lastConfirmed?.plan) {
        const ok = await entry.client.evaluate(setStyleExpression(token.previousCss, owner));
        if (!ok) return { status: 'restore-unconfirmed', message: '恢复未确认' };
        const observation = await entry.client.evaluate(verifyExpression(entry.lastConfirmed.plan, owner)).catch(() => null);
        const verdict = compareObservation(entry.lastConfirmed.plan, observation);
        if (verdict.status === 'verified' || verdict.status === 'partial') {
          return { status: 'restored', message: '已恢复上一次确认生效的主题' };
        }
        return { status: 'restore-unconfirmed', message: '已尝试恢复，但没能确认样式' };
      }
      const removed = await entry.client.evaluate(restoreExpression(owner));
      if (!removed) return { status: 'restore-unconfirmed', message: '恢复未确认' };
      const observation = await entry.client.evaluate(verifyExpression({ checks: [{ id: 'owned-style', required: true, kind: 'owned' }] }, owner)).catch(() => null);
      const owned = observation?.checks?.find(item => item.id === 'owned-style');
      if (observation?.kind === 'anti-face-verify' && owned?.state === 'missing') {
        return { status: 'restored', message: '已移除没有通过核对的主题' };
      }
      if (!observation || observation.kind !== 'anti-face-verify') {
        return { status: 'restore-unconfirmed', message: '连接没有返回恢复结果' };
      }
      return { status: 'restore-unconfirmed', message: '样式可能还在，恢复未确认' };
    } catch {
      return { status: 'restore-unconfirmed', message: '连接中断，恢复未确认' };
    }
  }

  async setOwnedCss(css, targetId, token = {}) {
    if(this.round5?.studio?.safeMode || this.round5?.studio?.migrationActive) return {ok:false,code:'SAFE_MODE'};
    return this.exclusive(async () => {
      const entry = targetId ? this.targets.get(targetId) : (this.focusId ? this.targets.get(this.focusId) : null);
      if (!entry?.session || !entry.client) return { ok: false, code: 'HOST_UNAVAILABLE' };
      if(this.round5?.studio?.safeMode || this.round5?.studio?.migrationActive || (token.isCurrent && !token.isCurrent())) return {ok:false,stale:true,code:'STALE'};
      const confirmed = await entry.client.evaluate(setStyleExpression(css, entry.session.id));
      if(this.round5?.studio?.safeMode || this.round5?.studio?.migrationActive || (token.isCurrent && !token.isCurrent())) return {ok:false,stale:true,code:'STALE'};
      return { ok: confirmed === true };
    });
  }

  restore(targetId = null) {
    if (targetId) this._invalidate(targetId);
    else if (this.focusId) this._invalidate(this.focusId);
    return this.exclusive(() => this._restore(targetId || this.focusId));
  }

  restoreAll() {
    for (const entry of this.targets.values()) entry.generation += 1;
    return this.exclusive(async () => {
      let last = this.status;
      for (const entry of [...this.targets.values()]) {
        if (entry.session) last = await this._restoreEntry(entry);
      }
      return last;
    });
  }

  async _restore(targetId) {
    const entry = targetId ? this.targets.get(targetId) : null;
    if (!entry || !entry.session) {
      if (entry && entry.state === 'applied') {
        entry.state = 'ready';
        entry.message = '已恢复 Antigravity 原始外观';
        return this._publish(entry);
      }
      return entry?.status || this.status;
    }
    return this._restoreEntry(entry);
  }

  async _restoreEntry(entry) {
    if (!entry.session) return this._publish(entry);
    const session = entry.session;
    try {
      const confirmed = entry.client && await entry.client.evaluate(restoreExpression(session.id));
      if (!confirmed) throw new Error('无法确认主题已恢复');
      entry.session = null;
      entry.state = 'ready';
      entry.message = '已恢复 Antigravity 原始外观';
      return this._publish(entry);
    } catch {
      entry.session = null;
      try { entry.client?.close(); } catch { /* ignore */ }
      entry.client = null;
      entry.state = 'suspended';
      entry.message = '连接已断开，临时主题将在最后一次连接后 35 秒内自动移除';
      return this._publish(entry);
    }
  }

  tick() {
    return this.exclusive(async () => {
      await this._listTargets().catch(() => []);
      for (const entry of [...this.targets.values()]) {
        if (entry.session) await this._tickEntry(entry);
      }
      return this.status;
    });
  }

  async _onLeaseLost(entry, epoch, autoEpoch) {
    if (this.autoRestoreOnReload && entry.desiredSettings && this._still(entry, epoch, autoEpoch)) {
      return this._boundedAutoRestore(entry, epoch, autoEpoch);
    }
    entry.session = null;
    entry.state = 'ready';
    entry.message = '目标页面已刷新，主题已恢复；可重新应用';
    return this._publish(entry);
  }

  async _tickEntry(entry) {
    if (!entry.session || !entry.client) return this._publish(entry);
    const epoch = entry.generation;
    const autoEpoch = entry.autoGeneration;
    try {
      const host = await this.inspectHost();
      if (!this._still(entry, epoch, autoEpoch)) return this._publish(entry);
      if (!checkCompatibility(host, this.manifest, entry.session.host).allowed) {
        await this._restoreEntry(entry);
        entry.state = 'suspended';
        entry.message = 'Antigravity 版本已变化，已暂停换肤，请重新检测';
        return this._publish(entry);
      }

      let probe = null;
      try {
        probe = await entry.client.evaluate(probeExpression());
      } catch {
        probe = null;
      }
      if (!this._still(entry, epoch, autoEpoch)) return this._publish(entry);

      if (probe && compatibleProbe(probe)) {
        entry.probe = probe;
        const hasLease = await entry.client.evaluate(heartbeatExpression(entry.session.id));
        if (!hasLease) {
          if (!this._still(entry, epoch, autoEpoch) || !this.autoRestoreOnReload) {
            entry.session = null;
            entry.state = 'ready';
            entry.message = '目标页面已刷新，主题已恢复；可重新应用';
            return this._publish(entry);
          }
          return this._onLeaseLost(entry, epoch, autoEpoch);
        }
        if (!this._still(entry, epoch, autoEpoch)) return this._publish(entry);
        return this._publish(entry);
      }

      let hasLease = false;
      try {
        hasLease = await entry.client.evaluate(heartbeatExpression(entry.session.id));
      } catch {
        hasLease = false;
      }
      if (!this._still(entry, epoch, autoEpoch)) return this._publish(entry);
      if (hasLease && probe && !compatibleProbe(probe)) {
        await this._restoreEntry(entry);
        entry.state = 'suspended';
        entry.message = '页面结构已变化，已暂停换肤';
        return this._publish(entry);
      }
      return this._onLeaseLost(entry, epoch, autoEpoch);
    } catch {
      if (!this._still(entry, epoch, autoEpoch)) return this._publish(entry);
      return this._restoreEntry(entry);
    }
  }

  async _sleep(ms, entry, epoch, autoEpoch) {
    const budget = Math.max(0, ms);
    const started = performance.now();
    await new Promise(resolve => {
      const timer = setInterval(() => {
        if (!this._still(entry, epoch, autoEpoch) || !this.autoRestoreOnReload || performance.now() - started >= budget) {
          clearInterval(timer);
          resolve();
        }
      }, 15);
    });
  }

  /**
   * DOM 暂时不可用时留在重试循环里。取消令牌在每次注入前重新检查。
   */
  async _boundedAutoRestore(entry, epoch, autoEpoch, maxRetries = 10) {
    const settings = entry.desiredSettings;
    const previousSession = entry.session;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (!this._still(entry, epoch, autoEpoch) || !this.autoRestoreOnReload) return this._publish(entry);
      try {
        const host = await this.inspectHost();
        if (!this._still(entry, epoch, autoEpoch)) return this._publish(entry);
        if (!checkCompatibility(host, this.manifest, previousSession?.host).allowed) {
          await this._restoreEntry(entry);
          entry.state = 'suspended';
          entry.message = 'Antigravity 版本已变化，已暂停换肤，请重新检测';
          return this._publish(entry);
        }
        const { raw } = await this._rawTargets(host);
        const page = this._pages(raw).find(item => item.id === entry.id);
        if (!page) {
          await this._dropEntry(entry, '窗口已关闭');
          return this.status;
        }
        if (page.url !== entry.identity?.url) {
          entry.identity = { ...entry.identity, url: page.url, title: page.title || '' };
          this.round5?.noteNavigation?.(entry.id);
        }
        if (!entry.client) return this._publish(entry);
        const probe = await entry.client.evaluate(probeExpression());
        if (!this._still(entry, epoch, autoEpoch) || !this.autoRestoreOnReload) return this._publish(entry);
        if (!compatibleProbe(probe)) {
          await this._sleep(this.retryDelayMs, entry, epoch, autoEpoch);
          continue;
        }
        entry.probe = probe;
        if (probe.sessionId && probe.sessionId !== previousSession?.id && probe.sessionId !== entry.session?.id) {
          entry.session = null;
          entry.state = 'suspended';
          entry.message = '另一个主题会话在刷新后生效';
          return this._publish(entry);
        }
        if (!this._still(entry, epoch, autoEpoch) || !this.autoRestoreOnReload) return this._publish(entry);
        const css = buildCSS(settings);
        const newId = randomUUID();
        const result = await entry.client.evaluate(applyExpression(css, newId));
        if (!this._still(entry, epoch, autoEpoch) || !this.autoRestoreOnReload) {
          await entry.client.evaluate(restoreExpression(newId)).catch(() => {});
          entry.session = null;
          entry.state = 'ready';
          entry.message = '已取消自动恢复';
          return this._publish(entry);
        }
        if (result?.sessionId === newId && result.rules) {
          entry.session = {
            id: newId,
            host,
            hostFingerprint: host.fingerprint,
            targetId: entry.id,
            styleId: STYLE_ID,
            themeId: settings.themeId,
            appliedAt: new Date().toISOString()
          };
          entry.host = host;
          entry.state = 'applied';
          entry.message = '目标页面刷新后已自动恢复主题';
          return this._publish(entry);
        }
      } catch {
        // 页面还在加载，进入下一次有界重试
      }
      await this._sleep(this.retryDelayMs, entry, epoch, autoEpoch);
    }
    entry.session = null;
    entry.state = 'ready';
    entry.message = '目标页面刷新，自动恢复超时；可手动重新应用';
    return this._publish(entry);
  }

  verifiedEntry(targetId) {
    const entry = targetId ? this.targets.get(targetId) : null;
    if (!entry?.client || !['ready', 'applied'].includes(entry.state)) return null;
    return entry;
  }

  statusFor(targetId) {
    if (!targetId) return this.status;
    const entry = this.targets.get(targetId);
    if (!entry) {
      return {
        state: 'detached',
        message: '窗口已关闭或不存在',
        host: this.status.host,
        probe: null,
        session: null
      };
    }
    return entry.status || this.status;
  }

  async dispose() {
    for (const entry of this.targets.values()) entry.generation += 1;
    await this.exclusive(async () => {
      for (const entry of [...this.targets.values()]) {
        if (entry.session) await this._restoreEntry(entry);
        try { entry.client?.close(); } catch { /* ignore */ }
      }
      this.targets.clear();
      this.focusId = null;
    });
  }
}

module.exports = { ThemeService };
