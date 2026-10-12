# Anti Face 第五轮修正与补齐技术方案 (v0.4.1)

日期：2026-10-06  
基线：v0.4.0  
目标版本：v0.4.1  

---

## 1. 背景与目标

在 v0.4.0 完成 10 项功能初版的基础上，经审查报告（`docs/ROUND5-COMPLETION-REVIEW-2026-10-06.md`）与隔离复现（`scripts/review-round5-completion.cjs`），发现并确认了 6 个功能缺陷（R01–R06）以及共享链路与交互范围缺口（G01–G08）。

本方案的目标是：
1. 建立统一的每目标状态模型（`TargetAppearanceState`）与操作令牌验证（`OperationToken`），从架构层面杜绝多窗口、异步换肤、场景切换中的状态串用与竞态覆盖；
2. 修复 R01–R06 全部 6 个隔离问题，并将其转化为长效自动化回归测试；
3. 补齐 G01–G08 涉及的共享有效外观预览、区域与锁定扩展、深度核对计划、截图对比交互、按角色配色采用、项目身份降级、版本历史任意比较与局部恢复、测试竞态修复；
4. 实现集成验收链 X01–X10；
5. 构建并通过全新便携发布包（v0.4.1），交付完整的复查与验证文档。

---

## 2. 架构纠正与核心分层设计

### 2.1 每目标状态（TargetAppearanceState）与草稿解耦

现有问题：`StudioService.document` 同时承担了全局草稿、编辑器当前文档、各窗口已应用主题及最后持久化主题。这导致窗口 B 应用主题会直接篡改全局文档，当窗口 A 发生场景切换时，错误地采用了窗口 B 的主题（R03）。

纠正设计：
- `StudioService.editorDraft`（即 `studio.document`）：仅作为编辑器当前的未提交或当前激活草稿；
- 在 `Round5Service` / `StudioService` 中维护独立的 `TargetAppearanceState` 映射表（`targetStates: Map<string, TargetAppearanceState>`）：

```ts
interface TargetAppearanceState {
  targetId: string;
  targetEpoch: number;              // 窗口连接身份周期（断线重连推进）
  operationGeneration: number;      // 针对该目标的操作代次（手动操作、恢复、模式变更推进）
  activeDocument: ThemeDocument | null; // 该目标当前已确认应用的完整主题（原生时为 null）
  lastVerifiedAppearance: any | null;   // 最近一次验证成功的有效外观
  lastVerifiedDocumentHash: string | null;
  verificationStatus: 'unknown' | 'verified' | 'partial' | 'failed' | 'restore-unconfirmed';
  scene: 'home' | 'chat' | 'unknown';
  viewport: { width: number; height: number; dpr?: number } | null;
  projectIdentity: any | null;
  manualHold: boolean;
  inFlightSceneTask?: Promise<any> | null;
}
```

- 目标窗口关闭或断开时释放其会话状态；相同 targetId 再出现时以新的 `targetEpoch` 视为新目标，不复用旧截图或主题。
- 原生未换肤窗口（`activeDocument === null`）绝不因其他窗口应用主题而遭到自动场景上色。

### 2.2 统一操作令牌体系（Operation Tokens）

为杜绝异步边界后的旧任务写回，所有异步链路（场景自动应用、截图、配色 worker、预览应用、持久化）均使用标准操作令牌：

```ts
interface OperationToken {
  targetId: string;
  targetEpoch: number;
  operationGeneration: number;
  documentHash?: string;
  requestId?: string;
  isCurrent: () => boolean;
}
```

中央失效事件：
- 手动换主题、恢复原样、进入试穿、取消试穿、场景模式关闭、项目解绑/改绑、窗口重连/关闭、截图清除、生成取消。
- 在每个异步等待之后（图像读取后、分析后、探测后、注入前、验证后、回滚前、写盘前、更新界面前）严格调用 `token.isCurrent()`，若已失效立即中断并清理中间副作用。

### 2.3 纯视觉计算与异步准备彻底分层

1. **异步层**：
   - 验证宿主连接与目标代次；
   - `ImageAnalysisService` 负责按资源哈希读取魔数、尺寸、解码并按规范降采样（有界 LRU 缓存）；
   - 获取真实宿主视口与 DPR；
2. **纯计算层**：
   - `resolveEffectiveAppearance(document, context, analysis)`：纯同步计算，输出有效视觉模型（颜色、区域、壁纸焦点、遮罩、正文对比度评估、系统调整项）；
   - 拆分主进程哈希（Node crypto）与纯视觉数据结构，确保可序列化模型可直接供给前端 React `Preview` 消费；
3. **执行层**：
   - 生成 CSS 规则；
   - 注入并执行 `applyVerification` 核对；
   - 遇失败按事务协议执行回滚；
4. **提交层**：
   - `SaveResult` 两阶段原子事务持久化，确保文件系统与内存状态一致。

---

## 3. R01–R06 修复与实现技术细节

### R01：独立 ImageAnalysisService
- 抽取 `ImageAnalysisService`，不再依赖“整套配色生成”按钮：
  - 对合法 `assetId` 或 `legacyDataUrl`，读取图像 Buffer，校验格式与尺寸；
  - 降采样为标准 512px 采样数据并提取基础统计；
  - 缓存键为 `hash(bytes) + algoVersion + sampleSpec`；设置最大内存限制（如 16MB）与 LRU 淘汰；
  - 支持并发请求合并（In-flight deduplication）；
  - `explain`、`decorateApply`、生成配色均调用同一图像准备接口；
  - 真实宿主视口由 CDP 探测与窗口事件维护，模拟预览使用容器 ResizeObserver，两者标记不同 contextKind。

### R02：场景任务代次防御与贯通
- `onAutoScene(targetId, scene)` 在启动时捕获当前 target 的 epoch、generation、activeDocument；
- 检查该目标存在、未 hold、非试穿、模式为 auto；
- 在 await `ImageAnalysisService` 和 await `decorateApply` 返回后，重新校验 `isCurrent` 以及目标状态；
- 将 `isCurrent` 贯通至 `ThemeService.applyDocument` -> `_applyCss`，在 CSS 注入前、验证前、回滚前均检查；
- 记录去重仅在验证成功且令牌仍当前时生效。

### R03：目标主题独立隔离
- 目标状态 `targetStates` 为每个窗口独立维护 `activeDocument`；
- `onAutoScene(targetId)` 始终基于该 target 的 `activeDocument` 计算场景变体，绝不回退读取全局 `studio.document`；
- 切换 UI 所选目标时，加载对应目标的激活状态快照。

### R04：CaptureService 完整生命周期管理
- `CaptureService` 引入 `captureGeneration`（每目标独立计数器）；
- `take` 捕获当前代次，`clear(targetId)` 推进该目标的代次；
- 慢截图返回后，严格检查 `generation === currentGeneration`，已清除或已切换的目标抛弃返回结果；
- 修正 `this.bytes` 统计：替换同组 `after` 时正确扣减旧图片字节数；
- 前端 `HostComparePanel` 维护 mounted ref 与自增 requestToken，await 返回后验证是否仍挂载且目标未变；
- 敏感信息遮挡采用可撤销的局部覆盖机制，在 finally 统一执行清理。

### R05：保存主题与历史的原子事务（SaveResult）
- 定义返回结构：
  ```ts
  type SaveResult =
    | { ok: true; documentSaved: true; revisionSaved: true; revisionId: string }
    | { ok: false; code: string; documentSaved: boolean; revisionSaved: boolean; rollback: string; message: string };
  ```
- 两阶段提交：
  1. 预写不可变版本文件 `records/<revisionId>.json`；
  2. 写入主题配置/文档；
  3. 更新版本索引 `index.json`；
- 若第 2/3 步失败，执行补偿回滚并报告确切的 `partial` / `failed` 状态，绝不在外层伪装 `ok: true`。

### R06：配色 Worker 统一 settle-once 与超时终止
- Worker 生命周期采用统一的 `settleOnce(err, res)` 模式：
  - 监听 `message`、`error`、`exit`、`timeout`、`cancel`；
  - 任意触发即置 `settled = true`，清除计时器、解绑监听器、移出 jobs 表，并妥善 `terminate` Worker；
  - 超时返回明确错误码 `TIMEOUT`；取消返回 `CANCELLED`；异常退出返回 `WORKER_EXITED`；
  - `stop()` 遍历并终止所有在途 Worker，等待清理完毕后退出。

---

## 4. G01–G08 补齐与交互方案

- **G01 模拟预览**：
  - 前端 `Preview.tsx` 接收纯数据 `EffectiveVisualModel`；
  - 主界面与预览容器接入 `ResizeObserver`，视口动态传递，切换首页/聊天传递显式 `scene`；
  - 自动保护与构图调整在 UI 上标记“系统调整”指示。
- **G02 阅读保护扩展**：
  - 增加目标对比度输入控件（3.0–21.0）与说明；
  - 增加锁定控件（前景色、遮罩、正文/侧栏/输入框透明度）；
  - 支持分别评估 chat、composer、sidebar、card；
  - 多项采用支持单步撤销。
- **G03 深度核对计划**：
  - 扩展 `VerificationPlan`：检查背景图片 `naturalWidth` / 加载状态、各区域背景色/alpha/模糊、排版字号/行距、wallpaper pointer-events、owned style lease；
  - `partial` 状态精确罗列未生效的检查项。
- **G04 真实截图对比操作**：
  - 支持全窗口与受控 probe 区域裁剪；
  - 缩放、适应窗口、左右分割滑块对比；
  - 视口/DPR/导航状态不一致时标识“不可精确对比”。
- **G05 配色锁定与按角色采用**：
  - 支持锁定角色（accent, background, panel, foreground, muted）；
  - 候选方案展示颜色角色名称及色块；
  - 支持“采用强调色”、“采用背景”或“采用整套”；
  - 换图或修改锁定时自动使上一批候选失效。
- **G06 项目身份降级**：
  - 明确标注来源为 `verified-host`、`manual-project` 或 `session-window`；
  - 自动识别不可用时如实提示并提供手动关联。
- **G07 版本历史比较与局部恢复**：
  - 支持任意选择两个版本进行 diff；
  - 结构化差异展示；
  - 局部恢复（颜色、排版、壁纸与构图、指定区域）。
- **G08 Smoke 轮询修复与 X01–X10 覆盖**：
  - 修正 `scripts/smoke-round5.cjs`，封装有界文件轮询助手，容忍初次 ENOENT；
  - 编写全新测试套件 `tests/round5-fix.test.cjs` 覆盖 R01–R06 及 X01–X10。

---

## 5. 交付与验证步骤

1. 编写行为失败测试 `tests/round5-fix.test.cjs`；
2. 实施架构修正（`ImageAnalysisService`、`TargetAppearanceState`、`CaptureService`、`Round5Service`、`ThemeService`）；
3. 实施 UI 扩展（`Preview`、`ReadabilityPanel`、`HostComparePanel`、`ThemeGeneratorPanel`、`ThemeRevisionPanel` 等）；
4. 修复 `scripts/smoke-round5.cjs` 并验证；
5. 执行全面验证：`check`、`test:round5:fix`、旧测试集回归、打包并验证 package；
6. 交付 4 份文档与 `artifacts/round5-fix-results.json`，版本正式更新至 v0.4.1。
