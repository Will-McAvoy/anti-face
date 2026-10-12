# 架构与维护 (v0.3.0)

## 数据流与系统架构

Anti Face 采用分层解耦架构，严格保持渲染进程隔离与最小权限原则：

```
[React 渲染进程]
   │
   ├─ Studio (外观与 15 主题、性能预设)
   ├─ Realtime (任务状态、速度与 Token 监控)
   ├─ History (历史记录、聚合筛选、CSV/JSON 导出)
   └─ Connection (连接状态、多窗口选择、自动恢复)
   │
   ▼
[src/adapters/desktop.ts]
   │
   ▼
[desktop/preload.cjs (受限 contextBridge 白名单)]
   │
   ▼
[Electron 主进程 IPC 调度与来源校验 (trusted frame & URL)]
   ├──────────────────────────┼─────────────────────────┐
   ▼                          ▼                         ▼
[ThemeService]      [TelemetryManager]          [HistoryStorage]
   │ (多窗口目标管理)           │ (双向观测适配)            │ (UserData JSONL)
   │ (刷新自动恢复防护)         ├─ 宿主 CDP 状态观察         ├─ 单写入队列
   │ (租约心跳与更新保护)       ├─ 结构化统计文件读入        ├─ 尾部损坏隔离
   ▼                          ├─ 会话步骤时序解析          ├─ CSV 公式注入防范
[CDP 仅 127.0.0.1]            └─ 状态机与指标纯函数        └─ 保留策略与清理
   ▼                          (core/state-machine.cjs)
[Antigravity 宿主页面]         (core/metrics.cjs)
```

## 模块边界与职责

| 模块 | 职责与安全边界 |
|---|---|
| `core/theme.cjs` | 主题配置校验、性能预设定义（性能优先/平衡/视觉优先）、`prefers-reduced-motion` 样式生成与合法性约束 |
| `core/metrics.cjs` | 纯函数指标计算：首段延迟、区间平均速度、5s 滚动窗口滑动计算、缓存包含关系、推理拆分、重试追踪与缺失聚合 |
| `core/state-machine.cjs` | 9 种任务阶段合法状态机转移（idle/queued/running/generating/tool_running/waiting_user/completed/failed/cancelled/unknown），终态单向递进不回退，多工具并发追踪 |
| `core/runtime.cjs` | 固定结构 DOM 探针、带唯一所有权的临时样式注入、独立租约与过期自毁 |
| `core/compatibility.cjs` | 版本号与 app.asar SHA-256 二进制哈希双重强校验，更新失效与安全门禁 |
| `desktop/host.cjs` | 安装识别、调试端口归属检查与端口监听进程名核对 |
| `desktop/cdp.cjs` | 仅限 127.0.0.1 的 WebSocket CDP 客户端，支持超时控制、断线重连与优雅降级 |
| `desktop/theme-service.cjs` | 宿主多窗口目标管理（`targetId` 独立状态），可配置的刷新后有界自动恢复，`generationToken` 竞态防护（用户手动恢复优先） |
| `desktop/telemetry-sources.cjs` | 聚合宿主 CDP 状态与 `$USERPROFILE/.gemini/antigravity` 本地统计文件，维护实时指标与阶段视图，支持无外部依赖的 Fixture 测试模式 |
| `desktop/history-storage.cjs` | 安全存储于 Electron `userData/history/`，JSONL 格式单写入队列，原子写入，损坏行隔离诊断，防 CSV 公式注入（`=`/`+`/`-`/`@` 转义），7/30/90 天保留周期管理 |
| `desktop/main.cjs` | 主进程生命周期、主窗口与迷你窗分开的 IPC 权限、关闭到托盘与真正退出、有界退出（最多 6.5 秒） |
| `desktop/studio-service.cjs` | 第四轮外观协调：试穿、主题库、自动切换、托盘、快捷键和提醒都从这里进入同一个样式注入 |
| `core/theme-schema.cjs` | 主题文档、范围、继承和 schema 1 迁移 |
| `core/preview-session.cjs` | 试穿状态机、防抖和迟到响应失效 |
| `core/schedule.cjs` | 本地时间上的定时/系统主题决策，测试注入时钟 |

## 换肤恢复与竞态防护机制 (F5)

1. **多窗口管理**：
   - 枚举已连接宿主的各页面目标，窗口标题脱敏（截断过长文本，避免暴露用户提问）；
   - 各目标独立维护应用状态，切换当前目标不丢失其他目标的换肤与恢复上下文。
2. **刷新后自动恢复**：
   - 默认关闭，需用户显式开启；
   - 依赖目标代数机制 (`generationToken`)：若在目标刷新后等待 DOM 就绪的 10 次有界重试期间，用户点击了“恢复原样”，全局 `generationToken` 立即递增，正在排队的异步重试任务发现代数失效后立即终止，彻底杜绝“用户恢复后又被旧回调重新上色”的竞态漏洞。
3. **性能预设**：
   - **性能优先**：`blur: 0px`, `opacity: 90%`, `radius: 8px`，背景模糊开销降至零，长时工作高效稳定；
   - **平衡**：`blur: 12px`, `opacity: 75%`, `radius: 16px`；
   - **视觉优先**：`blur: 24px`, `opacity: 64%`, `radius: 24px`。

## 遥测与隐私保护规范 (F1 - F4)

1. **真实数据与诚实降级**：
   - 宿主提供精确统计时，如实展示输入、输出、缓存及推理用量；
   - 宿主当前版本未公开逐 Token 毫秒级流式分片时，系统明确告知用户“当前宿主未提供流式时间戳；平均速率基于步骤/会话有效耗时计算”，严禁使用插值或随机数伪造实时曲线；
   - 数据源断开时，状态标记为 `stale` 并保留最后已知更新时间，严禁将断开误判为任务失败。
2. **隐私隔离**：
   - 绝不读取、不传输、不持久化用户的聊天文本、提问内容、回答正文、项目源码或认证令牌；
   - 本地历史仅记录数值指标与脱敏元数据；
   - 本地统计持久化默认关闭，由用户自主决定开启。
