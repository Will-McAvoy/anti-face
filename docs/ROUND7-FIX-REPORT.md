# Anti Face 0.6.1 第七轮核心修正报告 (ROUND7-FIX-REPORT)

- **交付日期**：2026-10-12
- **执行环境**：Windows 11 x64, Node.js 24, Electron 44.5.1
- **基线版本**：0.6.0
- **交付版本**：0.6.1
- **对应验收报告**：[ROUND7-FIX-ACCEPTANCE.md](ROUND7-FIX-ACCEPTANCE.md)
- **对应测试报告**：[ROUND7-FIX-TEST-REPORT.md](ROUND7-FIX-TEST-REPORT.md)

---

## 一、背景与问题回顾

在 0.6.0 版本验收审查 (`docs/V0.6.0-ACCEPTANCE-REVIEW-2026-10-12.md`) 与复现脚本 (`scripts/review-060.cjs`、`scripts/review-060-ui.cjs`) 中，发现了以下 5 项阻碍正式交付的核心缺陷与真实接线断裂：

1. **R01 应用前变化摘要与确认协议失败**：
   - `StudioService.previewApply` 传递了 4 个位置参数，而 `core/theme-apply-summary.cjs` 的 `generateApplySummary` 接收单对象入参，导致入参严重错位。
   - 核心层返回字段（`changes` 数组）与渲染层组件期望结构（`groups: { colors, typography, wallpaper, regions, auto }`）脱节，甚至在序列化阶段触发 `TypeError: 稳定序列化遇到无法编码的值`。
   - 缺少应用确认令牌（Confirmation Token）机制，用户点击确认无法防止窗口切换、草稿修改或代次变更带来的应用串染。
2. **R02 壁纸轮换未接通有效外观链**：
   - `Round5Service.contextFor` 遗漏转发 `wallpaperOverride` 与 `rotationActive` 标记，导致有效外观解析器拿不到实际轮换壁纸。
   - `Round5Service.decorateApply` 仍在针对原保存主题文档的壁纸进行图像分析，而 CSS 注入却试图引用轮换图片，导致分析结果与真实背景图分裂。
3. **R03 轮换并发竞态、迟到取消与状态回执缺陷**：
   - 轮换在进行异步解码和准备时，若用户已触发一键恢复或手动换肤，缺乏 `isCurrent()` 安全拦截，产生迟到注入。
   - 无论底层应用与样式核对是否成功，轮换服务均盲目将资产租约提交为“已持久占用”，造成资产状态虚假。
   - 对原生无主题窗口未做防护，容易强制套用全局主题草稿。
4. **R04 自动备份保留策略与未托管文件误删**：
   - 原清理逻辑仅依赖文件名正则表达式，遇到外部未来时间戳（如 2099 年异常文件）时发生排序错乱。
   - 无法识别损坏文件，未能保障“最新有效备份”的底线；更致命的是清理逻辑可能将同目录下非托管文件或外部手工备份误删，并在特定情况下误删刚导出的最新备份。
5. **R05 局部复制与端到端真实验证断层**：
   - 局部复制组件在渲染层直接修改对象，缺乏主进程资源可访问性预检和受控白名单校验。
   - 原打包冒烟脚本 `smoke-round7-packed.cjs` 仅传参 `--packed` 给纯 Node 脚本，并未真正启动打包后的 Electron 可执行文件。

---

## 二、核心修正与实现详情

### 1. R01: 统一应用摘要接口与令牌确认协议 (Token-gated Apply)

- **参数统一适配**：
  在 `core/theme-apply-summary.cjs` 中引入 `normalizeSummaryArgs`，同时支持旧位置调用与标准对象传参。修复序列化检查与深度比对算法。
- **模式单协议对齐**：
  结构统一为：
  ```ts
  interface ApplySummary {
    previewId: string;
    baseline: { kind: 'native' | 'lastVerified' | 'unknown'; label: string };
    groups: {
      colors: DiffItem[];
      typography: DiffItem[];
      wallpaper: DiffItem[];
      regions: DiffItem[];
      auto: DiffItem[];
    };
    requestedChanges: DiffItem[];
    effectiveChanges: DiffItem[];
    autoChanges: DiffItem[];
    totalChanges: number;
    warnings: string[];
  }
  ```
- **主进程令牌消费与过期保护**：
  - `StudioService.previewApply` 生成 preview 摘要并分配唯一 `previewId`，缓存到 `previewSessions`（具备 5 分钟 TTL、LRU 上限 20 条，记录 `instanceId`、`contextHash` 与 `documentHash`）。
  - 新增主进程 IPC `apply:confirm` (`StudioService.confirmApply(previewId, options)`)。
  - 确认时严格校验会话有效性、过期时间及目标实例一致性；消费后即刻从缓存移除（原子消费，二次调用返回 `EXPIRED_OR_NOT_FOUND`）。
  - 前端 `ApplySummaryModal.tsx` 和 `App.tsx` 完整接入 `confirmApply` 链路。

### 2. R02: 壁纸轮换全链路接通有效外观 (Effective Appearance Pipeline)

- **Round5Service 上下文贯通**：
  修改 `desktop/round5-service.cjs` 中的 `contextFor(targetId)`，主动读取 `wallpaperRotationService.getEffectiveRotationOverride(targetId)` 并注入返回的上下文对象中。
- **真实装饰与分析统一 (docForAnalysis)**：
  在 `Round5Service.decorateApply` 中，若存在有效轮换覆盖，则构造 `effectiveWallpaperDoc`，并将图像分析 (`imageAnalysisService.analyzeImage`) 与最终生成的背景层 CSS (`::before` 背景图资产 URL) 全部绑定到该轮换图片资产 ID 上。
  确保原主题 JSON 保持未修改，但运行时外观与图像保护一致生效。

### 3. R03: 轮换事务守卫与安全回滚

- **三维守卫 `isCurrent()`**：
  在 `desktop/wallpaper-rotation-service.cjs` 执行轮换任务的每个异步断点（扫描后、租约获取后、应用前、核对前），调用 `isCurrent()` 检查：
  1. 当前目标是否被用户显式 `manualHold`（试穿或手动锁定）；
  2. 目标窗口 `instanceId` 是否与发起时一致；
  3. 目标是否已执行一键恢复或被置为安全模式。
  任何一项条件不满足，立即废弃在途任务，不向宿主注入任何样式。
- **原子状态与租约提交**：
  只有当 `themeService.apply` 返回成功且结果已核对时，才将临时资产租约提交为当前活跃租约；若失败，执行租约释放并记录真实失败原因。
- **原生目标保护**：
  原生窗口在没有主题绑定时不自动强套主题草稿。
- **存入主题语义完善**：
  `saveCurrentToTheme` 显式感知并传递保存结果中的 `remember` 状态，失败时不返回成功假象。

### 4. R04: 自动备份托管索引 (Managed Index) 与底线保留

- **托管索引机制**：
  在 `desktop/auto-backup-service.cjs` 中引入 `managedBackups` 状态表，持久化记录在 `userData/auto-backup-state.json` 中，仅对本系统自动创建的文件进行生命周期管理。
- **非托管文件隔离**：
  外部非法或损坏文件（例如复现用例中的 `anti-face-auto_2099-01-01T00-00-00_deadbeef.antiface-backup`）或手工创建的备份包，由于不在托管索引中，保留清理算法决不会误删。
- **刚导出备份与有效备份保底保护**：
  - `core/auto-backup-policy.cjs` 的 `selectBackupsToPrune` 显式支持 `protectPath` 参数，保护刚落盘的备份。
  - 清理前必须调用 `inspectBackup` 确认备份文件有效；即使超过保留上限或过期，系统始终强制保底保留至少 1 份经过完整性校验的最新有效备份。
  - 时间戳未来溢出（>当前系统时间）会被钳制，防止排序异常。

### 5. R05: 局部复制安全白名单与主进程 IPC 预检

- **白名单导出与完整性**：
  在 `core/theme-copy-parts.cjs` 中规范化导出 `ALLOWED_COPY_GROUPS`（包含 `colors`, `typography`, `wallpaper`, `regions.global`, `regions.sidebar`, `regions.chat`, `regions.input`, `regions.cards`）。
- **主进程 IPC 校验**：
  `src/components/CopyThemePartsModal.tsx` 在提交复制时，调用主进程 `window.antiFace.copyThemeParts` 完成源主题与目标主题的结构化预检，避免在渲染层由于深拷贝损坏元数据或资产引用丢失。

### 6. R06: 真实 Electron 端到端自动化冒烟测试

- **真实 Electron Dev 冒烟** (`scripts/smoke-round7-fix.cjs`)：
  使用 Playwright 启动真实 Electron 实例，测试页面 DOM 加载、`studioState`、`previewApply`、`confirmApply` 令牌消费、二次消费拒绝、`copyThemeParts` 及状态通道。
- **真实 Packaged EXE 解包冒烟** (`scripts/smoke-round7-fix-packed.cjs`)：
  使用 Playwright 直接加载 `release/win-unpacked/Anti Face.exe`，在真实的生产打包 ASAR 环境中验证：
  - 可执行程序启动（体积 234.34 MB）；
  - 主窗口 DOM 加载与 UI 渲染；
  - 应用程序版本返回严格为 `0.6.1`；
  - 主进程 ASAR 内部依赖与原生模块加载正常；
  - 变更摘要生成与确认令牌消费在打包环境下完整通过。

---

## 三、验证与回归总结

| 序号 | 验证项目 | 涉及脚本 / 测试 | 结果 | 关键指标 / 证据 |
|---|---|---|---|---|
| 1 | 修复回归用例集 | `node --test tests/round7-fix.test.cjs` | **5/5 PASS** | R01~R05 对应逻辑全部通过 |
| 2 | 审查复现脚本验证 | `node scripts/review-060.cjs` | **PASS** | 摘要 ok: true、轮换 ID 对齐、迟到写入 0、新备份与异常文件安全保留 |
| 3 | 审查 UI 脚本验证 | `node scripts/review-060-ui.cjs` | **PASS** | 解决序列化异常，`previewOk: true` |
| 4 | 历史规模基准 | `node --test tests/scale.test.cjs` | **PASS** | 10,000 条记录测试在 354ms 内完成（阈值 1200ms） |
| 5 | 全量单元与集成测试 | `npm test` | **260/260 PASS** | 260 项全部通过，0 失败，0 告警 |
| 6 | 前端编译与类型检查 | `npm run build` | **PASS** | TypeScript 无错误，Vite 构建 563ms |
| 7 | 综合检查门禁 | `npm run check` | **PASS** | 构建 + 260 项全量自动化测试通过 (11.6s) |
| 8 | 真实 Dev 冒烟 | `npm run smoke:round7:fix` | **PASS** | Playwright 驱动 Electron 交互通过 |
| 9 | 真实 Packaged 冒烟 | `npm run smoke:round7:fix:packed` | **PASS** | Playwright 驱动 `Anti Face.exe` 验证通过 |
| 10 | 生产打包产物 | `npm run package` | **PASS** | 输出 `release/Anti Face 0.6.1.exe`，SHA256 校验记录 |

---

## 四、生产交付物

1. **便携式可执行程序**：
   - 文件名：`release/Anti Face 0.6.1.exe`
   - 文件大小：约 101 MB
   - SHA-256：`d6a4384695107390f607b58f46de80d4137b3d5930e01dcb9f7718aa2ec5319c`
2. **解包二进制目录**：
   - 路径：`release/win-unpacked/Anti Face.exe`
3. **哈希记录清单**：
   - `release/SHA256SUMS.txt`（已追加 0.6.1 条目，保留 0.1.0~0.6.0 所有历史版本）
