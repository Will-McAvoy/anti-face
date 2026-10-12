# 第五轮缺陷修复与全量回归测试报告 (Round 5 Fix Test Report)

> 历史文档。这里的 131 项和「100% 通过」是 2026-10-06 的记录，不能当作 v0.4.2 的当前状态。当前命令和退出码见 `docs/GROK-SECOND-FIX-TEST-REPORT.md`。

**测试执行环境**:
- **操作系统**: Windows 11 (10.0.26200)
- **Node.js**: v24.16.0
- **npm**: 11.13.0
- **工作目录**: `D:\onedrive\work\hermes\anti_face`
- **执行时间**: 2026-10-06 14:00 - 14:15 CST

---

## 1. 测试套件执行记录与日志汇总

### 1.1 `npm run check` (构建与全量单元测试)
- **命令**: `npm run check` (包含 `tsc --noEmit && vite build` 以及 `npm test`)
- **执行结果**: `Exit code: 0`
- **总测试数**: 131 tests
- **通过**: 131
- **失败**: 0
- **耗时**: ~4.5s
- **关键断言覆盖**:
  - TypeScript 类型检查零错误，Vite 构建生产包成功输出 `dist/`。
  - 核心架构断言：T01–T30 基础外观/定时/快捷键/通知全部通过。
  - 边界隔离：F4 规模验收（10,000 条历史记录筛选、翻页与 CSV 导出实测 <300ms）。
  - Chromium 实际渲染断言：真实计算样式对比与两页截图像素差异校验通过。
  - R01–R06 修复用例全部包含并在全量测试中通过。

### 1.2 `npm run test:round5:fix` (专项缺陷与集成链)
- **命令**: `npm run test:round5:fix` (`node --test tests/round5-fix.test.cjs`)
- **执行结果**: `Exit code: 0`
- **总测试数**: 16 tests
- **通过**: 16
- **失败**: 0
- **耗时**: ~265ms
- **详细子项清单**:
  ```
  ✔ R01: 阅读保护不依赖配色生成，独立从 asset 读取并分析图像 (42.2ms)
  ✔ R02: 自动场景异步等待期间发生 manual hold，旧任务必须作废且不注入 (0.6ms)
  ✔ R03: 每个目标窗口使用自己的 activeDocument，场景切换不串用全局草稿 (0.3ms)
  ✔ R04: 截图清除或切换窗口使在途截图失效，替换 after 正确计算字节 (0.7ms)
  ✔ R05: 恢复与保存主题遇到历史记录磁盘错误时，返回明确失败/事务状态，不报整体成功 (0.4ms)
  ✔ R06: 配色 Worker 超时与取消使用 settle-once，Promise 正确结束且 jobs 彻底清空 (22.5ms)
  ✔ X01: 导入图 -> 直接开启保护 -> 重启 -> 再开启（不依赖配色生成） (14.0ms)
  ✔ X02: 场景慢计算 -> 手动恢复 -> 旧结果返回（零旧注入，不覆盖恢复） (0.4ms)
  ✔ X03: A/B 不同主题 -> 各自导航 -> 切界面（各目标文档、场景、样式一致） (0.4ms)
  ✔ X04: 截图 -> 清除/切目标 -> 旧返回（UI 和后台缓存都不复活） (0.3ms)
  ✔ X05: 版本保存磁盘失败 -> 重启 -> 重试（文档与历史状态明确、幂等） (12.6ms)
  ✔ X06: 静默 worker -> 超时 -> 再生成（请求结束，第二次正常工作） (36.0ms)
  ✔ X07: 阅读保护＋场景＋主体构图同时开（有效模型与锁定生效） (1.6ms)
  ✔ X08: 用户改过精选主题 -> 更新失败（用户副本与资产不丢，明确提示） (18.8ms)
  ✔ X09: 项目识别变 unknown -> 原 targetId 复用（不沿用旧项目和截图） (0.7ms)
  ✔ X10: 只恢复某区域 -> 其他区域不变，基线完全保留 (1.3ms)
  ```

### 1.3 `npm run test:round5` (Round 5 核心场景套件)
- **命令**: `npm run test:round5` (`node --test tests/round5-core.test.cjs tests/round5-services.test.cjs tests/round5-scenarios.test.cjs tests/round5-render.test.cjs`)
- **执行结果**: `Exit code: 0`
- **总测试数**: 26 tests
- **通过**: 26
- **失败**: 0
- **耗时**: ~15.6s
- **关键断言覆盖**:
  - 阅读对比度 21:1 / 1:1 双向独立校验。
  - 亮点图与高对比局部亮度分析。
  - Chromium 真实渲染两页不同样式截图像素哈希差异比对。
  - 场景迟滞（Hysteresis）算法。
  - 核心 E01–E12 场景无回归。

### 1.4 桌面端多版本集成冒烟测试
- **`npm run test:desktop`**: 
  - 结果：`Exit code: 0`
  - 日志：`PASS: desktop UI, filtering, persistence, wallpaper, JSON import/export, IPC validation, renderer isolation, telemetry, history export, process restart`
- **`npm run test:desktop:round3`**: 
  - 结果：`Exit code: 0`
  - 日志：`PASS: real desktop IPC/UI selects, probes, applies and restores B; A isolation; rapid selection; idle disconnect/reconnect; missing/corrupt statistics display`
- **`npm run test:desktop:round4`**: 
  - 结果：`Exit code: 0`
  - 日志：`PASS: round4 desktop defaults, region editor, library, import error, mini window`
- **`npm run test:desktop:round5`**: 
  - 结果：`Exit code: 0`
  - 日志：`PASS: round5 readability page, diagnostics, offline catalog install`
- **`npm run test:desktop:round5:e2e`**:
  - 结果：`Exit code: 0`
  - 覆盖步骤：真实 Electron 界面按钮驱动链路 E01 至 E12 全部无假冒通过。
  - 日志：`PASS: round5 button chain E01-E12 on simulated host`

---

## 2. 真实宿主与模拟宿主说明 (Host Testing Disclosure)

根据项目规范对宿主测试环境的诚实披露要求：
1. **自动化测试环境**：
   - 包含真实的 Chromium 渲染测试（读取真实计算样式 `getComputedStyle`、DOM 几何与真实截图像素差异）。
   - 包含真实的本地 Electron 进程、IPC 管道、Preload 与 Main 进程通信。
   - 宿主端采用符合 Antigravity 协议的受控 Mock Host（`tests/fixtures/desktop-round5-host.cjs`），模拟 CDP 协议、注入样式、会话租约与故障场景。
2. **生产实机宿主说明**：
   - 本测试报告中的 131 项单元测试及 5 项端到端冒烟测试均已在 Chromium/Electron 模拟协议下 100% 验证通过。
   - 真实商业版 Google Antigravity 实机联调需在用户物理宿主窗口运行时进行最终人工核验（详见 Release Notes）。

---

## 3. 最终产物检验报告

- **构建命令**: `npm run package`
- **校验脚本**: `node scripts/verify-round5-package.cjs`
- **校验输出**:
  ```json
  {
    "version": "0.4.1",
    "exe": "release\\Anti Face 0.4.1.exe",
    "bytes": 101637220,
    "sha256": "fa58b432c4ba483d78a50bf7bffd184fd846f2e69164e9fe740c9515aa376895",
    "comparedSources": 59,
    "frontendAssets": [
      "assets/index-s_7TaZAs.js",
      "assets/index-Bj2m9pDA.css"
    ],
    "catalogItems": 20,
    "portableShell": "未在本脚本启动便携外壳，只核对 win-unpacked 与 EXE 哈希",
    "checkedAt": "2026-10-06T06:13:39.230Z"
  }
  ```

测试结论：所有回归测试与缺陷验收 100% 通过，系统状态优良。
