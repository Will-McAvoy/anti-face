# Anti Face 第七轮开发实施计划 (Round 7 Plan)

日期：2026-10-12（Asia/Taipei）  
基线版本：0.5.1（修复后推荐版本 0.6.0）  
工程目录：`D:\onedrive\work\hermes\anti_face`

---

## 1. 现状审查与既有缺陷核实

### 1.1 基线测试与构建状态
- `npm run check`: 218/218 项测试全部通过，TypeScript 与 Vite 构建零错误。
- 历史发布 EXE：`Anti Face 0.1.0.exe` 至 `Anti Face 0.5.1.exe` 均保留且哈希一致。
- 源码防灾备份：已于 `.backups/round7-baseline-2026-10-12` 完整备份 `core`, `desktop`, `src`, `package.json`。

### 1.2 既有缺陷确认（0.5.1 性能策略故障恢复）
- 依据 `docs/V0.5.1-ACCEPTANCE-REVIEW-2026-10-12.md` 与 `GROK_V0.5.2_FIX_PROMPT.md`：
  - 运行 `node scripts/review-051-performance.cjs` 实测输出：
    `applyAttempts: 1, reportedTier: "powersave", actualHostTier: "normal", recoveredAfterTwoRefreshes: false`
  - 根因：`PerformanceService.refresh` 中先调用 `evaluate`，它直接将内存状态 `state.tier` 标为 `powersave`。随后 `applyDocument` 发生临时故障时，下一次 `refresh` 再次求值，由于 `state.tier` 已经与目标档位相同，判定 `changed: false`，导致后续刷新不再重试，界面显示省电但宿主仍为普通效果。
- 处置方案：
  - 实施 Phase 0，分离 `desiredTier`/`desiredKey` 与 `confirmedTier`/`confirmedKey`。
  - 引入有限重试机制（指数退避/下次有效刷新重试），并在安全模式、恢复原貌、目标销毁时取消待重试任务。
  - 编写回归用例 `tests/v052-performance-recovery.test.cjs` 验证故障后成功恢复补写。

---

## 2. 本轮五项核心功能已有能力与真实缺口清单

| 功能编号 | 功能名称 | 已有能力 | 真实缺口与必需新增 |
|---|---|---|---|
| **F01** | 主题标签与分类 | `ThemeLibraryEntry` 基本存储、按名称/ID简单过滤、收藏与分页 | 1. 结构增加 `tags: string[]` 并规范化（Unicode NFC、去重、上限12个、单标签24字符）<br>2. 纯函数 `core/theme-tags.cjs`（normalizeTags, matchesThemeFilters, getTagCounts）<br>3. 标签多选 AND/OR 过滤、深浅色亮度派生、有无壁纸过滤、无标签主题筛选<br>4. 复制/导入导出/备份恢复全链路保留 tags，内置主题支持标签覆盖/个人副本<br>5. UI 标签展示、编辑 Chip、筛选栏与翻页同步重置 |
| **F02** | 本地壁纸文件夹轮换 | 单张壁纸选择与裁剪、ImageDecode 解码支持 (PNG/JPEG/WEBP)、有效外观覆盖机制 | 1. `core/wallpaper-rotation-policy.cjs` 纯策略（顺序/随机去重 Shuffle Bag、时钟调度）<br>2. `desktop/wallpaper-rotation-service.cjs` 目录授权、有界扫描（上限2000张）、安全解码<br>3. 运行期资产受控载入（当前/下一张引用释放，不无限增长）<br>4. 运行期壁纸 override 接入有效外观解析，不持续重写持久化主题 JSON<br>5. 暂停原因提示（安全模式/未连接/试穿/迁移中/手动暂停）<br>6. 手动“下一张”、显式“将当前壁纸保存到主题”操作（写入 undo/历史）<br>7. 多目标窗口独立隔离，旧目标销毁即废弃 |
| **F03** | 应用前变化摘要和应用后结果 | `core/theme-diff.cjs` 比较两份主题差异、`theme:applyDocument` 基础应用通道 | 1. `core/theme-apply-summary.cjs` 生成结构化预检摘要（配色、排版、壁纸、区域、自动覆盖）<br>2. 区分用户请求变化 (requestedChanges) 与最终有效外观变化 (effectiveChanges)<br>3. 未验证/原生窗口基线明确提示“当前没有本程序已确认主题”，不伪造旧值<br>4. 主进程预览 Token 缓存与指纹校验，目标上下文/主题变化时主动失效<br>5. 应用后返回结构化结果（已生效、部分生效、失败回滚、历史落盘状态 revisionSaved）并在 UI 明确展示 |
| **F04** | 主题局部复制 | 主题编辑器草稿管理、单步 undo/redo 撤销栈、历史记录 partialRestore 机制 | 1. `core/theme-copy-parts.cjs` 纯函数：白名单选择组（配色、排版、壁纸、各区域）<br>2. 深拷贝选中字段，严格保护目标 ID/name/tags/版本历史不被篡改<br>3. 配色继承语义处理：复制源主题解析后的可见 palette，即使源主题是空 overrides 也能正确获取视觉颜色<br>4. 壁纸完整构图拷贝与 AssetStore 引用租约校验<br>5. 编辑器单次事务（作为一步 undo/redo）<br>6. UI 弹窗：源主题选择、组选多选框、变化预览、确认应用至草稿 |
| **F05** | 自动备份与保留策略 | `BackupService.exportBackup`、PKZip 压缩解压、原子提交与检查机制 | 1. `desktop/auto-backup-service.cjs`：配置管理（启用、目录、周期：每天/重大修改后、保留份数、保留天数）<br>2. 重大修改事件检测与防抖（2分钟防抖，最短间隔5分钟；排除运行期轮换/性能调档/滑块拖动）<br>3. 内容指纹校验：无数据变化跳过写入<br>4. 独立托管索引与命名规则 `anti-face-auto_<timestamp>_<uuid>.antiface-backup`<br>5. 先生成验证后清理旧备份；只清理本服务所属自动备份，绝不删除用户手工文件<br>6. 路径安全校验（禁止选在 userData 内部导致递归打包）<br>7. UI 备份设置卡片：目录选择、立即备份、暂停/恢复、打开目录、状态指示 |

---

## 3. 共用设计与协同边界

### 3.1 状态与持久化分层
- **元数据 vs 样式文档**：标签 (tags) 属于主题库元数据，不写入主题文档 CSS 对象，修改标签不触发宿主换肤或外观 undo。
- **草稿 vs 运行时覆盖**：
  - 局部复制修改编辑器前端草稿（属于一次 undo 动作），需用户手动点击应用或保存。
  - 壁纸轮换与性能策略均属于有效外观层级的**运行时覆盖 (runtime override)**，不污染已保存的主题文档，不每轮写入版本历史。
- **自动备份内容**：仅持久化配置、主题库、资产与偏好，不打包运行期截图或临时覆盖。

### 3.2 意图与优先级协调
- **全局优先级**：
  `安全模式 / 恢复原貌 / 迁移屏障` > `最新用户手动操作（试穿/应用/局部复制）` > `已配置自动规则（轮换/性能调档/定时自动化）`
- **冲突保护**：
  - 手动试穿或手动换肤期间，壁纸轮换自动暂停，UI 展示暂停原因。
  - 恢复原貌 (restoreAll) 触发后，所有在途的性能与轮换写入立即失效并终止。
  - 自动备份与手动备份/恢复使用同一套 `coordinated` 互斥锁，迁移期间禁止并发写入 Store。

---

## 4. 分阶段实施与验证步骤

### 阶段 0：性能故障恢复修正（P2 缺陷闭环）
1. 修改 `desktop/performance-service.cjs`：实现 `desiredTier` 与 `confirmedTier` 分离，维护 retry 队列，支持错误重试与取消。
2. 编写 `tests/v052-performance-recovery.test.cjs`，覆盖单次临时故障后恢复补写、非异常失败、安全模式取消重试、AC/电池切换覆盖。
3. 验证 `scripts/review-051-performance.cjs` 逻辑在恢复场景下的正确通过。

### 阶段 1：F01 标签分类 & F04 局部复制（数据模型与草稿核心）
1. 编写 `core/theme-tags.cjs` 与单元测试 `tests/round7-tags.test.cjs`。
2. 升级 `desktop/theme-library.cjs`、`core/theme-schema.cjs`、`src/types.ts` 支持 `tags` 持久化、查询、导入导出。
3. 验证备份服务 `backup-service.cjs` 检查与恢复在保留 tags 时的正确性。
4. 编写 `core/theme-copy-parts.cjs` 与单元测试 `tests/round7-copy-parts.test.cjs`。
5. 更新 IPC 通道与白名单（`core/ipc-policy.cjs`, `desktop/preload.cjs`, `desktop/main.cjs`）。
6. 实现 UI：主题库标签 Chip、编辑浮层、多选过滤工具栏；编辑器局部复制弹窗。

### 阶段 2：F03 应用前摘要与应用后结果（核对与意图强化）
1. 编写 `core/theme-apply-summary.cjs` 与单元测试 `tests/round7-apply-summary.test.cjs`。
2. 在 `StudioService` 中接入基线提取、摘要生成、Token 缓存及在途指纹校验。
3. 扩展应用返回值结构，区分原生基线与未验证状态，返回历史落盘与部分生效明细。
4. 更新主窗口与快速切换窗口 IPC，UI 增加折叠式摘要组件与状态反馈面板。

### 阶段 3：F02 本地壁纸文件夹轮换（运行期覆盖与调度）
1. 编写 `core/wallpaper-rotation-policy.cjs` 纯策略与单测。
2. 编写 `desktop/wallpaper-rotation-service.cjs` 目录扫描、调度、受控 Asset 载入与 override 注入。
3. 编写 `tests/round7-rotation.test.cjs`（覆盖假时钟、损坏图片、安全模式暂停、去重）。
4. 接入 `StudioService`，打通有效外观渲染，支持“保存当前壁纸到主题”。
5. 更新 IPC 与 UI 轮换控制面板。

### 阶段 4：F05 自动备份与保留策略（长期数据保护）
1. 编写 `desktop/auto-backup-service.cjs`，实现重大修改监听、防抖、目录校验与保留策略清理。
2. 编写 `tests/round7-auto-backup.test.cjs`（覆盖假时钟、防抖、失败不删旧备份、无关文件保护）。
3. 接入 Store 提交钩子与 IPC 接口。
4. 实现 UI 自动备份管理卡片。

### 阶段 5：综合集成、端到端与打包交付
1. 编写综合场景测试 `tests/round7-cross-scenarios.test.cjs` 与真实 Chromium 渲染测试 `tests/round7-render.test.cjs`。
2. 编写真实 Electron 冒烟测试 `scripts/smoke-round7.cjs` 与打包程序测试 `scripts/smoke-round7-packed.cjs`。
3. 更新 `package.json`（版本提升至 0.6.0，新增 npm scripts）。
4. 执行全量构建、测试、打包，验证 ASAR 完整性与实际 EXE 启动。
5. 输出交付文档：架构设计、测试报告、验收报告、发布说明。
