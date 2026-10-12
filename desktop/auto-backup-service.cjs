const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { appError } = require('../core/errors.cjs');
const {
  validateAutoBackupConfig,
  isManagedAutoBackupFilename,
  selectBackupsToPrune
} = require('../core/auto-backup-policy.cjs');

const DEBOUNCE_MS = 120_000; // 2 分钟防抖
const MIN_INTERVAL_MS = 300_000; // 5 分钟最小备份间隔

function isPathInside(parent, candidate) {
  const rel = path.relative(parent, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

class AutoBackupService {
  constructor(studio, deps = {}) {
    this.studio = studio;
    this.fs = deps.fs || fs;
    this.now = deps.now || (() => Date.now());
    this.setTimeout = deps.setTimeout || global.setTimeout;
    this.clearTimeout = deps.clearTimeout || global.clearTimeout;
    this.debounceMs = deps.debounceMs ?? DEBOUNCE_MS;
    this.minIntervalMs = deps.minIntervalMs ?? MIN_INTERVAL_MS;

    this.config = validateAutoBackupConfig(deps.config || {});
    this.lastBackupTime = 0;
    this.lastBackupFile = null;
    this.lastBackupFingerprint = null;
    this.lastError = null;

    this.debounceTimer = null;
    this.dailyTimer = null;
    this.isBackingUp = false;
    this.managedBackups = [];
  }

  async loadState() {
    try {
      const userData = this.studio?.userData;
      if (!userData) return;
      const stateFile = path.join(userData, 'auto-backup-state.json');
      const content = await this.fs.readFile(stateFile, 'utf8');
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object') {
        this.lastBackupTime = parsed.lastBackupTime || 0;
        this.lastBackupFile = parsed.lastBackupFile || null;
        this.lastBackupFingerprint = parsed.lastBackupFingerprint || null;
        if (Array.isArray(parsed.managedBackups)) {
          this.managedBackups = parsed.managedBackups;
        }
      }
    } catch {
      // 首次运行或无状态文件
    }
  }

  async saveState() {
    try {
      const userData = this.studio?.userData;
      if (!userData) return;
      const stateFile = path.join(userData, 'auto-backup-state.json');
      const data = {
        lastBackupTime: this.lastBackupTime,
        lastBackupFile: this.lastBackupFile,
        lastBackupFingerprint: this.lastBackupFingerprint,
        managedBackups: this.managedBackups
      };
      const tmp = `${stateFile}.${randomUUID()}.tmp`;
      await this.fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
      await this.fs.rename(tmp, stateFile);
    } catch {
      // 容错
    }
  }

  async init(savedConfig = {}) {
    this.config = validateAutoBackupConfig(savedConfig);
    await this.loadState();
    if (this.config.enabled && this.config.directoryRef) {
      this._setupDailySchedule();
    }
  }

  setConfig(newConfig) {
    this.config = validateAutoBackupConfig(newConfig);
    this._stopAllTimers();
    if (this.config.enabled && this.config.directoryRef) {
      this._setupDailySchedule();
    }
    return this.config;
  }

  _stopAllTimers() {
    if (this.debounceTimer) {
      this.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.dailyTimer) {
      this.clearTimeout(this.dailyTimer);
      this.dailyTimer = null;
    }
  }

  destroy() {
    this._stopAllTimers();
  }

  _setupDailySchedule() {
    if (!this.config.enabled || this.config.schedule !== 'daily') return;
    // 每日检查定时器（每小时检查一次是否已满 24 小时）
    this.dailyTimer = this.setTimeout(() => {
      const now = this.now();
      if (now - this.lastBackupTime >= 86400000) {
        void this.runAutoBackup('daily-schedule').catch(() => {});
      }
      this._setupDailySchedule();
    }, 3600000);
  }

  /**
   * 监听重大修改事件触发防抖备份
   */
  noteMajorChange(reason = 'change') {
    if (!this.config.enabled || this.config.schedule !== 'afterMajorChange') return;
    if (!this.config.directoryRef) return;
    if (this.studio?.safeMode || this.studio?.migrationActive) return;

    if (this.debounceTimer) {
      this.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    const now = this.now();
    // 检查最小间隔约束
    const elapsed = now - this.lastBackupTime;
    const waitTime = elapsed < this.minIntervalMs
      ? Math.max(this.debounceMs, this.minIntervalMs - elapsed)
      : this.debounceMs;

    this.debounceTimer = this.setTimeout(() => {
      this.debounceTimer = null;
      void this.runAutoBackup(reason).catch(() => {});
    }, waitTime);
  }

  /**
   * 计算当前关键数据的指纹以避免无变更重复打包
   */
  async computeDataFingerprint() {
    const hash = createHash('sha256');
    const userData = this.studio?.userData;
    if (!userData) return null;

    const files = [
      'theme-library.json',
      'appearance.json',
      'preferences.json',
      'project-bindings.json',
      path.join('theme-revisions', 'index.json')
    ];
    for (const f of files) {
      try {
        const content = await this.fs.readFile(path.join(userData, f));
        hash.update(content);
      } catch {
        hash.update('');
      }
    }
    return hash.digest('hex');
  }

  getStatus() {
    return {
      enabled: this.config.enabled,
      directoryRef: this.config.directoryRef,
      schedule: this.config.schedule,
      retainCount: this.config.retainCount,
      retainDays: this.config.retainDays,
      lastBackupTime: this.lastBackupTime,
      lastBackupFile: this.lastBackupFile,
      lastBackupFingerprint: this.lastBackupFingerprint,
      lastError: this.lastError,
      isBackingUp: this.isBackingUp,
      pendingDebounce: !!this.debounceTimer
    };
  }

  /**
   * 执行自动备份与保留清理
   */
  async runAutoBackup(reason = 'manual') {
    if (this.studio?.safeMode) throw appError('SAFE_MODE', '安全模式下禁止自动备份');
    if (this.studio?.migrationActive) throw appError('MIGRATION_ACTIVE', '迁移恢复期间禁止自动备份');
    if (!this.config.directoryRef) throw appError('INVALID_ARGUMENT', '未配置自动备份目标目录');

    const destDir = path.resolve(this.config.directoryRef);
    if (this.studio?.userData && isPathInside(path.resolve(this.studio.userData), destDir)) {
      throw appError('INVALID_ARGUMENT', '备份目录不能位于程序内部数据目录中，防止递归打包');
    }

    // 确保目标目录存在
    try {
      const stat = await this.fs.stat(destDir);
      if (!stat.isDirectory()) throw appError('INVALID_ARGUMENT', '所选备份路径不是有效文件夹');
    } catch (err) {
      if (err.code === 'INVALID_ARGUMENT') throw err;
      throw appError('NOT_FOUND', `备份目录无法访问: ${err.message}`);
    }

    if (this.isBackingUp) return { ok: false, code: 'BUSY', message: '已有备份任务正在执行' };
    this.isBackingUp = true;
    this.lastError = null;

    try {
      // 指纹检查：若数据无变化则跳过
      const fingerprint = await this.computeDataFingerprint();
      if (fingerprint && fingerprint === this.lastBackupFingerprint && reason !== 'force') {
        return { ok: true, skipped: true, reason: 'unchanged', fingerprint };
      }

      // 生成文件名：anti-face-auto_YYYY-MM-DDTHH-mm-ss_UUID8.antiface-backup
      const now = new Date(this.now());
      const dateStr = now.toISOString()
        .slice(0, 19)
        .replace(/:/g, '-');
      const suffix = randomUUID().slice(0, 8);
      const filename = `anti-face-auto_${dateStr}_${suffix}.antiface-backup`;
      const fullPath = path.join(destDir, filename);

      if (!this.studio?.backup) throw appError('STATE_ERROR', '备份服务不可用');

      // 使用 BackupService 执行原子导出
      const exportRes = await this.studio.backup.exportBackup(fullPath, { includeRevisions: true });
      if (!exportRes || !exportRes.ok) {
        throw appError('BACKUP_FAILED', '自动备份导出失败');
      }

      // 完整性校验：若备份服务支持，验证包完整可用
      if (typeof this.studio.backup.inspectBackup === 'function') {
        let inspected;
        try {
          inspected = await this.studio.backup.inspectBackup(fullPath);
        } catch (error) {
          await this.fs.rm(fullPath, { force: true }).catch(() => {});
          throw appError('BACKUP_CORRUPT', `刚导出的备份无法通过校验：${error.message}`);
        }
        if (!inspected || inspected.valid !== true || inspected.corrupt === true) {
          await this.fs.rm(fullPath, { force: true }).catch(() => {});
          throw appError('BACKUP_CORRUPT', '刚导出的备份完整性校验失败');
        }
        if (inspected?.inspectionId || inspected?.id) {
          this.studio.backup.cancelInspection?.(inspected.inspectionId || inspected.id);
        }
      }

      this.lastBackupTime = this.now();
      this.lastBackupFile = fullPath;
      this.lastBackupFingerprint = fingerprint;

      // 登记入托管索引
      const managedEntry = {
        id: randomUUID(),
        filename,
        filePath: fullPath,
        createdAtMs: this.now(),
        fingerprint,
        verified: true
      };
      this.managedBackups.push(managedEntry);
      await this.saveState();

      // 执行保留清理（明确保护 fullPath）
      await this.pruneOldBackups(destDir, { protectPath: fullPath });
      await this.saveState();

      return {
        ok: true,
        filePath: fullPath,
        filename,
        fingerprint,
        stats: exportRes
      };
    } catch (err) {
      this.lastError = err.message;
      throw err;
    } finally {
      this.isBackingUp = false;
    }
  }

  /**
   * 清理过期及超出保留数量的旧自动备份
   * 仅删除符合命名规则且属于本服务的托管自动备份，决不触碰用户手动备份或无关文件
   */
  async pruneOldBackups(destDir, options = {}) {
    const protectPath = typeof options === 'string' ? options : (options?.protectPath || null);
    let entries = [];
    try {
      entries = await this.fs.readdir(destDir);
    } catch {
      return [];
    }

    const existingFileNames = new Set(entries);

    // 剔除在磁盘上已不存在的无效记录
    this.managedBackups = this.managedBackups.filter(b =>
      path.dirname(path.resolve(b.filePath)) !== path.resolve(destDir) || existingFileNames.has(b.filename));

    // 仅针对属于当前目标目录且记录在托管索引中的文件进行清理
    const realDir = await this.fs.realpath(destDir);
    const managedList = [];
    for (const record of this.managedBackups) {
      if (path.dirname(path.resolve(record.filePath)) !== path.resolve(destDir) ||
          path.basename(record.filePath) !== record.filename || !isManagedAutoBackupFilename(record.filename)) continue;
      const stat = await this.fs.lstat(record.filePath).catch(() => null);
      if (!stat?.isFile() || stat.isSymbolicLink() || path.dirname(await this.fs.realpath(record.filePath)) !== realDir) continue;
      if (typeof this.studio?.backup?.inspectBackup === 'function') {
        let inspection;
        try {
          inspection = await this.studio.backup.inspectBackup(record.filePath);
          if (inspection?.valid !== true) continue;
        } catch { continue; }
        finally { if (inspection?.inspectionId) this.studio.backup.cancelInspection?.(inspection.inspectionId); }
      }
      managedList.push(record);
    }

    if (managedList.length <= 1) {
      return [];
    }

    const toPrune = selectBackupsToPrune(managedList, {
      retainCount: this.config.retainCount,
      retainDays: this.config.retainDays,
      nowMs: this.now(),
      protectPath
    });

    const pruned = [];
    for (const file of toPrune) {
      if (protectPath && path.resolve(file) === path.resolve(protectPath)) {
        continue;
      }
      try {
        await this.fs.rm(file, { force: true });
        pruned.push(file);
        this.managedBackups = this.managedBackups.filter(b => b.filePath !== file);
      } catch {
        // 单个文件删除失败不中断其他文件清理
      }
    }

    return pruned;
  }

  stop() {
    this._stopAllTimers();
    this.isBackingUp = false;
  }
}

module.exports = {
  AutoBackupService,
  DEBOUNCE_MS,
  MIN_INTERVAL_MS,
  isPathInside
};
