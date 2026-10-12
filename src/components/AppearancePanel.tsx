import { useState } from 'react';
import { ImagePlus, RotateCcw, X } from 'lucide-react';
import type { Appearance, PerformancePreset, RegionId, ThemeDocument } from '../types';

const REGIONS: { id: RegionId; label: string }[] = [
  { id: 'global', label: '全局基础' },
  { id: 'sidebar', label: '侧边栏' },
  { id: 'chat', label: '聊天内容区' },
  { id: 'composer', label: '输入框' },
  { id: 'card', label: '卡片与消息' }
];

const PRESETS: Record<PerformancePreset, { blur: number; opacity: number; radius: number; label: string; desc: string }> = {
  performance: { blur: 0, opacity: 90, radius: 8, label: '性能优先', desc: '无模糊，长时工作低开销' },
  balanced: { blur: 12, opacity: 75, radius: 16, label: '平衡', desc: '适度毛玻璃与柔和过渡' },
  visual: { blur: 24, opacity: 64, radius: 24, label: '视觉优先', desc: '质感磨砂与大圆角' }
};

export function AppearancePanel({
  value,
  preset,
  onChange,
  onPresetChange,
  onWallpaper,
  onReset,
  region = 'global',
  onRegion,
  document,
  onDocument,
  onGesture,
  onExtractPalette,
  onUndo,
  onRedo,
  onRevertBaseline,
  canUndo = false,
  canRedo = false,
  undoLabel = '撤销',
  redoLabel = '重做',
  onCopyParts
}: {
  value: Appearance;
  preset?: PerformancePreset;
  onChange: (next: Appearance) => void;
  onPresetChange?: (preset: PerformancePreset) => void;
  onWallpaper: () => void;
  onReset: () => void;
  region?: RegionId;
  onRegion?: (region: RegionId) => void;
  document?: ThemeDocument | null;
  onDocument?: (document: ThemeDocument) => void;
  onGesture?: (phase: 'start' | 'end') => void;
  onExtractPalette?: () => Promise<{ colors: { hex: string }[]; hint?: { note: string } | null } | null>;
  onUndo?: () => void;
  onRedo?: () => void;
  onRevertBaseline?: () => void;
  onCopyParts?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  undoLabel?: string;
  redoLabel?: string;
}) {
  const handleSelectPreset = (p: PerformancePreset) => {
    const pVal = PRESETS[p];
    onChange({
      ...value,
      blur: pVal.blur,
      opacity: pVal.opacity,
      radius: pVal.radius
    });
    if (onPresetChange) onPresetChange(p);
  };

  return (
    <section className="appearance-panel">
      <div className="section-heading">
        <h2>细调外观</h2>
        <div style={{ display: 'flex', gap: '4px' }}>
          {onUndo && (
            <button
              type="button"
              className="icon-button"
              disabled={!canUndo}
              onClick={onUndo}
              aria-label={undoLabel}
              title={undoLabel + ' (Ctrl+Z)'}
              style={{ opacity: canUndo ? 1 : 0.4 }}
            >
              ↺
            </button>
          )}
          {onRedo && (
            <button
              type="button"
              className="icon-button"
              disabled={!canRedo}
              onClick={onRedo}
              aria-label={redoLabel}
              title={redoLabel + ' (Ctrl+Shift+Z)'}
              style={{ opacity: canRedo ? 1 : 0.4 }}
            >
              ↻
            </button>
          )}
          {onRevertBaseline && (
            <button
              type="button"
              className="icon-button"
              onClick={onRevertBaseline}
              aria-label="恢复进入编辑时状态"
              title="恢复进入编辑时状态"
            >
              <RotateCcw size={14} />
            </button>
          )}
          {onCopyParts && (
            <button
              type="button"
              className="secondary-button"
              style={{ padding: '2px 8px', fontSize: '11px', marginLeft: '4px' }}
              onClick={onCopyParts}
              title="从其他主题复制部件（配色、排版、壁纸或区域）"
            >
              局部复制
            </button>
          )}
        </div>
      </div>
      <p>把工作空间，调成喜欢的样子。重置整套外观会清除区域覆盖、壁纸和排版。</p>
      {onRegion && (
        <div className="theme-filters" role="group" aria-label="外观区域">
          {REGIONS.map(item => (
            <button key={item.id} type="button" aria-pressed={region === item.id} className={region === item.id ? 'active' : ''} onClick={() => onRegion(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      )}

      <div className="preset-selector" style={{ marginBottom: '16px' }}>
        <span style={{ fontSize: '12px', color: 'var(--muted)', display: 'block', marginBottom: '8px' }}>
          性能预设模式
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
          {(['performance', 'balanced', 'visual'] as const).map(pKey => {
            const p = PRESETS[pKey];
            const isSelected = value.blur === p.blur && value.opacity === p.opacity && value.radius === p.radius;
            return (
              <button
                key={pKey}
                type="button"
                className={`secondary-button ${isSelected ? 'active' : ''}`}
                style={{
                  padding: '6px 4px',
                  fontSize: '12px',
                  border: isSelected ? '1px solid var(--accent)' : '1px solid var(--line)',
                  background: isSelected ? 'rgba(197, 219, 168, 0.15)' : 'transparent',
                  color: isSelected ? 'var(--accent)' : 'inherit',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
                onClick={() => handleSelectPreset(pKey)}
                title={p.desc}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {([
        { key: 'blur', label: '背景模糊', max: 40, min: 0, unit: 'px' },
        { key: 'opacity', label: '面板不透明度', max: 100, min: 40, unit: '%' },
        { key: 'radius', label: '卡片圆角', max: 28, min: 0, unit: 'px' }
      ] as const).map(item => (
        <label className="slider-field" key={item.key}>
          <span>
            {item.label}
            <output>{value[item.key]}{item.unit}</output>
          </span>
          <input
            type="range"
            aria-label={item.label}
            min={item.min}
            max={item.max}
            value={value[item.key]}
            onPointerDown={() => onGesture?.('start')}
            onPointerUp={() => onGesture?.('end')}
            onPointerCancel={() => onGesture?.('end')}
            onChange={e => onChange({ ...value, [item.key]: Number(e.target.value) })}
          />
        </label>
      ))}

      <div className="wallpaper-label">自定义壁纸</div>
      <button
        className={'wallpaper-picker' + (value.wallpaper ? ' has-image' : '')}
        onClick={onWallpaper}
        style={value.wallpaper ? { backgroundImage: 'url("' + value.wallpaper + '")' } : undefined}
      >
        <ImagePlus size={22} />
        <span>{value.wallpaper ? '更换壁纸' : '选择一张喜欢的图片'}</span>
        <small>PNG / JPG / WebP · 最大 5 MB</small>
      </button>
      {value.wallpaper && (
        <button
          className="text-button remove-wallpaper"
          onClick={() => {
            onChange({ ...value, wallpaper: null });
            if (document && onDocument) {
              onDocument({
                ...document,
                preset: 'custom',
                wallpaper: {
                  ...document.wallpaper,
                  assetId: null,
                  legacyDataUrl: null
                }
              });
            }
          }}
        >
          <X size={13} />
          移除壁纸
        </button>
      )}
      {document && onDocument && region !== 'global' && (
        <RegionFields region={region} document={document} onDocument={onDocument} onGesture={onGesture} />
      )}
      {document && onDocument && (
        <WallpaperFields document={document} onDocument={onDocument} onGesture={onGesture} onExtractPalette={onExtractPalette} />
      )}
      <div className="appearance-note">
        <span>小提示</span>
        <p>性能优先模式关闭背景模糊；玻璃主题搭配壁纸更有层次。壁纸模糊只作用在背景层，文字保持清晰。</p>
      </div>
    </section>
  );
}

function patchRegion(document: ThemeDocument, region: RegionId, patch: Record<string, number | string | null>): ThemeDocument {
  const current = document.regions[region] || {};
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value == null) delete (next as Record<string, unknown>)[key];
    else (next as Record<string, unknown>)[key] = value;
  }
  return { ...document, preset: 'custom', regions: { ...document.regions, [region]: Object.keys(next).length ? next : null } };
}

function gestureProps(onGesture?: (phase: 'start' | 'end') => void) {
  return {
    onPointerDown: () => onGesture?.('start'),
    onPointerUp: () => onGesture?.('end'),
    onPointerCancel: () => onGesture?.('end')
  };
}

function RegionFields({ region, document, onDocument, onGesture }: { region: RegionId; document: ThemeDocument; onDocument: (document: ThemeDocument) => void; onGesture?: (phase: 'start' | 'end') => void }) {
  const current = document.regions[region];
  const fields = [
    ['opacity', '不透明度', 40, 100, '%'],
    ['blur', '模糊', 0, 40, 'px'],
    ['radius', '圆角', 0, 28, 'px'],
    ['borderWidth', '边框宽度', 0, 3, 'px'],
    ['borderStrength', '边框强度', 0, 100, '%']
  ] as const;
  return (
    <div>
      <label className="slider-field">
        <span>继承全局<input type="checkbox" checked={!current} onChange={event => onDocument({ ...document, regions: { ...document.regions, [region]: event.target.checked ? null : { opacity: 80 } } })} /></span>
      </label>
      {fields.map(([key, label, min, max, unit]) => (
        <label className="slider-field" key={key}>
          <span>{label}<output>{current && current[key] != null ? `${current[key]}${unit}` : '继承'}</output></span>
          <input aria-label={`${region}-${label}`} type="range" min={min} max={max} disabled={!current} value={current?.[key] ?? min} {...gestureProps(onGesture)} onChange={event => onDocument(patchRegion(document, region, { [key]: Number(event.target.value) }))} />
        </label>
      ))}
      <label className="slider-field">
        <span>阴影</span>
        <select aria-label={`${region}-阴影`} value={current?.shadow || 'inherit'} onChange={event => onDocument(event.target.value === 'inherit' ? patchRegion(document, region, { shadow: null }) : patchRegion(document, region, { shadow: event.target.value }))}>
          <option value="inherit">继承</option>
          <option value="none">无</option>
          <option value="soft">轻</option>
          <option value="medium">中</option>
        </select>
      </label>
      {region === 'chat' && <ChatType document={document} onDocument={onDocument} onGesture={onGesture} />}
      <button type="button" className="text-button" onClick={() => onDocument({ ...document, regions: { ...document.regions, [region]: null } })}>重置此区域</button>
    </div>
  );
}

function ChatType({ document, onDocument, onGesture }: { document: ThemeDocument; onDocument: (document: ThemeDocument) => void; onGesture?: (phase: 'start' | 'end') => void }) {
  const type = document.typography;
  const set = (patch: Partial<ThemeDocument['typography']>) => onDocument({ ...document, typography: { ...type, ...patch } });
  return (
    <div>
      <div className="wallpaper-label">聊天排版</div>
      <p>只改变聊天正文，不改变代码编辑器、终端和图标。</p>
      <label className="slider-field">
        <span>聊天字号<output>{type.chatFontSize == null ? '默认' : `${type.chatFontSize}px`}</output></span>
        <input aria-label="聊天字号" type="range" min={12} max={22} disabled={type.chatFontSize == null} value={type.chatFontSize ?? 16} {...gestureProps(onGesture)} onChange={event => set({ chatFontSize: Number(event.target.value) })} />
      </label>
      <label><input type="checkbox" checked={type.chatFontSize == null} onChange={event => set({ chatFontSize: event.target.checked ? null : 16 })} /> 字号跟随宿主</label>
      <label className="slider-field">
        <span>行距<output>{type.lineHeight == null ? '默认' : type.lineHeight}</output></span>
        <input aria-label="聊天行距" type="range" min={1.3} max={2} step={0.1} disabled={type.lineHeight == null} value={type.lineHeight ?? 1.5} {...gestureProps(onGesture)} onChange={event => set({ lineHeight: Number(event.target.value) })} />
      </label>
      <label><input type="checkbox" checked={type.lineHeight == null} onChange={event => set({ lineHeight: event.target.checked ? null : 1.5 })} /> 行距跟随宿主</label>
      <label className="slider-field">
        <span>内容宽度<output>{type.contentWidth == null ? '默认' : `${type.contentWidth}px`}</output></span>
        <input aria-label="内容宽度" type="range" min={640} max={1200} step={20} disabled={type.contentWidth == null} value={type.contentWidth ?? 800} {...gestureProps(onGesture)} onChange={event => set({ contentWidth: Number(event.target.value) })} />
      </label>
      <label><input type="checkbox" checked={type.contentWidth == null} onChange={event => set({ contentWidth: event.target.checked ? null : 800 })} /> 宽度跟随宿主</label>
    </div>
  );
}

function FocalPointPicker({
  focusX,
  focusY,
  imageUrl,
  onChange,
  onGesture
}: {
  focusX: number;
  focusY: number;
  imageUrl?: string | null;
  onChange: (x: number, y: number) => void;
  onGesture?: (phase: 'start' | 'end') => void;
}) {
  const [dragging, setDragging] = useState(false);

  const handlePointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
    const y = Math.max(0, Math.min(100, Math.round(((e.clientY - rect.top) / rect.height) * 100)));
    onChange(x, y);
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <span style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
        焦点构图（拖动设定视觉中心）: {focusX}%, {focusY}%
      </span>
      <div
        role="slider"
        aria-label="壁纸焦点位置"
        aria-valuenow={focusX}
        style={{
          position: 'relative',
          width: '100%',
          height: 120,
          borderRadius: 8,
          border: '1px solid var(--line)',
          background: imageUrl ? `url("${imageUrl}") center/cover no-repeat` : 'rgba(255,255,255,0.05)',
          overflow: 'hidden',
          cursor: dragging ? 'grabbing' : 'crosshair',
          touchAction: 'none'
        }}
        onPointerDown={e => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
          onGesture?.('start');
          handlePointer(e);
        }}
        onPointerMove={e => {
          if (dragging) handlePointer(e);
        }}
        onPointerUp={e => {
          setDragging(false);
          onGesture?.('end');
        }}
        onPointerCancel={() => {
          setDragging(false);
          onGesture?.('end');
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: `${focusY}%`,
            height: 1,
            background: 'rgba(255,255,255,0.4)',
            pointerEvents: 'none'
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${focusX}%`,
            width: 1,
            background: 'rgba(255,255,255,0.4)',
            pointerEvents: 'none'
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: `${focusX}%`,
            top: `${focusY}%`,
            width: 16,
            height: 16,
            borderRadius: '50%',
            border: '2px solid var(--accent, #a3e635)',
            background: 'rgba(0,0,0,0.6)',
            boxShadow: '0 0 4px rgba(0,0,0,0.8)',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none'
          }}
        />
      </div>
    </div>
  );
}

function WallpaperFields({ document, onDocument, onGesture, onExtractPalette }: { document: ThemeDocument; onDocument: (document: ThemeDocument) => void; onGesture?: (phase: 'start' | 'end') => void; onExtractPalette?: () => Promise<{ colors: { hex: string }[]; hint?: { note: string } | null } | null> }) {
  const wallpaper = document.wallpaper;
  const set = (patch: Partial<ThemeDocument['wallpaper']>) => onDocument({ ...document, preset: 'custom', wallpaper: { ...wallpaper, ...patch } });
  return (
    <div>
      <div className="wallpaper-label">壁纸效果</div>
      <label className="slider-field"><span>填充<select aria-label="壁纸填充" value={wallpaper.fit} onChange={event => set({ fit: event.target.value as 'cover' | 'contain' })}><option value="cover">铺满</option><option value="contain">完整显示</option></select></span></label>
      <FocalPointPicker
        focusX={wallpaper.focusX}
        focusY={wallpaper.focusY}
        imageUrl={wallpaper.legacyDataUrl}
        onChange={(x, y) => set({ focusX: x, focusY: y })}
        onGesture={onGesture}
      />
      {([
        ['focusX', '水平焦点', 0, 100],
        ['focusY', '垂直焦点', 0, 100],
        ['scale', '缩放', 100, 200],
        ['blur', '壁纸模糊', 0, 30],
        ['brightness', '亮度', 30, 150],
        ['saturate', '饱和度', 0, 150],
        ['maskStrength', '遮罩强度', 0, 80]
      ] as const).map(([key, label, min, max]) => (
        <label className="slider-field" key={key}>
          <span>{label}<output>{wallpaper[key]}</output></span>
          <input aria-label={label} type="range" min={min} max={max} value={wallpaper[key]} {...gestureProps(onGesture)} onChange={event => set({ [key]: Number(event.target.value) })} />
        </label>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" className="text-button" onClick={() => set({ fit: 'cover', focusX: 50, focusY: 50, scale: 100, blur: 0, brightness: 100, saturate: 100, maskColor: '#000000', maskStrength: 0 })}>重置壁纸效果</button>
        <button type="button" className="text-button" onClick={() => set({ assetId: null, legacyDataUrl: null, fit: 'cover', focusX: 50, focusY: 50, scale: 100, blur: 0, brightness: 100, saturate: 100, maskColor: '#000000', maskStrength: 0 })}>清除壁纸</button>
      </div>
      <PalettePicker document={document} onDocument={onDocument} onExtractPalette={onExtractPalette} />
    </div>
  );
}

function PalettePicker({ document, onDocument, onExtractPalette }: { document: ThemeDocument; onDocument: (document: ThemeDocument) => void; onExtractPalette?: () => Promise<{ colors: { hex: string }[]; hint?: { note: string } | null } | null> }) {
  const [colors, setColors] = useState<{ hex: string }[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button type="button" className="secondary-button" disabled={!document.wallpaper.assetId || !onExtractPalette} onClick={() => {
        if (!onExtractPalette) return;
        void onExtractPalette().then(result => {
          setColors(result?.colors || []);
          setHint(result?.hint?.note || null);
          setError(result ? null : '还没有可取样的壁纸');
        }).catch(reason => setError(reason instanceof Error ? reason.message : '取色失败'));
      }}>提取强调色</button>
      {error && <p>{error}</p>}
      {hint && <p>{hint}</p>}
      <div className="header-actions">
        {colors.map(color => (
          <button key={color.hex} type="button" className="secondary-button" aria-label={`采用强调色 ${color.hex}`} style={{ background: color.hex }} onClick={() => onDocument({ ...document, colors: { ...document.colors, accent: color.hex } })}>{color.hex}</button>
        ))}
      </div>
    </div>
  );
}
