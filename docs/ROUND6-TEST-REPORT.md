> 历史记录（v0.5.0）：原“7/7、100% PASS 即全部完成”的结论已被 2026-10-08 独立复核取代。本文件保留当时记录，不代表当前验收；当前以 [0.5.1 修复报告](ROUND6-FIX-REPORT.md)、[分层验收](ROUND6-FIX-ACCEPTANCE.md) 和 [实测报告](ROUND6-FIX-TEST-REPORT.md) 为准。旧复核失败材料保持原样。

# Anti Face 第六轮测试报告 (v0.5.0)

**测试日期**：2026-10-08（Asia/Taipei）  
**测试版本**：v0.5.0 (从 v0.4.3 升级)  
**操作系统**：Windows 11 (win32 x64)  
**Node.js 版本**：v24.x  
**打包产物**：`release/Anti Face 0.5.0.exe`  
**SHA256**：`2CF9EE56616EBAF5B367FB74C78A3E5490BE87D8317C7EB0D7B2A58A496B17BE`  

---

## 1. 测试概要

| 测试套件 | 测试文件 | 测试用例数 | 通过数 | 失败数 | 执行耗时 | 状态 |
|---|---|---|---|---|---|---|
| **全量自动化套件 (`npm run check`)** | `tests/*.test.cjs` (含旧版与Round 6) | 184 | 184 | 0 | 3696 ms | **100% 通过** |
| **Round 6 专用套件 (`npm run test:round6`)** | `tests/round6-*.test.cjs` | 33 | 33 | 0 | 305 ms | **100% 通过** |
| **Grok 第二轮回归套件 (`npm run test:grok-second`)** | `tests/grok-second-fix.test.cjs` | 16 | 16 | 0 | 1619 ms | **100% 通过** |
| **v0.4.3 核心回归套件** | `tests/v043-regression.test.cjs` | 4 | 4 | 0 | 1901 ms | **100% 通过** |
| **综合功能冒烟核验 (`scripts/smoke-round6.cjs`)** | F01 - F07 综合冒烟脚本 | 7 项 | 7 项 | 0 | 150 ms | **100% 通过** |

---

## 2. Round 6 专项目标覆盖矩阵 (F01 - F07)

### F01：一键恢复与安全启动 (`tests/round6-recovery.test.cjs`)
- [x] **正常退出与崩溃计数检测**：`SafeLaunchManager` 正常退出调用 `recordCleanExit()` 清零失败计数；连续 2 次非正常退出触发安全模式（`reason: CONSECUTIVE_UNRECOVERED_CRASHES`）。
- [x] **命令行强制安全模式**：CLI 参数 `--safe-mode` 强制进入安全模式（`reason: CLI_FLAG`）。
- [x] **恢复屏障与代际锁**：`restoreAll()` 即刻提升 `operationGeneration` 并激活 `manualHold`，在途慢操作令牌立即失效。
- [x] **结构化状态真实报告**：成功返回各目标独立状态（`restored`, `disconnected`, `failed`），部分故障时汇总报告为 `partial`，绝不虚报全量成功。

### F02：编辑撤销/重做完善与基线 (`tests/round6-edit-history.test.cjs`)
- [x] **手势聚合**：滑块连续拖拽与焦点拖拽在 `beginGesture` 到 `endGesture` 间只生成一条撤销记录。
- [x] **手势取消**：`cancelGesture` 立即复原手势前文档且不污染撤销栈。
- [x] **键盘微调合并**：500ms 内对同字段的连续调整自动合并为单步撤销。
- [x] **恢复初始基线**：`revertToBaseline` 一键重置为会话打开时的基线状态，同时将重置动作入栈，支持再次 Undo 找回。
- [x] **历史资产保护**：`referencedAssetIds()` 收集当前文档、基线、在途手势、撤销栈与重做栈引用的所有壁纸 assetId。
- [x] **主题切换隔离**：载入不同主题 ID 时清空旧栈并建立新基线，防止跨主题撤销串用。

### F03：主题快速切换器 (`tests/round6-switcher.test.cjs`)
- [x] **IPC 权限隔离**：`switcher` 角色只允许调用 `SWITCHER_CHANNELS` 白名单通道，被坚决拒绝访问敏感管理通道（如 `backup:export`, `save-theme`）。
- [x] **纯内存搜索与防注入**：特殊字符、HTML 标签与正则特殊符号不产生崩溃或副作用。
- [x] **多目标独立性**：快速切换器仅对指定窗口应用主题，其他窗口保持原样。
- [x] **竞态与冲突防护**：目标窗口处于 `manualHold` 或更高代际时，快速切换器操作安全拒绝。

### F04：多显示器与 DPI 适配 (`tests/round6-display.test.cjs`)
- [x] **4 套坐标系精确换算**：DIP、Physical Pixels (DPR 1.5/2.0)、CSS Pixels、CDP Screenshot Pixels 互转无损。
- [x] **负坐标系支持**：副屏置于主屏左侧 (例如 x = -1920) 或上方时的正负边界转换精度一致。
- [x] **智能 WorkArea 夹持**：离线屏幕上的窗口安全救回至主屏幕居中；拖出屏幕上方的窗口确保标题栏至少留在可见区域内。
- [x] **视口与 DPR 指纹**：`computeDisplayContextHash` 准确反映屏幕拓扑和缩放变动。

### F05：完整备份与迁移 (`tests/round6-backup.test.cjs`)
- [x] **零依赖 PKZip**：利用 Node 24 原生 `node:zlib` 进行标准 ZIP 压缩与解压，CRC32 校验一致。
- [x] **路径穿越与恶意输入拦截**：`isSafeRelativePath` 彻底阻断 `../`、绝对路径、Windows 驱动器盘符、空字节及控制字符。
- [x] **三阶段恢复**：
  - 阶段 A：只读审查 `manifest.json` 与 SHA256 哈希，解码图片资源文件头。
  - 阶段 B：冲突预览，准确区分新增、相同与冲突主题。
  - 阶段 C：原子事务提交。`keep-both` 自动重命名保留双份；`overwrite` 覆盖已有主题。
  - 事务回滚：写入异常时自动恢复备份副本，主题库与偏好不损坏。

### F06：性能自适应 (`tests/round6-performance.test.cjs`)
- [x] **纯函数迟滞与冷却状态机**：单次卡顿不降级；连续 3 次恶劣采样 (>33.3ms) 触发降级；连续 15 次稳定采样恢复；强制 10 秒冷却防止振荡。
- [x] **电源感知**：电池供电时自动切入 `powersave` 档位。
- [x] **无侵入运行时截断**：`resolveEffectiveAppearance` 对 `wallpaper.blur` 与各区域 `blur` 施加档位上限（轻量模式 12px，省电模式 8px）；原持久化主题文档 JSON 绝对不被修改。

### F07：任务完成提醒规则与真实性约束 (`tests/round6-notifications.test.cjs`)
- [x] **来源真实性约束**：未声明 `supportsTaskCompleted: true` 的数据源发来真实完成事件，被直接拒绝并返回 `source-unsupported-completed`，保留原日志源诚实性约束。
- [x] **跨午夜勿扰时段**：`22:30` 至 `07:30` 在夜间 23:00 与凌晨 03:00 判定为静音。
- [x] **暂停 30 分钟**：在暂停窗口期内提醒被抑制，过期后自动恢复。
- [x] **前台聚焦抑制**：前台聚焦时桌面通知横幅静默，音效按设置保留。
- [x] **测试通道专用隔离**：测试音效与提醒不产生假完成记录，不污染去重缓存，忽略免打扰静音。

### 跨功能综合场景验证 (`tests/round6-cross-scenarios.test.cjs`)
- [x] **Cross 1**：一键恢复屏障即时作废在途的快速切换器慢注入。
- [x] **Cross 2**：快速切换器在省电模式下应用主题，有效外观限制模糊而原文档保持全保真。
- [x] **Cross 3**：负坐标多显示器下快速切换器居中展开与 DPI 变更加密指纹。
- [x] **Cross 4**：备份恢复与撤销历史资产保护联动。
- [x] **Cross 5**：安全模式阻止自动应用，用户手动恢复后干净重置。

---

## 3. 性能与规模实测基准 (Scale Benchmark)

在 `round4.test.cjs` 历史审计规模基准上对 10,000 条真实记录进行实测：

```
[Scale Benchmark] 10,000 记录实测耗时:
- 写入 10,000 条: 56.1 ms
- 筛选与首批查询: 71.9 ms
- 翻页查询 (Page 5): 71.9 ms
- 筛选导出 CSV: 100.0 ms
✔ F4 规模验收: 10,000 条记录下筛选、翻页和导出可用并报告实际耗时 (350.0253ms)
```

全流程耗时 350 ms，性能优异。

---

## 4. 打包产物核验

- **打包命令**：`npm run package`（执行 `tsc --noEmit && vite build` 后调用 `scripts/package.mjs`）
- **打包器**：`electron-builder 26.15.3`
- **生成产物**：`release/Anti Face 0.5.0.exe` (便携版 Portable 单可执行文件)
- **文件大小**：101,670,768 字节 (~101.6 MB)
- **SHA-256 哈希值**：`2CF9EE56616EBAF5B367FB74C78A3E5490BE87D8317C7EB0D7B2A58A496B17BE`
- **ASAR 完整性**：
  - `release/win-unpacked/resources/app.asar` (34,946,704 字节)
  - 解压目录 `app.asar.unpacked` 包含 wasm、音效与工作进程依赖，符合 `package.json` 中的 `asarUnpack` 规则。
