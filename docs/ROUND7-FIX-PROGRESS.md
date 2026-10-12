# Anti Face Round 7 修正任务进度 (ROUND7-FIX-PROGRESS)

- **基线版本**：0.6.0
- **目标交付版本**：0.6.1
- **更新时间**：2026-10-12
- **当前阶段**：全部完成（已通过真实 Playwright Electron、打包 EXE 及全量 260 项自动化回归测试）

---

## 阶段规划与执行追踪

| 阶段 | 任务目标 | 核心涉及文件 | 状态 | 验证命令/测试 |
|---|---|---|---|---|
| **P0** | 开工检查与基线确认 | `docs/V0.6.0-ACCEPTANCE-REVIEW-2026-10-12.md`, `scripts/review-060.cjs` | **已完成** | 历史失败证据保留，确认 scale 性能 354ms 达标 |
| **R01** | 统一应用摘要接口并接确认令牌 | `core/theme-apply-summary.cjs`, `desktop/studio-service.cjs`, `src/components/ApplySummaryModal.tsx`, `src/App.tsx`, `desktop/main.cjs`, `desktop/preload.cjs`, `src/types.ts` | **已完成** | `node --test tests/round7-fix.test.cjs` (R01 PASS), `node scripts/review-060-ui.cjs` (previewOk: true) |
| **R02** | 轮换有效外观链（Round5/context/analysis/URL） | `desktop/round5-service.cjs`, `desktop/wallpaper-rotation-service.cjs`, `core/effective-appearance.cjs` | **已完成** | `node --test tests/round7-fix.test.cjs` (R02 PASS), `node scripts/review-060.cjs` (pipeline PASS) |
| **R03** | 轮换事务、迟到取消、结果状态与原生窗口保护 | `desktop/wallpaper-rotation-service.cjs`, `desktop/studio-service.cjs` | **已完成** | `node --test tests/round7-fix.test.cjs` (R03 PASS), 迟到轮换 0 写入，失败不提交租约 |
| **R04** | 自动备份托管索引 (Managed Index)、完整性校验与保底保留 | `desktop/auto-backup-service.cjs`, `core/auto-backup-policy.cjs` | **已完成** | `node --test tests/round7-fix.test.cjs` (R04 PASS), `node scripts/review-060.cjs` (未托管坏文件保留，新备份安全) |
| **R05** | 标签与局部复制完整链路补强 | `desktop/theme-library.cjs`, `core/theme-copy-parts.cjs`, `src/components/CopyThemePartsModal.tsx` | **已完成** | `node --test tests/round7-fix.test.cjs` (R05 PASS), 导出组别校验与主进程 IPC 预检 |
| **R06** | 真实端到端 Smoke、解包程序与最终 EXE 校验打包 | `scripts/smoke-round7-fix.cjs`, `scripts/smoke-round7-fix-packed.cjs`, `package.json`, `release/` | **已完成** | `npm run check` (260/260 PASS), `npm run smoke:round7:fix` (PASS), `npm run smoke:round7:fix:packed` (PASS), 生成 0.6.1 EXE |

---

## 阶段执行明细记录

### 1. R01: 统一应用摘要接口并接确认令牌
- **修改文件**：
  - `core/theme-apply-summary.cjs`: 实现 `normalizeSummaryArgs`，同时兼容对象与位置参数调用；统一输出字段 `baseline: { kind, label }`，`groups: { colors, typography, wallpaper, regions, auto }`，`requestedChanges`, `effectiveChanges`, `autoChanges`, `totalChanges`。
  - `desktop/studio-service.cjs`: `previewApply` 生成摘要并存入主进程有限会话缓存（5 分钟 TTL，上限 20 条）；实现 `confirmApply(previewId, options)`，对 preview 会话进行存在性、过期、instanceId 及 contextHash 多重校验后消费令牌并执行安全应用。
  - `core/ipc-policy.cjs` & `desktop/main.cjs`: 注册 `apply:confirm` 接口。
  - `desktop/preload.cjs` & `src/types.ts`: 暴露 `confirmApply(previewId)` API 与类型定义。
  - `src/components/ApplySummaryModal.tsx` & `src/App.tsx`: 弹窗确认按钮接入 `confirmSummary(previewId)` 令牌提交机制，失败或过期给出明确反馈。

### 2. R02 & R03: 轮换有效外观链与事务安全
- **修改文件**：
  - `desktop/round5-service.cjs`: `contextFor` 补齐透传 `wallpaperOverride` 与 `rotationActive`；`decorateApply` 在存在轮换覆盖时生成 `docForAnalysis`，使图片分析与背景 CSS assetUrl 指向同一轮换资产。
  - `desktop/wallpaper-rotation-service.cjs`:
    - 引入 `isCurrent()` 安全门禁：检查目标代次、`instanceId`、`manualHold` 及恢复屏障，若发生状态变迁立即中断并中止写入。
    - 原生目标窗口保护：原生无主题窗口不强行应用轮换草稿。
    - 原子租约流转：仅在应用成功且核对通过后才提交资产租约与更新轮换状态；失败时清理临时资源并记录失败状态。
    - `saveCurrentToTheme` 显式校验并传递 `remember` 结果，杜绝失败静默假阳性。

### 3. R04: 自动备份托管索引与安全保留策略
- **修改文件**：
  - `core/auto-backup-policy.cjs`: `selectBackupsToPrune` 增加 `protectPath` 保护刚导出的备份，保底保留至少 1 份最新有效备份，并对未来越界时间戳进行钳制。
  - `desktop/auto-backup-service.cjs`:
    - 引入 `managedBackups` 托管索引机制并持久化到 `auto-backup-state.json`。
    - 清理前通过 `inspectBackup` 进行有效性校验，损坏或无效备份不计入有效保留集。
    - 仅对本实例托管生成的有效自动备份执行淘汰；非托管文件（如 2099 异常伪造文件、第三方手工文件）一律保留，绝不误删。

### 4. R05: 主题标签与局部复制完整链路
- **修改文件**：
  - `core/theme-copy-parts.cjs`: 导出 `ALLOWED_COPY_GROUPS = ['colors', 'typography', 'wallpaper', 'regions.global', 'regions.sidebar', 'regions.chat', 'regions.input', 'regions.cards']`。
  - `src/components/CopyThemePartsModal.tsx`: 调用主进程 `window.antiFace.copyThemeParts` 执行服务端安全校验与预检。
  - `desktop/theme-library.cjs`: 保持 tags 字段落盘、导入导出与持久化。

### 5. R06: 真实端到端 Smoke、解包与打包交付
- **修改与生成文件**：
  - `package.json`: 升级版本至 `0.6.1`，新增 `"smoke:round7:fix"` 与 `"smoke:round7:fix:packed"` 脚本。
  - `scripts/smoke-round7-fix.cjs`: Playwright 驱动真实 Dev Electron 实例，验证主窗口、`studioState`、`previewApply`、`confirmApply` 令牌消费、二次消费拒绝、`copyThemeParts` 与状态通道。
  - `scripts/smoke-round7-fix-packed.cjs`: Playwright 驱动真实生产打包二进制 `release/win-unpacked/Anti Face.exe`，完成打包环境全链路验证。
  - `release/Anti Face 0.6.1.exe`: 生产便携版可执行文件。
  - `release/SHA256SUMS.txt`: 记录 `d6a4384695107390f607b58f46de80d4137b3d5930e01dcb9f7718aa2ec5319c  Anti Face 0.6.1.exe`。
