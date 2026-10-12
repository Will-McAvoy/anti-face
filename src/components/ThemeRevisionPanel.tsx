import { useState, useEffect, useRef } from 'react';
import { History, Pin, PinOff, GitCompare, RotateCcw, AlertTriangle, Check } from 'lucide-react';
import type { ThemeDocument } from '../types';

export function ThemeRevisionPanel({ themeId, onDocument, onError }: {
  themeId: string | null;
  onDocument: (document: ThemeDocument) => void;
  onError: (text: string) => void;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [leftId, setLeftId] = useState<string>('');
  const [rightId, setRightId] = useState<string>('');
  const [diff, setDiff] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [pendingOperation, setPendingOperation] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Array<{ revisionId: string; reason?: string }>>([]);
  const requestSerial = useRef(0);

  async function loadCandidates(serial?: number) {
    if (!themeId || !window.antiFace?.listRecoveryCandidates) return;
    const found = await window.antiFace.listRecoveryCandidates(themeId);
    if (serial != null && requestSerial.current !== serial) return;
    setCandidates(found || []);
  }

  async function load() {
    if (!themeId || !window.antiFace) return;
    setBusy(true);
    try {
      const list = await window.antiFace.listRevisions(themeId);
      setItems(list || []);
      if (list && list.length >= 2) {
        setLeftId(list[1].revisionId);
        setRightId(list[0].revisionId);
      } else if (list && list.length === 1) {
        setLeftId(list[0].revisionId);
        setRightId(list[0].revisionId);
      }
      await loadCandidates();
    } catch (error) {
      onError(error instanceof Error ? error.message : '读取版本历史失败');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const serial = ++requestSerial.current;
    setItems([]);
    setDiff(null);
    setLeftId('');
    setRightId('');
    setPendingOperation(null);
    setCandidates([]);
    if (!themeId || !window.antiFace) return;
    void window.antiFace.listRevisions(themeId).then(list => {
      if (requestSerial.current !== serial) return;
      setItems(list || []);
      if (list && list.length >= 2) {
        setLeftId(list[1].revisionId);
        setRightId(list[0].revisionId);
      } else if (list && list.length === 1) {
        setLeftId(list[0].revisionId);
        setRightId(list[0].revisionId);
      }
      void loadCandidates(serial);
    }).catch(error => {
      if (requestSerial.current === serial) onError(error instanceof Error ? error.message : '读取版本历史失败');
    });
  }, [themeId]);

  async function handleDiff() {
    if (!leftId || !rightId || !window.antiFace) return;
    setBusy(true);
    try {
      const diffResults = await window.antiFace.diffRevisions(leftId, rightId);
      setDiff(diffResults || []);
    } catch (error) {
      onError(error instanceof Error ? error.message : '计算版本差异失败');
    } finally {
      setBusy(false);
    }
  }

  async function restore(revisionId: string, selection: any, confirm: boolean) {
    if (!window.antiFace) return;
    setBusy(true);
    setActionNotice(null);
    try {
      const result = await window.antiFace.restoreRevision(revisionId, selection, confirm);
      if (!result?.ok) {
        if (result?.documentSaved && result?.revisionSaved === false) {
          setPendingOperation(result.operationId || null);
          setActionNotice(result.message || '主题已经保存，版本历史没有写完。可以重试。');
          if (result.document) onDocument(result.document);
          return;
        }
        onError(result?.message || '版本恢复失败');
        return;
      }
      setPendingOperation(null);
      if (result.draft) {
        onDocument(result.draft);
        setActionNotice(`已将版本载入当前草稿（${selection ? '局部恢复' : '整套'}），点击“保存”或“应用”后生效。`);
      }
      if (result.document) {
        onDocument(result.document);
        setActionNotice('已成功确认恢复并生成新版本！');
        void load();
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : '恢复操作异常');
    } finally {
      setBusy(false);
    }
  }

  async function togglePin(revisionId: string, currentlyPinned: boolean) {
    if (!themeId || !window.antiFace) return;
    try {
      await window.antiFace.pinRevision(themeId, revisionId, !currentlyPinned);
      void load();
    } catch (error) {
      onError(error instanceof Error ? error.message : '固定版本操作失败');
    }
  }

  function groupDiffs(changes: any[]) {
    const groups: Record<string, any[]> = {
      '颜色 (Colors)': [],
      '排版 (Typography)': [],
      '壁纸与构图 (Wallpaper)': [],
      '区域样式 (Regions)': [],
      '其他字段 (Other)': []
    };
    for (const c of changes) {
      if (c.path.startsWith('colors.')) groups['颜色 (Colors)'].push(c);
      else if (c.path.startsWith('typography.')) groups['排版 (Typography)'].push(c);
      else if (c.path.startsWith('wallpaper.')) groups['壁纸与构图 (Wallpaper)'].push(c);
      else if (c.path.startsWith('regions.')) groups['区域样式 (Regions)'].push(c);
      else groups['其他字段 (Other)'].push(c);
    }
    return groups;
  }

  return (
    <section className="round5-panel">
      <h2>版本历史与回退</h2>
      <p style={{ margin: '4px 0 12px', fontSize: '13px', color: 'var(--muted)' }}>
        每次保存或应用会自动生成不可变版本快照。恢复旧版本将先载入草稿，或生成新版本记录，绝不损坏旧历史。
      </p>

      {candidates.length > 0 && (
        <div style={{ padding: '8px 12px', borderRadius: '6px', background: 'rgba(234, 179, 8, 0.08)', border: '1px solid rgba(234, 179, 8, 0.35)', marginBottom: '12px' }}>
          <p style={{ margin: '0 0 8px', fontSize: '12px' }}>有 {candidates.length} 条历史记录不在索引里。无法确认是故意删除还是索引丢失，所以没有自动加回。</p>
          {candidates.map(item => (
            <button
              key={item.revisionId}
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => void window.antiFace?.adoptRecoveryCandidate(item.revisionId).then(() => {
                setActionNotice('已把这条丢失索引的历史加回列表。');
                void load();
              }).catch(error => {
                onError(error instanceof Error ? error.message : '恢复历史失败');
              })}
            >
              恢复这条记录
            </button>
          ))}
        </div>
      )}
      {pendingOperation && (
        <button
          type="button"
          className="secondary-button"
          onClick={() => void window.antiFace?.retryRevision(pendingOperation).then(result => {
            if (result?.ok) {
              setPendingOperation(null);
              setActionNotice('版本历史已经补写完成。');
              void load();
            } else {
              setActionNotice(result?.message || '版本历史仍然没有写完。');
            }
          }).catch(error => {
            setActionNotice(error instanceof Error ? error.message : '版本历史仍然没有写完。');
          })}
        >
          重试写入历史
        </button>
      )}
      {items.some(item => item.colors) && (
        <p style={{ fontSize: '12px', color: 'var(--muted)' }}>颜色块来自该版本自己的文档，不是当前编辑草稿。缺少壁纸文件时只显示颜色，不假装壁纸还在。</p>
      )}
      {actionNotice && (
        <div style={{ padding: '8px 12px', borderRadius: '6px', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.3)', color: '#4ade80', fontSize: '12px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Check size={14} />
          {actionNotice}
        </div>
      )}

      <div className="round5-row" style={{ alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void load()}>
          <History size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
          刷新历史列表
        </button>
        <span style={{ fontSize: '12px', color: 'var(--muted)' }}>共 {items.length} 个版本记录</span>
      </div>

      {items.length === 0 ? (
        <p style={{ fontSize: '13px', color: 'var(--muted)' }}>当前主题暂无历史快照。保存主题后将在此自动记录。</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {items.map(item => (
            <div
              key={item.revisionId}
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid var(--line)',
                background: 'rgba(255, 255, 255, 0.02)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong>{new Date(item.createdAt).toLocaleString()}</strong>
                  <span style={{ fontSize: '11px', color: 'var(--muted)', marginLeft: '8px' }}>来源: {item.source}</span>
                  {item.pinned && (
                    <span style={{ fontSize: '10px', background: 'rgba(234, 179, 8, 0.2)', color: '#facc15', padding: '1px 6px', borderRadius: '4px', marginLeft: '6px' }}>
                      已固定
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ fontSize: '11px', padding: '2px 8px' }}
                  onClick={() => togglePin(item.revisionId, !!item.pinned)}
                >
                  {item.pinned ? <PinOff size={11} style={{ marginRight: '3px', verticalAlign: 'middle' }} /> : <Pin size={11} style={{ marginRight: '3px', verticalAlign: 'middle' }} />}
                  {item.pinned ? '取消固定' : '固定防自动清理'}
                </button>
              </div>
              {item.colors ? (
                <div style={{ display: 'flex', gap: '4px' }} aria-label={`${item.name || '版本'}颜色预览`}>
                  {Object.entries(item.colors).filter(([, color]) => color).map(([role, color]) => (
                    <span key={role} title={role} style={{ width: 14, height: 14, borderRadius: 3, background: String(color), display: 'inline-block' }} />
                  ))}
                  {!(item.assetRefs || []).length && <span style={{ fontSize: '11px', color: 'var(--muted)' }}>这份版本没有壁纸文件</span>}
                </div>
              ) : (
                <span style={{ fontSize: '11px', color: 'var(--muted)' }}>这份历史没有可显示的颜色预览</span>
              )}

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', paddingTop: '4px', borderTop: '1px solid var(--line)' }}>
                <button
                  type="button"
                  className="primary-button"
                  style={{ fontSize: '11px', padding: '3px 8px' }}
                  disabled={busy}
                  onClick={() => void restore(item.revisionId, null, false)}
                >
                  载入完整草稿
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ fontSize: '11px', padding: '3px 8px' }}
                  disabled={busy}
                  onClick={() => void restore(item.revisionId, { groups: ['colors'] }, false)}
                >
                  仅恢复颜色
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ fontSize: '11px', padding: '3px 8px' }}
                  disabled={busy}
                  onClick={() => void restore(item.revisionId, { groups: ['typography'] }, false)}
                >
                  仅恢复排版
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ fontSize: '11px', padding: '3px 8px' }}
                  disabled={busy}
                  onClick={() => void restore(item.revisionId, { groups: ['wallpaper'] }, false)}
                >
                  仅恢复壁纸构图
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ fontSize: '11px', padding: '3px 8px' }}
                  disabled={busy}
                  onClick={() => void restore(item.revisionId, { regions: ['sidebar'] }, false)}
                >
                  仅恢复侧栏
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ fontSize: '11px', padding: '3px 8px' }}
                  disabled={busy}
                  onClick={() => void restore(item.revisionId, { regions: ['chat'] }, false)}
                >
                  仅恢复聊天区
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ fontSize: '11px', padding: '3px 8px', color: '#4ade80' }}
                  disabled={busy}
                  onClick={() => void restore(item.revisionId, null, true)}
                >
                  <RotateCcw size={11} style={{ marginRight: '3px', verticalAlign: 'middle' }} />
                  直接确认恢复
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {items.length > 1 && (
        <div style={{ marginTop: '20px', padding: '14px', borderRadius: '8px', border: '1px solid var(--line)', background: 'rgba(255, 255, 255, 0.02)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <GitCompare size={15} style={{ color: 'var(--accent)' }} />
            <h3 style={{ margin: 0, fontSize: '13px' }}>版本对比（任意两版）</h3>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', marginBottom: '12px' }}>
            <label style={{ fontSize: '12px' }}>基准版本 (Before):</label>
            <select
              value={leftId}
              onChange={e => setLeftId(e.target.value)}
              style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '4px', background: 'var(--panel)', border: '1px solid var(--line)', color: 'inherit' }}
            >
              {items.map(item => (
                <option key={item.revisionId} value={item.revisionId}>
                  {new Date(item.createdAt).toLocaleTimeString()} ({item.source})
                </option>
              ))}
            </select>

            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>对比</span>

            <label style={{ fontSize: '12px' }}>目标版本 (After):</label>
            <select
              value={rightId}
              onChange={e => setRightId(e.target.value)}
              style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '4px', background: 'var(--panel)', border: '1px solid var(--line)', color: 'inherit' }}
            >
              {items.map(item => (
                <option key={item.revisionId} value={item.revisionId}>
                  {new Date(item.createdAt).toLocaleTimeString()} ({item.source})
                </option>
              ))}
            </select>

            <button type="button" className="primary-button" disabled={busy || !leftId || !rightId} onClick={handleDiff}>
              计算差异
            </button>
          </div>

          {diff !== null && (
            <div style={{ marginTop: '12px' }}>
              {diff.length === 0 ? (
                <p style={{ fontSize: '12px', color: '#4ade80' }}>两个版本完全一致，没有视觉字段差异。</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {Object.entries(groupDiffs(diff)).map(([groupTitle, list]) => {
                    if (!list || list.length === 0) return null;
                    return (
                      <div key={groupTitle} style={{ background: 'rgba(0,0,0,0.25)', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--line)' }}>
                        <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '6px', color: 'var(--accent)' }}>{groupTitle} ({list.length} 项变化)</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {list.map(c => (
                            <div key={c.path} style={{ fontSize: '11px', display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace' }}>
                              <span>{c.path}</span>
                              <span>
                                <span style={{ color: '#f87171' }}>{JSON.stringify(c.before)}</span>
                                <span style={{ margin: '0 6px', color: 'var(--muted)' }}>→</span>
                                <span style={{ color: '#4ade80' }}>{JSON.stringify(c.after)}</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
