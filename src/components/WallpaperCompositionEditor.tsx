import { useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { NormalizedRect, ThemeDocument } from '../types';

function emptyRect(): NormalizedRect {
  return { x: 0.2, y: 0.2, width: 0.4, height: 0.4 };
}

export function WallpaperCompositionEditor({ document, onDocument }: {
  document: ThemeDocument | null;
  onDocument: (document: ThemeDocument) => void;
}) {
  const [drag, setDrag] = useState<'subject' | 'text' | null>(null);
  const [draft, setDraft] = useState<ThemeDocument['wallpaper']['composition'] | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<ThemeDocument['wallpaper']['composition'] | null>(null);
  const saved = document?.wallpaper?.composition || { subjectRect: null, textSafeRect: null, policy: 'manual' as const };
  const composition = draft || saved;
  liveRef.current = composition;

  function commit(next: ThemeDocument['wallpaper']['composition']) {
    if (!document || !next) return;
    onDocument({ ...document, wallpaper: { ...document.wallpaper, composition: next } });
  }

  function move(kind: 'subjectRect' | 'textSafeRect', event: PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.min(0.9, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const y = Math.min(0.9, Math.max(0, (event.clientY - bounds.top) / bounds.height));
    const base = liveRef.current || composition;
    const current = (kind === 'subjectRect' ? base.subjectRect : base.textSafeRect) || emptyRect();
    const next = { ...base, [kind]: { ...current, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 } };
    liveRef.current = next;
    setDraft(next);
  }

  function nudge(kind: 'subjectRect' | 'textSafeRect', dx: number, dy: number) {
    const current = (composition[kind] || emptyRect());
    commit({
      ...composition,
      [kind]: {
        ...current,
        x: Math.round(Math.min(0.99, Math.max(0, current.x + dx)) * 1000) / 1000,
        y: Math.round(Math.min(0.99, Math.max(0, current.y + dy)) * 1000) / 1000
      }
    });
  }

  return (
    <section className="round5-panel">
      <h2>壁纸构图</h2>
      <p>拖动矩形只记一次。策略保存在主题里，窗口缩放时的焦点变化不会另存一版。</p>
      <div className="round5-row">
        {([['manual', '手动'], ['protect-subject', '保护主体'], ['protect-text', '保护文字'], ['balanced', '平衡']] as const).map(([id, label]) => (
          <button key={id} type="button" className={composition.policy === id ? 'primary-button' : 'secondary-button'} onClick={() => { setDraft(null); commit({ ...saved, policy: id }); }}>{label}</button>
        ))}
        <button type="button" className="secondary-button" onClick={() => { setDraft(null); commit({ subjectRect: null, textSafeRect: null, policy: 'manual' }); }}>重置</button>
      </div>
      <div
        ref={stageRef}
        className="composition-stage"
        onPointerMove={event => {
          if (drag === 'subject') move('subjectRect', event);
          if (drag === 'text') move('textSafeRect', event);
        }}
        onPointerUp={() => {
          if (drag && liveRef.current) commit(liveRef.current);
          setDrag(null);
          setDraft(null);
        }}
      >
        <button type="button" className="composition-rect subject" style={rectStyle(composition.subjectRect)} onPointerDown={event => { stageRef.current?.setPointerCapture(event.pointerId); setDrag('subject'); }}>主体</button>
        <button type="button" className="composition-rect text" style={rectStyle(composition.textSafeRect)} onPointerDown={event => { stageRef.current?.setPointerCapture(event.pointerId); setDrag('text'); }}>留白</button>
      </div>
      <div className="round5-row">
        <button type="button" onClick={() => nudge('subjectRect', -0.01, 0)}>主体左移</button>
        <button type="button" onClick={() => nudge('subjectRect', 0.01, 0)}>主体右移</button>
        <button type="button" onClick={() => nudge('textSafeRect', 0, -0.01)}>留白上移</button>
        <button type="button" onClick={() => nudge('textSafeRect', 0, 0.01)}>留白下移</button>
      </div>
    </section>
  );
}

function rectStyle(rect: NormalizedRect | null | undefined) {
  const value = rect || { x: 0.1, y: 0.1, width: 0.01, height: 0.01 };
  return { left: `${value.x * 100}%`, top: `${value.y * 100}%`, width: `${value.width * 100}%`, height: `${value.height * 100}%` };
}
