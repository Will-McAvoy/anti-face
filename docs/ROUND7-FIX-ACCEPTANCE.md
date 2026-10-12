# Anti Face 0.6.1 验收报告 (ROUND7-FIX-ACCEPTANCE)

- **验收日期**：2026-10-12
- **验收对象**：Anti Face 0.6.1（第七轮核心修正交付）
- **基线版本**：0.6.0
- **当前状态**：**已全部验收通过 (ACCEPTED)**

---

## 一、验收矩阵与核对清单

| 修正项 | 核心要求与门槛 | 验证依据与测试手段 | 验收结果 |
|---|---|---|---|
| **R01 应用前变化摘要与确认协议** | 1. 消除参数错位与序列化异常；<br>2. 核心与渲染层使用统一单一协议；<br>3. 原生基线诚实标为 `native`；<br>4. 生成确认令牌并存入主进程有限会话；<br>5. 提交确认原子消费，过期或二次提交拒绝。 | - `scripts/review-060-ui.cjs` -> `previewOk: true`<br>- `tests/round7-fix.test.cjs` R01 PASS<br>- `scripts/smoke-round7-fix.cjs` 与 packed 脚本验证真实 Electron IPC 与重复提交拦截。 | **通过** |
| **R02 壁纸轮换接通有效外观链** | 1. `Round5Service.contextFor` 传递轮换覆盖；<br>2. 图像分析与生成的 CSS 必须针对同一轮换资产；<br>3. 原始用户主题 JSON 保持未变，不产生虚假版本。 | - `scripts/review-060.cjs` -> `requestedAssetId === resolvedAssetId`<br>- `tests/round7-fix.test.cjs` R02 PASS<br>- Chromium DOM 背景层样式渲染核对。 | **通过** |
| **R03 轮换事务守卫与安全回滚** | 1. 异步阶段断点通过 `isCurrent()` 检测 `manualHold`、实例变化或一键恢复并即时取消；<br>2. 迟到轮换 0 写入；<br>3. 失败时不提交持久租约并清除临时占用；<br>4. 原生目标窗口保护。 | - `scripts/review-060.cjs` -> `writesAfterRestore: 0`, `returnedOk: false`<br>- `tests/round7-fix.test.cjs` R03 PASS<br>- 验证失败状态与日志准确记录。 | **通过** |
| **R04 自动备份托管索引与安全保留** | 1. 建立 `managedBackups` 托管索引并持久化；<br>2. 仅对托管备份执行清理，绝不删除外部手工或异常伪造文件；<br>3. 强制保底保留至少 1 份经过校验的有效备份；<br>4. 刚导出的备份受严格保护不被立即淘汰。 | - `scripts/review-060.cjs` -> `newBackupStillExists: true`, `corruptUnownedFileKept: true`<br>- `tests/round7-fix.test.cjs` R04 PASS<br>- 越界时间戳钳制测试通过。 | **通过** |
| **R05 标签与局部复制完整链路** | 1. 规范化导出受控复制白名单；<br>2. 主进程安全校验与预检；<br>3. 标签在主题库、重启、备份导出与恢复全生命周期完整持久化。 | - `tests/round7-fix.test.cjs` R05 PASS<br>- `ThemeLibrary` 500 主题压力夹具通过<br>- 真实 Electron 中验证 `copyThemeParts` IPC 预检。 | **通过** |
| **R06 真实端到端打包与执行验证** | 1. 自动化全量回归 100% 通过；<br>2. 不放宽或删除任何旧有断言；<br>3. 真实启动打包后的 `release/win-unpacked/Anti Face.exe`；<br>4. 产出正式便携版 0.6.1 EXE 并记录 SHA-256。 | - `npm run check`: 260/260 全部通过 (11.6s)<br>- `scale.test.cjs`: 364ms 性能达标<br>- `npm run smoke:round7:fix:packed`: 真实打包 EXE 启动与功能验证通过。 | **通过** |

---

## 二、交付物与完整性校验

### 1. 生产交付产物

| 文件路径 | 类型 | 大小 | SHA-256 校验码 |
|---|---|---|---|
| `release/Anti Face 0.6.1.exe` | Windows 便携版独立可执行文件 | 约 101 MB | `d6a4384695107390f607b58f46de80d4137b3d5930e01dcb9f7718aa2ec5319c` |
| `release/win-unpacked/Anti Face.exe` | Windows 解包版主执行文件 | 234.34 MB | 与便携版打包资源完全一致 |
| `release/SHA256SUMS.txt` | 官方版本哈希清单 | 1119 字节 | 包含 0.1.0 ~ 0.6.1 完整历史条目 |

### 2. 核心测试与冒烟记录

- 单元与集成测试：`npm test` 260 项通过。
- Dev Electron 冒烟报告：`artifacts/smoke-round7-fix.json`。
- Packaged Electron 冒烟报告：`artifacts/smoke-round7-fix-packed.json`。
- 历史 Review 观察记录：`artifacts/review-060-ui.json` 与控制台回执完整保存。

---

## 三、结项结论

第七轮修正任务围绕 **0.6.0 发现的核心缺陷** 进行了系统性的链路梳理与修复，彻底消除了序列化失败、管线脱节、迟到竞态与保留误删等根本性问题，并在真实 Electron 与打包二进制中闭环证明。**Anti Face 0.6.1 准予正式结项交付**。
