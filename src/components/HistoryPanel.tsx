import React, { useState, useEffect } from 'react';
import { Calendar, Download, FileSpreadsheet, FileText, Filter, RefreshCw, Shield, Trash2 } from 'lucide-react';
import type { HistoryQueryResult } from '../types';

export function HistoryPanel({
  onNotice
}: {
  onNotice: (notice: { kind: 'error' | 'success'; text: string }) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [retentionDays, setRetentionDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<'all' | 'today' | '7d' | '30d'>('7d');
  const [selectedModel, setSelectedModel] = useState('all');
  const [selectedProject, setSelectedProject] = useState('all');
  const [page, setPage] = useState(1);
  const [queryResult, setQueryResult] = useState<HistoryQueryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 加载设置与历史
  const loadData = async () => {
    if (!window.antiFace) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const s = await window.antiFace.getHistorySettings();
      setEnabled(s.enabled);
      setRetentionDays(s.retentionDays);

      const res = await window.antiFace.queryHistory({
        dateRange,
        model: selectedModel,
        project: selectedProject,
        page,
        pageSize: 15
      });
      setQueryResult(res);
    } catch (err: any) {
      const text = err.message || '加载历史记录失败';
      setLoadError(text);
      onNotice({ kind: 'error', text });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!window.antiFace) {
      setLoading(false);
      return;
    }
    void loadData();
  }, [dateRange, selectedModel, selectedProject, page]);

  const handleToggleEnabled = async (checked: boolean) => {
    if (!window.antiFace) return;
    const previous = enabled;
    setEnabled(checked);
    try {
      const s = await window.antiFace.setHistorySettings({ enabled: checked });
      setEnabled(s.enabled);
      onNotice({
        kind: 'success',
        text: s.enabled ? '已启用本地统计持久化。' : '已停止保存本地历史，实时观察不受影响。'
      });
      loadData();
    } catch (err: any) {
      setEnabled(previous);
      onNotice({ kind: 'error', text: err.message || '历史开关保存失败，已回退' });
    }
  };

  const handleRetentionChange = async (days: number) => {
    if (!window.antiFace) return;
    const previous = retentionDays;
    setRetentionDays(days);
    try {
      const s = await window.antiFace.setHistorySettings({ retentionDays: days });
      setRetentionDays(s.retentionDays);
      onNotice({ kind: 'success', text: `手动清理阈值已设为 ${days} 天。这不会自动删除记录。` });
    } catch (err: any) {
      setRetentionDays(previous);
      onNotice({ kind: 'error', text: err.message || '保留周期保存失败，已回退' });
    }
  };

  const handleExport = async (format: 'csv' | 'json') => {
    if (!window.antiFace || busy) return;
    setBusy(true);
    try {
      const file = await window.antiFace.exportHistory({
        format,
        filter: { dateRange, model: selectedModel, project: selectedProject }
      });
      if (file) {
        onNotice({ kind: 'success', text: `已成功导出至：${file}` });
      }
    } catch (err: any) {
      onNotice({ kind: 'error', text: err.message || '导出失败' });
    } finally {
      setBusy(false);
    }
  };

  const handleCleanup = async (scope: 'older_than_retention' | 'all') => {
    if (!window.antiFace || busy) return;
    const confirmMsg = scope === 'all'
      ? '确定要清空全部本地历史统计记录吗？此操作不可逆。'
      : `确定清理超过 ${retentionDays} 天的历史记录吗？`;
    if (!window.confirm(confirmMsg)) return;

    setBusy(true);
    try {
      const res = await window.antiFace.cleanupHistory(scope);
      onNotice({ kind: 'success', text: `已清理 ${res.deletedCount} 条记录，剩余 ${res.remainingCount} 条。` });
      setPage(1);
      loadData();
    } catch (err: any) {
      onNotice({ kind: 'error', text: err.message || '清理失败' });
    } finally {
      setBusy(false);
    }
  };

  const summary = queryResult?.summary;
  const records = queryResult?.records || [];

  if (!window.antiFace) {
    return (
      <div className="empty-state" style={{ padding: '40px', textAlign: 'center' }}>
        <Shield size={24} style={{ margin: '0 auto 12px' }} />
        <p>本地历史需要桌面版 Anti Face。浏览器预览不能读写本机历史。</p>
      </div>
    );
  }

  return (
    <div className="history-dashboard" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 隐私与存储设置横幅 */}
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
          gap: '16px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Shield size={20} color="var(--accent)" />
          <div>
            <div style={{ fontWeight: 600, fontSize: '14px' }}>本地统计与隐私保护</div>
            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
              数据仅保存在本机 Electron 用户数据目录；绝不保存聊天正文、代码或密钥。
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={e => handleToggleEnabled(e.target.checked)}
            />
            启用本地历史记录
          </label>

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
            <span style={{ color: 'var(--muted)' }}>手动清理阈值:</span>
            <select
              aria-label="保留周期"
              value={retentionDays}
              onChange={e => handleRetentionChange(Number(e.target.value))}
              style={{
                background: '#1a221b',
                color: 'inherit',
                border: '1px solid var(--line)',
                padding: '3px 6px',
                borderRadius: '4px',
                fontSize: '12px'
              }}
            >
              <option value={7}>7 天</option>
              <option value={30}>30 天</option>
              <option value={90}>90 天</option>
            </select>
          </div>
        </div>
      </div>

      {/* 筛选与操作栏 */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid var(--line)',
          borderRadius: '10px',
          padding: '12px 16px'
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
          <div className="theme-filters" style={{ margin: 0 }}>
            {([['today', '今日'], ['7d', '近 7 天'], ['30d', '近 30 天'], ['all', '全部']] as const).map(([val, label]) => (
              <button
                key={val}
                type="button"
                className={dateRange === val ? 'active' : ''}
                onClick={() => { setDateRange(val); setPage(1); }}
                style={{ fontSize: '12px', padding: '4px 10px' }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 模型筛选 */}
          {queryResult && queryResult.availableModels.length > 0 && (
            <select
              aria-label="筛选模型"
              value={selectedModel}
              onChange={e => { setSelectedModel(e.target.value); setPage(1); }}
              style={{
                background: '#1a221b',
                color: 'inherit',
                border: '1px solid var(--line)',
                padding: '4px 8px',
                borderRadius: '6px',
                fontSize: '12px'
              }}
            >
              <option value="all">所有模型</option>
              {queryResult.availableModels.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}

          {/* 项目筛选 */}
          {queryResult && queryResult.availableProjects.length > 0 && (
            <select
              aria-label="筛选项目"
              value={selectedProject}
              onChange={e => { setSelectedProject(e.target.value); setPage(1); }}
              style={{
                background: '#1a221b',
                color: 'inherit',
                border: '1px solid var(--line)',
                padding: '4px 8px',
                borderRadius: '6px',
                fontSize: '12px'
              }}
            >
              <option value="all">所有项目</option>
              {queryResult.availableProjects.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className="secondary-button"
            style={{ fontSize: '12px', padding: '4px 10px' }}
            onClick={() => handleExport('csv')}
            disabled={busy || records.length === 0}
            title="导出为 CSV 表格 (防公式注入)"
          >
            <FileSpreadsheet size={14} /> 导出 CSV
          </button>
          <button
            type="button"
            className="secondary-button"
            style={{ fontSize: '12px', padding: '4px 10px' }}
            onClick={() => handleExport('json')}
            disabled={busy || records.length === 0}
            title="导出为 JSON 文件"
          >
            <FileText size={14} /> 导出 JSON
          </button>
          <button
            type="button"
            className="icon-button"
            style={{ padding: '6px', color: '#e06c75' }}
            onClick={() => handleCleanup('older_than_retention')}
            disabled={busy}
            title={`清理超过 ${retentionDays} 天记录`}
          >
            <Trash2 size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            style={{ padding: '6px' }}
            onClick={loadData}
            title="刷新历史"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* 统计指标卡片 */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
          <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--line)', borderRadius: '10px', padding: '14px' }}>
            <div style={{ fontSize: '11px', color: 'var(--muted)' }}>总任务记录数</div>
            <div style={{ fontSize: '20px', fontWeight: 600, marginTop: '4px' }}>{summary.totalRecords}</div>
          </div>
          <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--line)', borderRadius: '10px', padding: '14px' }}>
            <div style={{ fontSize: '11px', color: 'var(--muted)' }}>已知总输出 Token</div>
            <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--accent)', marginTop: '4px' }}>
              {summary.knownTotalOutput.toLocaleString()}
            </div>
            {summary.hasMissingData && (
              <div style={{ fontSize: '10px', color: '#e5c07b', marginTop: '2px' }}>
                (下限：{summary.missingOutputCount} 条记录缺失)
              </div>
            )}
          </div>
          <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--line)', borderRadius: '10px', padding: '14px' }}>
            <div style={{ fontSize: '11px', color: 'var(--muted)' }}>已知总输入 Token</div>
            <div style={{ fontSize: '20px', fontWeight: 600, marginTop: '4px' }}>
              {summary.knownTotalInput.toLocaleString()}
            </div>
          </div>
          <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--line)', borderRadius: '10px', padding: '14px' }}>
            <div style={{ fontSize: '11px', color: 'var(--muted)' }}>任务平均已知输出</div>
            <div style={{ fontSize: '20px', fontWeight: 600, marginTop: '4px' }}>
              {summary.averageOutputTokens != null ? `${summary.averageOutputTokens} tok` : '—'}
            </div>
          </div>
          <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--line)', borderRadius: '10px', padding: '14px' }}>
            <div style={{ fontSize: '11px', color: 'var(--muted)' }}>平均输出速率</div>
            <div style={{ fontSize: '20px', fontWeight: 600, color: '#61afef', marginTop: '4px' }}>
              {summary.averageOutputSpeed != null ? `${summary.averageOutputSpeed} tok/s` : '—'}
            </div>
          </div>
        </div>
      )}

      {summary && <p style={{ color: 'var(--muted)', fontSize: '12px' }}>
        已知重试次数：{summary.retryCount ?? '未知'}
        {summary.missingAttemptsCount > 0 && `（${summary.missingAttemptsCount} 条记录的重试情况未知）`}
      </p>}
      {/* 历史表格 */}
      <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--line)', borderRadius: '12px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--line)', background: 'rgba(255, 255, 255, 0.02)', color: 'var(--muted)', fontSize: '12px' }}>
              <th style={{ padding: '12px 16px' }}>时间</th>
              <th style={{ padding: '12px 16px' }}>模型</th>
              <th style={{ padding: '12px 16px' }}>项目</th>
              <th style={{ padding: '12px 16px' }}>状态</th>
              <th style={{ padding: '12px 16px' }}>耗时</th>
              <th style={{ padding: '12px 16px' }}>输入 Token</th>
              <th style={{ padding: '12px 16px' }}>输出 Token</th>
              <th style={{ padding: '12px 16px' }}>总 Token</th>
            </tr>
          </thead>
          <tbody>
            {records.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                <td style={{ padding: '12px 16px', color: 'var(--muted)' }}>
                  {r.occurredAt ? new Date(r.occurredAt).toLocaleString() : '发生时间未知'}
                </td>
                <td style={{ padding: '12px 16px' }}>{r.model}</td>
                <td style={{ padding: '12px 16px' }}>{r.project}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    background: r.status === 'completed' ? 'rgba(152, 195, 121, 0.15)' : 'rgba(224, 108, 117, 0.15)',
                    color: r.status === 'completed' ? '#98c379' : '#e06c75'
                  }}>
                    {r.status}
                  </span>
                </td>
                <td style={{ padding: '12px 16px' }}>
                  {r.durationSeconds != null ? `${r.durationSeconds}s` : '—'}
                </td>
                <td style={{ padding: '12px 16px' }}>
                  {r.inputTokens != null ? r.inputTokens.toLocaleString() : '—'}
                </td>
                <td style={{ padding: '12px 16px', color: 'var(--accent)' }}>
                  {r.outputTokens != null ? r.outputTokens.toLocaleString() : '—'}
                </td>
                <td style={{ padding: '12px 16px', fontWeight: 600 }}>
                  {r.totalTokens != null ? r.totalTokens.toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {loadError && (
          <div style={{ padding: '16px', color: '#e06c75' }} role="alert">{loadError}</div>
        )}
        {records.length === 0 && !loading && (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
            {enabled ? '空历史：还没有符合筛选条件的记录。' : '本地历史记录未启用。开启上方开关后才会保存任务指标。'}
          </div>
        )}

        {/* 分页控制 */}
        {queryResult && queryResult.totalPages > 1 && (
          <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--line)', fontSize: '12px' }}>
            <span style={{ color: 'var(--muted)' }}>
              第 {queryResult.page} / {queryResult.totalPages} 页 (共 {queryResult.totalCount} 条)
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="secondary-button"
                disabled={queryResult.page <= 1}
                onClick={() => setPage(p => p - 1)}
                style={{ padding: '4px 8px', fontSize: '12px' }}
              >
                上一页
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={queryResult.page >= queryResult.totalPages}
                onClick={() => setPage(p => p + 1)}
                style={{ padding: '4px 8px', fontSize: '12px' }}
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
