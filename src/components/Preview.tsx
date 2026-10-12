import type { CSSProperties } from 'react';
import { ArrowUp, ChevronDown, Clock3, Folder, MessageSquare, Plus, Search, Sparkles, Sliders } from 'lucide-react';
import type { Appearance, Theme, ThemeDocument } from '../types';

export function Preview({
  theme,
  appearance,
  document,
  effectiveVisual,
  scene = 'home',
  onSceneChange,
  adjustments
}: {
  theme: Theme;
  appearance: Appearance;
  document?: ThemeDocument | null;
  effectiveVisual?: any | null;
  scene?: 'home' | 'chat';
  onSceneChange?: (scene: 'home' | 'chat') => void;
  adjustments?: Array<{ id: string; field: string; reason: string; from: any; to: any }>;
}) {
  const vis = effectiveVisual;
  const accent = vis?.colors?.accent || document?.colors?.accent || theme.accent;
  const background = vis?.colors?.background || document?.colors?.background || theme.background;
  const panel = vis?.colors?.panel || document?.colors?.panel || theme.panel;
  const foreground = vis?.colors?.foreground || document?.colors?.foreground || theme.foreground;
  const muted = vis?.colors?.muted || document?.colors?.muted || theme.muted;

  const globalReg = vis?.regions?.global || document?.regions?.global;
  const sidebarReg = vis?.regions?.sidebar || document?.regions?.sidebar;
  const chatReg = vis?.regions?.chat || document?.regions?.chat;
  const composerReg = vis?.regions?.composer || document?.regions?.composer;
  const cardReg = vis?.regions?.card || document?.regions?.card;

  const opacity = globalReg?.opacity ?? appearance.opacity;
  const blur = globalReg?.blur ?? appearance.blur;
  const radius = globalReg?.radius ?? appearance.radius;

  const wp = vis?.wallpaper || document?.wallpaper;
  const wallpaperUrl = document?.wallpaper?.legacyDataUrl || appearance.wallpaper;
  const wpSize = wp?.fit === 'contain' ? 'contain' : 'cover';
  const wpPos = wp ? `${wp.focusX}% ${wp.focusY}%` : 'center';
  const wpScale = wp ? wp.scale / 100 : 1;
  const wpFilter = wp ? `blur(${wp.blur}px) brightness(${wp.brightness}%) saturate(${wp.saturate}%)` : 'none';

  const typo = vis?.typography || document?.typography;
  const chatFontSize = typo?.chatFontSize ? `${typo.chatFontSize}px` : '10px';
  const lineHeight = typo?.lineHeight ? String(typo.lineHeight) : '1.4';
  const contentWidth = typo?.contentWidth ? `min(${typo.contentWidth}px, 100%)` : '100%';

  const appliedAdjustments = adjustments || [];

  const style = {
    '--preview-bg': background,
    '--preview-panel': panel,
    '--preview-fg': foreground,
    '--preview-muted': muted,
    '--preview-accent': accent,
    '--preview-opacity': opacity + '%',
    '--preview-blur': blur + 'px',
    '--preview-radius': radius + 'px',

    '--preview-sidebar-opacity': (sidebarReg?.opacity ?? opacity) + '%',
    '--preview-sidebar-blur': (sidebarReg?.blur ?? blur) + 'px',
    '--preview-sidebar-radius': (sidebarReg?.radius ?? radius) + 'px',

    '--preview-chat-opacity': (chatReg?.opacity ?? opacity) + '%',
    '--preview-chat-blur': (chatReg?.blur ?? blur) + 'px',
    '--preview-chat-radius': (chatReg?.radius ?? radius) + 'px',

    '--preview-composer-opacity': (composerReg?.opacity ?? opacity) + '%',
    '--preview-composer-blur': (composerReg?.blur ?? blur) + 'px',
    '--preview-composer-radius': (composerReg?.radius ?? radius) + 'px',

    '--preview-card-opacity': (cardReg?.opacity ?? opacity) + '%',
    '--preview-card-blur': (cardReg?.blur ?? blur) + 'px',
    '--preview-card-radius': (cardReg?.radius ?? radius) + 'px',

    '--preview-chat-font-size': chatFontSize,
    '--preview-chat-line-height': lineHeight,
    '--preview-content-width': contentWidth,

    backgroundImage: wallpaperUrl ? `url("${wallpaperUrl}")` : theme.gradient,
    position: 'relative'
  } as CSSProperties;

  return (
    <div className="preview" style={style} data-testid="theme-preview" aria-label={theme.name + '主题预览'}>
      {wallpaperUrl && (
        <div
          className="preview-wallpaper-layer"
          style={{
            position: 'absolute',
            inset: wp?.blur && wp.blur > 0 ? (wp.fit === 'contain' ? 0 : '-16px') : 0,
            backgroundImage: `url("${wallpaperUrl}")`,
            backgroundColor: background,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: wpPos,
            backgroundSize: wpSize,
            transform: `scale(${wpScale})`,
            filter: wpFilter,
            pointerEvents: 'none',
            zIndex: 0
          }}
        />
      )}
      {wallpaperUrl && wp && wp.maskStrength > 0 && (
        <div
          className="preview-mask-layer"
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: wp.maskColor || '#000000',
            opacity: wp.maskStrength / 100,
            pointerEvents: 'none',
            zIndex: 1
          }}
        />
      )}
      <div className="preview-content-layer" style={{ position: 'relative', zIndex: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div className="preview-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="window-dots"><i /><i /><i /></span>
            <span>Antigravity</span>
            <span className="preview-tag">
              {scene === 'chat' ? '聊天专注' : '首页氛围'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {appliedAdjustments.length > 0 && (
              <span
                style={{
                  fontSize: '10px',
                  background: 'rgba(255, 255, 255, 0.12)',
                  color: foreground,
                  padding: '2px 6px',
                  borderRadius: '4px',
                  cursor: 'help'
                }}
                title={appliedAdjustments.map(a => `${a.field}: ${a.reason}`).join('\n')}
              >
                <Sliders size={10} style={{ verticalAlign: 'middle', marginRight: '3px' }} />
                系统调整 {appliedAdjustments.length}
              </span>
            )}
            {onSceneChange && (
              <div style={{ display: 'inline-flex', background: 'rgba(0,0,0,0.3)', borderRadius: '6px', padding: '2px' }}>
                <button
                  type="button"
                  style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    border: 'none',
                    borderRadius: '4px',
                    background: scene === 'home' ? 'var(--preview-accent)' : 'transparent',
                    color: scene === 'home' ? '#101511' : foreground,
                    cursor: 'pointer'
                  }}
                  onClick={() => onSceneChange('home')}
                  aria-label="预览首页"
                >
                  首页
                </button>
                <button
                  type="button"
                  style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    border: 'none',
                    borderRadius: '4px',
                    background: scene === 'chat' ? 'var(--preview-accent)' : 'transparent',
                    color: scene === 'chat' ? '#101511' : foreground,
                    cursor: 'pointer'
                  }}
                  onClick={() => onSceneChange('chat')}
                  aria-label="预览对话"
                >
                  对话
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="preview-body">
          <aside className="preview-sidebar">
            <div className="preview-brand"><Sparkles size={19} /> Workspace <ChevronDown size={12} /></div>
            <div className="preview-nav active"><Plus size={15} />新对话</div>
            <div className="preview-nav"><Search size={14} />搜索</div>
            <div className="preview-nav"><Clock3 size={14} />历史记录</div>
            <small>项目</small>
            <div className="preview-nav"><Folder size={14} />我的工作空间</div>
            <div className="preview-nav indent"><MessageSquare size={13} />让想法开始生长</div>
            <div className="preview-nav indent"><MessageSquare size={13} />今日灵感</div>
            <div className="preview-profile"><span>J</span><div>个人空间<small>为专注而设</small></div></div>
          </aside>

          <div className="preview-main">
            {scene === 'chat' ? (
              <div className="preview-chat-container" style={{ maxWidth: 'var(--preview-content-width)', width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ background: 'var(--preview-panel)', borderRadius: 'var(--preview-chat-radius)', padding: '10px', fontSize: 'var(--preview-chat-font-size)', lineHeight: 'var(--preview-chat-line-height)', color: foreground }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '4px', color: accent }}>User</div>
                  请帮我重构这段代码，并保持类型完整。
                </div>
                <div style={{ background: 'var(--preview-panel)', borderRadius: 'var(--preview-chat-radius)', padding: '10px', fontSize: 'var(--preview-chat-font-size)', lineHeight: 'var(--preview-chat-line-height)', color: foreground }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '4px', color: accent }}>Antigravity</div>
                  已经按照规范完成了重构。调整了模块依赖并补全了类型定义，可随时在测试中验证。
                </div>
              </div>
            ) : (
              <>
                <div className="preview-greeting" style={{ maxWidth: 'var(--preview-content-width)' }}>
                  <span className="greeting-symbol">✳</span>
                  <h2>留一点空间，给灵感。</h2>
                  <p style={{ fontSize: 'var(--preview-chat-font-size)', lineHeight: 'var(--preview-chat-line-height)' }}>
                    从一个问题开始，让想法成为现实。
                  </p>
                </div>
                <div className="preview-prompts" style={{ maxWidth: 'var(--preview-content-width)' }}>
                  <div className="preview-card-item"><Sparkles size={16} /><b>探索新想法</b><span>把灵感变成下一步</span></div>
                  <div className="preview-card-item"><Folder size={16} /><b>开启一个项目</b><span>构建你想象中的作品</span></div>
                </div>
              </>
            )}

            <div className="preview-composer" style={{ maxWidth: 'var(--preview-content-width)' }}>
              <span>今天想一起完成什么？</span>
              <div><Plus size={16} /><span>Antigravity <ChevronDown size={12} /></span><i><ArrowUp size={15} /></i></div>
            </div>
            <small className="preview-footnote">示意布局 · 实际效果以客户端为准</small>
          </div>
        </div>
      </div>
    </div>
  );
}
