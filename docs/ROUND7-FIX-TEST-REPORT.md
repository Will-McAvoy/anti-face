# Anti Face 0.6.1 测试报告 (ROUND7-FIX-TEST-REPORT)

- **测试日期**：2026-10-12
- **操作系统**：Windows 11 x64 (10.0.26200)
- **运行环境**：Node.js v24.16.0, Electron 44.5.1, Playwright 1.63.0
- **测试命令**：`npm run check`, `npm run smoke:round7:fix`, `npm run smoke:round7:fix:packed`

---

## 一、自动化测试执行汇总

```text
> anti-face@0.6.1 check
> npm run build && npm test

> anti-face@0.6.1 build
> tsc --noEmit && vite build
✓ built in 563ms

> anti-face@0.6.1 test
> node --test tests/*.test.cjs

ℹ tests 260
ℹ suites 0
ℹ pass 260
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11614.2086
```

全量 260 项自动化测试执行完毕，**通过率 100% (260/260)，0 失败，0 告警，0 跳过**。

---

## 二、关键阶段测试用例详情

### 1. 第七轮修正专用测试链 (`tests/round7-fix.test.cjs`)

| 用例名称 | 核心验证点 | 耗时 | 结果 |
|---|---|---|---|
| **R01: 应用摘要接口与确认令牌** | 1. 验证 `generateApplySummary` 支持对象与位置传参；<br>2. 验证输出结构对齐；<br>3. 验证主进程 `confirmApply` 令牌原子消费与过期重放拦截。 | 113.05ms | **PASS** |
| **R02: 轮换有效外观链贯通** | 1. 验证 `Round5Service.contextFor` 透传 `wallpaperOverride`；<br>2. 验证 `decorateApply` 将图像分析绑定至轮换资产；<br>3. 验证生成 CSS `::before` 背景图 URL 指向新图片。 | 259.73ms | **PASS** |
| **R03: 轮换事务守卫与安全回滚** | 1. 验证在途轮换遇到 `manualHold` 或一键恢复时 `isCurrent()` 阻断；<br>2. 验证迟到任务 0 写入；<br>3. 验证应用失败时不提交持久租约并清除临时占用。 | 38.49ms | **PASS** |
| **R04: 自动备份托管索引与底线保留** | 1. 验证 `managedBackups` 索引仅管理自动备份；<br>2. 验证非托管文件（如 2099 年异常文件）决不误删；<br>3. 验证无论超限或过期，保底保留至少 1 份最新有效备份；<br>4. 保护刚导出的备份文件。 | 29.84ms | **PASS** |
| **R05: 局部复制安全白名单与 IPC 预检** | 1. 验证 `ALLOWED_COPY_GROUPS` 导出完备；<br>2. 验证主进程 `copyThemeParts` 结构校验与资源可用性检查；<br>3. 验证单步撤销栈支持。 | 2.07ms | **PASS** |

### 2. 审查复现脚本验证对比 (`scripts/review-060.cjs` 与 `scripts/review-060-ui.cjs`)

| 模块 | 0.6.0 审查失败现象 (历史记录) | 0.6.1 修正后实测表现 |
|---|---|---|
| **Summary 接口** | `TypeError: 稳定序列化遇到无法编码的值`，参数错位 | `ok: true`, 19 项变更准确分类至 groups，耗时 3ms |
| **UI Preview** | `previewOk: false` | `previewOk: true`, 完整返回 previewId 与 baseline |
| **轮换管线** | `requestedAssetId !== resolvedAssetId` | 两者完全一致（`d3f74c10-773b-4e22-afdd-ba02cd14409e`），图片分析与 URL 同步更新 |
| **迟到轮换** | 恢复后依然触发异步写入，状态被破坏 | `writesAfterRestore: 0`, `returnedOk: false`, `currentAssetClaimed: false` |
| **备份保留清理** | 误删刚导出备份，或误删外部未托管文件 | `newBackupStillExists: true`, `corruptUnownedFileKept: true`, 最新有效备份安全保留 |

### 3. 性能基准测试 (`tests/scale.test.cjs`)

在隔离环境与全量回归中均对 10,000 条历史记录进行极限压测：
- **写入 10,000 条记录**：88.5 ms
- **筛选与首批查询**：83.8 ms
- **翻页查询 (Page 5)**：94.7 ms
- **筛选导出 CSV**：81.4 ms
- **总耗时**：364.8 ms（大幅优于既定 1200 ms 阈值，断言无放宽）

### 4. 真实 Chromium 渲染计算测试

- **壁纸轮换运行时覆盖生效**：验证真实背景层 `::before` 样式规则注入，有效资产 URL 解析通过 (422.58ms)。
- **省电模式下运行时模糊度夹持**：验证真实 Chromium 渲染引擎在省电模式下 computedStyle 模糊上限被夹持在 8px (286.45ms)。
- **标签与变更摘要 DOM 组件渲染**：无样式溢出，排版正常，文字对比度满足要求 (390.77ms)。

---

## 三、真实 Electron 冒烟测试

### 1. Dev Electron 冒烟 (`npm run smoke:round7:fix`)

```text
[Smoke Round 7 Fix] Launching real Electron instance...
  ✓ Main window loaded successfully
  ✓ studioState returned active document
  ✓ previewApply succeeded: previewId=prev-1791789528957-qjv5ym, baseline=native, totalChanges=19
  ✓ confirmApply token consumed successfully via IPC
  ✓ Duplicate confirmApply rejected with EXPIRED_OR_NOT_FOUND
  ✓ copyThemeParts validated via main process IPC
  ✓ Rotation and AutoBackup status channels responsive

[Smoke Round 7 Fix] ALL REAL ELECTRON VERIFICATIONS PASSED!
```
产物记录保存至 `artifacts/smoke-round7-fix.json`。

### 2. 真实 Packaged EXE 解包冒烟 (`npm run smoke:round7:fix:packed`)

```text
[Smoke Round 7 Fix Packed] Checking packaged executable path...
  Target: D:\onedrive\work\hermes\anti_face\release\win-unpacked\Anti Face.exe
  Found executable (234.34 MB)
[Smoke Round 7 Fix Packed] Launching REAL packaged Electron application...
  ✓ Packaged main window loaded successfully
  ✓ Packaged app version: 0.6.1
  ✓ Packaged studioState returned active document
  ✓ Packaged previewApply succeeded: previewId=prev-1791789521408-28k5b8, baseline=native, totalChanges=19
  ✓ Packaged confirmApply token consumed successfully via IPC
  ✓ Packaged duplicate confirmApply rejected with EXPIRED_OR_NOT_FOUND
  ✓ Packaged copyThemeParts validated via main process IPC
  ✓ Packaged Rotation and AutoBackup status channels responsive

[Smoke Round 7 Fix Packed] ALL PACKAGED ELECTRON VERIFICATIONS PASSED!
```
产物记录保存至 `artifacts/smoke-round7-fix-packed.json`。

---

## 四、测试结论

所有 260 项自动化回归测试、审查复现脚本、性能压测、以及开发态与生产打包态的真实 Electron 启动冒烟测试均已**全部通过**。Anti Face 0.6.1 已达成高质量、可验证的闭环交付标准。
