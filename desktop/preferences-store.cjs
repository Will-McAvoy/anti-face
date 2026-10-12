const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { appError } = require('../core/errors.cjs');
const { validateAutomation } = require('../core/schedule.cjs');
const { validateNotificationPrefs } = require('../core/notification-policy.cjs');
const { plainObject, assertSupportedVersion } = require('../core/theme-schema.cjs');

const {defaultPerformancePrefs,validatePerformancePrefs}=require('../core/performance-policy.cjs');
const {validateRotationConfig}=require('../core/wallpaper-rotation-policy.cjs');
const {validateAutoBackupConfig}=require('../core/auto-backup-policy.cjs');

const ACCEL = /^(?:(?:CommandOrControl|Ctrl|Alt|Shift|Super)\+){1,3}(?:F([1-9]|1[0-2])|[A-Z0-9])$/;

function defaultPreferences() {
  return {
    schemaVersion: 1,
    tray: { closeToTray: false },
    shortcuts: {
      enabled: false,
      bindings: { toggleWindow: null, nextFavorite: null, previousFavorite: null, restoreHost: null, quickSwitcher: null }
    },
    performance: defaultPerformancePrefs(),
    notifications: validateNotificationPrefs({}),
    automation: validateAutomation({}),
    wallpaperRotation: validateRotationConfig({}),
    autoBackup: validateAutoBackupConfig({}),
    mini: { enabled: false, alwaysOnTop: false, bounds: null },
    externalSoundWarning: false
  };
}

function validateAccelerator(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !ACCEL.test(value)) throw appError('INVALID_ARGUMENT', '快捷键格式无效');
  return value;
}

function validatePreferences(value) {
  const defaults = defaultPreferences();
  const source = plainObject(value) ? value : {};
  assertSupportedVersion({ schemaVersion: source.schemaVersion || 1 }, 1, '偏好');
  const bindings = plainObject(source.shortcuts?.bindings) ? source.shortcuts.bindings : {};
  const seen = new Set();
  const nextBindings = {};
  for (const key of Object.keys(defaults.shortcuts.bindings)) {
    nextBindings[key] = validateAccelerator(bindings[key]);
    if (nextBindings[key]) {
      if (seen.has(nextBindings[key])) throw appError('INVALID_ARGUMENT', '同一个快捷键不能绑定两个动作');
      seen.add(nextBindings[key]);
    }
  }
  return {
    schemaVersion: 1,
    tray: { closeToTray: source.tray?.closeToTray === true },
    shortcuts: { enabled: source.shortcuts?.enabled === true, bindings: nextBindings },
    performance: validatePerformancePrefs(source.performance || {}),
    notifications: validateNotificationPrefs(source.notifications || {}),
    automation: validateAutomation(source.automation || {}),
    wallpaperRotation: validateRotationConfig(source.wallpaperRotation || {}),
    autoBackup: validateAutoBackupConfig(source.autoBackup || {}),
    mini: {
      enabled: source.mini?.enabled === true,
      alwaysOnTop: source.mini?.alwaysOnTop === true,
      bounds: plainObject(source.mini?.bounds) ? {
        x: Math.round(source.mini.bounds.x),
        y: Math.round(source.mini.bounds.y),
        width: Math.round(source.mini.bounds.width),
        height: Math.round(source.mini.bounds.height)
      } : null
    },
    externalSoundWarning: source.externalSoundWarning === true
  };
}

class PreferencesStore {
  constructor(file) {
    this.file = file;
    this.queue = Promise.resolve();
    this.frozen = false;
    this.current = defaultPreferences();
  }

  async load() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (Number.isInteger(parsed.schemaVersion) && parsed.schemaVersion > 1) {
        this.frozen = true;
        return { preferences: this.current, warning: '偏好版本过新，已保留原文件', errorCode: 'UNSUPPORTED_SCHEMA' };
      }
      this.current = validatePreferences(parsed);
      return { preferences: this.current, warning: null };
    } catch (error) {
      if (error.code === 'ENOENT') return { preferences: this.current, warning: null };
      if (error.code === 'UNSUPPORTED_SCHEMA') {
        this.frozen = true;
        return { preferences: this.current, warning: error.message, errorCode: error.code };
      }
      return { preferences: defaultPreferences(), warning: '偏好无法读取，已使用默认值。原文件会保留到可写时。' };
    }
  }

  save(value) {
    const next = validatePreferences(value);
    const run = this.queue.catch(() => {}).then(async () => {
      if (this.frozen) throw appError('UNSUPPORTED_SCHEMA', '偏好版本过新，已停止写入');
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${randomUUID()}.tmp`;
      await fs.writeFile(temp, JSON.stringify(next, null, 2), 'utf8');
      await fs.rename(temp, this.file);
      this.current = next;
      return next;
    });
    this.queue = run;
    return run;
  }
}

module.exports = { PreferencesStore, defaultPreferences, validatePreferences, validateAccelerator };
