const path = require('node:path');
const { appError } = require('./errors.cjs');

const ALLOWED_SCHEDULES = new Set(['daily', 'afterMajorChange']);
const AUTO_BACKUP_NAME_REGEX = /^anti-face-auto_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d{3})?Z?)_([0-9a-fA-F-]+)\.antiface-backup$/;

function validateAutoBackupConfig(raw = {}) {
  const enabled = raw.enabled === true;
  const directoryRef = typeof raw.directoryRef === 'string' ? raw.directoryRef.trim() : '';
  const schedule = ALLOWED_SCHEDULES.has(raw.schedule) ? raw.schedule : 'afterMajorChange';

  let retainCount = typeof raw.retainCount === 'number' && Number.isFinite(raw.retainCount)
    ? Math.round(raw.retainCount)
    : 7;
  if (retainCount < 1) retainCount = 1;
  if (retainCount > 50) retainCount = 50;

  let retainDays = typeof raw.retainDays === 'number' && Number.isFinite(raw.retainDays)
    ? Math.round(raw.retainDays)
    : 30;
  if (retainDays < 1) retainDays = 1;
  if (retainDays > 365) retainDays = 365;

  return {
    enabled,
    directoryRef,
    schedule,
    retainCount,
    retainDays
  };
}

function isManagedAutoBackupFilename(filename) {
  if (typeof filename !== 'string') return false;
  return AUTO_BACKUP_NAME_REGEX.test(filename);
}

function parseAutoBackupTimestamp(filename) {
  const match = filename.match(AUTO_BACKUP_NAME_REGEX);
  if (!match) return null;
  // 将 YYYY-MM-DDTHH-mm-ss 恢复为可解析的 ISO 时间
  const rawIso = match[1].replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3');
  const parsed = Date.parse(rawIso);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 依据保留数量和保留天数筛选出可安全清理的自动备份
 * 约束：
 * 1. 绝不删除用户手动备份或无关文件（调用方仅传入 isManagedAutoBackupFilename === true 的文件）
 * 2. 至少保留一份最新的有效自动备份（即使它已超期）
 * 3. 保护刚导出的新备份（protectPath）
 * @param {Array<{ filename: string, filePath: string, createdAtMs: number }>} backups - 按时间升序排序
 * @param {{ retainCount: number, retainDays: number, nowMs: number, protectPath?: string }} policy
 * @returns {Array<string>} - 待删除的文件绝对路径列表
 */
function selectBackupsToPrune(backups = [], policy = {}) {
  if (!Array.isArray(backups) || backups.length <= 1) {
    return [];
  }

  const retainCount = policy.retainCount || 7;
  const retainDays = policy.retainDays || 30;
  const nowMs = policy.nowMs || Date.now();
  const maxAgeMs = retainDays * 86400000;
  const protectPath = policy.protectPath || null;

  // 升序排列（最旧的在前面；异常未来时间钳制至当前时间，防止假未来文件挤占最新有效备份）
  const sorted = [...backups].sort((a, b) => {
    const aTime = Math.min(a.createdAtMs, nowMs);
    const bTime = Math.min(b.createdAtMs, nowMs);
    return aTime - bTime;
  });
  const toPrune = new Set();

  // 1. 超出 retainCount 数量的较旧备份
  if (sorted.length > retainCount) {
    const excess = sorted.length - retainCount;
    for (let i = 0; i < excess; i++) {
      toPrune.add(sorted[i].filePath);
    }
  }

  // 2. 超出 retainDays 天数的较旧备份
  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    if (nowMs - item.createdAtMs > maxAgeMs) {
      toPrune.add(item.filePath);
    }
  }

  // 3. 铁律：必须保留至少一份最新的有效备份！
  const newestItem = sorted[sorted.length - 1];
  if (newestItem) {
    toPrune.delete(newestItem.filePath);
  }

  // 4. 若指定了需要明确保护的文件路径（如刚导出的备份），决不删除！
  if (protectPath) {
    for (const p of toPrune) {
      if (path.resolve(p) === path.resolve(protectPath)) {
        toPrune.delete(p);
      }
    }
  }

  return [...toPrune];
}

module.exports = {
  validateAutoBackupConfig,
  isManagedAutoBackupFilename,
  parseAutoBackupTimestamp,
  selectBackupsToPrune,
  AUTO_BACKUP_NAME_REGEX
};
