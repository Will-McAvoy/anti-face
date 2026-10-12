# Antigravity 宿主遥测数据能力报告 (TELEMETRY-CAPABILITIES)

第四轮提醒：`desktop/telemetry-sources.cjs` 明确不把单个 `PLANNER_RESPONSE` 的 `DONE` 当成整个任务完成。因此 Anti Face 的完成提示音不会自动触发。只有日志把最后事件标成 `FAILED` 或 `ERROR` 时，失败提醒才可能发出，并且仍受开关、静音和去重限制。断线只标记过期，不当成失败。模拟数据不触发正式提醒。

**调查日期**：2026-10-03  
**宿主版本**：Antigravity Desktop 2.19.1.0 (win32-x64)  
**可执行文件路径**：`%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe`  
**app.asar 指纹**：`341234faf45bd1776fd5418a3c288dedc5487ebfcf153f53d75de17cfe15c1de`  
**调试端口**：`DevToolsActivePort` (本机 127.0.0.1 动态端口，如 3608)  
**用户数据与遥测路径**：
- `%USERPROFILE%\.gemini\antigravity\`
- `%APPDATA%\Antigravity\`

---

## 1. 调查发现与数据源分布

经过对本机运行中 Antigravity 客户端的实地探测与文件系统调查，明确了以下真实数据渠道：

### 1.1 本地结构化统计文件 (`antigravity_stats_cache.json`)
- **路径**：`%USERPROFILE%\.gemini\antigravity\antigravity_stats_cache.json`
- **格式**：JSON，按会话 UUID 索引
- **发现字段**：
  - `convo_id` (会话 UUID)
  - `mtime` (最后修改时间戳)
  - `created_at` / `date` (创建时间与日期)
  - `duration_sec` (总运行时长秒数)
  - `model` (如 "Gemini 3.7 Flash", "Gemini 3.8 Flash (High)")
  - `project` (项目名，如 "hermes")
  - `workspace_path` (工作区路径)
  - `turn_count` (轮数)
  - `input_tokens` (非缓存输入 Token，精确)
  - `cached_tokens` (缓存输入 Token，精确)
  - `output_tokens` (输出 Token，精确)
  - `thinking_tokens` (推理/思考 Token，精确)
  - `total_tokens` (总 Token = input + cached + output)
  - `tool_counts` (各工具调用频次对象)
  - `tool_errors` (工具错误计数)
- **语义确认**：
  - `input_tokens` 与 `cached_tokens` 互斥独立，总输入 = `input_tokens + cached_tokens`；
  - `output_tokens` 包含 `thinking_tokens`；
  - 数据为请求/会话级的累计确认值（Cumulative / Final）。

### 1.2 会话轨迹文件 (`transcript.jsonl`)
- **路径**：`%USERPROFILE%\.gemini\antigravity\brain\<convo-id>\.system_generated\logs\transcript.jsonl`
- **格式**：JSON Lines
- **发现字段**：
  - `step_index` (步骤序号，递增)
  - `source` (`USER_EXPLICIT` / `MODEL` / `SYSTEM`)
  - `type` (`USER_INPUT` / `PLANNER_RESPONSE`)
  - `status` (`DONE` / 等待等)
  - `created_at` (ISO 8601 时间戳，精确到秒)
  - `tool_calls` (工具调用数组)
  - `thinking` (包含思考内容标志)
- **语义确认**：
  - 提供了任务的真实开始时间戳（Step 0 `created_at`）；
  - 提供了每个规划步骤的完成时间与工具调用阶段证据；
  - 未提供逐 Token 的流式分片毫秒级时间戳（Streaming chunk timestamps）。

### 1.3 会话摘要 SQLite 库 (`conversation_summaries.db`)
- **路径**：`%USERPROFILE%\.gemini\antigravity\conversation_summaries.db`
- **格式**：SQLite 3
- **发现字段**：`conversation_id`, `title`, `step_count`, `last_modified_time`, `workspace_uris`, `status`, `project_id`, `not_fully_idle` 等。
- **语义确认**：可用于跨会话快速索引、项目归属与活动状态确认。

### 1.4 本机受控 CDP 连接 (`127.0.0.1:DevToolsActivePort`)
- **端点**：`/json/list`、`WebSocketDebuggerUrl`
- **可获取状态**：
  - 窗口/目标列表及目标 ID (`targetId`)；
  - 页面标题 (`document.title`)，包含当前会话标题与项目别名；
  - 当前 URL (`location.href`)，包含当前活跃的 `convo_id`；
  - 页面渲染状态：DOM 按钮状态、动画加载器状态（`.animate-spin`）。
- **限制与隐私**：仅进行只读元数据与状态观察，不读取聊天正文、不抓取网络敏感凭据。

---

## 2. 字段级数据能力矩阵

| 字段 | 是否可用 | 来源 | 精确/估算 | 实时/最终 | 标识与关联方式 | 限制与降级策略 |
|---|---|---|---|---|---|---|
| **任务开始时间** | **可用** | `transcript.jsonl` (首步 `created_at`) | 精确 | 实时 | 通过 `convo_id` 关联 | 中途接入时显示“已观测耗时”，不冒充完整历史耗时 |
| **阶段：idle** | **可用** | CDP 状态 + `transcript.jsonl` 最新状态 | 精确 | 实时 | `convo_id` + Target | 确认无活跃 step 时为 idle |
| **阶段：generating** | **可用** | CDP DOM 状态 + 活跃 step | 精确观测 | 实时 | Target + `convo_id` | 观察到模型生成中 |
| **阶段：tool_running**| **可用** | `transcript.jsonl` 工具调用未完 + CDP | 精确 | 实时 | Step tool_calls | 多个工具并行时维护活动计数 |
| **阶段：waiting_user**| **可用** | Step status + CDP 输入就绪 | 精确 | 实时 | Step status | 明确等待用户交互 |
| **阶段：completed/failed** | **可用** | Step status / `conversation_summaries.db` | 精确 | 终态 | `convo_id` + step_index | 终态单向递进，不被较旧事件倒退 |
| **模型标识** | **可用** | `antigravity_stats_cache.json` / 配置 | 精确 | 最终/当前 | `convo_id` | 未就绪时显示“—” |
| **输入 Token** | **可用** | `antigravity_stats_cache.json` (`input_tokens`) | 精确 | 最终/累计 | `convo_id` | 非缓存输入，来源口径明确记录 |
| **缓存 Token** | **可用** | `antigravity_stats_cache.json` (`cached_tokens`) | 精确 | 最终/累计 | `convo_id` | 独立非包含，总输入 = input + cached |
| **输出 Token** | **可用** | `antigravity_stats_cache.json` (`output_tokens`) | 精确 | 最终/累计 | `convo_id` | 包含推理 Token |
| **推理 Token** | **可用** | `antigravity_stats_cache.json` (`thinking_tokens`)| 精确 | 最终/累计 | `convo_id` | 来源明确包含在 output_tokens 中 |
| **逐 Token 流式时间戳** | **当前不支持** | 宿主无公开流式 Token 广播 API | 不适用 | 不可用 | 无 | **诚实降级**：不伪造实时平滑速度曲线；依据有效步区间计算请求全程速率，标记“步级/区间输出速率” |
| **首段输出延迟** | **受限支持** | Step 0 到 Step 1 时间戳 (秒级) | 秒级精度 | 步级 | `convo_id` | 标记为“步级输出延迟”，无毫秒 Token 流时不冒用严格 TTFT |
| **项目归属** | **可用** | `antigravity_stats_cache.json` (`project`) / CDP title | 精确 | 实时 | 项目名/工作区 | 无法判定时显示“未知项目” |

---

## 3. 统计口径与计算规则确认

依据上述真实数据 Schema，严格建立纯函数计算口径：

1. **总输入 Token**：
   - 宿主规则：`input_tokens` 为非缓存输入，`cached_tokens` 为缓存输入；
   - 公式：`TotalInput = input_tokens + cached_tokens`；
   - `inputIncludesCached = false`。
2. **缓存命中率**：
   - 公式：`CacheRate = TotalInput > 0 ? (cached_tokens / TotalInput) : null`；
   - 若 `TotalInput === 0`，显示“不适用”；若 `cached_tokens > TotalInput`，标记数据异常。
3. **输出与推理**：
   - 宿主规则：`output_tokens` 包含了 `thinking_tokens`；
   - `outputIncludesReasoning = true`；
   - 可见输出 Token 计算：`VisibleOutput = output_tokens - thinking_tokens`；
   - 合计输出即为 `output_tokens`，绝不重复将 `thinking_tokens` 叠加至 `output_tokens`。
4. **Token 速度口径**：
   - 真实宿主环境下，由于仅提供步骤级与累计确认用量，显示“全程平均输出速率 (tok/s)”，并有明确说明 Tooltip：“宿主未暴露逐 Token 流式时间，速率基于步骤有效输出区间计算”；
   - 在 Fixture/测试模式下，提供完整的逐 Token 事件流以验证 F2.1/F2.2/F2.3 纯函数算法与 5 秒滑动窗口。

---

## 4. 隐私保护边界

1. 不读取、不传输、不保存用户聊天正文、代码、Prompt 或回复内容；
2. 不读取、不持久化任何 API Key、Cookie、Bearer Token；
3. 本地存储仅保存脱敏的数字指标（Token 计数、耗时、模型名、项目别名、状态枚举）；
4. 提供独立的“本地统计持久化”开关，默认关闭，用户开启后方写入 UserData；
5. 关闭统计时立即停止读取与写入任务。

## 5. 2026-10-04 实现边界

上面第 1、2 节是 2026-10-03 对宿主文件的调查，不是本轮又拿一条真实请求对过账。当前代码按下面的规则降级，夹具已覆盖：

- 没有日志、认不出的会话、或没有指标时，阶段是 `unknown`，Token 为 null，并给出原因。不用 `idle` 或 0 填充。
- `USER_INPUT` 表示这一轮已经提交，阶段是 `running`，不是“等待用户”。
- 只有一条 `PLANNER_RESPONSE` 且 `DONE` 时，不能当成整个任务 `completed`。
- 切模式、切窗口、切会话或切请求时清掉上一份指标。缓存键包含来源、目标、会话和文件版本，不能只看全局 mtime。
- `taskId` 按轮次区分，不用会话 id 前 8 位代表每一轮。
- 耗时用可注入的单调时钟。终态冻结。没看到完整起点时标注已观测。
- `capabilities.finalTokens` 只在真实模式且读到累计 Token 时为真。模拟模式固定为 false，避免把 2200 说成宿主累计值。
- 桌面冒烟在 2026-10-04 连上了一个已验证窗口，界面显示状态未知且没有可核对 Token。这只证明空值降级，不证明字段公式在真实数据上再次成立。
