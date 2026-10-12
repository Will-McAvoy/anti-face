import { useState } from 'react';
import type { ThemeDocument } from '../types';
import { ReadabilityPanel } from './ReadabilityPanel';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { SceneModePanel } from './SceneModePanel';
import { WallpaperCompositionEditor } from './WallpaperCompositionEditor';
import { HostComparePanel } from './HostComparePanel';
import { ThemeGeneratorPanel } from './ThemeGeneratorPanel';
import { ProjectAppearancePanel } from './ProjectAppearancePanel';
import { ThemeRevisionPanel } from './ThemeRevisionPanel';
import { ThemeCatalogPanel } from './ThemeCatalogPanel';

const tabs = [
  ['read', '阅读保护'],
  ['diag', '诊断'],
  ['scene', '场景'],
  ['compose', '构图'],
  ['compare', '真实对比'],
  ['palette', '整套配色'],
  ['project', '项目外观'],
  ['history', '版本'],
  ['catalog', '精选']
] as const;

export function Round5Page({ document, targetId, onDocument, onError, onInstalled }: {
  document: ThemeDocument | null;
  targetId: string | null;
  onDocument: (document: ThemeDocument) => void;
  onError: (text: string) => void;
  onInstalled: () => void;
}) {
  const [tab, setTab] = useState<(typeof tabs)[number][0]>('read');
  if (!window.antiFace) return <p>这些功能需要桌面版。浏览器预览不会假装已经连上宿主。</p>;
  return (
    <div className="round5-page">
      <div className="round5-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'primary-button' : 'secondary-button'} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === 'read' && <ReadabilityPanel document={document} targetId={targetId} onDocument={onDocument} onError={onError} />}
      {tab === 'diag' && <DiagnosticsPanel targetId={targetId} onError={onError} />}
      {tab === 'scene' && <SceneModePanel document={document} targetId={targetId} onDocument={onDocument} onError={onError} />}
      {tab === 'compose' && <WallpaperCompositionEditor document={document} onDocument={onDocument} />}
      {tab === 'compare' && <HostComparePanel targetId={targetId} onError={onError} />}
      {tab === 'palette' && <ThemeGeneratorPanel document={document} onDocument={onDocument} onError={onError} />}
      {tab === 'project' && <ProjectAppearancePanel targetId={targetId} onError={onError} />}
      {tab === 'history' && <ThemeRevisionPanel themeId={document?.id || null} onDocument={onDocument} onError={onError} />}
      {tab === 'catalog' && <ThemeCatalogPanel onError={onError} onInstalled={onInstalled} />}
    </div>
  );
}
