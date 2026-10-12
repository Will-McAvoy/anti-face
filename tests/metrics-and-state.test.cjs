const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateOutputLatency,
  calculateAverageSpeed,
  RollingSpeedCalculator,
  deduplicateUsage,
  calculateRetryUsage,
  calculateInputAndCache,
  calculateOutputAndReasoning,
  aggregateEfficiency
} = require('../core/metrics.cjs');
const {
  createInitialTaskState,
  taskStateReducer,
  markStateStale
} = require('../core/state-machine.cjs');

test('T01: calculateOutputLatency - 延迟计算与缺失处理', () => {
  // 请求开始：1000ms，首个输出：1800ms -> 800ms
  assert.equal(calculateOutputLatency(1000, 1800), 800);
  // 缺少开始时间 -> null
  assert.equal(calculateOutputLatency(null, 1800), null);
  // 缺少首个输出时间 -> null
  assert.equal(calculateOutputLatency(1000, null), null);
  // 时间倒流异常 -> null
  assert.equal(calculateOutputLatency(2000, 1800), null);
});

test('T02: calculateAverageSpeed - 区间平均输出速度', () => {
  // 4 秒内新增 20 个输出 Token -> 5.0 tok/s
  assert.equal(calculateAverageSpeed(20, 4), 5.0);
  // 输入 Token 不影响输出速度计算 (独立纯函数)
  assert.equal(calculateAverageSpeed(20, 4), 5.0);
  // 持续时间 <= 0 -> null
  assert.equal(calculateAverageSpeed(20, 0), null);
  // 负 Token -> null
  assert.equal(calculateAverageSpeed(-5, 4), null);
});

test('T03: RollingSpeedCalculator - 5秒滑动窗口与去重', () => {
  const calc = new RollingSpeedCalculator(5);
  // 0s 到 5s 内逐步增加 25 个 Token
  calc.addSample(1000, 5, 'evt-1');
  calc.addSample(2000, 5, 'evt-2');
  calc.addSample(3000, 5, 'evt-3');
  calc.addSample(4000, 5, 'evt-4');
  calc.addSample(5000, 5, 'evt-5');

  // 重复事件输入，去重不重复累加
  calc.addSample(5000, 5, 'evt-5');

  // 在 6000ms 观察 (跨度 5000ms)
  const res = calc.getRollingSpeed(6000);
  assert.equal(res.status, 'valid');
  assert.equal(res.speed, 5.0);

  // 断线测试：标记断线后返回 stale，不继续产生新数据
  calc.setConnected(false);
  const disconnectedRes = calc.getRollingSpeed(6500);
  assert.equal(disconnectedRes.status, 'stale');
  assert.equal(disconnectedRes.speed, null);
});

test('T04: deduplicateUsage - 累计量与 final 去重', () => {
  // cumulative 10, cumulative 20, final 20, duplicate final 20 -> 20 (not 70)
  const records = [
    { scope: 'request', type: 'cumulative', tokens: 10, requestId: 'req-1' },
    { scope: 'request', type: 'cumulative', tokens: 20, requestId: 'req-1' },
    { scope: 'request', type: 'final', tokens: 20, requestId: 'req-1' },
    { scope: 'request', type: 'final', tokens: 20, requestId: 'req-1' }
  ];
  assert.equal(deduplicateUsage(records), 20);
});

test('T05: calculateRetryUsage - 重试用量归属与累计追踪', () => {
  // attempt A: 10 failed
  // attempt B: 20 succeeded
  const attempts = [
    { attemptId: 'att-1', outputTokens: 10, status: 'failed' },
    { attemptId: 'att-2', outputTokens: 20, status: 'success' }
  ];
  const stats = calculateRetryUsage(attempts);
  assert.equal(stats.totalOutput, 30);
  assert.equal(stats.attemptCount, 2);
  assert.equal(stats.retryOutput, 20);
  assert.equal(stats.retryRatio, 66.7);
});

test('T06: calculateInputAndCache - 缓存包含关系与异常检查', () => {
  // 包含模式：总输入 100，缓存 40 -> 总输入 100，缓存率 40%
  const res1 = calculateInputAndCache(100, 40, true);
  assert.equal(res1.totalInput, 100);
  assert.equal(res1.cacheRate, 40.0);
  assert.equal(res1.isApplicable, true);

  // 互斥模式：非缓存输入 60，缓存 40 -> 总输入 100，缓存率 40%
  const res2 = calculateInputAndCache(60, 40, false);
  assert.equal(res2.totalInput, 100);
  assert.equal(res2.cacheRate, 40.0);
  assert.equal(res2.isApplicable, true);

  // 语义未知模式：不可计算总数或缓存率
  const res3 = calculateInputAndCache(100, 40, 'unknown');
  assert.equal(res3.totalInput, null);
  assert.equal(res3.cacheRate, null);
  assert.equal(res3.error, '统计口径未知');

  // 异常模式：缓存大于包含的输入
  const res4 = calculateInputAndCache(50, 60, true);
  assert.equal(res4.error, '缓存计数异常 (大于总输入)');
});

test('T07: calculateOutputAndReasoning - 推理与输出包含关系', () => {
  // output 30, reasoning 10, includes=true -> 合计 30, 可见 20
  const res1 = calculateOutputAndReasoning(30, 10, true);
  assert.equal(res1.totalOutput, 30);
  assert.equal(res1.visibleOutput, 20);

  // includes=unknown -> 保持独立，不盲目合并
  const res2 = calculateOutputAndReasoning(30, 10, 'unknown');
  assert.equal(res2.totalOutput, null);
  assert.equal(res2.error, '包含关系未知');
});

test('T08: aggregateEfficiency - 仅 final 用量与缺失聚合', () => {
  const tasks = [
    { outputTokens: 50, isFinalOnly: true },
    { outputTokens: 30, isFinalOnly: true }
  ];
  const agg = aggregateEfficiency(tasks);
  assert.equal(agg.knownOutputLowerBound, 80);
  assert.equal(agg.averageKnownOutputPerTask, 40.0);
  assert.equal(agg.isComplete, true);

  // 包含缺失数据的情况
  const incompleteTasks = [
    { outputTokens: 20 },
    { outputTokens: null }
  ];
  const aggIncomplete = aggregateEfficiency(incompleteTasks);
  assert.equal(aggIncomplete.knownOutputLowerBound, 20);
  assert.equal(aggIncomplete.missingSampleCount, 1);
  assert.equal(aggIncomplete.isComplete, false);
});

test('T09: taskStateReducer - 终态不可逆与乱序防护', () => {
  let state = createInitialTaskState('task-1');
  state = taskStateReducer(state, { type: 'task_started', taskId: 'task-1', sequence: 1 });
  assert.equal(state.phase, 'running');

  // generating
  state = taskStateReducer(state, { phase: 'generating', sequence: 2 });
  assert.equal(state.phase, 'generating');

  // completed (终态)
  state = taskStateReducer(state, { phase: 'completed', sequence: 3 });
  assert.equal(state.phase, 'completed');

  // 较早的 generating 事件到达，终态坚决不倒退
  state = taskStateReducer(state, { phase: 'generating', sequence: 2 });
  assert.equal(state.phase, 'completed');

  // 新任务开始可以重置
  state = taskStateReducer(state, { type: 'task_started', taskId: 'task-2', sequence: 1 });
  assert.equal(state.taskId, 'task-2');
  assert.equal(state.phase, 'running');
});

test('F1 多工具并发管理', () => {
  let state = createInitialTaskState('task-tool');
  state = taskStateReducer(state, { type: 'task_started', taskId: 'task-tool' });

  // 启动工具 A
  state = taskStateReducer(state, { type: 'tool_call_start', toolId: 'tool-A' });
  assert.equal(state.phase, 'tool_running');
  assert.equal(state.activeTools.size, 1);

  // 启动工具 B
  state = taskStateReducer(state, { type: 'tool_call_start', toolId: 'tool-B' });
  assert.equal(state.phase, 'tool_running');
  assert.equal(state.activeTools.size, 2);

  // 工具 A 结束，工具 B 仍在运行，因此 phase 依然是 tool_running
  state = taskStateReducer(state, { type: 'tool_call_end', toolId: 'tool-A' });
  assert.equal(state.phase, 'tool_running');
  assert.equal(state.activeTools.size, 1);

  // 工具 B 结束，没有活跃工具，回到 running
  state = taskStateReducer(state, { type: 'tool_call_end', toolId: 'tool-B' });
  assert.equal(state.phase, 'running');
  assert.equal(state.activeTools.size, 0);
});
