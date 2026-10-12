import { useEffect, useState } from 'react';
import { Folder, Link2, Unlink, RotateCcw, AlertCircle, Info } from 'lucide-react';

export function ProjectAppearancePanel({ targetId, onError }: { targetId: string | null; onError: (text: string) => void }) {
  const [state, setState] = useState<any>(null);
  const [themeId, setThemeId] = useState('graphite');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    if (!window.antiFace) return;
    try {
      setState(await window.antiFace.listBindings(targetId));
    } catch (error) {
      onError(error instanceof Error ? error.message : '刷新项目外观状态失败');
    }
  }

  useEffect(() => { void refresh(); }, [targetId]);

  async function identify() {
    setBusy(true);
    try {
      const found = await window.antiFace!.identifyProject(targetId);
      if (!found?.reliable) {
        onError('宿主未暴露稳定的工作区项目身份（来源受限）。您可以通过选择本地项目文件夹建立关联，或直接绑定当前窗口。');
      }
      await refresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : '项目识别失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="round5-panel">
      <h2>项目外观</h2>
      <p style={{ margin: '4px 0 12px', fontSize: '13px', color: 'var(--muted)' }}>
        项目绑定支持三种来源：已验证宿主身份（verified-host）、用户手动指定项目（manual-project）以及仅本次会话（session-window）。
      </p>

      <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--line)', borderRadius: '8px', padding: '12px', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <Info size={15} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: '13px', fontWeight: 'bold' }}>当前窗口项目身份状态</span>
        </div>
        {state?.identified?.reliable ? (
          <p style={{ margin: '4px 0', fontSize: '13px' }}>
            已识别项目：{state.identified.displayHint}（来源：{state.identified.identityKind || 'manual-project'}）。
            持久绑定会留下来，但重启后当前窗口不会自动认成这个项目，需要手动重新关联。
          </p>
        ) : (
          <p style={{ margin: '4px 0', fontSize: '13px', color: 'var(--muted)' }}>
            宿主没有给出可靠项目身份。选择文件夹是手动关联，不是自动识别。重启后要再次手动关联，会话绑定也不会自动回到复用的窗口。
          </p>
        )}
      </div>

      <div className="round5-row" style={{ flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
        <button
          type="button"
          className="primary-button"
          disabled={busy || !targetId}
          onClick={() => void identify()}
        >
          <Folder size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
          选择项目文件夹
        </button>

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <label style={{ fontSize: '12px' }}>主题标识:</label>
          <input
            value={themeId}
            onChange={e => setThemeId(e.target.value)}
            aria-label="主题标识"
            style={{ width: '100px', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--line)', background: 'var(--panel)', color: 'inherit' }}
          />
        </div>

        <button
          type="button"
          className="secondary-button"
          disabled={busy || !targetId}
          onClick={() => {
            void window.antiFace?.bindSession(themeId, targetId, '当前窗口')
              .then(refresh)
              .catch(err => onError(err.message));
          }}
        >
          <Link2 size={13} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
          绑定当前窗口（会话级）
        </button>

        <button
          type="button"
          className="secondary-button"
          disabled={busy || !state?.identified?.projectKey}
          onClick={() => {
            void window.antiFace?.saveBinding({ projectKey: state.identified.projectKey, themeId })
              .then(refresh)
              .catch(err => onError(err.message));
          }}
        >
          保存项目绑定
        </button>

        <button
          type="button"
          className="secondary-button"
          disabled={busy || !targetId}
          onClick={() => {
            void window.antiFace?.resumeAutomationTarget(targetId)
              .then(refresh)
              .catch(err => onError(err.message));
          }}
        >
          <RotateCcw size={13} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
          恢复自动模式
        </button>
      </div>

      {state?.current?.dangling && (
        <div style={{ marginTop: '12px', padding: '8px 12px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <AlertCircle size={14} />
          当前绑定的主题「{state.current.themeId}」在个人库及内置主题中均不存在，请改绑或解除。
        </div>
      )}

      <div style={{ marginTop: '16px' }}>
        <h3 style={{ fontSize: '13px', margin: '0 0 8px' }}>已保存的持久化项目绑定</h3>
        {(!state?.persisted || state.persisted.length === 0) ? (
          <p style={{ fontSize: '12px', color: 'var(--muted)' }}>暂无持久化项目绑定记录。</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {state.persisted.map((item: any) => (
              <li
                key={item.bindingId}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid var(--line)',
                  marginBottom: '6px',
                  fontSize: '12px'
                }}
              >
                <div>
                  <span>{item.displayHint} → {item.themeId}</span>
                  {item.dangling && <span style={{ color: '#f87171', marginLeft: '6px' }}>（主题缺失）</span>}
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ fontSize: '11px', padding: '2px 8px' }}
                    onClick={() => void window.antiFace?.saveBinding({ projectKey: item.projectKey, themeId }).then(refresh)}
                  >
                    改绑
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ fontSize: '11px', padding: '2px 8px', color: '#f87171' }}
                    onClick={() => void window.antiFace?.removeBinding(item.projectKey).then(refresh)}
                  >
                    <Unlink size={11} style={{ marginRight: '3px', verticalAlign: 'middle' }} />
                    解除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
