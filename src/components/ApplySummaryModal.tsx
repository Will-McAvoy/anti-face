import React from 'react';
import { Sparkles, CheckCircle2, AlertTriangle, X, ShieldAlert, ArrowRight } from 'lucide-react';
import type { ThemeDocument } from '../types';

interface ChangeItem {
  field: string;
  category: string;
  before: string;
  after: string;
  source: string;
}

interface ApplySummary {
  previewId: string;
  baseline: {
    kind: 'native' | 'lastVerified' | 'session' | 'verified-theme' | 'unknown' | string;
    label: string;
  };
  totalChanges: number;
  requestedChanges: ChangeItem[];
  effectiveChanges: ChangeItem[];
  autoChanges: ChangeItem[];
  groups: {
    colors: ChangeItem[];
    typography: ChangeItem[];
    wallpaper: ChangeItem[];
    regions: ChangeItem[];
    auto: ChangeItem[];
  };
}

interface ApplySummaryModalProps {
  summary: ApplySummary;
  targetName?: string;
  isApplying?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ApplySummaryModal({
  summary,
  targetName,
  isApplying = false,
  onConfirm,
  onClose
}: ApplySummaryModalProps) {
  const { baseline, groups, totalChanges } = summary;

  const renderGroup = (title: string, items: ChangeItem[]) => {
    if (!items || items.length === 0) return null;
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6 }}>
          {title} ({items.length})
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {items.map((item, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 10px',
                borderRadius: 4,
                background: 'var(--panel-muted, rgba(0,0,0,0.15))',
                fontSize: 12
              }}
            >
              <span style={{ fontWeight: 500 }}>{item.field}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: 'var(--muted)', textDecoration: 'line-through' }}>{item.before || (item as any).beforeDisplay || '原生默认'}</span>
                <ArrowRight size={12} style={{ color: 'var(--muted)' }} />
                <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{item.after}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="modal-backdrop" style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.65)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: 16
    }}>
      <div className="modal-dialog" style={{
        background: 'var(--panel)',
        borderRadius: 8,
        border: '1px solid var(--line)',
        width: '100%',
        maxWidth: 580,
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.4)'
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={18} /> 应用前变更摘要
            </h3>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              目标窗口: {targetName || '当前窗口'} · {baseline.label}
            </span>
          </div>
          <button
            type="button"
            className="text-button"
            onClick={onClose}
            disabled={isApplying}
            style={{ padding: 4, color: 'var(--muted)' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
          {baseline.kind === 'native' && (
            <div style={{
              padding: 10,
              borderRadius: 6,
              background: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              color: '#60a5fa',
              fontSize: 12,
              marginBottom: 16
            }}>
              ℹ 目标窗口目前处于原生默认状态，应用后将首次注入 Anti Face 主题。
            </div>
          )}

          {totalChanges === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
              当前主题样式与目标窗口现有生效外观完全一致，应用不会产生视觉变更。
            </p>
          ) : (
            <>
              {renderGroup('配色方案', groups.colors)}
              {renderGroup('排版与字体', groups.typography)}
              {renderGroup('壁纸与构图', groups.wallpaper)}
              {renderGroup('局部区域', groups.regions)}
              {renderGroup('运行时自动覆盖 (性能/场景/轮换)', groups.auto)}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--line)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            共 {totalChanges} 项属性变动
          </span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="secondary-button" disabled={isApplying} onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={isApplying}
              onClick={onConfirm}
            >
              {isApplying ? '正在应用...' : '确认应用到窗口'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
