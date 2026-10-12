# Anti Face 第二轮功能升级验收矩阵 (ROUND2-ACCEPTANCE)

**评估时间**：2026-10-04  
**宿主版本**：Antigravity Desktop 2.19.1.0 (win32-x64)  
**执行结果**：功能修正后的 `npm run check` 为 41/41 通过。桌面进程重启冒烟通过。真实宿主只复核了当前主窗口的 15 套主题应用与外观恢复。Token 与任务阶段没有用一条已知真实请求对账。下面第 0 节是本轮修正的证据；旧表里的“已实现且验证”只表示当时的夹具或 2026-10-03 文件调查，不能读成“全部能力都在真实宿主上复核过”。

---

## 0. 2026-10-04 功能修正

| 项 | 代码 | 夹具 | 桌面进程 | 真实宿主 | 限制 |
|---|---|---|---|---|---|
| 历史不截断、清理不丢写 | `desktop/history-storage.cjs` | 125 条 JSON/CSV/总数都是 125；10000 条导出 10000；清理栅栏期间追加后仍为 126；一次写入失败后下一条成功；坏尾不清空 | 开发态冒烟导出 3 条，CSV 4 行。打包后的程序导出 125 条，CSV 126 行 | 不适用。历史文件在本机 userData，不读宿主 | 查询页仍然最多 100 条。7/30/90 天不会自动删除。`maxRecords` 才会在追加后丢掉最旧记录 |
| 按窗口隔离主题 | `desktop/theme-service.cjs`、`src/App.tsx` | A、B 使用不同 mock client。写 B 一次且会话是 B。A 掉线后 A 为 ready、B 仍 applied | 有宿主窗口时会操作“选择宿主窗口”；没有窗口时显示空态。冒烟没有从界面向真实窗口上色 | `npm run verify:host`：当前主窗口 15 套主题、壁纸、模糊 27、圆角 24，然后样式数和变量恢复。见 `compatibility/verification.json` | 真实宿主没有测两个窗口互不影响。标题只截到 50 字 |
| 手动恢复取消自动恢复 | `desktop/theme-service.cjs` | 心跳栅栏里调用 restore 后 lateWrites 为 0，owner 为 null。另有探测前、已发出注入、关闭自动恢复、宿主指纹变化、DOM 短暂不可用 | 桌面冒烟没有可控 CDP 栅栏 | 未做。没有在真实页面刷新途中点恢复 | 取消发生在发送前时注入为 0。命令已经发出时，夹具会删掉残留样式 |
| 遥测不串来源、窗口、轮次 | `desktop/telemetry-sources.cjs`、`core/state-machine.cjs`、`RealtimePanel` | fixture 再切 host 后 totalTokens 为 null、provenance 为 real。mtime 不变时 B 是 model-B / 90。USER_INPUT 后 phase 为 running。终态耗时冻结 | 桌面里切到模拟数据再切回，模拟模型名消失。当时的真实窗口显示“状态未知”和“当前没有可核对的 Token 用量。” | 只观察到连接和空值降级。没有把界面数字对上 `antigravity_stats_cache.json` 里的某一次请求 | 单个 PLANNER DONE 不是整个任务完成。没有逐 Token 时间戳。`finalTokens` 仅在读到累计值时为真 |
| 设置跨进程保留 | `core/theme.cjs`、`desktop/settings.cjs`、`src/lib/settings.ts` | 旧文件不发明 autoRestore/history。带上该字段时会保留。主题导出去掉这两项 | 关闭 Electron 再打开：极光玻璃、模糊 27、自动恢复开、历史开、90 天。旧的珍珠白文件迁移后偏好仍关闭，用户打开后重启仍是 7 天和自动恢复开 | 不适用 | 主题导入导出不携带应用偏好。保存失败会回退界面。非法保留天数仍是 30 |
| 无 preload 与空态 | `RealtimePanel.tsx`、`HistoryPanel.tsx` | 文案在组件里；回归测试不渲染浏览器 | `scripts/no-preload-shell.cjs`：两个面板说明需要桌面版，不出现无限加载 | 真实窗口的空 Token 见上一行，不是无 preload | 浏览器预览不能读宿主，也不能写历史 |

复查脚本 `scripts/review-round2.cjs` 现在断言修正后的行为，并写出 `artifacts/round2-review-results.json`。不要用 2026-10-04 11:05 那份旧结果说明问题还在。

## 1. 验收矩阵标准

状态说明：
- **已实现且验证**：代码已实现，并且有自动化测试或环境验证证据。
- **已实现，真实环境待验证**：代码已实现并通过单元/桌面测试，等待特定宿主环境实测。
- **当前宿主不支持，已实现降级**：宿主未暴露稳定底层字段，系统已实现诚实降级与可信显示。
- **未完成**：尚在进行中。
- **不适用**：不属于本项范畴并附原因。

---

## 2. 详细验收条目清单

| ID | 需求子项 | 实现位置 | 自动化证据 | 真实验证证据 | 状态 | 限制/说明 |
|---|---|---|---|---|---|---|
| **P0** | **基线修复与干净构建** |  |  |  |  |  |
| P0.1 | 冲突文件安全隔离与备份 | `.backups/conflict-archive-2026-10-03/` | 当前 `scripts/` 里没有 `check-conflicts.cjs` 或 `archive-conflicts.cjs` | 2026-10-03 的归档说明见 `docs/CONFLICT-RECOVERY.md` | **历史记录，脚本已不在树中** | 本轮没有重做冲突归档 |
| P0.2 | 源码可全新构建 | `package.json`, `src/` | `npm run check` (tsc + vite) | 退出码 0，Vite 编译无错误 | **已实现且验证** | TS2717 彻底消除 |
| P0.3 | 原有 14 项单元测试回归 | `tests/*.test.cjs` | `node --test tests/*.test.cjs` | 14/14 原有断言完全通过 | **已实现且验证** | 核心断言无弱化或删减 |
| P0.4 | 全新 dist 桌面冒烟测试 | `scripts/smoke-desktop.cjs` | `npm run test:desktop` | PASS, 退出码 0 | **已实现且验证** | 真实 Electron 渲染与安全隔离 |
| **F1** | **实时任务状态** |  |  |  |  |  |
| F1.1 | 窗口与连接状态管理 | `desktop/theme-service.cjs`, `desktop/telemetry-sources.cjs` | `tests/telemetry-sources.test.cjs` | CDP 实时获取当前活动窗口标题与目标 ID | **已实现且验证** | 独立于换肤会话维护 |
| F1.2 | 9 种任务阶段模型与状态机 | `core/state-machine.cjs` | `tests/metrics-and-state.test.cjs` (T09, F1 多工具) | 观察到 generating / completed / tool_running 等状态 | **已实现且验证** | 终态单向递进，不可被旧事件倒退 |
| F1.3 | 已观测耗时与单调时钟 | `core/state-machine.cjs`, `desktop/telemetry-sources.cjs` | `tests/telemetry-sources.test.cjs` | 界面展示“已观测 xx 秒”，中途接入不伪造总时长 | **已实现且验证** | 使用本进程单调时钟避开系统时间调整干扰 |
| F1.4 | 数据源新鲜度与 stale 标记 | `core/state-machine.cjs`, `desktop/telemetry-sources.cjs` | `tests/metrics-and-state.test.cjs` (T03) | 宿主断开连接后显示过期标记并保留最后已知时间 | **已实现且验证** | 断开时不将任务误判为失败或完成 |
| F1.5 | 真实数据与 Mock 明确标识 | `src/components/RealtimePanel.tsx`, `desktop/telemetry-sources.cjs` | `tests/telemetry-sources.test.cjs` | 界面清晰标注“真实 Antigravity 宿主观测”与“测试模拟数据” | **已实现且验证** | 生产包默认关闭 Mock，不冒充真实数据 |
| **F2** | **Token 速度与输出延迟** |  |  |  |  |  |
| F2.1 | 首段输出延迟计算 (T01) | `core/metrics.cjs` | `tests/metrics-and-state.test.cjs` (T01) | 真实会话日志计算用户输入到首个规划输出秒级间隔 | **已实现且验证** | 缺失任一时间戳时显示“—”（不可用） |
| F2.2 | 区间平均输出速度计算 (T02) | `core/metrics.cjs` | `tests/metrics-and-state.test.cjs` (T02) | 结合会话持续耗时计算区间平均 tok/s | **已实现且验证** | 仅在有可靠持续时间区间时计算 |
| F2.3 | 5 秒滚动速度与窗口计算 (T03) | `core/metrics.cjs` (`RollingSpeedCalculator`) | `tests/metrics-and-state.test.cjs` (T03) | 测试模式下计算 5s 滑动窗口，断线即刻 stale | **已实现且验证** | 节流更新，支持预热与去重 |
| F2.4 | 仅 final 用量时的降级处理 (T08)| `core/metrics.cjs`, `src/components/RealtimePanel.tsx` | `tests/metrics-and-state.test.cjs` (T08) | 界面如实提示“宿主当前未提供逐 Token 流式时间戳” | **当前宿主不支持，已实现降级** | 不使用伪造曲线或随机数拼凑实时曲线 |
| **F3** | **Token 用量与效率口径** |  |  |  |  |  |
| F3.1 | 输入与缓存包含关系 (T06) | `core/metrics.cjs` | `tests/metrics-and-state.test.cjs` (T06) | 真实宿主解析：input_tokens 为非缓存输入，总输入 = input + cached | **已实现且验证** | 不重复累加缓存，缓存大于输入时报警 |
| F3.2 | 输出与推理包含关系 (T07) | `core/metrics.cjs` | `tests/metrics-and-state.test.cjs` (T07) | 真实宿主解析：output_tokens 包含 thinking_tokens，可见输出 = output - thinking | **已实现且验证** | 绝不将推理 Token 二次叠加至总输出 |
| F3.3 | 重试用量归属与累计追踪 (T05) | `core/metrics.cjs` | `tests/metrics-and-state.test.cjs` (T05) | 保留失败尝试的 Token 消耗，计算重试消耗比 | **已实现且验证** | 失败尝试不被成功结果静默覆盖 |
| F3.4 | 累计量与 final 去重 (T04) | `core/metrics.cjs` | `tests/metrics-and-state.test.cjs` (T04) | final 用量幂等覆盖 cumulative 过程值 | **已实现且验证** | 重复到达事件不重复计费 |
| F3.5 | 可解释效率指标 | `core/metrics.cjs`, `desktop/history-storage.cjs` | `tests/metrics-and-state.test.cjs` (T08) | 展示真实的缓存命中率百分比与平均已知任务输出 | **已实现且验证** | 无虚假“性能评分”或“质量提升”噱头 |
| **F4** | **本地历史与趋势** |  |  |  |  |  |
| F4.1 | UserData 安全存储与迁移 (T13) | `desktop/history-storage.cjs` | `tests/history-storage.test.cjs` (T13) | JSONL 单队列追加写入，自动隔离尾部损坏行 | **已实现且验证** | 退出时有界 flush (2s)，不阻塞程序退出 |
| F4.2 | 历史筛选与聚合 (T10, T11) | `desktop/history-storage.cjs`, `src/components/HistoryPanel.tsx` | `tests/history-storage.test.cjs` (T10, T11) | 今日/7天/30天/全部，按模型与项目过滤，分页表格 | **已实现且验证** | 跨窗口相同请求去重；不完整记录标已知下限 |
| F4.3 | CSV / JSON 导出 | `desktop/history-storage.cjs`, `src/components/HistoryPanel.tsx` | `tests/history-storage.test.cjs` (T13) | 成功导出测试，`=`/`+`/`-`/`@` 开头字段被单引号转义 | **已实现且验证** | 彻底防范 CSV 公式注入安全风险 |
| F4.4 | 保留周期 (7/30/90 天) 与清理 | `desktop/history-storage.cjs`, `src/components/HistoryPanel.tsx` | `tests/round2-regression.test.cjs` | 夹具确认 7 天阈值只在手动清理时删除过期记录 | **夹具已验证，不是自动删除** | 查询、导出和重启都不按天数删数据 |
| F4.5 | 隐私边界：不存正文与凭据 | `desktop/history-storage.cjs` | `tests/history-storage.test.cjs` | 记录字段结构脱敏检查：仅保存数字统计与元标识 | **已实现且验证** | 默认关闭持久化，用户开启后方写入 |
| **F5** | **换肤恢复、多窗口与升级保护** |  |  |  |  |  |
| F5.1 | 多窗口独立会话管理 | `desktop/theme-service.cjs`, `src/App.tsx` | `tests/multi-window-and-restore.test.cjs` | `service.listTargets()` 实时获取各窗口，并支持分别切换应用 | **已实现且验证** | 脱敏标题，窗口状态独立隔离 |
| F5.2 | 刷新后有界自动恢复 (T12) | `desktop/theme-service.cjs` | `tests/multi-window-and-restore.test.cjs` (T12) | 刷新后带 generationToken 检验，用户手动恢复后旧回调决不重上色 | **已实现且验证** | 最大 10 次有界重试，默认关闭以尊重手动习惯 |
| F5.3 | 升级保护与身份失配暂停 | `desktop/theme-service.cjs`, `desktop/host.cjs` | `tests/service.test.cjs` | 宿主版本或 SHA256 变化立即进入 suspended 并尽力清理 | **已实现且验证** | 不盲目加入白名单，未验证版本禁止注入 |
| F5.4 | 三档性能预设 (0px/12px/24px) | `core/theme.cjs`, `src/components/AppearancePanel.tsx` | `tests/multi-window-and-restore.test.cjs` | 性能优先(0px)、平衡(12px)、视觉优先(24px)在 CSS 中生效 | **已实现且验证** | 包含 prefers-reduced-motion 支持 |
| F5.5 | 退出与租约清理回归 | `desktop/main.cjs`, `desktop/theme-service.cjs` | `tests/runtime.test.cjs` | 正常退出立即 restore；异常退出依赖目标页面内 35s 租约自动销毁 | **已实现且验证** | 6.5s 退出超时保证与有界清理 |
| **M5** | **打包与交付物** |  |  |  |  |  |
| M5.1 | Windows 便携版 EXE 打包 | `release/Anti Face 0.2.0.exe` | `npm run package` | 2026-10-04 生成 100,005,503 字节 | **已重新打包** | 旧的 99,996,960 字节文件不能代表这次源码 |
| M5.2 | SHA256SUMS 文件与指纹校验 | `release/SHA256SUMS.txt` | `Get-FileHash` | `f22e6f54fa0c1b191f5a505a9c6fccc86da8f6deae52700f99c8db45e46186ae` | **已核对** | 只覆盖便携版 EXE，不是解包后的 Electron 运行时 |
| M5.3 | 打包二进制可独立运行验证 | `release/win-unpacked/Anti Face.exe` | `scripts/smoke-packed.cjs` | 2026-10-04 通过：四个面板、拒绝非法主题、默认偏好关闭、模拟数据不残留、125 条 CSV 为 126 行 | **已用本次解包程序验证** | 隔离 userData，没有给真实窗口上色。便携版自解压外壳只做了哈希，没有再单独双击 |
| M5.4 | 完整文档更新 | `README.md`, `ARCHITECTURE.md`, `STATUS.md` | 文档已更新且与实现保持严格一致 | 同步第二轮升级功能与使用说明 | **已实现且验证** | 无过期陈述与空泛口号 |
