import { Check, Droplets } from 'lucide-react';
import type { Theme } from '../types';
export function ThemeCard({ theme, selected, onSelect }: { theme: Theme; selected: boolean; onSelect: () => void }) {
  return <button className={'theme-card' + (selected ? ' selected' : '')} onClick={onSelect} aria-pressed={selected} aria-label={'选择' + theme.name}>
    <div className="theme-swatch" style={{ background: theme.gradient, color: theme.foreground }}>
      <div className="mini-window" style={{ background: theme.panel + 'cc' }}>
        <div className="mini-sidebar"><i style={{ background: theme.accent }} /><i /><i /><i /></div>
        <div className="mini-content"><span style={{ background: theme.accent }} /><i /><i /><div style={{ background: theme.background }} /></div>
      </div>
      {selected && <span className="selected-check"><Check size={12} /></span>}
    </div>
    <span className="theme-card-label"><strong>{theme.name}</strong>{theme.glass ? <Droplets size={13} /> : <span>{theme.mode === 'dark' ? '深色' : '浅色'}</span>}</span>
  </button>;
}
