# Gemini 执行完成情况复核

日期：2026-10-07（Asia/Taipei）。项目：Anti Face，当前源码和包版本 0.4.1。
对照要求：`FIFTH_ROUND_GROK_FIX_PROMPT.md`。

## 结论

有实际代码交付，构建、131 项现有测试、第五轮桌面 smoke 和包一致性核对通过。但不能验收为“6 个缺陷全部修复、8 项全部补齐”。新增样式核对存在会误判正确主题的回归；原有异步、保存、阅读保护和窗口隔离问题仍有遗漏。

本次没有修改业务实现，没有对真实 Antigravity 窗口换肤或截图。只新增独立复现脚本、结果和本报告；构建刷新 dist，原包校验脚本刷新其结果文件。本目录没有 Git 元数据，因此本次依据当前文件和前轮报告复核，不宣称取得 Gemini 的精确提交差异。

## 本次运行证据

| 检查 | 实际结果 | 证据 |
|---|---|---|
| `npm run check` | 构建、类型检查通过；131/131 测试通过 | `artifacts/review-gemini-check-2026-10-07.log` |
| `npm run test:desktop:round5` | 通过；原精选安装文件等待问题在本次运行未出现 | `artifacts/review-gemini-desktop-2026-10-07.log` |
| `node scripts/verify-round5-package.cjs` | 通过；59 个 desktop/core 源文件、前端资源、20 套精选及解包资源匹配 | `artifacts/review-gemini-package-2026-10-07.log` |
| `node scripts/review-gemini-2026-10-07.cjs` | 正常执行并记录下列缺陷；退出 0 表示复现脚本运行完成，**不表示功能验收通过** | `artifacts/review-gemini-2026-10-07.json` |
| `npm run test:desktop:round5:e2e` | 通过；E01–E12 模拟宿主按钮链，不能代表真实宿主样式验证 | `artifacts/review-gemini-e2e-2026-10-07.log` |

包：`release/Anti Face 0.4.1.exe`，101637220 字节，SHA256 `fa58b432c4ba483d78a50bf7bffd184fd846f2e69164e9fe740c9515aa376895`。本次未启动便携外壳、未重打包、未重跑旧轮桌面测试或 packed smoke。

## 已复现问题，按优先级排序

### P1-01：正确的半透明背景被判成验证失败

- 位置：`core/apply-verification.cjs` 的 `buildVerificationPlan` 区域 opacity 检查，与 `core/theme-css.cjs` 的 `regionBlock`。
- 主题 CSS 通过 `background: color-mix(..., transparent)` 控制背景 alpha；核对器却检查元素 `opacity`，把背景 alpha 0.6 与元素 opacity 1 比较。
- 实际 Chromium 运行相同项目 CSS：侧栏背景读到 `color(srgb 0.152941 0.172549 0.160784 / 0.6)`，元素 opacity 为 `1`，四个区域全部被判 failed，整体 `VERIFY_FAILED`。其他 owned-style、body-color、body-filter、输入框可达和圆角均通过。
- 后果：正确主题可能被拒绝或进入 `ThemeService` 的失败回滚分支。不是“宿主兼容性待验证”即可解释的问题。
- 同模块还有：字体字号写到聊天容器却核对 body；壁纸只检查 URL 字符串，不检查解码；模糊只检查含有 blur，不核对数值。
- 修复方向：核对生成 CSS 的真实作用属性和作用元素；支持浏览器实际返回的颜色格式，区分背景 alpha 与元素 opacity；增加真实 DOM 与生成 CSS 的验证回归。

### P1-02：目标隔离与生命周期没有闭合

- 位置：`desktop/round5-service.cjs:getTargetState/dropTarget/onAutoScene`。
- `onAutoScene` 仍允许当前选中但没有 activeDocument 的窗口回退到 `studio.document`。复现：原生窗口 A 无独立主题文档，场景回调仍向 A 应用全局草稿，写入 1 次。
- `targetEpoch` 每次创建固定为 1；generation 也从 1 重新开始。复现：旧场景等待分析，执行 dropTarget 后重建同 ID 目标，再释放旧结果，旧任务仍通过守卫并写入 1 次。
- 全项目搜索显示 `dropTarget` 只有定义和测试调用，业务目标断开链路没有调用它；`ThemeService._dropEntry` 只删除自己的 targets。
- 另一独立复现：先 rememberProject(workspaceId=old-workspace)，再提交 unknown 身份，返回 reliable=false，但 target 映射仍保留 workspace:old-workspace。身份变为 unknown 时未失效旧关联。
- 修复方向：不可复用的实例标识/单调 epoch，断开与重连明确通知 Round5Service；禁止无独立主题目标继承全局草稿；所有应用路径更新目标状态。

### P1-03：保存历史失败仍可被应用入口吞掉

- 位置：`desktop/studio-service.cjs:commitPreview/applyEditorDocument`，`desktop/round5-service.cjs:catalogInstall`。
- `restoreRevision` 已能返回 documentSaved=true、revisionSaved=false，这是实际改进；但其他入口仍 await remember 后忽略其 `{ok:false}`。
- 复现：`applyEditorDocument` 内历史写入返回 SAVE_FAILED，外层仍返回 `{state:'applied', verification:{status:'verified'}}`，没有历史失败字段。
- 当前 X05 使用模拟 saveDocument 和 remember，只在同一 service 上重试，没有真实重启、文件失败事务或幂等性验证。
- 修复方向：所有保存/应用/精选入口传播部分失败；明确事务与重试协议，并测试实际文件系统故障和重启后的文档/历史一致性。

### P2-04：旧格式壁纸阅读保护仍报缺少图片

- 位置：`desktop/image-analysis-service.cjs:prepare/analysisFor`、`desktop/round5-service.cjs:prepareImageAnalysis`。
- 复现：合法 PNG legacyDataUrl 解码成功，但 analysisFor 只处理 assetId 路径，返回 null。explain 的测量结果仍是 unknown / missing-image。
- 此外 prepareImageAnalysis 把每张图样本放入不受 LRU 限制的 `pixelCache`，即使 ImageAnalysisService 淘汰，像素仍被此 Map 持有。不能据单独服务的限额宣称总缓存有界。
- 普通资产图片独立分析已有正向测试并通过；R01 是部分修复。

### P2-05：预览场景切换未进入有效计算

- 位置：`desktop/round5-service.cjs:contextFor`、`core/effective-appearance.cjs:chooseScene`、`src/App.tsx`。
- App 传 contextKind=preview 和 previewScene，但 contextFor 的 previewing 只取实际试穿事务是否活跃；普通编辑预览处于 idle 时不会采用 previewScene。
- 复现：自动场景文档分别请求 home/chat 预览，两次均返回 `{scene:null,source:'unknown'}`，effectiveHash 完全一致。
- 预览已接入 effectiveVisual 是实际改进，但场景开关目前不能据此验收。
- 宿主 viewport 也没有自动测量并写入 viewports 的完整路径；调用 explain 不带 viewport 时，不能据预览 ResizeObserver 宣称使用了真实宿主尺寸。采用建议仍不绑定报告 hash/场景快照。

### P2-06：截图全量清除和比较上下文仍有缺陷

- 位置：`desktop/capture-service.cjs:clear/take`。
- clear(targetId) 的迟到结果和 after 替换计数已有修复；但 clear() 只遍历 targetGenerations 已登记键，take 并不登记初始键。
- 复现：首次 A 截图 pending 时 clear()，释放截图后仍返回 ok=true，缓存又有 1 组。
- 另一复现：同组、同 viewport，before clip=(0,0,100,100)，after clip=(200,200,100,100)，仍 comparable=true。没有核对 clip、DPR、导航等上下文。

## 代码审查确认的交互和功能缺口

以下为代码路径审查结果，未全部做 Electron 手动交互复现，不能与上方独立执行证据混淆。

1. **截图忙碌状态可能卡死**：HostComparePanel 切 target 时 requestToken 递增，但不清 busy；旧 finally 因 token 不符也不清 busy，拍摄按钮仍 disabled。ThemeGeneratorPanel 换图时同样清 active 而不清 busy，旧请求 finally 不再恢复按钮。
2. **截图“离开即销毁”的文案不成立**：HostComparePanel 卸载及切目标只清本地 state/token，未调用后端 clearCaptures；StudioService.selectTarget 也未清截图。后端缓存仍保留。
3. **所谓局部隐私遮挡实际整屏覆盖**：Round5Service 的 MASK_ON 仍是 fixed inset:0、实色背景的全屏 div，界面却写“局部隐私遮挡”。
4. **区域截图使用固定像素坐标**：聊天固定 x260/y40/w800/h600，输入框固定 x260/y560/w800/h120；没有测量实际目标 DOM，小窗会越界，大窗可能截错位置。
5. **对比滑块布局不对齐**：before 图 fit 宽度设为裁剪层的 100%，裁剪层自身宽度又是 sliderPos%，会缩小 before 图而非保持两张图同尺寸后裁切；100% 模式的 after 仍是容器 width100%。
6. **多区域阅读保护只增加了报告**：有效模型仍只对 chat 调用 protect 并应用修正；evaluateAllRegions 只是测量各区域，不能证明其他区域有保护修正，报告也在 auto 修正前生成。没有完整联合约束与各文字角色验收。
7. **项目重启提示过度承诺**：识别映射 identified 从空 Map 启动，手动绑定持久化并不等于重启后自动把窗口关联到该项目；UI 仍写“保存绑定后重启 Anti Face 仍将生效”。需明确重新关联流程。
8. **版本历史是部分补齐**：任意两版 diff、字段值、分组恢复及错误处理已有代码；缩略预览和完整事务保障仍不足。
9. **版本锁文件未同步**：package.json=0.4.1，package-lock.json 顶层及根 package 仍为 0.4.0。锁文件根依赖范围也与 package.json 存在不一致。

## 为什么 131 项测试通过仍不能验收

- 新增 16 项测试中，R01–R06 有针对旧缺陷的正向断言，是有价值的修复证据。
- X01–X10 大部分是原型对象、模拟 service 或纯函数测试，不是文档宣称的 10 条真实 UI 集成链。例如 X04 只测 CaptureService，没有挂载 UI；X05 没有真正重启。
- E2E 的模拟宿主 `tests/fixtures/desktop-round5-host.cjs` 对 opacity 返回 `item.expected || '0.8'`，对字号返回 `item.expected || '14px'`，对模糊固定返回 blur(5px)。这些不是真实浏览器 computedStyle，不能揭示属性选错或值不匹配。
- 现有 Chromium 测试验证颜色、像素和输入框可达，没有把新增完整 verification plan 跑在生成 CSS 上。本次独立脚本补上这个观察后立即复现失败。
- 本轮报告应把“测试执行成功”“模拟宿主通过”和“真实 CSS/真实宿主验证”分开描述。

## 对照修正提示词的完成度

| 项目 | 本次判定 |
|---|---|
| R01 独立图片分析 | 部分修复；普通 asset 路径通过，legacy 与缓存限制未闭合 |
| R02 异步场景守卫 | 手动 hold 的原用例通过；目标重建代次仍可失效 |
| R03 窗口文档隔离 | 部分修复；增加 activeDocument，但全局回退和断开清理仍有缺口 |
| R04 截图生命周期 | 指定目标清除和计数修复；全量清除、切窗/卸载和比较上下文未闭合 |
| R05 历史保存结果 | restoreRevision 改善；其他入口仍吞失败，事务验收不足 |
| R06 Worker 超时 | 新 timeout/exit/abort 收敛代码及现有回归通过；并发上限/50 次取消等要求未完整证明 |
| G01 共享有效预览 | 已接入快照，场景切换未完成 |
| G02 分区域阅读保护 | UI/测量增加，联合保护和建议快照仍不完整 |
| G03 深度样式核对 | 有新增检查，但存在 P1 错误，不能通过 |
| G04 真实对比交互 | 新增控件，但布局、坐标、遮挡及生命周期仍有问题 |
| G05 配色锁与局部采用 | 已实现主要控件；换图忙碌状态及完整覆盖仍不足 |
| G06 项目身份 | 标签和降级提示改善；重启关联与失效链未闭合 |
| G07 历史操作 | 多版 diff、分组恢复有实现；缩略预览和事务仍待补齐 |
| G08 测试及交付 | 本次 smoke 通过；测试深度及“全部完成”文档结论仍需修正 |

不据文件数、按钮数或测试数给出无依据的完成百分比。建议先修 P1 三项，再补截图、旧图片与预览路径，最后重做回归与更新验收文档；当前不建议作为“第五轮修正全部完成”的稳定交付。

## 第五轮 E2E 本次最终结果

本次运行完成，日志为 `PASS: round5 button chain E01-E12 on simulated host`，没有错误输出。该结果确认模拟宿主按钮链通过；由于模拟观察值的局限，不能推翻上方真实 Chromium 验证失败及服务边界复现结果。
