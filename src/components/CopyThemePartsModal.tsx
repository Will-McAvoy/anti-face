import React, { useState, useMemo } from 'react';
import { Copy, Check, X, AlertTriangle } from 'lucide-react';
import type { ThemeDocument } from '../types';
import { copyThemeParts, ALLOWED_COPY_GROUPS } from '../../core/theme-copy-parts.cjs';

interface CopyThemePartsModalProps {
  currentDocument: ThemeDocument;
  availableThemes: Array<{ id: string; name: string; document?: ThemeDocument }>;
  onApply: (updatedDoc: ThemeDocument) => void;
  onClose: () => void;
}

const GROUP_LABELS: Record<string, { title: string; desc: string }> = {
  colors: { title: '配色调色板', desc: '主色、背景色、文字颜色、边框与高亮等' },
  typography: { title: '排版文字', desc: '字体族、字号、行距' },
  wallpaper: { title: '壁纸与构图', desc: '壁纸资产、缩放、模糊度、遮罩与留白策略' },
  'regions.sidebar': { title: '侧边栏区域', desc: '透明度、圆角、模糊度、阴影' },
  'regions.chat': { title: '聊天区域', desc: '主聊天界面底色与透明度' },
  'regions.composer': { title: '输入框区域', desc: '输入框圆角、描边、背景' },
  'regions.card': { title: '卡片区域', desc: '卡片圆角、阴影与边框' }
};

export function CopyThemePartsModal({
  currentDocument,
  availableThemes,
  onApply,
  onClose
}: CopyThemePartsModalProps) {
  // 排除当前正在编辑的主题
  const candidateThemes = useMemo(() => {
    return availableThemes.filter(t => t.id !== currentDocument.id && t.document);
  }, [availableThemes, currentDocument.id]);

  const [selectedSourceId, setSelectedSourceId] = useState<string>(candidateThemes[0]?.id || '');
  const [selectedGroups, setSelectedGroups] = useState<string[]>(['colors']);
  const [error, setError] = useState<string | null>(null);

  const sourceEntry = candidateThemes.find(t => t.id === selectedSourceId);
  const sourceDoc = sourceEntry?.document;

  const toggleGroup = (group: string) => {
    setSelectedGroups(prev =>
      prev.includes(group) ? prev.filter(g => g !== group) : [...prev, group]
    );
  };

  const selectAll = () => {
    setSelectedGroups([...ALLOWED_COPY_GROUPS]);
  };

  const clearAll = () => {
    setSelectedGroups([]);
  };

  // 预检预览
  const previewResult = useMemo(() => {
    if (!sourceDoc || selectedGroups.length === 0) return null;
    try {
      return copyThemeParts(currentDocument, sourceDoc, selectedGroups);
    } catch (err: any) {
      return { error: err.message };
    }
  }, [currentDocument, sourceDoc, selectedGroups]);

  const handleConfirm = async () => {
    if (!sourceDoc) {
      setError('请选择源主题');
      return;
    }
    if (selectedGroups.length === 0) {
      setError('请至少选择一个要复制的部件');
      return;
    }

    try {
      let res: { changed: boolean; document: ThemeDocument; modifiedGroups: string[] };
      if (window.antiFace?.copyThemeParts) {
        res = await window.antiFace.copyThemeParts(currentDocument, sourceDoc, selectedGroups);
      } else {
        res = copyThemeParts(currentDocument, sourceDoc, selectedGroups);
      }
      if (!res.changed) {
        setError('所选部件的内容与当前主题完全一致，无需复制');
        return;
      }
      onApply(res.document);
      onClose();
    } catch (err: any) {
      setError(err.message || '局部复制失败');
    }
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
        maxWidth: 540,
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.4)'
      }}>
        {/* Modal Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <h3 style={{ margin: 0, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Copy size={18} /> 主题局部复制
          </h3>
          <button
            type="button"
            className="text-button"
            onClick={onClose}
            style={{ padding: 4, color: 'var(--muted)' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--muted)' }}>
            从现有主题中选择性复制配色、字体、壁纸或局部区域样式到当前草稿中。此操作将作为单步撤销记录保存。
          </p>

          {/* 源主题选择 */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>
              选择源主题
            </label>
            {candidateThemes.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>库中暂无其他可供复制的主题。</p>
            ) : (
              <select
                value={selectedSourceId}
                onChange={e => { setSelectedSourceId(e.target.value); setError(null); }}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--line)',
                  background: 'var(--background)',
                  color: 'inherit',
                  fontSize: 13
                }}
              >
                {candidateThemes.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.id.slice(0, 8)})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* 部件多选 */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>选择复制部件</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="text-button" onClick={selectAll} style={{ fontSize: 12 }}>全选</button>
                <button type="button" className="text-button" onClick={clearAll} style={{ fontSize: 12 }}>清空</button>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              {(ALLOWED_COPY_GROUPS as string[]).map(groupId => {
                const checked = selectedGroups.includes(groupId);
                const info = GROUP_LABELS[groupId] || { title: groupId, desc: '' };
                return (
                  <label
                    key={groupId}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: 10,
                      borderRadius: 6,
                      border: `1px solid ${checked ? 'var(--accent)' : 'var(--line)'}`,
                      background: checked ? 'rgba(var(--accent-rgb, 210, 227, 187), 0.08)' : 'transparent',
                      cursor: 'pointer'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => { toggleGroup(groupId); setError(null); }}
                      style={{ marginTop: 2 }}
                    />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{info.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{info.desc}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* 预检预览提示 */}
          {previewResult && !previewResult.error && (
            <div style={{
              padding: 10,
              borderRadius: 6,
              background: 'var(--panel-muted, rgba(0,0,0,0.15))',
              border: '1px solid var(--line)',
              fontSize: 12
            }}>
              <span style={{ color: previewResult.changed ? 'var(--accent)' : 'var(--muted)' }}>
                {previewResult.changed ? '✓ 检测到样式差异，复制后将即时更新草稿' : 'ℹ 所选部件与当前草稿相同'}
              </span>
            </div>
          )}

          {/* 错误提示 */}
          {error && (
            <div style={{
              marginTop: 12,
              padding: 10,
              borderRadius: 6,
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid #ef4444',
              color: '#ef4444',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}>
              <AlertTriangle size={14} /> {error}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--line)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 10
        }}>
          <button type="button" className="secondary-button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!sourceDoc || selectedGroups.length === 0}
            onClick={handleConfirm}
          >
            应用到草稿
          </button>
        </div>
      </div>
    </div>
  );
}
