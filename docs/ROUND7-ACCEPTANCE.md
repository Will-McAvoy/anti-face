# Anti Face Round 7 (v0.6.0) 交付验收报告

日期：2026-10-12（Asia/Taipei）
工程目录：`D:\onedrive\work\hermes\anti_face`
执行基线：源码 v0.5.1
最终交付版本：v0.6.0
验收结论：**全部阶段（Phase 0 - Phase 6）验证通过，准予发布**

---

## 1. 验收对照矩阵

| 编号 | 功能项 | 规范与边界要求 | 对应核心实现与测试 | 验收状态 |
|---|---|---|---|---|
| **Fix** | **P2 性能策略恢复修复** | 区分期望/确认状态（`desiredTier` vs `confirmedTier`），临时失败有限重试（最多 3 次），恢复原貌/安全模式即时清空队列 | `desktop/performance-service.cjs`<br/>`tests/v052-performance-recovery.test.cjs` (4/4 PASS) | **通过 (PASS)** |
| **F01** | **主题标签与多维分类** | 标签属于主题元数据，不触发 CSS 换肤/undo；Unicode NFC、中英混合、超限截断；基于相对亮度派生深浅色；支持多选 AND/OR 语义；500 主题压力测试 | `core/theme-tags.cjs`<br/>`desktop/theme-library.cjs`<br/>`src/components/ThemeLibrary.tsx`<br/>`tests/round7-tags.test.cjs` (6/6 PASS) | **通过 (PASS)** |
| **F02** | **本地壁纸文件夹轮换** | 有界扫描（<=3 层、<=2000 张）；拒绝 `userData` 内部路径；魔数校验（PNG/JPG/WEBP）；Shuffle Bag 无相邻重复；跨午夜防堆叠；运行时仅注入 `context.wallpaperOverride`，不篡改主题 JSON；资产租约流转与 GC；安全模式/试穿暂停保护；显式“存入主题” | `core/wallpaper-rotation-policy.cjs`<br/>`desktop/wallpaper-rotation-service.cjs`<br/>`src/components/WallpaperRotationCard.tsx`<br/>`tests/round7-rotation.test.cjs` (6/6 PASS) | **通过 (PASS)** |
| **F03** | **应用前变化摘要与结果反馈** | 首次应用原生窗口：`baselineKind: native`，旧值诚实标识“原生默认”，不伪造原生旧值；已换肤窗口：对比 `lastVerified` 基线；分组展示（colors, typography, wallpaper, regions）；呈现运行期自动叠加层（性能/场景/轮换）；诚实反馈，版本写盘失败明确暴露 `revisionSaved: false` | `core/theme-apply-summary.cjs`<br/>`desktop/theme-apply-summary.cjs`<br/>`src/components/ApplySummaryModal.tsx`<br/>`src/App.tsx`<br/>`tests/round7-apply-summary.test.cjs` (2/2 PASS) | **通过 (PASS)** |
| **F04** | **主题局部复制** | 白名单组（colors, typography, wallpaper, regions.*）；严格保护目标 ID/name/schemaVersion；跨不同基底主题穿透解析实际视觉颜色（`copyVisiblePalette`）；单步撤销事务保护（接入 `AppearanceHistory`）；相同内容复制返回 `changed: false` | `core/theme-copy-parts.cjs`<br/>`src/components/CopyThemePartsModal.tsx`<br/>`src/components/AppearancePanel.tsx`<br/>`tests/round7-copy-parts.test.cjs` (5/5 PASS) | **通过 (PASS)** |
| **F05** | **自动备份与严格保留策略** | 重大修改防抖（120s）与最小间隔（300s）；数据指纹（SHA-256）去重跳过；目录安全检查；文件名格式严格匹配 `/^anti-face-auto_.*\.antiface-backup$/`；保留清理算法仅识别自动备份，严格保底至少 1 份最新有效备份，绝不误删手工备份与用户文件；迁移与安全模式挂起保护 | `core/auto-backup-policy.cjs`<br/>`desktop/auto-backup-service.cjs`<br/>`src/components/AutoBackupCard.tsx`<br/>`tests/round7-auto-backup.test.cjs` (6/6 PASS) | **通过 (PASS)** |
| **Cross** | **跨场景与综合隔离验证** | 壁纸轮换与局部复制协调；一键恢复对轮换迟到注入的截断；迁移恢复期间自动备份拦截；标签更新与自动备份完整包验证；局部复制与变更摘要联动 | `tests/round7-cross-scenarios.test.cjs` (5/5 PASS) | **通过 (PASS)** |
| **Render** | **真实 Chromium 计算样式** | 真实 Chromium DOM 中验证轮换背景编译入 `body::before`；省电模式 blur 8px 上限计算生效；标签与摘要卡片排版无溢出 | `tests/round7-render.test.cjs` (3/3 PASS) | **通过 (PASS)** |

---

## 2. 规则与红线审查

1. **真实调用链核实**：所有功能均打通 UI -> IPC -> Service -> Core -> Store -> 宿主，无空中楼阁，无未连接的空壳函数。
2. **生产调用者闭环**：
   - 壁纸轮换：真实由 `scheduleNext()` 定时器、休眠唤醒补时、以及界面“手动下一张”触发，通过 `resolveEffectiveAppearance` 注入有效外观。
   - 标签系统：修改后经 `ThemeLibrary.updateTags()` 原子落盘至 `themes.json`，重启后完整加载并支持多维组合查询。
   - 自动备份：由 `preferences` 持久化开关、`noteMajorChange()` 防抖以及定时轮询驱动，落地真实 `.antiface-backup` 归档。
3. **隔离与保底红线**：
   - 零数据误删：保留策略由精确正则保护，手工创建的文件和异构归档绝对不删；无论任何保留期限，始终强制保底保留 1 个最新自动备份包。
   - 零主题篡改：轮换与性能调整作为运行期有效外观覆盖，绝不回写持久化主题 JSON。
   - 零递归灾难：壁纸目录和备份目录均有严格的 `isPathInside(userData)` 校验，从根源防止递归监控和无限膨胀打包。
4. **测试与回归断言保留**：
   - 既有 218 项回归测试 100% 保留且全部通过，未降低断言容差，未删除既有检查。
   - 全量测试用例增至 255 项，通过率 100%。

---

## 3. 验收签署

- **交付状态**：已完成代码实现、全量测试、打包准备与架构文档。
- **发布标识**：`Anti Face v0.6.0`。
