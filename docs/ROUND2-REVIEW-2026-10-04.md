# Anti Face 0.2.0 功能复查

复查日期：2026-10-04（Asia/Taipei）
项目位置：D:\onedrive\work\hermes\anti_face

## 结论

基础构建与原有换肤界面可用，但第二轮新增能力尚不能按验收文档认定为全部完成。发现历史记录丢失、导出截断、选错窗口、自动恢复竞态、遥测串会话及设置丢失等问题。

本次只做检查并新增复查脚本、结果文件与修正提示词，没有修改产品功能代码。npm run check 重建了 dist；桌面冒烟测试更新了 artifacts 下的截图。没有重新打包，也没有运行真实宿主换肤测试。

## 实际执行

- npm run check：通过，TypeScript + Vite 构建成功，32/32 项现有测试通过。
- npm run test:desktop：通过，覆盖现有主题界面、持久化、壁纸、配置导入导出和部分 IPC 隔离。
- node scripts/review-round2.cjs：在隔离文件夹和模拟 CDP 中确认下列 9 个异常观测，结果见 artifacts/round2-review-results.json。

注意：复查脚本断言的是“当前缺陷确实存在”。修复时应把相应场景改成正确行为的回归测试，不能把复查脚本退出码 0 解释为功能验收通过。

## 已复现问题

| 优先级 | 问题 | 复现结果 | 主要位置 |
|---|---|---|---|
| P1 | 历史清理覆盖并发追加 | 清理先读取 125 条记录，其间追加第 126 条；清理结束仅剩 125 条，新记录丢失 | desktop/history-storage.cjs:340；清理未进入追加写入队列 |
| P1 | 历史导出截断 | 125 条唯一记录，JSON totalCount=125，但 records 仅 100 条；CSV 同样只有 100 条 | desktop/history-storage.cjs:236、272、324 |
| P1 | 选择 B 窗口却修改 A | 对 A 应用后再对 B 应用，实际 session.targetId 仍为 A；A 写入 2 次，B 写入 0 次 | desktop/theme-service.cjs:113、188；已有 session 时忽略 specificTargetId |
| P1 | 手动恢复请求不能立即取消自动恢复 | tick 正在等待心跳响应时调用 restore；请求提交后仍发生 1 次注入，最终才移除 | desktop/theme-service.cjs:254、327；取消代数排在同一阻塞队列之后 |
| P1 | 切换会话显示前一会话统计 | 同一统计缓存包含 A/B 会话，A 为 model-A/10，B 为 model-B/90；切到 B 后仍显示 model-A/10 | desktop/telemetry-sources.cjs:191、238；缓存键只有 mtime，指标未按会话重置 |
| P1 | 同会话下一轮仍显示已完成 | transcript 先出现 DONE，再追加新的 USER_INPUT，状态仍为 completed | desktop/telemetry-sources.cjs:210；taskId 固定为会话前缀，未按请求轮次区分 |
| P2 | 模拟模式退出后数据残留 | fixture→host，真实目标暂时没有会话 ID，仍显示 2200 Token，provenance=fixture 且 isStale=false | desktop/telemetry-sources.cjs:72；只重置状态机，不重置指标与缓存 |
| P2 | 窗口列表状态与实际状态不一致 | 页面刷新后主状态变 ready，targets 列表仍报 applied | desktop/theme-service.cjs:100、287；targets entry.session 未同步清空 |
| P2 | 自动恢复设置保存时丢失 | validateSettings 输入 autoRestoreOnReload=true，输出完全不含该字段 | core/theme.cjs:validateSettings；src/lib/settings.ts:10；src/App.tsx:67 |

## 同时确认的代码接线缺口

- 真实日志轮询没有发出 task_started，也没有初始化 observedStartMs；上述真实格式夹具的 observedStartMs=null，观测耗时一直是 0。代码使用 Date.now，而验收文档称使用单调时钟。
- USER_INPUT 被映射为 waiting_user；单个 PLANNER_RESPONSE/DONE 被当成整个任务 completed。任务阶段需要经实际宿主语义验证，缺证据时应显示 unknown。
- 同会话使用同一个 taskId/requestId，历史 lastSavedTaskId 按 convoId 去重，无法正确表示同一聊天的多个请求。保存标记在 appendRecord 成功前更新，失败可能不再重试。
- 前端的遥测窗口选择只更新 selectedTargetId；TelemetryManager 仍选择 themeService 当前窗口或第一窗口，选择操作没有切换遥测数据源。
- autoRestoreOnReload 未贯穿保存/读取/启动恢复；history enabled、retentionDays 只存内存，主进程重启固定 false/30。
- 历史 writeQueue 使用 then 链，前一次写入拒绝后后续写入也持续拒绝；需恢复队列但仍报告失败。
- telemetry 的 setInterval 没有防重入；旧轮询可能在模式或窗口切换后写回。未读取到数据仍更新 lastUpdated、finalTokens 固定 true；错误时 metrics.isStale 与 taskState.isStale 不一致。
- 历史损坏行每次查询都会再次追加到隔离日志；maxRecords 没有执行逻辑。保留周期目前只用于手动清理阈值，不能表述为已实现自动保留策略。

这些代码问题需要在修正阶段进一步补测试。没有在用户真实历史文件上做破坏性复现。

## 为何现有测试没有发现

- 多窗口测试只验证能枚举两个目标，且两个窗口共用同一个 client，没有测试分别应用、恢复和续期。
- T12 先 await restore，再 tick，没有让恢复请求与正在运行的自动恢复交错。
- 规模导出测试只检查 CSV 非空、超过 10 行，没有核对导出记录总数。
- 遥测测试只验证初始空状态和进入 fixture，未验证退出 fixture、跨会话、连续请求和断线重连。
- 现有桌面冒烟测试主要覆盖 0.1.0 的主题功能，不能证明全部新面板端到端正确。

## 交付

修正提示词：SECOND_ROUND_FUNCTION_FIX_PROMPT.md。
应保留 SECOND_ROUND_UPGRADE_PROMPT.md 原文件，下一轮以当前代码和本次复查证据为基线，不再直接沿用“全部已实现且验证”的结论。
