const { appError } = require('./errors.cjs');

const BACKUP_FORMAT = 'anti-face-backup';
const BACKUP_SCHEMA_VERSION = 1;

const MAX_TOTAL_UNCOMPRESSED_BYTES = 512 * 1024 * 1024; // 512 MiB
const MAX_SINGLE_FILE_BYTES = 64 * 1024 * 1024; // 64 MiB
const MAX_FILE_COUNT = 2000;

const FORBIDDEN_WINDOWS_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]);

function isSafeRelativePath(relPath) {
  if (typeof relPath !== 'string' || !relPath.trim()) return false;
  if (relPath.includes('\0')) return false;
  const normalized = relPath.replace(/\\/g, '/');

  // 不得包含盘符 C: 或以 / 开头，不得为 UNC 路径
  if (/^[a-zA-Z]:/.test(normalized)) return false;
  if (normalized.startsWith('/') || normalized.startsWith('//')) return false;

  const parts = normalized.split('/');
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') return false; // 严禁目录穿越
    // 检查 Windows 保留设备名称
    const baseName = part.split('.')[0].toUpperCase();
    if (FORBIDDEN_WINDOWS_NAMES.has(baseName)) return false;
    // 检查非法字符与控制字符
    if (/[\x00-\x1f<>:"|?*]/.test(part)) return false;
  }
  return true;
}

function validateBackupManifest(rawManifest) {
  if (!rawManifest || typeof rawManifest !== 'object') {
    throw appError('BACKUP_CORRUPT', '备份包缺少合法的清单描述 (manifest.json)');
  }

  if (rawManifest.format !== BACKUP_FORMAT) {
    throw appError('BACKUP_CORRUPT', `不支持的备份格式: ${rawManifest.format}`);
  }

  if (rawManifest.formatVersion !== BACKUP_SCHEMA_VERSION) {
    throw appError('UNSUPPORTED_SCHEMA', `备份包版本过新 (formatVersion=${rawManifest.formatVersion})，当前程序无法读取未来格式`);
  }

  if (!Array.isArray(rawManifest.files)) {
    throw appError('BACKUP_CORRUPT', '备份清单缺少文件列表');
  }

  if (rawManifest.files.length > MAX_FILE_COUNT) {
    throw appError('RESOURCE_LIMIT', `备份包包含的文件数量 (${rawManifest.files.length}) 超过上限 (${MAX_FILE_COUNT})`);
  }

  let totalBytes = 0; const seen = new Set();
  for (const file of rawManifest.files) {
    if (!file || typeof file !== 'object') {
      throw appError('BACKUP_CORRUPT', '清单中存在无效的文件条目');
    }
    if (!isSafeRelativePath(file.path)) {
      throw appError('PATH_TRAVERSAL', `检测到非法或不安全的文件路径: ${file.path}`);
    }
    const normalized=file.path.normalize('NFC').replace(/\\/g,'/').toLowerCase();
    if(seen.has(normalized)) throw appError('BACKUP_CORRUPT','清单路径重复');
    seen.add(normalized);
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) {
      throw appError('BACKUP_CORRUPT', `文件长度无效: ${file.path}`);
    }
    if (file.bytes > MAX_SINGLE_FILE_BYTES) {
      throw appError('RESOURCE_LIMIT', `单文件大小超过上限: ${file.path} (${file.bytes} bytes)`);
    }
    if (typeof file.sha256 !== 'string' || file.sha256.length !== 64) {
      throw appError('BACKUP_CORRUPT', `文件缺少有效哈希校验: ${file.path}`);
    }
    totalBytes += file.bytes;
  }

  if (totalBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
    throw appError('RESOURCE_LIMIT', `备份解压总大小 (${totalBytes} bytes) 超过安全上限 (${MAX_TOTAL_UNCOMPRESSED_BYTES} bytes)`);
  }

  return {
    format: rawManifest.format,
    formatVersion: rawManifest.formatVersion,
    createdAt: rawManifest.createdAt || new Date().toISOString(),
    appVersion: rawManifest.appVersion || '0.5.0',
    sections: Array.isArray(rawManifest.sections) ? rawManifest.sections : [],
    files: rawManifest.files,
    totalBytes
  };
}

module.exports = {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  MAX_TOTAL_UNCOMPRESSED_BYTES,
  MAX_SINGLE_FILE_BYTES,
  MAX_FILE_COUNT,
  isSafeRelativePath,
  validateBackupManifest
};
