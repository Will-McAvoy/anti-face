# 当前完成情况 (v0.6.3)

更新时间：2026-10-12

## 0.6.3 整理发布

- 宿主身份缓存、端口缓存延长、遗留调试端口文件给出可读提示；精选壁纸重新生成；仓库与 CI 为上传 GitHub 整理。
- 275 项测试通过（低并发；默认并发在本机高负载时有一项 Chromium 超时，见报告）；最终解包程序冒烟通过。详见 [0.6.3 发布报告](V0.6.3-RELEASE-REPORT.md)。

## 0.6.2 扫描后直接修复

- 修复自动备份校验吞错、空索引误认领文件、轮换停止/新操作后迟到提交和临时资产引用泄漏。
- 摘要确认验证当前草稿、目标和操作代次，过期确认不会应用旧内容。
- 全量272项通过；真实Electron摘要/IPC检查通过。最终包和限制见 [修复与验收报告](V0.6.2-FIX-REPORT.md)。
- 默认win-unpacked被占用，本轮使用release/build-0.6.2-verified独立输出，保留旧EXE。
- 当前包：[Anti Face 0.6.2.exe](../release/Anti%20Face%200.6.2.exe)，127644560字节，SHA256 `aca630ddf2cb08d484f20aded55d1443f6a2323dd6439ef3e5aad02c5ec47ce2`；包内源码与前端核验通过。

## 0.6.1 历史交付（第七轮核心修正与真实闭环）

交付文档见 [修正报告](ROUND7-FIX-REPORT.md)、[测试报告](ROUND7-FIX-TEST-REPORT.md)、[验收报告](ROUND7-FIX-ACCEPTANCE.md) 与 [进度追踪](ROUND7-FIX-PROGRESS.md)。

- **R01 应用前变化摘要与确认令牌闭环**：统一入参形态（兼容单对象与位置参数），修复序列化异常；对齐 `groups` 与 `baseline` 单一契约，原生默认诚实回显；主进程建立 5 分钟 TTL 有限 preview 会话，实现原子消费的 `confirmApply` 令牌机制，杜绝二次重放与竞态串染。
- **R02 壁纸轮换进入有效外观链**：`Round5Service.contextFor` 透传 `wallpaperOverride` 与 `rotationActive`；`decorateApply` 对有效轮换图片执行图片分析并将 CSS `::before` 资产 URL 绑定至同一轮换资产，实现运行时生效而不污染持久化主题 JSON。
- **R03 轮换事务守卫与安全回滚**：`isCurrent()` 在各异步阶段阻断 `manualHold`、实例重建与一键恢复后的迟到写入（写入次数为 0）；原子提交资产租约，失败不提交假阳性占用；原生无主题窗口安全保护；`saveCurrentToTheme` 显式传递 `remember` 保存结果。
- **R04 自动备份托管索引与安全保留**：引入持久化 `managedBackups` 托管索引，非托管异常文件（如 2099 年异常文件）决不误删；保底保留至少 1 份经过有效性校验的最新备份；显式保护刚导出的备份不被即时淘汰。
- **R05 局部复制白名单与主进程 IPC 预检**：规范化导出受控复制白名单，提交前通过主进程 `copyThemeParts` 进行元数据与资源可用性检查；标签在全生命周期完整持久化。
- **全量自动化测试与真实端到端打包验证**：
  - `npm run check`：TypeScript 构建通过，260/260 项自动化测试 100% 通过（0 失败、0 跳过，耗时 11.6s）。
  - `npm run smoke:round7:fix`：Playwright 驱动真实 Dev Electron 冒烟测试全项通过。
  - `npm run smoke:round7:fix:packed`：Playwright 驱动打包产物 `release/win-unpacked/Anti Face.exe` (234.34 MB) 真实运行，版本号 0.6.1，IPC 与变更确认全链路通过。
  - 生产交付文件：[Anti Face 0.6.1.exe](../release/Anti%20Face%200.6.1.exe)，SHA256 `d6a4384695107390f607b58f46de80d4137b3d5930e01dcb9f7718aa2ec5319c`。

## 0.6.0 历史记录（第七轮核心能力初版）

交付文档见 [开发计划](ROUND7-PLAN.md)、[架构设计](ROUND7-ARCHITECTURE.md)、[测试报告](ROUND7-TEST-REPORT.md)、[验收报告](ROUND7-ACCEPTANCE.md) 与 [发布说明](ROUND7-RELEASE-NOTES.md)。

- **P2 级性能自适应修复 (Baseline Grok v0.5.2 Fix)**：解耦 `desiredTier` 与 `confirmedTier`，引入有限重试机制（最多 3 次），安全模式或一键恢复即时清空队列，彻底修复了首次 apply 失败后不再重试的同步遗留缺陷。
- **F01 主题标签与多维分类**：标签属于主题库持久化元数据，不影响 CSS 与外观 undo 栈；支持中英混合与 Unicode NFC 规范化；依据 WCAG 相对亮度自动推导深浅色分类；提供多选 AND/OR 组合筛选；500 主题压力测试下查询与计数一致；落盘、重启与导入导出备份完整保留。
- **F02 本地壁纸文件夹轮换**：支持本地文件夹有界扫描（<=3 层、<=2000 张）；拒绝选入 `userData` 内部；魔数验证（PNG/JPG/WEBP）；Shuffle Bag 跨周期无相邻重复与跨午夜防堆叠；运行时仅作为 `wallpaperOverride` 注入有效外观，绝不改写持久化主题 JSON；临时租约与 GC；安全模式/试穿自动挂起；支持“存入主题”显式固化为正式版本。
- **F03 应用前变化摘要与结果反馈**：首次换肤明确标识 `baselineKind: native`，旧值诚实标注“原生默认”，不伪造原生旧值；已换肤对比 `lastVerified` 基线；结构化呈现变更分组与运行期自动叠加层；诚实结果反馈，历史写盘失败明确暴露 `revisionSaved: false`。
- **F04 主题局部复制**：白名单组（colors, typography, wallpaper, regions.*）；严格保护目标 ID/名称；跨不同基底主题穿透解析实际视觉调色板；单步撤销事务保护（接入 `AppearanceHistory`）；相同内容返回 `changed: false`。
- **F05 自动备份与严格保留策略**：重大修改 120s 防抖、300s 最小间隔；数据指纹（SHA-256）去重；文件名格式严格匹配正则；保留清理算法仅识别自动备份，严格保底至少 1 份最新有效备份，绝不误删手工备份与用户文件；迁移与安全模式挂起保护。
- **交叉场景与真实渲染**：通过 5 组跨场景集成测试（轮换与局部复制协调、一键恢复阻断迟到轮换、迁移拦截自动备份脏读、标签自动备份包验证、局部复制与变更摘要联动）及 3 项真实 Chromium DOM 样式计算测试。
- **全量测试与打包**：
  - `npm run check`：255 项全量通过、0 失败、0 跳过（含 Round 7 专用 33 项用例与既有 218 项回归用例）。
  - `npm run smoke:round7`：5/5 项端到端冒烟验证通过。
  - 生产打包：`release/Anti Face 0.6.0.exe` 与 `release/win-unpacked/Anti Face.exe`。

## 0.5.1 历史记录（第六轮实用功能修正）

0.5.0 文末「184 项通过、smoke 7/7 即七项全部完成」已被 2026-10-08 复核否定。那一节保留为历史，不再代表当前状态。本轮说明见 [修正报告](ROUND6-FIX-REPORT.md)、[测试报告](ROUND6-FIX-TEST-REPORT.md) 和 [验收矩阵](ROUND6-FIX-ACCEPTANCE.md)。

- 备份检查不再把文件字节交给界面。恢复写入真实资产库，图片、缩略图和选中的偏好、绑定、历史在新目录重启后仍可读。冲突副本使用合法 UUID。包里即使把绑定标成启用，恢复后也会关掉并要求重新关联。
- 安全模式挡住编辑、个人库、试穿、快速切换和迟到写入。强制结束后再次启动会先进入安全屏障，并给出「保持安全模式」。
- 快速切换保存失败不再报已保存。快捷键可保存，默认关闭。
- 性能自动策略按电源变化限制模糊，不改已保存主题。当前没有可靠帧时间采样，界面不再写成会按掉帧自动调整。
- 屏幕变化会把主窗和迷你窗拉回可见工作区。撤销栈引用的壁纸在清理后仍可读，会话结束或栈淘汰后可以释放。
- 提醒规则接到真实发送路径。普通日志不能证明整任务完成，完成提醒次数保持为 0。
- `npm run check`：207 项通过、0 失败、0 跳过。Round 6 专用 56 项通过。最终包是 [Anti Face 0.5.1.exe](../release/Anti%20Face%200.5.1.exe)，101,681,640 字节，SHA256 `a71af3fc2a78118ae18643e023797b8937e070ab8b47369dee6e01e752ef6365`。0.1.0 到 0.5.0 的 EXE 哈希未变。
- 已启动 `release/win-unpacked/Anti Face.exe` 做备份、安全模式、性能保存和强制退出后的启动选择。强退证据是 2026-10-10T14:07 的严格补跑，不是 13:32 那次锁等待放宽后的退出码 0。便携外壳没有双击。真实 Antigravity、物理双屏、真实电池和系统通知是否送达都没有验证。

## 0.5.0 历史记录（第六轮初版，2026-10-08 复核已取代「7/7 即全部完成」）

- **F01 一键恢复与安全启动**：恢复屏障立即失效在途操作，结构化状态报告（不谎报全量成功）；SafeLaunchManager 崩溃计数检测与 CLI --safe-mode 强制安全模式，不删除任何用户数据。
- **F02 编辑撤销/重做完善与基线**：revertToBaseline 丢弃修改重置到基线且入栈可再次 Undo 找回；滑块/焦点拖拽手势聚合；500ms 键盘微调合并；nextUndoLabel/nextRedoLabel 动作意图标签；referencedAssetIds() 保护历史与基线引用的壁纸图片。
- **F03 主题快速切换器**：轻量独立快速切换窗口 (desktop/switcher.html)；SWITCHER_CHANNELS 严格受限的 IPC 权限隔离；内存搜索防注入；单目标换肤与其他窗口严格隔离；manualHold 冲突保护。
- **F04 多显示器与 DPI 适配**：DIP / Physical / CSS / CDP Screenshot 4 套坐标模型换算；副屏负坐标系完全支持；智能 clampBoundsToWorkAreas 保证标题栏可见且离线屏幕安全救援；computeDisplayContextHash 视口指纹跟踪。
- **F05 完整备份与迁移**：Node 24 原生 node:zlib 零依赖 PKZip 读写；isSafeRelativePath 阻断路径穿越；单文件 64MB / 解压 512MB 限制；阶段 A（只读审查/图片解码）-> 阶段 B（冲突预览）-> 阶段 C（原子提交与失败自动回滚，支持 keep-both 与 overwrite）。
- **F06 性能自适应**：纯函数状态机 (evaluatePerformanceState) 迟滞与 10s 冷却；电池感知自动切入 powersave；resolveEffectiveAppearance 运行时截断模糊上限（轻量 12px，省电 8px）；底层持久化主题文档 JSON 零污染。
- **F07 任务完成提醒规则与真实性约束**：来源能力声明规范；未声明整任务完成能力的普通日志源严格拒绝触发（source-unsupported-completed，保留原日志源诚实性约束）；跨午夜免打扰静音；暂停 30 分钟；前台聚焦桌面静默仅保留声音；独立测试通道不污染去重缓存。
- **自动化测试结果**：
  - npm run check：184/184 项通过、0 失败、0 跳过。
  - npm run test:round6：33/33 项 Round 6 专用用例全部通过。
  - npm run test:grok-second：16/16 项全部通过。
  - node --test tests/v043-regression.test.cjs：4/4 项全部通过。
  - node scripts/smoke-round6.cjs：7/7 项冒烟全部通过，记录于 artifacts/round6/results.json。
- **当前交付包**：[Anti Face 0.5.0.exe](../release/Anti%20Face%200.5.0.exe)，101,670,768 字节；SHA256 2CF9EE56616EBAF5B367FB74C78A3E5490BE87D8317C7EB0D7B2A58A496B17BE。原 9 个历史 EXE（0.1.0 ~ 0.4.3）完整保留且哈希一致。
- **交付文档**：[第六轮架构设计](ROUND6-ARCHITECTURE.md)、[测试报告](ROUND6-TEST-REPORT.md)、[验收矩阵](ROUND6-ACCEPTANCE.md)、[发布说明](ROUND6-RELEASE-NOTES.md)。
- **真实性说明**：未接入真实 Antigravity 时，宿主数据源诚实标注降级状态；真实宿主整任务完成待具备终态事件判定的专有适配器验证。

## 0.4.3 已交付 (历史记录)


- F01：正确行距通过真实 Chromium 测量，18px × 1.5 = 27px；错误行距仍失败。
- F02：恢复、新操作和目标重建使旧意图失效；按钮链中迟到任务不再注入 CSS 或倒退状态。
- F03：历史完整事务串行化；并发成功记录重启后保留，同 operationId 去重，删除/淘汰不复活，旧模糊数据保留恢复候选。
- npm run check：151 通过、0 失败、0 跳过；专用 4 项和 grok-second 16 项通过，相关桌面 smoke、E01–E12、round4、打包及最终包 smoke 均退出 0。
- 当前包：[Anti Face 0.4.3.exe](../release/Anti%20Face%200.4.3.exe)，101,648,666 字节；SHA256 `bacd2dfb3f11b6f9069e9e53babad3c60066c7058228910af7ede18696458cd5`。
- 最终包 118 个源码/资源文件与磁盘一致；原 8 个 EXE 保留且哈希未变。本轮未改业务代码或依赖。
- 真实 Antigravity 未验证；外壳未启动，已验证最终 win-unpacked 程序。
- [修复报告](V0.4.3-FIX-REPORT.md)、[测试报告](V0.4.3-TEST-REPORT.md)、[实际结果](../artifacts/v043-release/results.json)。

## 第二轮修正（历史记录 v0.4.2）

2026-10-07 的独立复核否定了下方 v0.4.1「131 项与 E01–E12 即全部完成」的结论。那些段落保留为历史，不再代表当前状态。本轮说明见 `docs/GROK-SECOND-FIX-ACCEPTANCE.md`、`docs/GROK-SECOND-FIX-TEST-REPORT.md` 和 `artifacts/grok-second-fix/results.json`。

- 样式核对与 CSS 生成共用 `core/style-contract.cjs`。区域背景比的是混进 panel 的颜色，不是元素 opacity。正确 CSS 在真实 Chromium 里通过，故意改错的 alpha 失败。
- 每个窗口有自己的 `instanceId` 和 `activeDocument`。没有自己的主题时，不再套用全局草稿。同 ID 重连后，旧任务写入 0 次。
- 历史写失败会返回 `revisionSaved: false`，界面可以重试。`revisions:retry` 在主窗口允许列表里。索引写到一半失败时，新进程能收成一条记录。
- 图片分析按内容哈希缓存，上限 16 MiB、16 条。合法 data URL 可以独立分析。`pixelCache` 保持为空，生成不往里填。
- 编辑预览的首页/对话在预览阶段 idle 时仍然各用各的场景。截图：没拍完就离开会作废；已经拍完的一组留着，以便回来拍应用后。点清除、断开，或在对比页换窗口，会删掉对应图。
- 本轮命令全部退出码 0：`npm run check` 147 项通过、0 失败、0 跳过。模拟宿主 E01–E12 通过。这不是真实 Antigravity 窗口。
- 便携包：`release/Anti Face 0.4.2.exe`，101,642,031 字节，SHA256 `62c7c258f5038edbf3254db85f8addf312e68185e96ef74e3797bddecd5ebb7c`。`release/Anti Face 0.4.1.exe` 仍在，101,637,220 字节。便携外壳没有双击。Playwright 启动的是 `release/win-unpacked/Anti Face.exe`。
- 真实 Antigravity 窗口：未验证。

## 第五轮功能修正（历史记录 v0.4.1，已被 2026-10-07 复核与 v0.4.2 取代）

- 完整修复 ROUND5-COMPLETION-REVIEW-2026-10-06 中指出的全部 6 个核心缺陷 (R01–R06)，补齐 8 大贯通点 (G01–G08)，新增 10 条集成测试链 (X01–X10)。
- **R01 阅读保护图像解耦**：提取 `ImageAnalysisService`，阅读保护不依赖配色生成，独立从 asset 读取并分析图像，拥有 16 条目 / 64MB LRU 缓存与并发合并。
- **R02 异步场景状态守卫**：`onAutoScene` 和 `_applyCss` 引入严格的代次与 `manualHold` 防护，旧异步结果废弃不注入。
- **R03 目标窗口状态隔离**：每个目标窗口维护独立的 `activeDocument`，窗口间主题互不串染。
- **R04 截图生命周期与内存**：切窗或清除时目标代次递增使在途截图失效；替换 `after` 截图精确扣减旧图字节。
- **R05 版本落盘事务一致性**：恢复与保存遇到历史记录磁盘错误时，返回结构化 `SaveResult` 明确失败原因，杜绝假阳性成功提示。
- **R06 配色 Worker Settle-Once**：集中管理超时与退出，Promise 必然结束，彻底清理 Worker 资源。
- **G01–G08 管道贯通**：预览支持场景切换与调整徽标、阅读保护面板支持 1.5–21 对比度调节与字段锁、深度核对支持壁纸/模糊/文字并返回 partial 明细、真实对比支持键盘调节与隐私遮挡、配色生成支持角色锁定与局部采用、项目绑定支持 3 类身份与降级回退、版本支持任意双版本 diff 与区域级局部恢复。
- **自动化测试结果**：
  - `npm run check`：131/131 单元测试全部通过，TypeScript 与 Vite 构建零错误。
  - `npm run test:round5`：26/26 测试通过。
  - `npm run test:round5:fix`：16/16 修复与集成链测试通过。
  - `npm run test:desktop`、`test:desktop:round3`、`test:desktop:round4`、`test:desktop:round5` 全部通过。
  - `npm run test:desktop:round5:e2e`：Playwright 真实按钮链路 E01–E12 全部通过退出码 0。
- **打包产物**：`release/Anti Face 0.4.1.exe`，101,637,220 字节，SHA256 `fa58b432c4ba483d78a50bf7bffd184fd846f2e69164e9fe740c9515aa376895`。
- **真实环境说明**：当前所有自动化测试（Chromium 渲染与 CDP 模拟宿主）全部通过；真实 Antigravity 商业版环境待连接真实窗口进一步目视验证。
- 详细证据详见：`ROUND5-FIX-ACCEPTANCE.md`、`ROUND5-FIX-TEST-REPORT.md`、`ROUND5-FIX-RELEASE-NOTES.md` 及 `artifacts/round5-fix-results.json`。

## 第五轮初版（历史基线 v0.4.0）

- 阅读保护、应用核对与恢复、诊断、首页/聊天场景、壁纸构图、真实窗口对比、本机整套配色、项目或窗口绑定、主题版本、20 套离线精选。
- 远程主题源未配置。界面写明“内置精选”和“远程源未配置”。没有账号、社区、支付、云端生成、视频壁纸或插件系统。
- 主题文档 schema 2。个人库、偏好和旧 settings 仍是 schema 1。旧主题迁移后颜色和焦点不变。
- 没有在真实 Antigravity 窗口上完成本轮换肤或截图。这些项是“已实现且自动化通过，真实环境待验证”，不是全部完成。模拟宿主上的按钮链路不能把状态改成 1。
- 便携包：`release/Anti Face 0.4.0.exe`，101,629,009 字节，SHA256 `bfe1518ba917aa60838ee28a0b593f3a2ee7d67261bcf24d6874e83029da30ec`。只刷新了这一行；0.1.0 到 0.3.1 的 EXE 没有覆盖。
- `node scripts/smoke-round5-e2e.cjs` 在模拟宿主上通过 E01–E12，退出码 0，用时 281.84 秒。`node scripts/smoke-packed.cjs` 对当前 win-unpacked 退出码 0，用时 130.95 秒。收尾重跑 `npm test`，115 项通过，约 19 秒。便携外壳没有单独双击。打包核对见 `artifacts/round5-package-verification.json`。
- 验收和命令见 `ROUND5-ACCEPTANCE.md`、`ROUND5-TEST-REPORT.md`、`ROUND5-RELEASE-NOTES.md`。

## 第四轮功能修正（历史基线 v0.3.1）

- 完整修复 ROUND4-REVIEW 中指出的全部 7 个功能缺陷 (R01–R07)。
- P1 试穿事务完整性：apply 失败时不落盘 baseline；取消试穿时正确回填 document；关闭时检查会话与保存/取消状态。
- P1 自动化代次安全：generation 栅栏杜绝慢探测覆盖手动与最新决策；换肤显式触发 `noteManual`。
- P1 个人库与外观模式冻结保护：写时复制防止脏内存污染；未来 schema 只读保护原文件。
- P1 声音解包与播放可靠性：`package.json` 显式解包 `assets/sounds/**/*` 到 `app.asar.unpacked`，支持外部 PowerShell MediaPlayer 稳定访问。
- P2 预览共享模型与构图：统一 CSS 规范；支持可视化拖动十字准星构图 (`FocalPointPicker`)；删除壁纸同时置空 `assetId` 与 `legacyDataUrl`。
- P2 个人库分页与重排：支持分页控件、每页 12 项；按 ID 独立获取应用主题；收藏重排始终传递全量集合。
- P2 托盘/定时主界面同步：暴露 `onStudioChanged`；无编辑自动同步，有草稿弹出冲突处理模态对话框。
- P2 迷你窗口：支持拖动持久化、分辨率变化夹取与严格 smoke 测试等待。
- 便携包：`release/Anti Face 0.3.1.exe`，101,579,695 字节，SHA256 `1AAC4F5AEDF97A49C2AED9E775016D9B4B8DD4B557BDED8058B80A79DCA3071E`。
- 自动化测试：`node --test tests/*.test.cjs` 89 项全部通过；`npm run test:desktop`、`npm run test:desktop:round3`、`npm run test:desktop:round4`、`node scripts/smoke-packed.cjs` 全部通过退出码 0。
- 验收文档详见 `ROUND4-FIX-ACCEPTANCE.md` 与 `ROUND4-FIX-TEST-REPORT.md`。

## 第四轮（历史基线 v0.3.0）

- 分区域外观、壁纸背景层、个人主题库、自动切换、托盘/快捷键/迷你窗和提醒服务已接到桌面版。
- 实时试穿、自动切换、通知、快捷键和关闭到托盘默认关闭。
- 完成提醒不会自动触发。当前日志不能把单个规划步骤结束当成整个任务完成。
- 旧 `settings.json` 仍是 schema 1。更高版本会停止写入并保留原文件。
- 验收和命令证据见 `ROUND4-ACCEPTANCE.md`、`ROUND4-TEST-REPORT.md`。
- 本轮没有向真实 Antigravity 注入新主题。区域选择器还没有在当前宿主 DOM 上逐个目视。
- 便携包：`release/Anti Face 0.3.0.exe`，101,579,517 字节，SHA256 `e5d1fd8142f3afcabbba2d4277e9ed519c488cfa6eef0e4367b2a4deb00f954d`。
- 真实窗口还点过：提取强调色并采用一个色块；试穿未保存时的继续编辑、取消并隐藏、保存并隐藏。Windows 应用深浅色切换后界面跟着变，注册表已改回原值。
- 在 Antigravity 2.19.1.0 当前窗口核对：侧栏透明度变量 60%，输入框圆角 6px 且不透明度仍为 88%，标题栏和 body 没有 filter，壁纸层为 blur(8px) 且不接收鼠标。检查后已恢复，只留下一份样式节点。
- `node --test tests/*.test.cjs` 为 79 项通过。`npm run test:desktop`、`node scripts/smoke-round4.cjs`、`node scripts/smoke-packed.cjs` 退出码都是 0。便携外壳曾启动并随后结束。

## 第三轮修正（v0.2.1 基线）

## 第三轮修正（历史记录）

- 多窗口选择现在会检查对应目标；重新检测使用当前选择，异步旧结果不会覆盖新选择。
- 发现端点断开时立即清除旧连接状态；无主题会话同样生效，重连需要重新验证。
- 历史重写只通过同目录临时文件、同步落盘和 rename 替换；失败保留旧文件，不再复制覆盖。
- 延迟按每轮日志计算，界面明确标为“首个规划响应间隔”，不宣称首 Token 延迟。
- 统计字段缺失、无会话、缓存损坏时不保留旧派生值；任务与统计独立标记新鲜度，30 秒无新证据标为过期。
- 历史 schema v2 区分 occurredAt 和 observedAt；未知时间不计入今日，不按保留天数删除；重试未知显示未知。旧 transcript 记录的无法证明字段读取时降级，不直接改原文件。
- 重启后已归档的 v2 轮次不重复追加。测试用户目录的日志来源也隔离，避免真实日志干扰合成历史。
- 第三轮验收说明见 `ROUND3-FIX-2026-10-04.md`。下方第二轮记录仅为历史基线。

## 0.2.1 交付与验收

- `npm run check`：46/46 测试通过，构建与类型检查通过。
- `npm run test:desktop`、`npm run test:desktop:round3`、`node scripts/smoke-packed.cjs` 均退出 0。
- 上一轮 9 项和第三轮 8 类场景全部通过正确性回归；详见第三轮交付报告。
- 历史便携版：`release/Anti Face 0.2.1.exe`，125,131,100 字节。
- SHA256：`a65dfc7a21c068865d7eb0f4042ebb591cc13e1b14114796f84033388d2d7bc4`。
- 打包命令：完成 build 后，以 `ELECTRON_BUILDER_COMPRESSION_LEVEL=3` 执行 `node scripts/package.mjs`；仅改变压缩级别。
- `app.asar` 中五个修改后的 desktop 文件、前端 HTML/JS/CSS 已与当前磁盘源码逐字节比对；package 的 name/version/main 一致，版本为 0.2.1。
- 已启动 `release/win-unpacked/Anti Face.exe` 验证四个面板、IPC 拒绝、默认偏好、模拟数据隔离和 125 条历史导出。便携外壳本身未再次双击自解压。
- 包核验结果：`artifacts/round3-package-verification.json`。本轮未向真实宿主注入主题。

## 第二轮升级完成功能

1. **基线与工程健康 (P0)**：
   - 彻底梳理并安全隔离 16 个 OneDrive 冲突文件至 `.backups/conflict-archive-2026-10-03/`。
   - 修复全局 TypeScript TS2717 命名空间冲突，全新构建零阻断。
   - 原有 14 项单元测试完全回归通过。

2. **实时任务状态 (F1)**：
   - 支持宿主窗口目标选择。遥测窗口走单独 IPC，不依赖该窗口是否已经换肤。
   - 9 种清晰状态（idle, queued, running, generating, tool_running, waiting_user, completed, failed, cancelled, unknown）。
   - 终态单向递进状态机，有效防御乱序与较旧事件倒退。
   - 单调时钟精准计算“已观测 xx 秒”，中途接入不伪造总时长。
   - 断线标记 stale 并保留最后更新时间。
   - 模拟数据与真实来源在界面上分开标识。没有日志时是未知和空值，不保留模拟的 2200。

3. **Token 速度与输出延迟 (F2)**：
   - 日志响应间隔：每轮输入日志到首个规划响应日志的间隔（毫秒），数据不齐时显示“—”；不是首 Token 时间。
   - 区间平均输出速率：基于有效输出区间计算新增 Token 速率 (tok/s)。
   - 5 秒滚动窗口计算器：基于单调时钟与事件去重，支持预热与断线 stale 降级。
   - 诚实降级：当前宿主未暴露逐 Token 流式时间戳时，禁用伪实时曲线，如实提示说明。

4. **Token 用量与效率统计 (F3)**：
   - 包含关系处理：非缓存输入 + 缓存输入计算总输入，缓存率 = cached / (input + cached)。
   - 推理处理：输出 Token 明确包含思考 Token，可见输出 = output - thinking，合计输出不重复叠加。
   - 重试：计算器支持已知尝试数据；当前 transcript 源不提供可靠尝试身份，真实历史的 attempts 为未知，不以规划步骤数推断。
   - 最终值去重：final 记录幂等覆盖，重复事件不叠加。

5. **本地历史与趋势 (F4)**：
   - 安全存储：独立于源码与 OneDrive，存放于 Electron `userData/history/` 目录下。
   - 健壮性：JSONL 单写入队列、原子写入、尾部损坏行自动隔离并记录诊断，不清空原有效数据。
   - 多维筛选：按今日/7天/30天/全部、模型、项目过滤，支持分页浏览。
   - 导出与防注入：支持导出 CSV 和 JSON，CSV 自动对 `=`、`+`、`-`、`@` 开头字段转义防范公式注入。
   - 保留策略与清理：7/30/90 天只作为手动清理阈值，不会自动删除。导出不受界面每页 100 条上限影响。清理和追加共用串行写入通道。
   - 隐私保护：默认关闭持久化采集，仅在用户开启后保存脱敏指标，绝不保存聊天正文、代码或密钥。

6. **换肤恢复与兼容性增强 (F5)**：
   - 多窗口管理：每个窗口单独保存连接和会话。标题只截断到 50 个字符，不是匿名化。可以分别应用、恢复当前窗口，或恢复全部。
   - 刷新后自动恢复：可配置开关（默认关闭），带 generationToken 竞态防护，用户手动点击恢复后旧回调绝不反向重上色。
   - 升级保护：版本或 app.asar 哈希失配时立即置为 suspended 并停止注入。
   - 三档性能预设：性能优先 (0px 模糊 / 90% 不透明度 / 8px 圆角)、平衡 (12px / 75% / 16px)、视觉优先 (24px / 64% / 24px)，并在 CSS 与预览中实际生效。

## 第二轮历史验证结果（2026-10-04）

- **代码**：六项修正已落在当时源码。证据见 `tests/round2-regression.test.cjs` 与 `scripts/review-round2.cjs`。
- **构建与单元测试**：`npm run check` 通过。`node --test tests/*.test.cjs` 为 41 项，0 失败。原有断言没有为了凑通过而放宽。
- **夹具**：125 条导出 JSON/CSV 都是 125；10000 条导出 10000；清理期间追加的 `new-during-cleanup` 仍在，总数 126。两个 mock 客户端分别写入 A 和 B。心跳返回前的手动恢复之后注入次数为 0。fixture 切到 host 后 `totalTokens` 为 null、`provenance` 为 real。
- **桌面进程**：`npm run test:desktop` 通过。覆盖主题保存、实时窗口选择或空态、模拟数据来回切换、历史开关、7/90 天阈值、3 条记录 CSV 导出、主题导出不带历史偏好、关闭进程再打开，以及旧配置迁移。无 preload 的页面会说明需要桌面版，而不是一直转圈。
- **真实宿主换肤**：`npm run verify:host` 在 Antigravity 2.19.1.0 上应用 15 套主题后恢复了原外观。只覆盖当前主窗口。没有在真实宿主上制造刷新竞态，也没有把界面 Token 和某次真实请求逐项对上。
- **真实宿主遥测**：桌面冒烟连上了一个已验证窗口。当时界面是“状态未知”，并写明没有可核对的 Token，模拟模型名没有留下来。这不能当成 Token 语义已验证。
- **本次打包程序**：`node scripts/smoke-packed.cjs` 通过。四个面板、非法主题被拒绝、历史和自动恢复默认关闭、模拟模型名切回后消失、125 条历史导出为 126 行 CSV。启动的是 `release/win-unpacked/Anti Face.exe`。便携版外壳只核对了哈希，没有再双击自解压。
- **未再运行**：`npm run test:desktop:host` 这次没有跑，不能沿用旧结论。

## 第二轮旧发布产物（0.2.0，不含第三轮修正）

2026-10-04 从当时源码重新打包：
- **可执行文件**：`release/Anti Face 0.2.0.exe` (100,005,503 字节)
- **校验哈希 (SHA256)**：`f22e6f54fa0c1b191f5a505a9c6fccc86da8f6deae52700f99c8db45e46186ae`
- **校验文件**：`release/SHA256SUMS.txt`
- 解包目录里的 `resources/app.asar` 含本次前端包 `index-BSo4ptAV.js` 和历史/遥测修正源码。旧哈希 `0e02e2de…` 作废。
