const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { writeAtomic } = require('../core/atomic-write.cjs');
const { appError } = require('../core/errors.cjs');
const { plainObject } = require('../core/theme-schema.cjs');

const BINDING_SCHEMA = 1;

class ProjectBindingsStore {
  constructor(file, deps = {}) {
    this.file = file;
    this.now = deps.now || (() => new Date().toISOString());
    this.data = { schemaVersion: BINDING_SCHEMA, bindings: [] };
    this.frozen = false;
    this.sessions = new Map();
    this.queue = Promise.resolve();
  }

  async load() {
    let raw;
    try { raw = await fs.readFile(this.file, 'utf8'); } catch (error) {
      if (error.code === 'ENOENT') return this.data;
      throw error;
    }
    let parsed;
    try { parsed = JSON.parse(raw); } catch {
      this.frozen = true;
      throw appError('REVISION_DAMAGED', '项目绑定文件损坏，已停止写入');
    }
    if (!plainObject(parsed) || !Number.isInteger(parsed.schemaVersion)) throw appError('UNSUPPORTED_SCHEMA', '项目绑定缺少版本');
    if (parsed.schemaVersion > BINDING_SCHEMA) {
      this.frozen = true;
      throw appError('UNSUPPORTED_SCHEMA', '项目绑定版本过新，已保留原文件');
    }
    this.data = {
      schemaVersion: BINDING_SCHEMA,
      bindings: Array.isArray(parsed.bindings) ? parsed.bindings.filter(item => plainObject(item) && item.bindingId && item.projectKey && item.themeId).map(item => ({
        bindingId: item.bindingId,
        identityKind: item.identityKind === 'workspace' ? 'workspace' : 'path',
        identityVersion: 1,
        projectKey: item.projectKey,
        themeId: item.themeId,
        enabled: item.enabled !== false && item.reconnectRequired !== true,
        reconnectRequired: item.reconnectRequired === true,
        updatedAt: item.updatedAt || this.now(),
        displayHint: typeof item.displayHint === 'string' ? item.displayHint.slice(0, 40) : '项目'
      })) : []
    };
    return this.data;
  }

  async saveBinding(input) {
    if (this.frozen) throw appError('UNSUPPORTED_SCHEMA', '项目绑定版本过新，已停止写入');
    const binding = {
      bindingId: input.bindingId || randomUUID(),
      identityKind: input.identityKind === 'workspace' ? 'workspace' : 'path',
      identityVersion: 1,
      projectKey: input.projectKey,
      themeId: input.themeId,
      enabled: input.enabled !== false,
      updatedAt: this.now(),
      displayHint: String(input.displayHint || '项目').slice(0, 40)
    };
    if (!binding.projectKey || !binding.themeId) throw appError('INVALID_ARGUMENT', '项目绑定不完整');
    const next = {
      schemaVersion: BINDING_SCHEMA,
      bindings: [binding, ...this.data.bindings.filter(item => item.projectKey !== binding.projectKey)]
    };
    const previous = this.data;
    await this._write(next);
    this.data = next;
    return { binding, previous };
  }

  async remove(projectKey) {
    if (this.frozen) throw appError('UNSUPPORTED_SCHEMA', '项目绑定版本过新，已停止写入');
    const next = { schemaVersion: BINDING_SCHEMA, bindings: this.data.bindings.filter(item => item.projectKey !== projectKey) };
    await this._write(next);
    this.data = next;
    return next;
  }

  find(projectKey) {
    return this.data.bindings.find(item => item.projectKey === projectKey) || null;
  }

  bindSession(targetId, themeId, label) {
    this.sessions.set(targetId, { targetId, themeId, label: label || '当前窗口', persistent: false });
    return this.sessions.get(targetId);
  }

  session(targetId) {
    return this.sessions.get(targetId) || null;
  }

  clearSession(targetId) {
    this.sessions.delete(targetId);
  }

  async _write(data) {
    const body = JSON.stringify(data, null, 2);
    const run = this.queue.catch(() => {}).then(() => writeAtomic(this.file, body));
    this.queue = run;
    return run;
  }
}

module.exports = { ProjectBindingsStore, BINDING_SCHEMA };
