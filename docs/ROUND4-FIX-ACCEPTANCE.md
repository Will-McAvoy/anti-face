# 第四轮功能修正验收文档 (ROUND4-FIX-ACCEPTANCE)

**日期**: 2026-10-04  
**版本**: v0.3.1  
**状态**: 全部 7 个审查缺陷 (R01–R07) 与 5 项功能缺口 (P1/P2) 均已修正并通过严格自动化回归与打包验收。

---

## 一、审查缺陷修正清单 (R01 – R07)

| 编号 | 审查缺陷 | 涉及文件 | 根因与修复措施 | 验证状态 |
|---|---|---|---|---|
| **R01** | `PreviewSession.commit` 在应用失败或异常时仍然执行 `save` 落盘 | `core/preview-session.cjs` | 跟踪 `actualRevision`/`actualGeneration` 及 `lastApplyResult`。当底层 apply 抛错、返回失败或版本不一致时，严格拒绝调用 `save` 回调，抛出 `HOST_UNAVAILABLE` 并保留原 `baseline`。 | **已通过** (`round4-fix.test.cjs`: R01) |
| **R02** | `AutomationService.tick` 在等待 `hostAvailable` 期间跨代次覆盖手动操作 | `desktop/automation-service.cjs` | 引入 `generation` 栅栏机制。在 `noteManual`、`pause`、`setConfig` 时自增并作废代次；在 `hostAvailable` 恢复后校验代次，若代次不匹配则立即中止应用。 | **已通过** (`round4-fix.test.cjs`: R02) |
| **R03** | `ThemeLibrary` 磁盘写入失败时内存残留脏数据，重试污染落盘 | `desktop/theme-library.cjs` | 对 `saveNew`、`rename`、`favorite`、`reorder`、`remove`、`importPack` 实行写时复制 (Copy-On-Write)。仅在临时文件原子重命名成功后才提交更新 `this.data.themes`。 | **已通过** (`round4-fix.test.cjs`: R03) |
| **R04** | `StudioService` 对未来未知的 `appearance.json` 版本直接覆盖丢失参数 | `desktop/studio-service.cjs` | `_loadDocument` 发现 `schemaVersion > 1` 或非法格式时标记 `documentFrozen = true`；`saveDocument` 串行排队并拒绝写入，抛出 `UNSUPPORTED_SCHEMA` 并保留原文件。 | **已通过** (`round4-fix.test.cjs`: R04) |
| **R05** | `NotificationService` 生产时钟配置缺失导致冷却逻辑失效与历史回放重复发声 | `core/notification-policy.cjs` | 生产默认构造将时钟绑定至 `performance.now()`；限制 `seen` 任务 ID 记录上限为 500；静音模式/冷却期间直接消费事件，解除静音后不补响历史事件。 | **已通过** (`round4-fix.test.cjs`: R05) |
| **R06** | `StudioService.applyEditorDocument` 换肤未通知自动化服务，导致定时切换打架 | `desktop/studio-service.cjs` | 在 `applyEditorDocument` 及个人主题库 `applyLibraryTheme` 显式调用 `this.automation.noteManual(themeId)`，记录人工介入并暂停自动规则。 | **已通过** (`round4-fix.test.cjs`: R06) |
| **R07** | `cancelPreview` 取消试穿后未回填 `studio.document`，导致主界面残留试穿草稿 | `desktop/studio-service.cjs`, `src/App.tsx` | `cancelPreview` 捕获 `res.restoredDocument` 并重新设置 `this.document`；前端收到取消结果后触发 `updateDocument(restored, 'replace')` 刷新草稿。 | **已通过** (`round4-fix.test.cjs`: R07) |

---

## 二、P1 / P2 关键功能与链路补齐

### 1. 声音资源与播放器可靠性 (P1-F)
- **问题**: 原打包后音频文件存在于 `app.asar` 虚拟文件系统内部，外部 PowerShell `MediaPlayer` 无法读取该路径。
- **修复**:
  1. `package.json` 中的 `build.asarUnpack` 显式增加 `"assets/sounds/**/*"`。打包后音频文件存在于真实文件系统路径 `release/win-unpacked/resources/app.asar.unpacked/assets/sounds/`。
  2. `desktop/audio-player.cjs` 增加 `app.isPackaged` 判断与 `app.asar.unpacked` 路径解析。
  3. 执行前严格通过 `fs.access` 校验文件存在；加入 3.5 秒硬超时与最多 3 个并发播放器限制。
- **证据**: `Get-ChildItem release\win-unpacked\resources\app.asar.unpacked\assets\sounds` 证实 4 个音频文件均存在（各 7982 字节）。

### 2. 预览窗口与多端模型共享 (P2-A)
- **修复**:
  1. `core/theme-css.cjs` 统一规则：当 `blur === 0` 或 `fit === 'contain'` 时 `inset: 0`，不无条件扩大；透明图片使用受控背景色。
  2. `src/components/Preview.tsx` 完整接入 `ThemeDocument`，传递区域变量 (`--preview-sidebar-*`, `--preview-card-*`, `--preview-composer-*`, `--preview-chat-*`) 及排版变量。
  3. `src/components/AppearancePanel.tsx` 增加可视化拖动十字准星 `FocalPointPicker`，支持实时拖动构图调整焦点 `focusX`/`focusY`；移除壁纸时同时置空 `assetId: null` 与 `legacyDataUrl: null`。

### 3. 主题库分页、按 ID 查询与收藏全量重排 (P2-B)
- **修复**:
  1. `ThemeLibraryPanel` 接入前端分页控件（上一页 / 下一页 / 页码指示器，默认每页 12 项），解除 60 项限制。
  2. 主题卡片增加可视化缩略色块/壁纸构图指示条 `ThemeThumbnail`。
  3. 修复在搜索过滤状态下收藏上移/下移丢项 BUG：`onReorder` 始终根据全量收藏集合 (`allFavoriteIds`) 计算前后置换，向后端提交完整集合。
  4. 新增 `library:get` IPC 接口，`onApply` 直接按主题 ID 检索主题对象，不依赖第一页快照。

### 4. 托盘/快捷键/自动切换主界面同步与冲突处理 (P2-C)
- **修复**:
  1. `preload.cjs` 暴露 `onStudioChanged` 监听机制。
  2. `src/App.tsx` 注册 `onStudioChanged`：
     - 若当前无未保存本地修改，自动平滑同步当前主题至界面。
     - 若当前存在未保存草稿，弹出冲突对话框，允许用户自由选择「载入新主题」或「保留当前草稿」。

### 5. 迷你窗口位置持久化与生命周期 (P2-D)
- **修复**:
  1. `desktop/mini.html` 设置 `-webkit-app-region: drag` 拖动条与按钮 `no-drag`。
  2. `desktop/mini-window.cjs` 接入 `moved`/`resized` 防抖持久化回调 `onBoundsPersist`。
  3. 监听 `screen` 显示器增减/DPI 变化自动执行 `clampBounds`；打开时使用 `showInactive()` 不抢焦点。
  4. `scripts/smoke-round4.cjs` 移除 `if (mini)` 弱化判断，采用严格等待与 `assert.ok(mini, '迷你窗必须成功创建')` 断言。

---

## 三、构建与测试验证矩阵

| 测试套件 / 命令 | 执行结果 | 耗时 | 关键断言 |
|---|---|---|---|
| `npm run check` | **89 passed, 0 failed** (Exit: 0) | 3.67s | 全部 81 项基准单元测试 + 8 项 R01-R07 回归测试全绿 |
| `npm run test:round4:fix` | **8 passed, 0 failed** (Exit: 0) | 3.31s | R01–R07 与音效真实路径专项目标测试通过 |
| `npm run test:desktop` | **PASS** (Exit: 0) | ~35s | 桌面 UI、过滤、持久化、壁纸、IPC 隔离、遥测重启通过 |
| `npm run test:desktop:round3` | **PASS** (Exit: 0) | ~20s | 多窗口 A/B 隔离、连接恢复、快速切换通过 |
| `npm run test:desktop:round4` | **PASS** (Exit: 0) | ~15s | 区域细调、个人库、迷你窗严格唤起关闭通过 |
| `npm run package` | **PASS** (Exit: 0) | ~40s | Electron-Builder 打包 portable 单执行文件成功 |
| `node scripts/smoke-packed.cjs` | **PASS** (Exit: 0) | ~25s | 解包可执行文件面板操作、125行导出、版本与偏好隔离通过 |

---

## 四、最终交付物与指纹

- **应用版本**: `0.3.1`
- **便携版 EXE 产物**: `release\Anti Face 0.3.1.exe`
- **产物文件大小**: `101,579,695` 字节
- **SHA256 校验和**: `1AAC4F5AEDF97A49C2AED9E775016D9B4B8DD4B557BDED8058B80A79DCA3071E`
- **解包资源目录**: `release\win-unpacked\resources\app.asar.unpacked\assets\sounds`
