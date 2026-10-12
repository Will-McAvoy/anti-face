const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { validateSettings, DEFAULT_APPEARANCE } = require('../core/theme.cjs');

const DEFAULT_SETTINGS = {
  schemaVersion: 1,
  themeId: 'graphite',
  appearance: { ...DEFAULT_APPEARANCE }
};

class SettingsStore {
  constructor(directory) {
    this.file = path.join(directory, 'settings.json');
    this.queue = Promise.resolve();
  }

  async _readRaw() {
    try {
      return JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch (error) {
      return { missing: error.code === 'ENOENT', corrupt: error.code !== 'ENOENT', error };
    }
  }

  async load() {
    const raw = await this._readRaw();
    if (raw.missing) return { settings: { ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_APPEARANCE } }, warning: null };
    if (raw.corrupt) {
      return {
        settings: { ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_APPEARANCE } },
        warning: '保存的设置无法读取，已使用默认预览。原文件会保留到下次保存。'
      };
    }
    if (Number.isInteger(raw.schemaVersion) && raw.schemaVersion > 1) {
      this.frozen = true;
      return {
        settings: { ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_APPEARANCE } },
        warning: '配置版本过新，已保留原文件。',
        errorCode: 'UNSUPPORTED_SCHEMA'
      };
    }
    try {
      return { settings: validateSettings(raw), warning: null };
    } catch (error) {
      return {
        settings: { ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_APPEARANCE } },
        warning: '保存的设置无法读取，已使用默认预览。原文件会保留到下次保存。'
      };
    }
  }

  _merge(previous, incoming) {
    const base = previous && previous.schemaVersion ? previous : DEFAULT_SETTINGS;
    const merged = {
      ...base,
      ...incoming,
      themeId: incoming.themeId,
      appearance: incoming.appearance
    };
    delete merged.schemaVersion;
    if (!Object.prototype.hasOwnProperty.call(incoming, 'autoRestoreOnReload')
      && typeof previous?.autoRestoreOnReload === 'boolean') {
      merged.autoRestoreOnReload = previous.autoRestoreOnReload;
    }
    if (!incoming.history && base.history) merged.history = base.history;
    if (!incoming.preset && base.preset) merged.preset = base.preset;
    return validateSettings({ ...merged, schemaVersion: incoming.schemaVersion || base.schemaVersion || 1 });
  }

  async _write(settings) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(settings, null, 2), 'utf8');
      await fs.rename(temp, this.file);
    } finally {
      await fs.rm(temp, { force: true }).catch(() => {});
    }
    return settings;
  }

  save(value) {
    if (this.frozen) {
      const error = new Error('配置版本过新，已停止写入以保留原文件');
      error.code = 'UNSUPPORTED_SCHEMA';
      return Promise.reject(error);
    }
    const incoming = validateSettings(value);
    const operation = this.queue.catch(() => {}).then(async () => {
      const raw = await this._readRaw();
      const previous = raw.schemaVersion ? raw : {};
      return this._write(this._merge(previous, incoming));
    });
    this.queue = operation;
    return operation;
  }

  /** 在串行通道里基于最新文件修改，避免主题保存和偏好保存互相覆盖。 */
  update(mutator) {
    const operation = this.queue.catch(() => {}).then(async () => {
      const loaded = await this.load();
      const next = validateSettings(mutator(loaded.settings));
      return this._write(next);
    });
    this.queue = operation;
    return operation;
  }
}

module.exports = { SettingsStore, DEFAULT_SETTINGS };
