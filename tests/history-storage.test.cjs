const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { HistoryStorage } = require('../desktop/history-storage.cjs');

test('T10 & T11: HistoryStorage - 跨窗口去重与不完整历史标记', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-hist-'));
  try {
    const storage = new HistoryStorage(tempDir, { enabled: true });
    await storage.init();

    // T10: 两个目标上报同一 requestId 的 final 记录
    await storage.appendRecord({
      requestId: 'req-multi-1',
      model: 'Gemini 3.8 Flash',
      project: 'hermes',
      outputTokens: 20
    });
    await storage.appendRecord({
      requestId: 'req-multi-1', // 同一请求
      model: 'Gemini 3.8 Flash',
      project: 'hermes',
      outputTokens: 20
    });

    // 另一个不同请求，outputTokens: null (不完整记录)
    await storage.appendRecord({
      requestId: 'req-incomplete-2',
      model: 'Gemini 3.8 Flash',
      project: 'hermes',
      outputTokens: null,
      isComplete: false
    });

    const res = await storage.queryRecords();
    // 跨窗口去重后：只有 2 条独立请求记录 (1 条 req-multi-1 + 1 条 req-incomplete-2)
    assert.equal(res.totalCount, 2);

    // T11: 聚合展示已知下限 20，并明确标记 1 条记录缺失
    assert.equal(res.summary.knownTotalOutput, 20);
    assert.equal(res.summary.missingOutputCount, 1);
    assert.equal(res.summary.hasMissingData, true);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('T13: HistoryStorage - 存储边界、损坏行隔离与 CSV 公式注入防护', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-hist-boundary-'));
  try {
    const storage = new HistoryStorage(tempDir, { enabled: true });
    await storage.init();

    // 写入有效记录
    await storage.appendRecord({
      id: 'rec-1',
      model: 'Gemini 3.8 Flash',
      project: '=cmd|"/C calc"!A0', // 潜在 CSV 注入 payload
      outputTokens: 100
    });

    // 人工在文件末尾追加一条损坏的半截 JSON 行
    await fs.appendFile(storage.historyFile, '{"schemaVersion": 1, "id": "broken", invalid_json\n', 'utf8');

    // 再次写入有效记录
    await storage.appendRecord({
      id: 'rec-2',
      model: 'Gemini 3.8 Flash',
      project: '+dangerous_formula',
      outputTokens: 50
    });

    // 读取测试：有效记录被正常读取，损坏记录被隔离且统计
    const loaded = await storage.loadAllValidRecords();
    assert.equal(loaded.records.length, 2);
    assert.equal(loaded.corruptCount, 1);

    // CSV 导出安全检查
    const csv = await storage.exportCsv();
    assert.ok(csv.includes("'=cmd|"), '以 = 开头的项目名必须被单引号转义');
    assert.ok(csv.includes("'+dangerous_formula"), '以 + 开头的项目名必须被单引号转义');

    // 清理测试
    const cleanup = await storage.cleanupRecords('all');
    assert.equal(cleanup.deletedCount, 2);
    const after = await storage.queryRecords();
    assert.equal(after.totalCount, 0);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
