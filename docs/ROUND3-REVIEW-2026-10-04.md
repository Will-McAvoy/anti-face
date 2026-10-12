# 第 3 轮检查报告（修复前证据）

后续状态：问题已在 0.2.1 修复，见 [第三轮交付](ROUND3-FIX-2026-10-04.md)。复现脚本现已转换为正确性回归；本报告中的错误输出保留为修复前证据。
检查日期：2026-10-04
项目：D:\onedrive\work\hermes\anti_face

## 结论
上一轮 9 个复现问题已通过回归复查，修正有实际效果；但尚不能判定功能完整通过。本轮确认 6 组问题（对应 8 类复现场景），包括历史文件失败路径的数据完整性、多窗口 UI 入口、统计语义及新鲜度。已生成 THIRD_ROUND_FUNCTION_FIX_PROMPT.md。

## 已通过
- npm run check：类型检查、构建及 41/41 测试成功。
- npm run test:desktop：退出码 0；覆盖桌面 UI、过滤、持久化、壁纸、JSON 导入导出、IPC 校验、渲染隔离、telemetry、历史导出、进程重启、旧设置迁移与无 preload 的桌面提示。
- node scripts/review-round2.cjs：上一轮 9 项均 fixed:true，包括完整导出、清理与追加并发、多窗口服务直接应用、独立窗口状态、恢复竞态、fixture 来源隔离、会话切换、新轮次状态与自动恢复偏好持久化。

## 未通过的隔离复现
| 优先级 | 问题 | 实际结果及影响 | 代码位置 |
|---|---|---|---|
| P1 | 历史替换失败保护不足 | 注入 rename 失败及复制中途失败，原文件被 partial 覆盖。是故障注入证明的潜在数据丢失，并非观察到真实用户文件损坏 | desktop/history-storage.cjs:353 |
| P1 | 首次选择另一窗口无法通过 UI 应用 | B 列为 detected，statusFor(B)=detached，UI canApply=false；重新 inspect 仍选择 A | desktop/theme-service.cjs:260、593；src/App.tsx:179、287 |
| P2 | 未应用主题时断线状态不更新 | 实际已断线，tick 后仍 ready | desktop/theme-service.cjs:260、429 |
| P2 | 第二轮延迟来自第一轮 | turn:1 应为 2000ms，实际 100ms；历史也引用共享延迟 | desktop/telemetry-sources.cjs:379、408 |
| P2 | 缺失统计仍保留旧派生数值 | 原始 input/output=null，派生 totalInput=150、totalOutput=200、cacheRate=33.3 | desktop/telemetry-sources.cjs:428 |
| P2 | 无会话仍显示旧指标 | phase=unknown，cached=50、cacheRate=33.3、averageSpeed=20、stale=false | desktop/telemetry-sources.cjs 的 tick |
| P2 | 损坏统计仍呈现为新鲜值 | 输出 200、metricsStale=false，同时提示统计缓存损坏 | desktop/telemetry-sources.cjs:428 |
| P2 | 历史重试及发生日期错误 | 3 个普通规划事件、0 重试事件，却计 2 次重试；2020 年事件按当前写入日期计入今日 | desktop/telemetry-sources.cjs:397–415；desktop/history-storage.cjs 记录规范化 |

## 证据与边界
复现脚本：scripts/review-round3.cjs。
机器结果：artifacts/round3-review-results.json。
脚本使用合成日志、模拟 CDP 和独立临时目录；文件故障注入限制于测试目标，结束后恢复 mock 并清理临时目录。未接触真实宿主聊天或真实历史数据。

本次 round3 脚本断言的是缺陷存在，退出码 0 表示成功复现，不能表述为产品测试通过。修复后应改为正确性断言。
多窗口 UI 阻断来自服务隔离复现及 App.tsx 按钮条件/选择流程的联合核对；本次没有执行双模拟窗口的实际点击测试，该端到端验证已列为修复验收要求。
本次没有向真实 Antigravity 应用主题，也没有验证真实 token 来源或重新打包安装程序。上述已通过测试不覆盖这些边界。

## 本轮产物
仅新增本报告、第 3 轮修正提示词、隔离复现脚本和复现结果；未修改业务实现。运行构建和旧回归会刷新其生成产物。

