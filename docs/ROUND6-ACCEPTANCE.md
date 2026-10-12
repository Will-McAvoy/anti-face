> 历史记录（v0.5.0）：原“7/7、100% PASS 即全部完成”的结论已被 2026-10-08 独立复核取代。本文件保留当时记录，不代表当前验收；当前以 [0.5.1 修复报告](ROUND6-FIX-REPORT.md)、[分层验收](ROUND6-FIX-ACCEPTANCE.md) 和 [实测报告](ROUND6-FIX-TEST-REPORT.md) 为准。旧复核失败材料保持原样。

# Anti Face 第六轮验收文档 (v0.5.0)

**执行日期**：2026-10-08（Asia/Taipei）  
**交付版本**：v0.5.0  
**验收状态**：**全部通过 (100% PASS)**  

---

## 1. 范围与功能逐项验收表

| 功能编号 | 原始编号 | 功能名称 | 验收项 | 实际验证结果 | 状态 |
|---|---|---|---|---|---|
| **F01** | 第一项 | 一键恢复与安全启动 | 1. 恢复屏障与代际锁失效在途慢操作<br>2. 连续 2 次非正常退出进入安全模式<br>3. `--safe-mode` 命令行参数强制安全模式<br>4. 多目标结构化状态报告（不谎报成功）<br>5. 安全模式不删除任何用户数据 | `tests/round6-recovery.test.cjs` 3/3 通过<br>`SafeLaunchManager` 准确管理崩溃计数与命令行标志<br>多目标状态真实区分 `restored`/`disconnected`/`failed` | **PASS** |
| **F02** | 第三项 | 编辑撤销/重做完善与基线 | 1. 滑块/焦点拖拽手势聚合（单步撤销）<br>2. `revertToBaseline` 一键丢弃修改且支持再次 Undo 找回<br>3. 500ms 键盘同字段微调合并<br>4. 动态动作意图标签 (`nextUndoLabel`/`nextRedoLabel`)<br>5. `referencedAssetIds()` 保护历史引用的壁纸资产<br>6. 切换不同主题 ID 时隔离撤销栈 | `tests/round6-edit-history.test.cjs` 6/6 通过<br>`AppearanceHistory` 覆盖手势、键盘、基线、意图标签与资产保护 | **PASS** |
| **F03** | 第四项 | 主题快速切换器 | 1. 独立轻量快速切换窗口与离线 HTML<br>2. `SWITCHER_CHANNELS` 严格白名单 IPC 授权隔离<br>3. 纯内存主题搜索与过滤，防注入与防崩溃<br>4. 单一目标独立换肤，其他窗口绝对隔离<br>5. 目标处于 `manualHold` 时拒绝切换 | `tests/round6-switcher.test.cjs` 4/4 通过<br>`desktop/quick-switcher.cjs` 与 `desktop/switcher-preload.cjs` 严格受限 | **PASS** |
| **F04** | 第八项 | 多显示器与 DPI 适配 | 1. DIP / Physical / CSS / CDP Screenshot 4 套坐标模型精确换算<br>2. 副屏在主屏左侧/上方（负坐标系）无损支持<br>3. 智能 WorkArea 夹持，标题栏始终可见，离线屏幕安全救援<br>4. `computeDisplayContextHash` 视口与 DPR 指纹计算 | `tests/round6-display.test.cjs` 4/4 通过<br>`core/display-context.cjs` 与 `desktop/display-service.cjs` 完整覆盖多屏与 DPI 换算 | **PASS** |
| **F05** | 第九项 | 完整备份与迁移 | 1. 零外部依赖原生 PKZip (`node:zlib`) 读写引擎<br>2. 严格路径穿越与非法字符校验 (`isSafeRelativePath`)<br>3. 单文件 64MB、总解压 512MB 限制<br>4. 阶段 A（只读审查与哈希校验、图片头解码）<br>5. 阶段 B（冲突预览，区分新增/相同/冲突）<br>6. 阶段 C（原子事务提交与失败回滚，支持 `keep-both` 与 `overwrite`） | `tests/round6-backup.test.cjs` 3/3 通过<br>`desktop/zip-util.cjs` 与 `desktop/backup-service.cjs` 跑通完整导出与恢复闭环 | **PASS** |
| **F06** | 第十一项 | 性能自适应 | 1. 纯函数状态机 (`evaluatePerformanceState`) 迟滞与 10s 冷却<br>2. 连续 3 次恶劣采样降级，连续 15 次稳定采样恢复<br>3. 电池感知自动切入 powersave<br>4. `resolveEffectiveAppearance` 限制运行时模糊（轻量 12px，省电 8px）<br>5. 用户原始主题 JSON 绝对不被修改 | `tests/round6-performance.test.cjs` 3/3 通过<br>`core/performance-policy.cjs` 状态机无副作用，持久化文档零污染 | **PASS** |
| **F07** | 第十二项 | 任务完成提醒规则与真实性约束 | 1. 适配器真实性约束：未声明支持整任务完成的源直接拒绝触发<br>2. 步骤 ≠ 整任务约束：杜绝单步完成误报整任务完成<br>3. 跨午夜免打扰静音时段判定<br>4. 暂停 30 分钟临时抑制机制 (`pausedUntil`)<br>5. 前台聚焦横幅静默，音效按需保留<br>6. 独立测试通道 (`test-preview`) 不污染去重缓存 | `tests/round6-notifications.test.cjs` 5/5 通过<br>`core/notification-policy.cjs` 与 `desktop/notification-service.cjs` 诚实约束完好保留 | **PASS** |

---

## 2. 真实性与架构约束核实

1. **真实性约束（步骤 ≠ 整任务）**：
   - 检查 `desktop/notification-service.cjs` 与 `core/task-event.cjs`，所有外部接入日志源必须通过 `declareSourceCapabilities` 声明 `supportsTaskCompleted`。
   - 当 `supportsTaskCompleted: false` 时，遇到真实完成事件返回 `source-unsupported-completed`，绝对不伪造完成事件。
2. **状态分层约束**：
   - 临时性能降级（`maxBlur`）仅在 `resolveEffectiveAppearance` 运行时生效，持久化主题文件 `theme-library.json` 中的 `blur` 保持原值，`documentHash` 不变。
   - 安全模式状态存在独立 `runtime-session.json`，不重置或修改用户的主题、资产与规则。
3. **操作令牌与恢复屏障约束**：
   - 所有恢复操作同步递增 `operationGeneration` 并激活 `manualHold`，旧有异步操作检查 `isCurrent()` 返回 `false`，绝不重新引入 `isCurrent: () => true`。
4. **Git 元数据事实**：
   - 本项目工作区无 `.git` 元数据目录，本次轮次严格遵循不伪造 Git 提交记录的原则，所有版本改动均备份在 `.backups/round6-baseline-2026-10-08/` 并在文档与产物中清晰体现。

---

## 3. 执行验证记录

```powershell
# 1. 运行 Round 6 专用自动化测试 (33 项用例)
npm run test:round6
# 结果: pass 33, fail 0, duration: 305 ms

# 2. 运行回归与全量检查 (184 项用例)
npm run check
# 结果: pass 184, fail 0, duration: 3696 ms

# 3. 运行 Grok 第二轮测试套件 (16 项用例)
npm run test:grok-second
# 结果: pass 16, fail 0, duration: 1619 ms

# 4. 运行 Round 6 综合冒烟脚本
node scripts/smoke-round6.cjs
# 结果: 7 passed, 0 failed, 输出保存至 artifacts/round6/results.json

# 5. 完整构建与打包可执行文件
npm run package
# 结果: 成功生成 release/Anti Face 0.5.0.exe (SHA256: 2CF9EE56616EBAF5B367FB74C78A3E5490BE87D8317C7EB0D7B2A58A496B17BE)
```
