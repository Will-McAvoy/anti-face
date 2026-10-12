# Anti Face Round 7 (v0.6.0) 测试与验证报告

日期：2026-10-12
测试执行模式：真实隔离环境、合成宿主与真实 Chromium DOM / 渲染管线
基线版本：v0.5.1
交付版本：v0.6.0

---

## 1. 测试概况与总览

| 测试分类 | 测试套件 | 测试用例数 | 结果 | 耗时 |
|---|---|---|---|---|
| **P2 级性能自适应修复** | `tests/v052-performance-recovery.test.cjs` | 4 | 全部通过 (PASS) | ~38ms |
| **F01 主题标签与分类** | `tests/round7-tags.test.cjs` | 6 | 全部通过 (PASS) | ~1.5s |
| **F02 壁纸文件夹轮换** | `tests/round7-rotation.test.cjs` | 6 | 全部通过 (PASS) | ~500ms |
| **F03 应用前变化摘要** | `tests/round7-apply-summary.test.cjs` | 2 | 全部通过 (PASS) | ~18ms |
| **F04 主题局部复制** | `tests/round7-copy-parts.test.cjs` | 5 | 全部通过 (PASS) | ~70ms |
| **F05 自动备份与保留** | `tests/round7-auto-backup.test.cjs` | 6 | 全部通过 (PASS) | ~540ms |
| **跨功能交叉场景验证** | `tests/round7-cross-scenarios.test.cjs` | 5 | 全部通过 (PASS) | ~450ms |
| **真实 Chromium 样式计算** | `tests/round7-render.test.cjs` | 3 | 全部通过 (PASS) | ~3.8s |
| **既有回归套件 (R01–R07)** | `tests/*.test.cjs` 全量测试 | 218 | 全部通过 (PASS) | ~20s |
| **端到端 Smoke 自动化脚本** | `scripts/smoke-round7.cjs` | 5 | 全部通过 (PASS) | ~3.5s |
| **全量验证总计** | **共 39 个测试文件** | **255 测试用例 + 5 Smoke 项** | **255/255 PASS (100%)** | **~26.8s** |

---

## 2. 新增套件详细验证情况

### 2.1 P2 性能恢复与重试队列 (`v052-performance-recovery.test.cjs`)
- **A. 首次临时失败后恢复**：验证初次 apply 失败后不误将 `confirmedTier` 标记为已成功；下一次轮询或允许重试时，能够检测到期望状态与确认状态不一致，成功补写 powersave。
- **B. 失败状态回执保护**：验证返回 `failed` 或 `stale` 时绝不污染确认档位。
- **C. 供电恢复 (AC) 重试**：验证切回市电时，从 powersave 恢复 normal 过程中遇瞬态错误能再次重试成功。
- **D. 安全模式与实例作废**：验证进入安全模式或目标窗口关闭销毁时，立即取消并丢弃在途重试任务。

### 2.2 F01 主题标签与多维分类 (`round7-tags.test.cjs`)
- 验证中英混合、大小写、空白过滤、Unicode NFC 规范化；
- 验证基于 WCAG 背景色相对亮度的深浅色自动推导；
- 验证 AND 与 OR 两种多选语义在组合过滤下的严格正确性；
- 验证 500 主题规模压力测试下的标签计数与过滤性能；
- 验证 ThemeLibrary 在保存、重命名、复制、更新标签、落盘和进程重启后的完全持久化；
- 验证完整备份（`.antiface-backup`）导出与在新数据目录恢复后标签数据完整性。

### 2.3 F02 本地壁纸文件夹轮换 (`round7-rotation.test.cjs`)
- 验证轮换配置校验与非法参数夹持；
- 验证 Shuffle Bag 无重复洗牌与跨周期首尾防撞算法；
- 验证跨午夜与时钟时滞计算（防定时器堆叠）；
- 验证目录有界扫描（最多 3 层、上限 2000 张）与魔数校验（PNG/JPG/WEBP），自动忽略非图片与损坏文件；
- 验证资产临时租约流转与 GC 自动清理；
- 验证安全模式、试穿和手动模式下的严格暂停与阻断。

### 2.4 F03 应用前变化摘要与结果反馈 (`round7-apply-summary.test.cjs`)
- 验证原生窗口应用：基线识别为 `native`，展示将要生效的请求值，旧值诚实标注为“原生默认”，不伪造原生旧值；
- 验证已换肤窗口应用：基于 `lastVerified` 基线对比生成字段级差异，分组展示（colors, typography, wallpaper, regions）；
- 验证运行时自动叠加层识别（性能策略模糊度削减、场景感知优化、壁纸轮换覆盖）。

### 2.5 F04 主题局部复制 (`round7-copy-parts.test.cjs`)
- 验证白名单组限制，严禁覆盖主题 ID 与名称；
- 验证仅复制指定部件（如只复制 sidebar，其他区域保持原样）；
- 验证跨不同 baseThemeId 复制时可见调色板穿透解析；
- 验证完整壁纸及构图参数复制；
- 验证相同内容复制返回 `changed: false`。

### 2.6 F05 自动备份与严格保留策略 (`round7-auto-backup.test.cjs`)
- 验证配置校验与 `userData` 内部目录防递归安全拒绝；
- 验证保留清理算法（`selectBackupsToPrune`）：严格保底至少 1 份最新有效备份，绝不误删非自动备份包；
- 验证重大修改防抖（120s）与指纹哈希（SHA-256）去重；
- 验证安全模式与迁移模式（`migrationActive = true`）下的自动抑制。

### 2.7 交叉集成场景 (`round7-cross-scenarios.test.cjs`)
- **Cross 1**：壁纸轮换覆盖与局部复制协调，草稿与有效外观正确隔离，显式存入主题才写入持久化文档；
- **Cross 2**：一键恢复与安全模式阻断迟到轮换注入；
- **Cross 3**：迁移进行中自动备份互斥拦截，防止脏读；
- **Cross 4**：标签更新触发自动备份，备份包解压验证标签完好且安全保留；
- **Cross 5**：局部复制后执行应用前摘要对比，明确显示所选组字段差异。

### 2.8 真实 Chromium 渲染计算 (`round7-render.test.cjs`)
- 验证在真实 Chromium 内壁纸轮换覆盖注入 `html body::before` 背景层 CSS；
- 验证省电模式下运行时模糊度夹持在真实 DOM 的 `getComputedStyle(sidebar).backdropFilter` 中为 `blur(8px)`；
- 验证标签与摘要 DOM 卡片排版无样式溢出与重叠。

---

## 3. 生产打包 Smoke 检查 (`smoke-round7.cjs`)

执行日志摘要：
```
[Smoke Round 7] Starting comprehensive verification for F01 - F05...
  ✓ F01_ThemeTagsAndCategorization: PASSED
  ✓ F02_WallpaperRotationService: PASSED
  ✓ F03_ApplySummaryAndFeedback: PASSED
  ✓ F04_ThemePartialCopy: PASSED
  ✓ F05_AutoBackupAndRetention: PASSED

[Smoke Round 7 Complete] Passed: 5, Failed: 0
```
结果持久化于 `artifacts/round7/smoke-summary.json`，各项功能均在独立隔离临时目录中通过了真实生命周期验证。
