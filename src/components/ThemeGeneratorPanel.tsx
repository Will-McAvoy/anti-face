import { useEffect, useRef, useState } from 'react';
import { Lock, Unlock, Sparkles, XCircle, Check } from 'lucide-react';
import type { ThemeDocument } from '../types';

const ROLES = [
  { role: 'accent', label: '强调色' },
  { role: 'background', label: '主背景' },
  { role: 'panel', label: '面板色' },
  { role: 'foreground', label: '前景色' },
  { role: 'muted', label: '次要文字' }
] as const;

export function ThemeGeneratorPanel({ document, onDocument, onError }: {
  document: ThemeDocument | null;
  onDocument: (document: ThemeDocument) => void;
  onError: (text: string) => void;
}) {
  const [schemes, setSchemes] = useState<any[]>([]);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockedRoles, setLockedRoles] = useState<Set<string>>(new Set());
  const active = useRef<string | null>(null);
  const lastAssetId = useRef<string | null>(document?.wallpaper?.assetId || null);

  useEffect(() => {
    return () => {
      if (active.current) void window.antiFace?.cancelGenerate(active.current);
      active.current = null;
    };
  }, []);

  // Invalidate previous results when wallpaper asset changes
  useEffect(() => {
    const currentAssetId = document?.wallpaper?.assetId || null;
    if (lastAssetId.current !== currentAssetId) {
      lastAssetId.current = currentAssetId;
      if (active.current) void window.antiFace?.cancelGenerate(active.current);
      active.current = null;
      setRequestId(null);
      setSchemes([]);
      setBusy(false);
    }
  }, [document?.wallpaper?.assetId]);

  useEffect(() => {
    setSchemes([]);
    setRequestId(null);
  }, [document?.id]);

  function toggleRoleLock(role: string) {
    setLockedRoles(prev => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }

  function getLocksPayload(): Record<string, string> {
    const locks: Record<string, string> = {};
    if (!document?.colors) return locks;
    for (const role of lockedRoles) {
      const val = (document.colors as any)[role];
      if (val) locks[role] = val;
    }
    return locks;
  }

  async function generate() {
    if (!document?.wallpaper?.assetId || !window.antiFace) return onError('先导入一张壁纸图片');
    if (active.current) void window.antiFace.cancelGenerate(active.current);

    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    active.current = id;
    setRequestId(id);
    setSchemes([]);
    setBusy(true);

    try {
      const locks = getLocksPayload();
      const result = await window.antiFace.generateThemes(document.wallpaper.assetId, locks, id);
      if (active.current !== id) return;
      if (!result?.ok) {
        if (result?.code !== 'CANCELLED') onError(result?.message || '没有生成主题');
        return;
      }
      setSchemes(result.schemes || []);
    } catch (error) {
      if (active.current !== id) return;
      onError(error instanceof Error ? error.message : '生成失败');
    } finally {
      if (active.current === id) setBusy(false);
    }
  }

  function handleCancel() {
    if (active.current) void window.antiFace?.cancelGenerate(active.current);
    active.current = null;
    setRequestId(null);
    setSchemes([]);
    setBusy(false);
  }

  async function adopt(colors: Record<string, string>, filterRoles?: string[]) {
    if (!document || !window.antiFace) return;
    const toAdopt: Record<string, string> = {};
    for (const [key, val] of Object.entries(colors)) {
      if (!filterRoles || filterRoles.includes(key)) {
        toAdopt[key] = val;
      }
    }
    const updated = await window.antiFace.adoptColors(document, toAdopt);
    onDocument(updated);
  }

  return (
    <section className="round5-panel">
      <h2>一张图片生成整套主题</h2>
      <p style={{ margin: '4px 0 12px', fontSize: '13px', color: 'var(--muted)' }}>
        在本机执行确定性配色算法，不使用云端大模型。采用配色保留现有的构图、字体与壁纸设置。
      </p>

      <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--line)', borderRadius: '8px', padding: '12px', marginBottom: '12px' }}>
        <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '6px' }}>锁定当前主题角色（锁定项在生成时将被保持）：</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {ROLES.map(({ role, label }) => {
            const isLocked = lockedRoles.has(role);
            const currentColor = document?.colors ? (document.colors as any)[role] : null;
            return (
              <button
                key={role}
                type="button"
                className={isLocked ? 'primary-button' : 'secondary-button'}
                style={{ fontSize: '12px', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                onClick={() => toggleRoleLock(role)}
              >
                {isLocked ? <Lock size={12} /> : <Unlock size={12} />}
                {label} {currentColor && <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: currentColor, display: 'inline-block' }} />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="round5-row">
        <button
          type="button"
          className="primary-button"
          disabled={busy || !document?.wallpaper?.assetId}
          onClick={() => void generate()}
        >
          <Sparkles size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
          {busy ? '正在分析生成…' : '生成整套主题'}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={!busy && schemes.length === 0}
          onClick={handleCancel}
        >
          <XCircle size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
          取消
        </button>
      </div>

      <div className="round5-grid" style={{ marginTop: '16px' }}>
        {schemes.map(scheme => (
          <article key={scheme.id} className="round5-card" style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <strong>{scheme.label}</strong>
              <span style={{ fontSize: '12px', color: 'var(--muted)' }}>纯色对比约 {scheme.contrast}:1</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', margin: '8px 0' }}>
              {ROLES.map(({ role, label }) => {
                const color = scheme.colors?.[role];
                if (!color) return null;
                return (
                  <div key={role} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: '14px', height: '14px', borderRadius: '3px', background: color, border: '1px solid rgba(255,255,255,0.2)' }} />
                      <span>{label}</span>
                    </div>
                    <code style={{ fontSize: '11px', color: 'var(--muted)' }}>{color}</code>
                  </div>
                );
              })}
            </div>

            {(scheme.warnings || []).map((item: { message: string }, index: number) => (
              <p key={index} style={{ fontSize: '11px', color: '#fbbf24', margin: '4px 0' }}>⚠ {item.message}</p>
            ))}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px', paddingTop: '8px', borderTop: '1px solid var(--line)' }}>
              <button
                type="button"
                className="primary-button"
                style={{ width: '100%', fontSize: '12px' }}
                onClick={() => void adopt(scheme.colors)}
              >
                <Check size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                采用整套方案
              </button>
              <button
                type="button"
                className="secondary-button"
                style={{ fontSize: '11px', padding: '3px 8px' }}
                onClick={() => void adopt(scheme.colors, ['accent'])}
              >
                仅采用强调色
              </button>
              <button
                type="button"
                className="secondary-button"
                style={{ fontSize: '11px', padding: '3px 8px' }}
                onClick={() => void adopt(scheme.colors, ['background', 'panel'])}
              >
                仅采用背景/面板
              </button>
              <button
                type="button"
                className="secondary-button"
                style={{ fontSize: '11px', padding: '3px 8px' }}
                onClick={() => void adopt(scheme.colors, ['foreground', 'muted'])}
              >
                仅采用文字颜色
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
