/**
 * Anti Face - 本地历史与趋势存储服务 (F4)
 *
 * 策略（不要混为一谈）：
 * - maxRecords：自动安全上限。追加写入后若超过上限，只在串行写入通道里丢掉最旧记录。
 * - retentionDays：不是自动保留策略。只作为手动 cleanupRecords('older_than_retention') 的阈值。
 *   查询、导出和重启都不会按天数删数据。
 * - 界面 pageSize 只影响分页，不影响导出、摘要和去重口径。
 */

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');

const CURRENT_SCHEMA_VERSION = 2;
const UI_MAX_PAGE_SIZE = 100;

class HistoryStorage {
  /**
   * @param {string} baseDir
   * @param {object} [options]
   */
  constructor(baseDir, options = {}) {
    this.baseDir = baseDir;
    this.historyFile = path.join(this.baseDir, 'task_history.jsonl');
    this.corruptLogFile = path.join(this.baseDir, 'corrupt_records.log');
    this.maxRecords = options.maxRecords || 50000;
    this.writeQueue = Promise.resolve();
    this.enabled = !!options.enabled;
    this.retentionDays = options.retentionDays || 30;
    this.flushTimeoutMs = options.flushTimeoutMs || 2000;
    this._corruptFingerprints = null;
    /** @type {null | (() => Promise<void> | void)} 测试用：重写前的栅栏，生产路径不设置 */
    this.onRewriteGate = null;
  }

  async init() {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
  }

  setRetentionDays(days) {
    if ([7, 30, 90].includes(days)) {
      this.retentionDays = days;
    }
  }

  /**
   * 单次失败不会毒化后续写入。调用方仍能拿到本次错误。
   * @param {() => Promise<any>} task
   */
  _enqueue(task) {
    const run = this.writeQueue.then(() => task(), () => task());
    this.writeQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  async appendRecord(record, { ifAbsent = false } = {}) {
    if (!this.enabled) return null;

    const sanitized = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: record.id || `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      requestId: record.requestId || null,
      taskId: record.taskId || null,
      occurredAt: record.occurredAt && Number.isFinite(Date.parse(record.occurredAt)) ? new Date(record.occurredAt).toISOString() : null,
      observedAt: new Date().toISOString(),
      model: record.model || 'unknown',
      project: record.project || '未知项目',
      status: record.status || 'completed',
      durationSeconds: record.durationSeconds != null ? Number(record.durationSeconds) : null,
      latencyMs: record.latencyMs != null ? Number(record.latencyMs) : null,
      averageSpeedToks: record.averageSpeedToks != null ? Number(record.averageSpeedToks) : null,
      inputTokens: record.inputTokens != null ? Number(record.inputTokens) : null,
      cachedInputTokens: record.cachedInputTokens != null ? Number(record.cachedInputTokens) : null,
      outputTokens: record.outputTokens != null ? Number(record.outputTokens) : null,
      reasoningTokens: record.reasoningTokens != null ? Number(record.reasoningTokens) : null,
      totalTokens: record.totalTokens != null ? Number(record.totalTokens) : null,
      attempts: Number.isInteger(record.attempts) && record.attempts > 0 ? record.attempts : null,
      isComplete: record.isComplete !== false,
      provenance: record.provenance || 'real',
      hostVersion: record.hostVersion || null
    };

    return this._enqueue(async () => {
      await this.init();
      if (ifAbsent && sanitized.requestId) {
        const { records } = await this.loadAllValidRecords();
        const existing = records.find(row => row.requestId === sanitized.requestId && row.schemaVersion >= 2);
        if (existing) return existing;
      }
      await this._appendLine(JSON.stringify(sanitized) + '\n');
      await this._enforceMaxRecords();
      return sanitized;
    });
  }

  async _appendLine(line) {
    await fs.appendFile(this.historyFile, line, 'utf8');
  }

  /**
   * 退出路径：有界等待。超时后不再阻塞进程退出。
   */
  async flush() {
    let timer;
    const timeout = new Promise(resolve => {
      timer = setTimeout(resolve, this.flushTimeoutMs);
    });
    try {
      await Promise.race([this.writeQueue, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** 导出路径：必须等完已提交的写入，不能用界面分页或退出超时截断。 */
  async waitForWrites() {
    await this.writeQueue;
  }

  async _fingerprintSet() {
    if (this._corruptFingerprints) return this._corruptFingerprints;
    const set = new Set();
    if (fsSync.existsSync(this.corruptLogFile)) {
      const text = await fs.readFile(this.corruptLogFile, 'utf8');
      for (const line of text.split('\n')) {
        const mark = 'Corrupted: ';
        const idx = line.indexOf(mark);
        if (idx >= 0) set.add(crypto.createHash('sha256').update(line.slice(idx + mark.length)).digest('hex'));
      }
    }
    this._corruptFingerprints = set;
    return set;
  }

  async loadAllValidRecords() {
    await this.init();
    if (!fsSync.existsSync(this.historyFile)) {
      return { records: [], corruptCount: 0 };
    }

    const records = [];
    let corruptCount = 0;
    const corruptLines = [];
    const fileStream = fsSync.createReadStream(this.historyFile, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const item = JSON.parse(trimmed);
        if (item && typeof item === 'object' && item.schemaVersion) {
          // v1 transcript archives used collection time and planner count as facts.
          // Keep the original file, but expose those unproven fields as unknown.
          if (item.schemaVersion < 2 && /:turn:\d+$/.test(item.requestId || '')) {
            records.push({ ...item, occurredAt: null, observedAt: item.occurredAt || null, attempts: null, latencyMs: null });
          } else records.push(item);
        } else {
          corruptCount++;
          corruptLines.push(trimmed);
        }
      } catch {
        corruptCount++;
        corruptLines.push(trimmed);
      }
    }

    if (corruptLines.length > 0) {
      const seen = await this._fingerprintSet();
      const fresh = [];
      for (const line of corruptLines) {
        const hash = crypto.createHash('sha256').update(line).digest('hex');
        if (seen.has(hash)) continue;
        seen.add(hash);
        fresh.push(line);
      }
      if (fresh.length > 0) {
        try {
          await fs.appendFile(
            this.corruptLogFile,
            fresh.map(l => `[${new Date().toISOString()}] Corrupted: ${l}`).join('\n') + '\n',
            'utf8'
          );
        } catch { /* 隔离日志写失败不能影响原历史 */ }
      }
    }

    return { records, corruptCount };
  }

  _dedupe(records) {
    const requestMap = new Map();
    const deduplicated = [];
    for (let i = records.length - 1; i >= 0; i--) {
      const rec = records[i];
      if (rec.requestId) {
        if (!requestMap.has(rec.requestId)) {
          requestMap.set(rec.requestId, true);
          deduplicated.unshift(rec);
        }
      } else {
        deduplicated.unshift(rec);
      }
    }
    return deduplicated;
  }

  _filter(deduplicated, filter) {
    const now = Date.now();
    return deduplicated.filter(rec => {
      const time = rec.occurredAt ? Date.parse(rec.occurredAt) : NaN;
      if ((filter.dateRange && filter.dateRange !== 'all' || filter.startDate && filter.endDate) && (!Number.isFinite(time) || time > now)) return false;
      if (filter.dateRange === 'today') {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        if (time < todayStart.getTime()) return false;
      } else if (filter.dateRange === '7d') {
        if (time < now - 7 * 86400000) return false;
      } else if (filter.dateRange === '30d') {
        if (time < now - 30 * 86400000) return false;
      } else if (filter.startDate && filter.endDate) {
        const start = new Date(filter.startDate).getTime();
        const end = new Date(filter.endDate).getTime();
        if (time < start || time > end) return false;
      }
      if (filter.model && filter.model !== 'all' && rec.model !== filter.model) return false;
      if (filter.project && filter.project !== 'all' && rec.project !== filter.project) return false;
      if (filter.status && filter.status !== 'all' && rec.status !== filter.status) return false;
      if (filter.completeOnly && !rec.isComplete) return false;
      return true;
    });
  }

  _summarize(filtered) {
    let knownTotalInput = 0;
    let knownTotalOutput = 0;
    let knownTotalCached = 0;
    let missingOutputCount = 0;
    let validSpeedSamples = 0;
    let speedSum = 0;
    let retryCount = 0;
    let missingAttemptsCount = 0;
    for (const r of filtered) {
      if (r.inputTokens != null) knownTotalInput += r.inputTokens;
      if (r.cachedInputTokens != null) knownTotalCached += r.cachedInputTokens;
      if (r.outputTokens != null) knownTotalOutput += r.outputTokens;
      else missingOutputCount++;
      if (r.averageSpeedToks != null && r.averageSpeedToks > 0) {
        validSpeedSamples++;
        speedSum += r.averageSpeedToks;
      }
      if (r.attempts > 1) retryCount += (r.attempts - 1);
      if (r.attempts == null) missingAttemptsCount++;
    }
    const totalCount = filtered.length;
    return {
      totalRecords: totalCount,
      knownTotalInput,
      knownTotalOutput,
      knownTotalCached,
      missingOutputCount,
      hasMissingData: missingOutputCount > 0,
      averageOutputSpeed: validSpeedSamples > 0 ? Number((speedSum / validSpeedSamples).toFixed(1)) : null,
      averageOutputTokens: (totalCount - missingOutputCount) > 0
        ? Math.round(knownTotalOutput / (totalCount - missingOutputCount))
        : null,
      retryCount: missingAttemptsCount === filtered.length && filtered.length > 0 ? null : retryCount,
      missingAttemptsCount
    };
  }

  /**
   * 筛选 + 去重后的完整集合。导出和摘要都用它，不受 UI pageSize 限制。
   */
  async collectMatching(filter = {}) {
    await this.waitForWrites();
    const { records, corruptCount } = await this.loadAllValidRecords();
    const deduplicated = this._dedupe(records);
    const filtered = this._filter(deduplicated, filter);
    return {
      records: filtered,
      totalCount: filtered.length,
      availableModels: Array.from(new Set(deduplicated.map(r => r.model))),
      availableProjects: Array.from(new Set(deduplicated.map(r => r.project))),
      corruptCount,
      summary: this._summarize(filtered)
    };
  }

  async queryRecords(filter = {}) {
    const all = await this.collectMatching(filter);
    const page = Math.max(1, Number(filter.page) || 1);
    const pageSize = Math.min(UI_MAX_PAGE_SIZE, Math.max(1, Number(filter.pageSize) || 20));
    const totalPages = Math.ceil(all.totalCount / pageSize) || 1;
    return {
      records: all.records.slice((page - 1) * pageSize, page * pageSize),
      totalCount: all.totalCount,
      page,
      pageSize,
      totalPages,
      availableModels: all.availableModels,
      availableProjects: all.availableProjects,
      corruptCount: all.corruptCount,
      summary: all.summary
    };
  }

  async exportCsv(filter = {}) {
    const queryRes = await this.collectMatching(filter);
    const escapeCsv = (val) => {
      if (val == null) return '';
      let str = String(val);
      if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };
    const headers = [
      'RecordID', 'OccurredAt', 'Model', 'Project', 'Status',
      'DurationSec', 'LatencyMs', 'AverageSpeedToks',
      'InputTokens', 'CachedTokens', 'OutputTokens', 'ReasoningTokens',
      'TotalTokens', 'Attempts', 'IsComplete', 'Provenance', 'ObservedAt'
    ];
    const lines = [headers.join(',')];
    for (const r of queryRes.records) {
      lines.push([
        escapeCsv(r.id),
        escapeCsv(r.occurredAt),
        escapeCsv(r.model),
        escapeCsv(r.project),
        escapeCsv(r.status),
        escapeCsv(r.durationSeconds),
        escapeCsv(r.latencyMs),
        escapeCsv(r.averageSpeedToks),
        escapeCsv(r.inputTokens),
        escapeCsv(r.cachedInputTokens),
        escapeCsv(r.outputTokens),
        escapeCsv(r.reasoningTokens),
        escapeCsv(r.totalTokens),
        escapeCsv(r.attempts),
        escapeCsv(r.isComplete),
        escapeCsv(r.provenance),
        escapeCsv(r.observedAt)
      ].join(','));
    }
    return lines.join('\r\n');
  }

  async exportJson(filter = {}) {
    const queryRes = await this.collectMatching(filter);
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      totalCount: queryRes.totalCount,
      summary: queryRes.summary,
      records: queryRes.records
    }, null, 2);
  }

  async _atomicReplace(records) {
    const tempFile = path.join(this.baseDir, `task_history_tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jsonl`);
    const content = records.map(r => JSON.stringify(r)).join('\n') + (records.length > 0 ? '\n' : '');
    try {
      await fs.writeFile(tempFile, content, 'utf8');
      const file = await fs.open(tempFile, 'r+');
      try { await file.sync(); } finally { await file.close(); }
      await fs.rename(tempFile, this.historyFile);
    } finally {
      // Never overwrite the original on rename failure. The caller can retry safely.
      await fs.rm(tempFile, { force: true }).catch(() => {});
    }
  }

  async _enforceMaxRecords() {
    if (!fsSync.existsSync(this.historyFile)) return;
    const { records } = await this.loadAllValidRecords();
    if (records.length <= this.maxRecords) return;
    await this._atomicReplace(records.slice(records.length - this.maxRecords));
  }

  /**
   * 清理与追加共用串行通道。读取发生在取得通道之后，避免用旧快照覆盖新记录。
   * @param {'all'|'older_than_retention'|{ startDate: string, endDate: string }} scope
   */
  async cleanupRecords(scope = 'older_than_retention') {
    return this._enqueue(async () => {
      await this.init();
      const { records } = await this.loadAllValidRecords();
      if (this.onRewriteGate) await this.onRewriteGate();
      const originalCount = records.length;
      let retained = records;
      const now = Date.now();
      if (scope === 'all') {
        retained = [];
      } else if (scope === 'older_than_retention') {
        const cutoff = now - this.retentionDays * 86400000;
        retained = records.filter(r => !r.occurredAt || !Number.isFinite(Date.parse(r.occurredAt)) || Date.parse(r.occurredAt) >= cutoff);
      } else if (scope && scope.startDate && scope.endDate) {
        const start = new Date(scope.startDate).getTime();
        const end = new Date(scope.endDate).getTime();
        retained = records.filter(r => {
          const t = r.occurredAt ? Date.parse(r.occurredAt) : NaN;
          return !Number.isFinite(t) || t < start || t > end;
        });
      }
      await this._atomicReplace(retained);
      return {
        deletedCount: originalCount - retained.length,
        remainingCount: retained.length
      };
    });
  }
}

module.exports = {
  HistoryStorage,
  CURRENT_SCHEMA_VERSION,
  UI_MAX_PAGE_SIZE
};
