> 历史记录（v0.5.0）：原“7/7、100% PASS 即全部完成”的结论已被 2026-10-08 独立复核取代。本文件保留当时记录，不代表当前验收；当前以 [0.5.1 修复报告](ROUND6-FIX-REPORT.md)、[分层验收](ROUND6-FIX-ACCEPTANCE.md) 和 [实测报告](ROUND6-FIX-TEST-REPORT.md) 为准。旧复核失败材料保持原样。

# Anti Face 第六轮架构设计与技术文档 (v0.5.0)

**日期**：2026-10-08（Asia/Taipei）  
**版本**：0.5.0  
**适用范围**：F01 - F07 七项实用功能及全系统集成  

---

## 1. 整体架构与状态分层

Anti Face 在第 6 轮构建了严格的状态分层体系，确保所有临时计算、系统环境观测和容灾降级状态不污染用户持久化的主题模型与撤销历史：

```
+-------------------------------------------------------------------------+
| Layer 1: 用户编辑草稿与撤销栈 (AppearanceHistory & Baseline)             |
|   - 当前草稿 (current)、初始会话基线 (baseline)                          |
|   - 撤销栈 (undoStack, max: 50, ~2MB 权重限制)、重做栈 (redoStack)      |
|   - 动作意图标签 (nextUndoLabel/nextRedoLabel) 与手势聚合 (gesture)      |
+-------------------------------------------------------------------------+
                                    |
+-------------------------------------------------------------------------+
| Layer 2: 用户持久化主题与偏好 (ThemeLibrary, PreferencesStore, Assets)    |
|   - 个人主题库 (theme-library.json, schemaVersion: 1)                   |
|   - 偏好设置 (preferences.json, DND时段, 音量, 性能模式)                |
|   - 资产存储 (assets/*.png, 引用计数与历史保护)                         |
+-------------------------------------------------------------------------+
                                    |
+-------------------------------------------------------------------------+
| Layer 3: 目标窗口应用状态与操作屏障 (StudioService Target State)          |
|   - activeDocument、appliedThemeId、appliedCss、lastVerified             |
|   - operationGeneration (代际令牌计数器)                                 |
|   - manualHold (手动恢复与安全屏障标志)                                  |
+-------------------------------------------------------------------------+
                                    |
+-------------------------------------------------------------------------+
| Layer 4: 运行时动态覆盖与容灾策略 (Runtime Overrides)                     |
|   - SafeLaunchManager: 崩溃计数、CLI --safe-mode、安全模式状态           |
|   - PerformanceService: 动态性能分档 (normal/lightweight/powersave)      |
|   - resolveEffectiveAppearance: 纯函数运行时模糊上限截断 (不改底层文档) |
+-------------------------------------------------------------------------+
                                    |
+-------------------------------------------------------------------------+
| Layer 5: 系统环境观测与数据源 (Host Adapters & Telemetry)                |
|   - DisplayContextService: 4 套坐标模型、WorkArea 夹持、视口指纹        |
|   - NotificationService: 来源能力声明 (supportsTaskCompleted 约束)       |
|   - CDP Session / Electron Screen / PowerSource 硬件事件                 |
+-------------------------------------------------------------------------+
```

---

## 2. 核心模块与实现细节

### 2.1 F01：一键恢复与安全启动 (Recovery Barrier & Safe Launch)

- **模块位置**：`desktop/safe-launch.cjs`、`desktop/studio-service.cjs`
- **安全模式管理 (`SafeLaunchManager`)**：
  - 维护 `runtime-session.json` 会话元数据文件。
  - 进程启动时原子读取并写入 `phase: 'running'`。
  - 正常退出时调用 `recordCleanExit()` 记录 `phase: 'clean'`。
  - 若上次未正常退出，累加 `failureCount`；当 `failureCount >= 2` 或传入 `--safe-mode` 命令行参数时，自动激活安全模式。
  - 安全模式特性：阻止启动时自动恢复换肤、强制提升并锁定恢复屏障、保留所有用户主题、壁纸、历史与偏好数据。
- **恢复屏障与结构化状态**：
  - `restoreAll(reason)` 采用原子代际锁：同步递增各目标窗口的 `operationGeneration` 并置位 `manualHold = true`，使所有在途的异步渲染、场景切换、切换器应用或性能重算操作立刻失效。
  - 返回目标级别结构化报告：
    - `targetId`、`title`、`status` (`'restored'` | `'disconnected'` | `'failed'` | `'unconfirmed'`)、`message`、`generation`。
    - 绝不在部分目标失败或断开时谎报整体成功。

### 2.2 F02：编辑撤销/重做完善与基线 (AppearanceHistory & Baseline)

- **模块位置**：`core/appearance-history.cjs`、`core/appearance-history.d.cts`
- **功能特性**：
  - **初始会话基线 (`baseline`)**：初始化或切换主题 ID 时记录干净基线。
  - **恢复初始基线 (`revertToBaseline()`)**：一键丢弃当前所有试探性修改回到基线状态；同时将当前草稿压入 undoStack（标签为“恢复初始基线”），误操作后可随时 Undo 找回。
  - **手势聚合 (`beginGesture` / `endGesture` / `cancelGesture`)**：滑块连续拖动与主体构图焦点拖拽期间产生的大量连续中间事件在 `endGesture()` 时聚合为单步撤销记录；`cancelGesture()` 直接回滚手势前状态且不入栈。
  - **键盘连按合并**：500ms 内对同一字段的连续微调自动合并为一步。
  - **动作意图标签**：`nextUndoLabel` 与 `nextRedoLabel` 动态返回 `撤销：[动作名]` 与 `重做：[动作名]`，并在 UI 按钮提示中呈现。
  - **会话资产保护 (`referencedAssetIds()`)**：收集当前草稿、基线、在途手势、撤销栈与重做栈引用的所有壁纸 assetId，在资产修剪时保护历史引用的壁纸文件。

### 2.3 F03：主题快速切换器 (QuickSwitcherController & Switcher Window)

- **模块位置**：`desktop/quick-switcher.cjs`、`desktop/switcher-preload.cjs`、`desktop/switcher.html`、`core/ipc-policy.cjs`
- **架构特点**：
  - 独立无边框轻量窗口，采用离线 HTML 模板 (`desktop/switcher.html`)。
  - 拥有专用 IPC 角色 `switcher` 与严格白名单通道 `SWITCHER_CHANNELS` (`switcher:init`, `switcher:selectTarget`, `switcher:apply`, `switcher:resolveConflict`, `switcher:close`)。
  - 绝无全量备份文件导出/导入、配置重写等越权操作能力。
  - 纯内存搜索与键盘上下箭头导航，支持特殊字符与防注入过滤。
  - 切换主题时单向作用于所选目标窗口，其他目标状态绝对隔离。

### 2.4 F04：多显示器与 DPI 适配 (DisplayContextService & Bounds Clamping)

- **模块位置**：`core/display-context.cjs`、`desktop/display-service.cjs`
- **4 套坐标模型与转换算法**：
  1. **DIP** (Device Independent Pixels)：Electron 窗口物理逻辑单位。
  2. **Physical Pixels**：屏幕物理点阵，`dip * scaleFactor`。
  3. **CSS Pixels**：宿主 DOM 视口与布局尺寸。
  4. **CDP Screenshot Pixels**：截图点阵，`clip.width * clip.scale * dpr`。
- **负坐标与多屏拓扑**：
  - 完整支持副屏在主屏左侧或上方产生的负坐标逻辑。
  - `clampBoundsToWorkAreas`：保证窗口或快速切换器标题栏（最小 100px 宽 × 32px 高）完整在可见屏幕 WorkArea 内，屏幕拔除时平滑重置至主屏幕居中，绝不飞出视口。
- **环境指纹计算 (`computeDisplayContextHash`)**：
  - 聚合视口尺寸与屏幕 DPR 计算 SHA-256 局部指纹，DPI 或分辨率变动时通知重算。

### 2.5 F05：完整备份与迁移 (BackupService & Zero-Dependency PKZip)

- **模块位置**：`desktop/zip-util.cjs`、`core/backup-schema.cjs`、`desktop/backup-service.cjs`
- **零外部依赖 PKZip 引擎 (`desktop/zip-util.cjs`)**：
  - 基于 Node 24 原生 `node:zlib` (`crc32`, `deflateRawSync`, `inflateRawSync`) 实现纯标准 ZIP 归档读写器。
- **安全与容量约束 (`core/backup-schema.cjs`)**：
  - `isSafeRelativePath`：严格拒绝路径穿越 (`../`)、绝对路径、Windows 驱动盘符、UNC 路径、保留设备名 (`CON`, `PRN`, `AUX`, `NUL` 等) 以及空字节/控制字符。
  - 单文件最大 64MB，解压后总容量上限 512MB，最大条目数 2000。
- **三阶段迁移流程**：
  - **阶段 A（只读审查）**：校验 `manifest.json`、完整性 SHA-256、解码图片文件头。
  - **阶段 B（冲突预览）**：计算新增主题数、无变更项数与冲突项数。
  - **阶段 C（事务提交）**：
    - 支持 `'keep-both'`（自动分配 `imported-` 前缀新 ID 并保留副本）与 `'overwrite'`（覆盖冲突项）。
    - 具备前置文件级快照与异常回滚机制，任意写入错误均完整复原原主题库与偏好文件。

### 2.6 F06：性能自适应 (PerformancePolicy & Resolution Layer)

- **模块位置**：`core/performance-policy.cjs`、`desktop/performance-service.cjs`、`core/effective-appearance.cjs`
- **纯函数状态机 (`evaluatePerformanceState`)**：
  - 档位划分：`normal` (全保真)、`lightweight` (模糊上限 12px)、`powersave` (模糊上限 8px)。
  - 迟滞逻辑：需要连续 3 次恶劣采样 (>33.3ms) 才触发降级；需要连续 15 次稳定采样 (<=33.3ms) 且非电池供电才逐步回升。
  - 冷却周期：10 秒强制冷却期，杜绝边缘波动导致的频繁振荡。
  - 电源感知：检测到市电断开切换为电池时，自动切入省电档位。
- **运行时无侵入覆盖 (`effective-appearance.cjs`)**：
  - 性能降级仅在运行时生成有效外观 (`effectiveAppearance`) 时对 `wallpaper.blur` 与各区域 `blur` 进行上限夹持。
  - 用户原始主题文档 (`document`) 与持久化 JSON 绝对不被修改，`documentHash` 保持一致，不产生虚假的脏状态或撤销历史。

### 2.7 F07：任务完成提醒规则与真实性约束 (TaskNotificationPolicy & Adapter Constraints)

- **模块位置**：`core/task-event.cjs`、`core/notification-policy.cjs`、`desktop/notification-service.cjs`
- **真实性约束（步骤 ≠ 整任务）**：
  - 数据源适配器必须通过 `declareSourceCapabilities` 声明能力。
  - 宿主普通日志源由于无法可靠判定是否为整任务完成，严格声明 `supportsTaskCompleted: false`。
  - `NotificationService` 遇未声明能力源发来的 `type: 'completed'` 真实事件，严格拒绝触发并返回 `source-unsupported-completed`，绝不假装完成。
- **勿扰与抑制机制**：
  - 跨午夜静音时段算法（例如 22:30 到 07:30 正确判定 23:00 与 03:00 为免打扰）。
  - 暂停 30 分钟临时抑制 (`pausedUntil`)。
  - 前台激活抑制 (`suppressInForeground`)：宿主处于前台聚焦时桌面横幅静默，仅播放声音（依设置）。
- **独立测试通道**：
  - 提供显式“测试音效”与“发送测试通知”接口，专用通道 `test-preview`，不计入任务完成统计，不污染去重缓存，不受静音时段抑制。

---

## 3. IPC 角色授权与安全模型

| 角色 | 窗口/上下文 | 允许的通道范围 | 严禁的操作 |
|---|---|---|---|
| `main` | 主窗口 (React UI) | `MAIN_CHANNELS` (外观、历史、备份、自动化、场景、阅读保护等) | 无法直接调用未白名单系统命令 |
| `mini` | 迷你悬浮窗 | `mini:snapshot`, `mini:open-main`, `mini:dismiss`, `mini:bounds` | 严禁调用主题修改、备份读写、CDP注入 |
| `switcher` | 快速切换器 | `switcher:init`, `switcher:selectTarget`, `switcher:apply`, `switcher:resolveConflict`, `switcher:close` | 严禁访问本地文件系统、全量备份、设置落盘 |

---

## 4. 存储迁移与向下兼容

- 所有 Round 6 新增配置字段（`safeMode`, `performance`, `backup`, `taskNotification`）均设有健壮的默认值降级函数。
- 旧版 `theme-library.json` (schemaVersion: 1) 与 `appearance.json` 保持 100% 原样兼容读取。
- 备份包 `.antiface-backup` 写入标准 JSON 与纯 ZIP 格式，未来版本遇到未知字段时停止覆盖写入并保留原文件。
