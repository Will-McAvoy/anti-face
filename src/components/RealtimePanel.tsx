import React from 'react';
import { Activity, AlertCircle, Clock, Cpu, Gauge, Info, Layers, RefreshCw, Zap } from 'lucide-react';
import type { TargetWindow, TelemetryState } from '../types';

const PHASE_LABELS: Record<string, { label: string; color: string; desc: string }> = {
  idle: { label: '空闲中', color: '#8b978d', desc: '宿主当前无运行中任务' },
  queued: { label: '排队中', color: '#e5c07b', desc: '任务已提交，等待服务响应' },
  running: { label: '运行中', color: '#61afef', desc: '任务正在执行' },
  generating: { label: '生成中', color: '#c5dba8', desc: '模型正在输出内容' },
  tool_running: { label: '工具调用中', color: '#d19a66', desc: '正在执行本地工具或命令' },
  waiting_user: { label: '等待用户', color: '#98c379', desc: '等待用户确认或输入' },
  completed: { label: '已完成', color: '#98c379', desc: '任务已成功完成' },
  failed: { label: '已失败', color: '#e06c75', desc: '任务执行出错' },
  cancelled: { label: '已取消', color: '#e5c07b', desc: '用户或系统取消了任务' },
  unknown: { label: '状态未知', color: '#5c6370', desc: '无法判断当前状态' }
};

export function RealtimePanel({
  telemetry,
  targets,
  selectedTargetId,
  onSelectTarget,
  onRefresh,
  onToggleMode
}: {
  telemetry: TelemetryState | null;
  targets: TargetWindow[];
  selectedTargetId: string | null;
  onSelectTarget: (targetId: string) => void;
  onRefresh: () => void;
  onToggleMode: (mode: 'host' | 'fixture') => void;
}) {
  if (!window.antiFace) {
    return (
      <div className="empty-state" style={{ padding: '40px', textAlign: 'center' }}>
        <AlertCircle size={24} style={{ margin: '0 auto 12px' }} />
        <p>实时遥测需要桌面版 Anti Face。浏览器预览不能读取宿主任务。</p>
      </div>
    );
  }

  if (!telemetry) {
    return (
      <div className="empty-state" style={{ padding: '40px', textAlign: 'center' }}>
        <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 12px' }} />
        <p>正在读取实时遥测数据…</p>
      </div>
    );
  }

  const { taskState, metrics, capabilities } = telemetry;
  const phaseInfo = PHASE_LABELS[taskState.phase] || PHASE_LABELS.unknown;
  const isFixture = capabilities.provenance === 'fixture';

  const formatTokens = (val: number | null) => {
    if (val == null) return '—';
    return Number(val).toLocaleString();
  };

  return (
    <div className="realtime-dashboard" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 顶部状态与窗口栏 */}
      <div
        style={{
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid var(--line)',
          borderRadius: '12px',
          padding: '16px 20px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '20px',
              background: 'rgba(0, 0, 0, 0.3)',
              border: `1px solid ${phaseInfo.color}`
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: phaseInfo.color,
                display: 'inline-block'
              }}
            />
            <strong style={{ color: phaseInfo.color, fontSize: '13px' }}>{phaseInfo.label}</strong>
          </div>

          {taskState.activeToolsCount > 0 && (
            <span style={{ fontSize: '12px', color: '#d19a66', background: 'rgba(209, 154, 102, 0.15)', padding: '2px 8px', borderRadius: '4px' }}>
              活跃工具: {taskState.activeToolsCount}
            </span>
          )}

          {taskState.isStale && (
            <span style={{ fontSize: '12px', color: '#e5c07b', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <AlertCircle size={14} /> 任务状态已过期 ({taskState.lastUpdateIso ? new Date(taskState.lastUpdateIso).toLocaleTimeString() : '已断开'})
            </span>
          )}

          <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
            {taskState.observedSeconds == null
              ? '耗时 —'
              : taskState.durationKind === 'frozen'
                ? `耗时 ${taskState.observedSeconds} 秒（已冻结）`
                : `已观测 ${taskState.observedSeconds} 秒`}
          </span>
          {taskState.unavailableReason && (
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{taskState.unavailableReason}</span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {targets.length === 0 && (
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>未发现已验证的 Antigravity 窗口</span>
          )}
          {selectedTargetId && targets.length > 0 && !targets.some(target => target.id === selectedTargetId) && (
            <span style={{ fontSize: '12px', color: '#e5c07b' }}>所选窗口已消失</span>
          )}
          {targets.length > 0 && (
            <select
              aria-label="选择宿主窗口"
              value={selectedTargetId || ''}
              onChange={e => onSelectTarget(e.target.value)}
              style={{
                background: '#1a221b',
                color: 'inherit',
                border: '1px solid var(--line)',
                padding: '4px 8px',
                borderRadius: '6px',
                fontSize: '12px'
              }}
            >
              {targets.map(t => (
                <option key={t.id} value={t.id}>
                  {t.title} {t.isCurrent ? '(当前窗口)' : ''}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            className="secondary-button"
            style={{ fontSize: '12px', padding: '4px 10px' }}
            onClick={() => onToggleMode(isFixture ? 'host' : 'fixture')}
            title="切换真实宿主遥测或测试模拟数据"
          >
            {isFixture ? '切换为真实宿主数据' : '切换为测试模拟数据'}
          </button>

          <button
            type="button"
            className="icon-button"
            onClick={onRefresh}
            title="刷新状态"
            style={{ padding: '6px' }}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* 来源模式横幅 */}
      <div
        style={{
          background: isFixture ? 'rgba(229, 192, 123, 0.1)' : 'rgba(197, 219, 168, 0.05)',
          border: `1px solid ${isFixture ? 'rgba(229, 192, 123, 0.3)' : 'var(--line)'}`,
          borderRadius: '8px',
          padding: '10px 14px',
          fontSize: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}
      >
        <Info size={16} color={isFixture ? '#e5c07b' : 'var(--accent)'} />
        <span>
          当前数据来源：<strong>{isFixture ? '测试模拟数据 (Fixture)' : '真实 Antigravity 宿主观测'}</strong>。
          {capabilities.streamingExplanation}
          {capabilities.finalTokens ? ' 已读到累计 Token。' : isFixture ? '' : ' 当前没有可核对的 Token 用量。'}
        </span>
      </div>

      {metrics.isStale && <p role="status" style={{ color: '#e5c07b', fontSize: '12px' }}>
        统计数据已过期或不可用；{metrics.lastUpdated ? `最后观测：${new Date(metrics.lastUpdated).toLocaleTimeString()}` : '暂无有效统计'}
        {metrics.unavailableReason && `（${metrics.unavailableReason}）`}
      </p>}
      {/* 指标卡片网格 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
        {/* 首个规划响应间隔 */}
        <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--line)', borderRadius: '10px', padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--muted)', fontSize: '12px', marginBottom: '8px' }}>
            <span>首个规划响应间隔</span>
            <Clock size={16} />
          </div>
          <div style={{ fontSize: '24px', fontWeight: 600, color: '#e6ebe3' }}>
            {metrics.latencyMs != null ? `${metrics.latencyMs} ms` : '—'}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
            输入日志到首个规划响应日志；不代表首 Token 延迟
          </div>
        </div>

        {/* 平均输出速度 */}
        <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--line)', borderRadius: '10px', padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--muted)', fontSize: '12px', marginBottom: '8px' }}>
            <span>平均输出速率</span>
            <Gauge size={16} />
          </div>
          <div style={{ fontSize: '24px', fontWeight: 600, color: 'var(--accent)' }}>
            {metrics.averageSpeedToks != null ? `${metrics.averageSpeedToks} tok/s` : '—'}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
            有效输出区间总新增 / 秒数
          </div>
        </div>

        {/* 滚动速度 (5s 窗口) */}
        <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--line)', borderRadius: '10px', padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--muted)', fontSize: '12px', marginBottom: '8px' }}>
            <span>滚动速度 (5s 窗口)</span>
            <Activity size={16} />
          </div>
          <div style={{ fontSize: '24px', fontWeight: 600, color: '#61afef' }}>
            {metrics.rollingSpeedStatus === 'stale'
              ? '— (已断开)'
              : metrics.rollingSpeedStatus === 'unavailable' || metrics.rollingSpeed == null
                ? '—'
                : `${metrics.rollingSpeed} tok/s`}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
            {metrics.rollingSpeedStatus === 'warming_up' ? '预热收敛中' : '最近 5 秒增量速率'}
          </div>
        </div>

        {/* 缓存命中率 */}
        <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--line)', borderRadius: '10px', padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--muted)', fontSize: '12px', marginBottom: '8px' }}>
            <span>缓存命中率</span>
            <Zap size={16} />
          </div>
          <div style={{ fontSize: '24px', fontWeight: 600, color: '#98c379' }}>
            {metrics.cacheRate != null ? `${metrics.cacheRate}%` : '不适用'}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
            缓存输入 / (输入 + 缓存)
          </div>
        </div>
      </div>

      {/* Token 用量与细分结构 */}
      <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--line)', borderRadius: '12px', padding: '20px' }}>
        <h3 style={{ fontSize: '14px', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Layers size={16} /> Token 用量与效率口径
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>当前活跃模型</div>
            <div style={{ fontSize: '15px', fontWeight: 500, marginTop: '4px' }}>{metrics.model || '—'}</div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>归属项目</div>
            <div style={{ fontSize: '15px', fontWeight: 500, marginTop: '4px' }}>{metrics.project || '未知项目'}</div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>输入 Token (非缓存)</div>
            <div style={{ fontSize: '15px', fontWeight: 500, marginTop: '4px' }}>{formatTokens(metrics.inputTokens)}</div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>缓存输入 Token</div>
            <div style={{ fontSize: '15px', fontWeight: 500, marginTop: '4px' }}>{formatTokens(metrics.cachedInputTokens)}</div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>总输入 Token</div>
            <div style={{ fontSize: '15px', fontWeight: 500, marginTop: '4px' }}>{formatTokens(metrics.totalInput)}</div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>输出 Token (含推理)</div>
            <div style={{ fontSize: '15px', fontWeight: 500, marginTop: '4px' }}>{formatTokens(metrics.outputTokens)}</div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>推理/思考 Token</div>
            <div style={{ fontSize: '15px', fontWeight: 500, marginTop: '4px' }}>{formatTokens(metrics.reasoningTokens)}</div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>总会话 Token</div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--accent)', marginTop: '4px' }}>
              {formatTokens(metrics.totalTokens)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
