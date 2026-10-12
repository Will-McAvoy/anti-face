import { useEffect, useRef, useState } from 'react';
import { Camera, Trash2, Download, Eye, EyeOff, Columns, SlidersHorizontal, ZoomIn, ZoomOut } from 'lucide-react';
import { frameBox, sliderClip } from '../../core/compare-frame.cjs';

export function HostComparePanel({ targetId, onError }: { targetId: string | null; onError: (text: string) => void }) {
  const [groupId, setGroupId] = useState<string | null>(null);
  const [before, setBefore] = useState<string | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [beforeMeta, setBeforeMeta] = useState<{ at: string; width: number; height: number } | null>(null);
  const [afterMeta, setAfterMeta] = useState<{ at: string; width: number; height: number } | null>(null);
  const [note, setNote] = useState('还没有拍摄。这是真实窗口截图，仅保留在内存中，不上传至任何服务器。');
  const [hideSensitive, setHideSensitive] = useState(false);
  const [viewMode, setViewMode] = useState<'split' | 'side-by-side'>('split');
  const [sliderPos, setSliderPos] = useState(50);
  const [zoom, setZoom] = useState<'fit' | '100%'>('fit');
  const [comparable, setComparable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [regionKind, setRegionKind] = useState<'full' | 'chat' | 'composer' | 'sidebar' | 'card'>('full');
  const [incompatibility, setIncompatibility] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const requestToken = useRef(0);
  const seenTarget = useRef(targetId);

  function resetFrames(message: string) {
    setBefore(null);
    setAfter(null);
    setBeforeMeta(null);
    setAfterMeta(null);
    setGroupId(null);
    setComparable(true);
    setIncompatibility(null);
    setBusy(false);
    setNote(message);
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestToken.current += 1;
      const previous = seenTarget.current;
      if (previous) void window.antiFace?.invalidateCaptures(previous);
    };
  }, []);

  useEffect(() => {
    const previous = seenTarget.current;
    seenTarget.current = targetId;
    if (previous === targetId) return;
    requestToken.current += 1;
    resetFrames('已切换目标窗口，旧截图已自动清理。');
    if (previous) void window.antiFace?.clearCaptures(previous);
  }, [targetId]);

  async function shoot(phase: 'before' | 'after') {
    if (!window.antiFace || !targetId) return onError('先选择一个已连接的窗口');
    const token = ++requestToken.current;
    const currentTarget = targetId;
    setBusy(true);
    try {
      const shot = await window.antiFace.takeCapture({
        targetId,
        phase,
        groupId: groupId || undefined,
        region: regionKind,
        hideSensitive
      });

      if (!mountedRef.current || requestToken.current !== token || targetId !== currentTarget) {
        return;
      }

      if (!shot?.ok) {
        return onError(shot?.message || '截图失败');
      }

      setGroupId(shot.groupId);
      setComparable(shot.comparable !== false);
      setIncompatibility(shot.incompatibility || null);

      const image = await window.antiFace.captureImage(shot.groupId, phase);
      if (!mountedRef.current || requestToken.current !== token || targetId !== currentTarget) {
        return;
      }

      const meta = { at: new Date().toLocaleTimeString(), width: image?.width || shot.width, height: image?.height || shot.height };

      if (phase === 'before') {
        setBefore(image?.dataUrl || null);
        setBeforeMeta(meta);
      } else {
        setAfter(image?.dataUrl || null);
        setAfterMeta(meta);
      }

      const reasonText = shot.incompatibility === 'clip'
        ? '前后裁切区域不同'
        : shot.incompatibility === 'dpr'
          ? '前后设备像素比不同'
          : shot.incompatibility === 'navigation'
            ? '前后页面导航不同'
            : shot.incompatibility === 'instance'
              ? '窗口已经重连'
              : '窗口视口或分辨率前后不一致';
      setNote(
        shot.comparable === false
          ? `${reasonText}，已改为并排查看，不再叠成滑块。`
          : `已拍摄「${phase === 'before' ? '应用前' : '应用后'}」状态。${hideSensitive ? '（已开启局部隐私遮挡）' : ''}`
      );
    } catch (error) {
      if (mountedRef.current && requestToken.current === token) {
        onError(error instanceof Error ? error.message : '截图操作失败');
      }
    } finally {
      if (mountedRef.current && requestToken.current === token) {
        setBusy(false);
      }
    }
  }

  function handleClear() {
    const previous = seenTarget.current;
    requestToken.current += 1;
    resetFrames('截图记录已清空。');
    if (previous) void window.antiFace?.clearCaptures(previous);
    else void window.antiFace?.clearCaptures(null);
  }

  return (
    <section className="round5-panel">
      <h2>真实窗口对比</h2>
      <p style={{ margin: '4px 0 12px', fontSize: '13px', color: 'var(--muted)' }}>
        {note} 截图只留在本机内存。没拍完就离开，这次拍摄会作废。已经拍下的一组会保留，方便离开本页去应用主题后再拍应用后。点清除、断开窗口，或在本页换到另一个窗口，会立即销毁对应截图。
      </p>

      <div className="round5-row" style={{ flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
        <button
          type="button"
          className="primary-button"
          disabled={busy || !targetId}
          onClick={() => void shoot('before')}
        >
          <Camera size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
          拍摄之前
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={busy || !targetId}
          onClick={() => void shoot('after')}
        >
          <Camera size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
          拍摄之后
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={!targetId && !before && !after}
          onClick={handleClear}
        >
          <Trash2 size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
          清除
        </button>

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginLeft: '8px' }}>
          <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={hideSensitive}
              onChange={e => setHideSensitive(e.target.checked)}
            />
            {hideSensitive ? <EyeOff size={13} /> : <Eye size={13} />}
            遮挡敏感区域（保护聊天与输入）
          </label>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
          <select
            value={regionKind}
            onChange={e => setRegionKind(e.target.value as any)}
            style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '4px', background: 'var(--panel)', border: '1px solid var(--line)', color: 'inherit' }}
            aria-label="截图区域选择"
          >
            <option value="full">全窗口</option>
            <option value="sidebar">侧栏（按窗口实测）</option>
            <option value="chat">聊天区（按窗口实测）</option>
            <option value="composer">输入框（按窗口实测）</option>
            <option value="card">卡片（按窗口实测）</option>
          </select>
          <button
            type="button"
            className="secondary-button"
            style={{ padding: '4px 8px', fontSize: '12px' }}
            onClick={() => setViewMode(v => v === 'split' ? 'side-by-side' : 'split')}
            disabled={!before || !after || !comparable}
            title={viewMode === 'split' ? '切换为并排查看' : '切换为滑块叠加'}
          >
            {viewMode === 'split' ? <Columns size={13} /> : <SlidersHorizontal size={13} />}
            {viewMode === 'split' ? '并排查看' : '滑块对比'}
          </button>
          <button
            type="button"
            className="secondary-button"
            style={{ padding: '4px 8px', fontSize: '12px' }}
            onClick={() => setZoom(z => z === 'fit' ? '100%' : 'fit')}
            title="缩放比例切换"
          >
            {zoom === 'fit' ? <ZoomIn size={13} /> : <ZoomOut size={13} />}
            {zoom === 'fit' ? '适应窗口' : '100%'}
          </button>
        </div>
      </div>

      {(before || after) && (
        <div style={{ marginTop: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--muted)', marginBottom: '8px' }}>
            <span>
              {beforeMeta ? `应用前拍摄时间：${beforeMeta.at} (${beforeMeta.width}×${beforeMeta.height})` : '应用前：未拍摄'}
            </span>
            <span>
              {afterMeta ? `应用后拍摄时间：${afterMeta.at} (${afterMeta.width}×${afterMeta.height})` : '应用后：未拍摄'}
            </span>
          </div>

          {incompatibility && (
            <p style={{ fontSize: '12px', color: 'var(--muted)' }}>不能叠成滑块：{incompatibility}。可以并排查看，或重新拍摄同一区域。</p>
          )}
          {viewMode === 'split' && before && after && comparable ? (
            <SliderFrame
              before={before}
              after={after}
              sliderPos={sliderPos}
              setSliderPos={setSliderPos}
              zoom={zoom}
              width={beforeMeta?.width || afterMeta?.width || 0}
              height={beforeMeta?.height || afterMeta?.height || 0}
            />
          ) : (
            <div className="compare-grid" style={{ display: 'grid', gridTemplateColumns: before && after ? '1fr 1fr' : '1fr', gap: '12px' }}>
              {before && (
                <div style={{ background: '#0a0d0a', borderRadius: '8px', border: '1px solid var(--line)', padding: '8px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '6px' }}>应用前 (Before)</div>
                  <img src={before} alt="应用前的窗口截图" style={{ width: '100%', borderRadius: '4px', display: 'block' }} />
                </div>
              )}
              {after && (
                <div style={{ background: '#0a0d0a', borderRadius: '8px', border: '1px solid var(--line)', padding: '8px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '6px' }}>应用后 (After)</div>
                  <img src={after} alt="应用后的窗口截图" style={{ width: '100%', borderRadius: '4px', display: 'block' }} />
                </div>
              )}
            </div>
          )}

          {groupId && (
            <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="secondary-button"
                disabled={!before}
                onClick={() => void window.antiFace?.exportCapture(groupId, 'before')}
              >
                <Download size={13} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                导出「应用前」PNG
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={!after}
                onClick={() => void window.antiFace?.exportCapture(groupId, 'after')}
              >
                <Download size={13} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                导出「应用后」PNG
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function SliderFrame({ before, after, sliderPos, setSliderPos, zoom, width, height }: {
  before: string;
  after: string;
  sliderPos: number;
  setSliderPos: (value: number | ((value: number) => number)) => void;
  zoom: 'fit' | '100%';
  width: number;
  height: number;
}) {
  const box = frameBox(zoom, width, height);
  const frameStyle = box.mode === 'pixel'
    ? { width: box.width, height: box.height }
    : { width: '100%', aspectRatio: box.aspectRatio, maxHeight: '460px' };
  return (
    <div
      style={{ position: 'relative', overflow: box.mode === 'pixel' ? 'auto' : 'hidden', borderRadius: '8px', border: '1px solid var(--line)', background: '#0a0d0a', userSelect: 'none', ...frameStyle }}
      tabIndex={0}
      role="slider"
      aria-label="对比滑块"
      aria-valuenow={sliderPos}
      aria-valuemin={0}
      aria-valuemax={100}
      onKeyDown={event => {
        if (event.key === 'ArrowLeft') setSliderPos(value => Math.max(0, value - 5));
        if (event.key === 'ArrowRight') setSliderPos(value => Math.min(100, value + 5));
      }}
    >
      <img src={after} alt="应用后" data-compare-layer="after" style={{ width: box.mode === 'pixel' ? box.width : '100%', height: box.mode === 'pixel' ? box.height : '100%', objectFit: 'fill', display: 'block' }} />
      <img
        src={before}
        alt="应用前的窗口截图"
        data-compare-layer="before"
        style={{ position: 'absolute', inset: 0, width: box.mode === 'pixel' ? box.width : '100%', height: box.mode === 'pixel' ? box.height : '100%', objectFit: 'fill', display: 'block', clipPath: sliderClip(sliderPos) }}
      />
      <div style={{ position: 'absolute', bottom: '12px', left: '12px', background: 'rgba(0,0,0,0.6)', padding: '2px 8px', borderRadius: '4px', fontSize: '11px' }}>◀ 之前 ({sliderPos}%)</div>
      <div style={{ position: 'absolute', bottom: '12px', right: '12px', background: 'rgba(0,0,0,0.6)', padding: '2px 8px', borderRadius: '4px', fontSize: '11px' }}>之后 ({100 - sliderPos}%) ▶</div>
      <input
        type="range"
        min={0}
        max={100}
        value={sliderPos}
        onChange={event => setSliderPos(Number(event.target.value))}
        style={{ position: 'absolute', bottom: '10px', left: '25%', width: '50%', cursor: 'ew-resize', accentColor: 'var(--accent)' }}
        aria-label="拖动滑块调节对比比例"
      />
      {box.mode === 'pixel' && <p style={{ position: 'absolute', top: 8, left: 8, margin: 0, fontSize: '11px', color: '#fff' }}>100% 为实际像素 {width}×{height}</p>}
    </div>
  );
}
