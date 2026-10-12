const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { HistoryStorage } = require('../desktop/history-storage.cjs');

test('F4 规模验收: 10,000 条记录下筛选、翻页和导出可用并报告实际耗时', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-scale-'));
  try {
    const storage = new HistoryStorage(tempDir, { enabled: true });
    await storage.init();

    // 1. 生成 10,000 条测试记录写入文件
    const t0 = performance.now();
    const batch = [];
    const models = ['Gemini 3.7 Flash', 'Gemini 3.8 Flash (High)', 'Claude 3.7 Sonnet'];
    const projects = ['hermes', 'anti_face', '物理拔高', 'default'];

    for (let i = 0; i < 10000; i++) {
      batch.push(JSON.stringify({
        schemaVersion: 1,
        id: `rec_${i}`,
        requestId: `req_${i % 8000}`, // 产生一定程度的去重场景
        taskId: `task_${i}`,
        occurredAt: new Date(Date.now() - (i % 60) * 86400000).toISOString(),
        model: models[i % models.length],
        project: projects[i % projects.length],
        status: i % 20 === 0 ? 'failed' : 'completed',
        durationSeconds: (i % 120) + 1,
        latencyMs: (i % 500) + 200,
        averageSpeedToks: 15.5,
        inputTokens: (i % 1000) + 100,
        cachedInputTokens: (i % 400),
        outputTokens: (i % 500) + 50,
        reasoningTokens: (i % 100),
        totalTokens: (i % 1500) + 200,
        attempts: (i % 15 === 0) ? 2 : 1,
        isComplete: true,
        provenance: 'real'
      }));
    }
    await fs.writeFile(storage.historyFile, batch.join('\n') + '\n', 'utf8');
    const writeTime = performance.now() - t0;

    // 2. 测量 10,000 条数据下的筛选与分页查询耗时
    const q0 = performance.now();
    const res = await storage.queryRecords({
      dateRange: '7d',
      model: 'Gemini 3.8 Flash (High)',
      page: 1,
      pageSize: 20
    });
    const queryTime = performance.now() - q0;

    assert.ok(res.totalCount > 0, '应筛选出 7 天内的指定模型记录');
    assert.equal(res.records.length, 20, '第一页应返回 20 条记录');
    assert.ok(res.summary.knownTotalOutput > 0, '统计摘要有效');

    // 3. 测量翻页耗时 (第 5 页)
    const p0 = performance.now();
    const page5 = await storage.queryRecords({
      dateRange: '7d',
      model: 'Gemini 3.8 Flash (High)',
      page: 5,
      pageSize: 20
    });
    const pageTime = performance.now() - p0;
    assert.equal(page5.records.length, 20);

    // 4. 测量导出 CSV 耗时
    const e0 = performance.now();
    const csv = await storage.exportCsv({ dateRange: '7d', model: 'Gemini 3.8 Flash (High)' });
    const exportTime = performance.now() - e0;
    assert.ok(csv.startsWith('RecordID,OccurredAt,Model'), 'CSV 格式合法');
    assert.ok(csv.split('\r\n').length > 10, '导出内容非空');

    console.log(`[Scale Benchmark] 10,000 记录实测耗时:
- 写入 10,000 条: ${writeTime.toFixed(1)} ms
- 筛选与首批查询: ${queryTime.toFixed(1)} ms
- 翻页查询 (Page 5): ${pageTime.toFixed(1)} ms
- 筛选导出 CSV: ${exportTime.toFixed(1)} ms`);

    // 确认耗时在合理范围（单次主进程操作在百毫秒级，不卡顿）
    assert.ok(queryTime < 500, `查询耗时 ${queryTime}ms 超过 500ms 阈值`);
    assert.ok(exportTime < 1000, `导出耗时 ${exportTime}ms 超过 1000ms 阈值`);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
