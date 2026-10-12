import { useState } from 'react';
import { Lock, Unlock, CheckCircle2, AlertTriangle, HelpCircle } from 'lucide-react';
import type { ThemeDocument } from '../types';

const LOCKABLE_FIELDS = [
  { field: 'colors.foreground', label: '正文文字颜色' },
  { field: 'wallpaper.maskStrength', label: '壁纸遮罩强度' },
  { field: 'regions.chat.opacity', label: '聊天区域透明度' },
  { field: 'regions.sidebar.opacity', label: '侧栏透明度' },
  { field: 'regions.composer.opacity', label: '输入框透明度' },
  { field: 'regions.card.opacity', label: '卡片透明度' }
] as const;

export function ReadabilityPanel({ document, targetId, onDocument, onError }: {
  document: ThemeDocument | null;
  targetId: string | null;
  onDocument: (document: ThemeDocument) => void;
  onError: (text: string) => void;
}) {
  const [report, setReport] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const mode = document?.readability?.mode || 'off';
  const targetContrast = document?.readability?.targetContrast ?? 4.5;
  const locks = new Set<string>(document?.readability?.locks || []);

  async function updateReadability(patch: Partial<{ mode: 'off' | 'suggest' | 'auto'; targetContrast: number; locks: string[] }>) {
    if (!document) return;
    const current = document.readability || { mode: 'off', targetContrast: 4.5, locks: [] };
    const next = {
      ...document,
      readability: {
        mode: patch.mode ?? current.mode,
        targetContrast: patch.targetContrast ?? current.targetContrast,
        locks: patch.locks ?? current.locks
      }
    };
    onDocument(next);
  }

  function toggleLock(field: string) {
    const nextLocks = new Set(locks);
    if (nextLocks.has(field)) nextLocks.delete(field);
    else nextLocks.add(field);
    void updateReadability({ locks: Array.from(nextLocks) });
  }

  async function analyze() {
    if (!document || !window.antiFace) return;
    setBusy(true);
    try {
      const res = await window.antiFace.analyzeReadability(document, targetId);
      setReport(res);
    } catch (error) {
      onError(error instanceof Error ? error.message : '阅读保护分析失败');
    } finally {
      setBusy(false);
    }
  }

  async function adopt(fields?: string[]) {
    if (!document || !window.antiFace) return;
    try {
      const adopted = await window.antiFace.adoptReadability(document, fields, targetId, report?.suggestionId || null);
      onDocument(adopted);
    } catch (error) {
      onError(error instanceof Error ? error.message : '没有采用这条建议');
    }
  }

  return (
    <section className="round5-panel">
      <h2>阅读保护</h2>
      <p>自动评估各区域前景文字与背景壁纸的对比度。自动保护仅计算当次有效外观，点击“采用”后写入主题。</p>

      <div className="round5-row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        {(['off', 'suggest', 'auto'] as const).map(item => (
          <button
            key={item}
            type="button"
            className={mode === item ? 'primary-button' : 'secondary-button'}
            onClick={() => void updateReadability({ mode: item })}
          >
            {item === 'off' ? '关闭保护' : item === 'suggest' ? '仅建议' : '自动保护'}
          </button>
        ))}

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginLeft: '12px' }}>
          <label htmlFor="target-contrast-input" style={{ fontSize: '12px' }}>目标对比度:</label>
          <input
            id="target-contrast-input"
            type="number"
            min={1.5}
            max={21}
            step={0.5}
            value={targetContrast}
            style={{ width: '60px', padding: '4px 6px', borderRadius: '4px', border: '1px solid var(--line)', background: 'var(--panel)', color: 'inherit' }}
            onChange={e => {
              const val = parseFloat(e.target.value);
              if (Number.isFinite(val) && val >= 1 && val <= 21) {
                void updateReadability({ targetContrast: val });
              }
            }}
          />
          <span style={{ fontSize: '11px', color: 'var(--muted)' }} title="WCAG AA 建议正文 ≥ 4.5:1，AAA 建议 ≥ 7:1，大号字 ≥ 3:1">
            <HelpCircle size={13} style={{ verticalAlign: 'middle' }} /> AA推荐 4.5:1
          </span>
        </div>

        <button
          type="button"
          className="secondary-button"
          disabled={busy || !document}
          onClick={() => void analyze()}
          style={{ marginLeft: 'auto' }}
        >
          {busy ? '正在评估…' : '查看完整评估'}
        </button>
      </div>

      <div style={{ marginTop: '16px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--line)', borderRadius: '8px', padding: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '8px' }}>调整保护锁定项（已锁定的字段系统不会改动）：</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {LOCKABLE_FIELDS.map(({ field, label }) => {
            const isLocked = locks.has(field);
            return (
              <button
                key={field}
                type="button"
                className={isLocked ? 'primary-button' : 'secondary-button'}
                style={{ fontSize: '12px', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                onClick={() => toggleLock(field)}
              >
                {isLocked ? <Lock size={12} /> : <Unlock size={12} />}
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {report?.readability && (
        <div className="round5-card" style={{ marginTop: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0, fontSize: '14px' }}>对比度评估报告</h3>
            <span style={{ fontSize: '12px', color: report.readability.reached ? '#4ade80' : '#fbbf24', display: 'flex', alignItems: 'center', gap: '4px' }}>
              {report.readability.reached ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
              {report.readability.reached ? '已达标' : '待改善'}
            </span>
          </div>

          <p style={{ margin: '8px 0', fontSize: '13px' }}>
            聊天正文最低对比度：<strong>{report.readability.measurement?.worst != null ? `${report.readability.measurement.worst.toFixed(2)}:1` : '未知'}</strong>
            （低分位 P10：{report.readability.measurement?.p10 != null ? `${report.readability.measurement.p10.toFixed(2)}:1` : '—'}，采样点 {report.readability.measurement?.samples ?? 0} 个）
          </p>

          {report.readability.regions && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px', margin: '12px 0' }}>
              {Object.entries(report.readability.regions).map(([rId, data]: [string, any]) => {
                const labelMap: Record<string, string> = { chat: '聊天区', composer: '输入框', sidebar: '侧栏', card: '提示卡片' };
                const label = labelMap[rId] || rId;
                const score = data?.measurement?.worst;
                const ok = data?.passed;
                return (
                  <div key={rId} style={{ background: 'rgba(0,0,0,0.2)', padding: '8px', borderRadius: '6px', border: '1px solid var(--line)' }}>
                    <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{label}</div>
                    <div style={{ fontSize: '14px', fontWeight: 'bold', color: ok ? '#4ade80' : '#fbbf24' }}>
                      {score != null ? `${score.toFixed(2)}:1` : '未识别'}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {(report.readability.warnings || []).map((item: { message: string }, index: number) => (
            <p key={index} style={{ color: '#fbbf24', fontSize: '12px', margin: '4px 0' }}>⚠ {item.message}</p>
          ))}

          {(report.readability.adjustments || []).length > 0 && (
            <div style={{ marginTop: '12px', borderTop: '1px solid var(--line)', paddingTop: '10px' }}>
              <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '8px' }}>系统调整建议：</div>
              {(report.readability.adjustments || []).map((item: { field: string; reason: string; from: any; to: any }) => (
                <div key={item.field} className="round5-row" style={{ marginBottom: '6px', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px' }}>{item.reason} ({item.field})</span>
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ fontSize: '11px', padding: '2px 8px' }}
                    onClick={() => void adopt([item.field])}
                  >
                    仅采用此项
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="primary-button"
                style={{ marginTop: '8px', width: '100%' }}
                onClick={() => void adopt()}
              >
                全部采用到主题草稿
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
