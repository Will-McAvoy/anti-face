# Anti Face

**为 Antigravity Desktop Windows 客户端提供主题定制、阅读外观调整与任务 / Token 观测的本地桌面工具。**

你可以用它管理主题与壁纸、预览外观变化、查看宿主提供的任务和用量数据，并保存本地使用历史。项目采用 Electron、React、TypeScript 和 Vite 开发，使用 [MIT 许可证](LICENSE)。

当前版本：**v0.6.3**。

[下载安装包](https://github.com/Will-McAvoy/anti-face/releases/download/v0.6.3/Anti.Face.0.6.3.exe) · [发布说明](https://github.com/Will-McAvoy/anti-face/releases/tag/v0.6.3) · [版本与验证记录](docs/STATUS.md)

## 下载与使用

适用于 **Windows 10 / 11 x64**。使用已打包的便携版无需安装 Node.js；从源码开发时才需要 Node.js。

1. 在 [Releases](https://github.com/Will-McAvoy/anti-face/releases) 下载 `Anti.Face.0.6.3.exe`，双击运行。
2. 在「主题与外观」中选择主题、调整壁纸与排版，预览效果。
3. 使用宿主相关功能时，先启动 Antigravity Desktop，再到「连接与兼容」检测并选择目标窗口。
4. 应用外观前查看变化摘要，确认后再应用；需要还原时对当前窗口使用恢复功能。

安装包尚未做代码签名，首次运行 Windows 可能提示未知发布者。请核对下载来源及本文末尾的 SHA256。

## 主要功能

| 功能 | 说明 |
| --- | --- |
| 主题与外观 | 内置主题、分区域样式、壁纸与排版调整，提供性能优先、平衡、视觉优先三档预设 |
| 主题管理 | 另存、收藏、标签筛选、导入导出、局部复制，以及编辑撤销与重做 |
| 阅读与精选 | 20 套精选壁纸与预览，提供阅读外观调整；加入精选不会自动换肤 |
| 壁纸轮换 | 从本地文件夹轮换壁纸，可将当前效果存入主题 |
| 任务与 Token 观测 | 展示宿主提供的任务状态、用量、输出延迟和区间速率，标明数据新鲜度与可用性 |
| 历史与趋势 | 可选择启用本地历史记录，按日期、模型和项目筛选，导出 CSV / JSON |
| 恢复与备份 | 多窗口管理、恢复原样、可选的刷新后主题恢复、自动备份与安全模式 |

实时试穿默认关闭，只作用于当前选中的窗口；取消会恢复试穿前的外观。自动主题切换、托盘、全局快捷键、迷你窗和提示音也默认关闭，可按需启用。

## 当前验证范围

v0.6.3 的 [GitHub Actions 构建与测试](https://github.com/Will-McAvoy/anti-face/actions/runs/38250812117)已通过，项目包含 275 项自动化测试，并有开发态及解包程序的冒烟验证记录。

**目前尚未完成连接真实 Antigravity Desktop 的换肤验收。** 自动化测试和模拟宿主结果不能代替真实宿主验证，使用前请查看 [兼容性与遥测说明](docs/TELEMETRY-CAPABILITIES.md)。

Token 观测依赖宿主实际暴露的数据。当前没有逐 Token 的流式毫秒时间戳，速率按有效区间计算；无法可靠判断整个任务完成时，不会自动发出完成提示。主题和壁纸只改变外观，不能加快模型推理。

## v0.6.3 更新

- 按宿主文件变化缓存版本与 SHA256，减少重复读取 app.asar。
- 调试端口归属缓存延长到 30 秒，连接失败后立即清除。
- 宿主关闭但遗留调试端口文件时，显示可读的重新启动提示。
- 重新生成 20 套精选壁纸及预览，完善 Windows 构建与测试配置。

详细记录见 [0.6.3 发布报告](docs/V0.6.3-RELEASE-REPORT.md)；历史版本见 [docs/STATUS.md](docs/STATUS.md)。

---

## 从源码运行

**系统要求**：Windows 10/11 64位，Node.js 22.12+（推荐 Node.js 24）。

```powershell
npm ci
npm run dev
```

仅预览网页版：
```powershell
npm run dev:web
```

生产构建与启动桌面应用：
```powershell
npm run build
npm start
```

---

## 功能详细说明

### 1. 主题与外观 (Studio)
- 包含 15 套精选主题（深色、浅色、玻璃风格）。
- 新增**三档性能预设**：
  - **性能优先**：模糊 0px，不透明度 90%，圆角 8px，完全关闭磨砂开销，长时工作首选；
  - **平衡**：模糊 12px，不透明度 75%，圆角 16px，柔和磨砂与适度过渡；
  - **视觉优先**：模糊 24px，不透明度 64%，圆角 24px，质感磨砂。
- 支持自定义壁纸（PNG/JPG/WebP，上限 5 MB），支持配置导入导出。

### 2. 实时任务状态与 Token 监控 (Realtime)
- **任务阶段**：通过状态机严密追踪 `空闲中 (idle)`、`排队中 (queued)`、`运行中 (running)`、`生成中 (generating)`、`工具调用中 (tool_running)`、`等待用户 (waiting_user)`、`已完成 (completed)` 等状态，终态不可逆。
- **输出延迟与速率**：
  - 首段输出延迟：从用户提交到首个可见输出事件的毫秒间隔；
  - 平均输出速率：有效输出区间内的实际 tok/s；
  - 滚动速度：最近 5 秒的实时增量速率；
  - *当前宿主限制说明*：Antigravity 当前版本未暴露逐 Token 的流式分片毫秒时间戳，系统如实提示并基于步骤有效区间计算，不使用随机数伪造曲线。
- **Token 细分**：
  - 输入 Token (非缓存) 与缓存输入 Token；
  - 真实缓存命中率 = `cached / (input + cached)`；
  - 输出 Token 与思考/推理 Token（输出已包含思考 Token，绝不重复相加）。
- **数据来源切换**：提供“真实 Antigravity 宿主观测”与“测试模拟数据 (Fixture)”快速切换，便于演示与验证。

### 3. 本地历史与使用趋势 (History)
- **隐私保护**：默认关闭历史持久化采集；用户在界面显式勾选“启用本地历史记录”后方写入数据。
- **零敏感数据**：仅保存脱敏的数字用量指标、模型名、项目名与耗时；绝不读取或保存用户的提问、回答正文、源代码或 API 密钥。
- **多维筛选与分页**：支持今日、近 7 天、近 30 天或全部，支持模型、项目筛选与翻页浏览。
- **导出与防注入**：支持一键导出 CSV 和 JSON，CSV 自动对以 `=`、`+`、`-`、`@` 开头的字符串转义，彻底防范电子表格公式注入漏洞。
- **保留周期与清理**：7 / 30 / 90 天只是手动清理阈值，不会在查询、导出或重启时自动删记录。`maxRecords` 才是追加后的自动安全上限。可按该阈值清理，或清空全部历史。

### 4. 换肤恢复与多窗口管理 (Connection)
- **多窗口管理**：每个已验证窗口单独持有连接、会话和主题。窗口标题只截断到 50 个字符，不会改写成匿名标题。恢复按钮作用于当前选中窗口；“恢复全部窗口”是单独操作。
- **刷新后自动恢复**：提供“宿主刷新后自动恢复主题”开关（默认关闭）。内置 `generationToken` 竞态防护：若用户在重试等待期间手动点击“恢复原样”，正在进行的自动恢复立即失效，决不会反向重新上色。
- **升级保护**：每次操作前强校验宿主版本与 app.asar SHA-256 二进制哈希，检测到客户端升级或哈希变化立即挂起并暂停注入。

---

## 验证与自动化测试

当前 `npm test` 共 275 项单元/回归测试（含 Playwright Chromium 渲染测试，首次需 `npx playwright install chromium`）。夹具通过不等于真实 Token 语义已经核对。机器负载很高时 Chromium 测试可能超时，可用 `node --test --test-concurrency=2 tests/*.test.cjs` 降低并发。

```powershell
npm run check              # TypeScript、Vite 生产构建、单元与回归测试
npm run test:round5        # 第五轮纯函数、服务、场景和 Chromium 渲染
npm run test:desktop       # Playwright：主题、实时、历史导出、进程重启、旧配置迁移、无 preload
npm run test:desktop:round5
node scripts/smoke-round5-e2e.cjs   # 模拟宿主上的按钮链路。不是真实 Antigravity 验收
node scripts/accept-round5-host.cjs # 没有指定窗口时拒绝换肤，不伪造通过
node scripts/smoke-packed.cjs
node scripts/verify-round5-package.cjs
npm run verify:host        # 真实 Antigravity 上应用主题并恢复外观；本轮没有代跑
npm run package            # 用当前源码打 Windows x64 便携版
```

---

## 目录结构

```text
anti_face/
├─ src/
│  ├─ App.tsx                     工作室、实时监控、历史趋势、连接诊断四大导航面板
│  ├─ components/
│  │  ├─ AppearancePanel.tsx       外观与三档性能预设面板
│  │  ├─ RealtimePanel.tsx         F1/F2/F3 实时任务状态与 Token 监控组件
│  │  ├─ HistoryPanel.tsx          F4 本地历史、筛选、导出与清理组件
│  │  ├─ Preview.tsx               实时示意预览组件
│  │  ├─ ThemeCard.tsx             主题卡片
│  │  └─ ErrorBoundary.tsx         全局错误边界
│  ├─ adapters/desktop.ts          前端桌面 IPC 适配层
│  ├─ lib/settings.ts              设置校验与图片读取
│  └─ types.ts                     全量 TypeScript 接口定义
├─ core/
│  ├─ metrics.cjs                  F2/F3 纯函数指标计算 (延迟、平均速度、滑动窗口、缓存/推理口径)
│  ├─ state-machine.cjs            F1 任务 9 状态转移模型与多工具并发追踪
│  ├─ theme.cjs                    主题校验、性能预设与 prefers-reduced-motion CSS 生成
│  ├─ runtime.cjs                  DOM 探针、可撤销样式注入与租约续期表达式
│  └─ compatibility.cjs            版本与二进制哈希强校验
├─ desktop/
│  ├─ main.cjs                     Electron 主进程、安全 IPC 校验、退出清理
│  ├─ preload.cjs                  受限 contextBridge 白名单
│  ├─ host.cjs                     宿主安装检测、DevTools 端口归属验证
│  ├─ cdp.cjs                      本机 CDP 通信
│  ├─ theme-service.cjs            多窗口管理、有界自动恢复、端口缓存
│  ├─ history-storage.cjs          UserData JSONL 存储、损坏隔离、CSV/JSON 导出
│  ├─ telemetry-sources.cjs        CDP 状态与 stats 缓存文件多源遥测聚合
│  └─ settings.cjs                 原子设置持久化
├─ compatibility/                  兼容清单与最新实测证据
├─ docs/
│  ├─ ROUND2-PLAN.md               第二轮升级执行计划
│  ├─ ROUND2-ACCEPTANCE.md         第二轮升级验收矩阵与测试证据
│  ├─ CONFLICT-RECOVERY.md         OneDrive 冲突文件归档与恢复报告
│  ├─ TELEMETRY-CAPABILITIES.md    宿主遥测数据能力调查报告
│  ├─ ARCHITECTURE.md              系统架构与模块边界
│  ├─ STATUS.md                    当前完成情况与边界说明
│  ├─ V0.4.3-FIX-REPORT.md         0.4.3 三项修复与交付结果
│  ├─ V0.4.3-TEST-REPORT.md        0.4.3 实际命令、包与运行证据
│  ├─ ROUND5-ARCHITECTURE.md       第五轮模块、schema 和优先级
│  ├─ ROUND5-FIX-ACCEPTANCE.md     第五轮缺陷修复与全链路验收证据
│  ├─ ROUND5-FIX-TEST-REPORT.md    全量测试报告与命令日志
│  ├─ ROUND5-FIX-RELEASE-NOTES.md  0.4.1 用户发布说明
│  ├─ ROUND5-ACCEPTANCE.md         F01–F10 验收状态 (历史)
│  ├─ ROUND5-TEST-REPORT.md        第五轮初版测试记录 (历史)
│  └─ ROUND5-RELEASE-NOTES.md      0.4.0 用户说明 (历史)
├─ tests/                          单元与专项回归测试，当前 `npm test` 为 275 项
└─ release/                        `npm run package` 输出目录（不入库）
```

---

## 安装包校验与本地产物

- 构建产物（`release/`、`dist/`）和测试日志（`artifacts/`）都不提交到仓库。旧报告里指向这些目录的链接只在本地构建后有效。
- **v0.6.3 发布附件**：`Anti.Face.0.6.3.exe`，178,680,691 字节，SHA256 `0e38fe84b3328252b2edac8c4f39c9652f2d40f52c72b17946bb0a8698777b38`。自行构建的哈希会不同。
- **签名状态**：本地便携版，未配置商业代码签名证书。

## 许可证

本项目采用 [MIT License](LICENSE)，Copyright (c) 2026 Will-McAvoy。
