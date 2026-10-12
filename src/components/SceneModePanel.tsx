import { useState } from 'react';
import type { ThemeDocument } from '../types';

export function SceneModePanel({ document, targetId, onDocument, onError }: {
  document: ThemeDocument | null;
  targetId: string | null;
  onDocument: (document: ThemeDocument) => void;
  onError: (text: string) => void;
}) {
  const [seen, setSeen] = useState('还没有识别');
  const mode = document?.sceneAppearance?.mode || 'off';

  async function setMode(next: 'off' | 'auto' | 'home' | 'chat') {
    if (!document) return;
    const sceneAppearance = {
      mode: next,
      home: document.sceneAppearance?.home || { maskStrength: null, opacity: null },
      chat: document.sceneAppearance?.chat || { maskStrength: null, opacity: null }
    };
    onDocument({ ...document, sceneAppearance });
    if (!window.antiFace) return;
    try {
      if (next === 'auto') {
        await window.antiFace.watchScene(targetId);
        setSeen('还不确定');
      } else {
        await window.antiFace.unwatchScene(targetId);
        setSeen(next === 'home' ? '固定首页' : next === 'chat' ? '固定聊天' : '已关闭');
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : '场景监听失败');
    }
  }

  async function refresh() {
    if (!window.antiFace) return;
    try {
      const result = await window.antiFace.pollScene(targetId);
      setSeen(result.scene === 'home' ? '首页' : result.scene === 'chat' ? '聊天' : '还不确定');
    } catch (error) {
      onError(error instanceof Error ? error.message : '场景识别失败');
    }
  }

  function setOverride(scene: 'home' | 'chat', field: 'maskStrength' | 'opacity', value: string) {
    if (!document) return;
    const current = document.sceneAppearance || { mode: 'off' as const, home: { maskStrength: null, opacity: null }, chat: { maskStrength: null, opacity: null } };
    const parsed = value === '' ? null : Number(value);
    onDocument({
      ...document,
      sceneAppearance: { ...current, [scene]: { ...current[scene], [field]: parsed } }
    });
  }

  return (
    <section className="round5-panel">
      <h2>首页氛围 / 聊天专注</h2>
      <p>自动识别只看页面结构，不读取聊天内容。当前识别：{seen}。</p>
      <div className="round5-row">
        {([['off', '关闭'], ['auto', '自动'], ['home', '固定首页'], ['chat', '固定聊天']] as const).map(([id, label]) => (
          <button key={id} type="button" className={mode === id ? 'primary-button' : 'secondary-button'} onClick={() => void setMode(id)}>{label}</button>
        ))}
        <button type="button" className="secondary-button" onClick={() => void refresh()}>再识别一次</button>
      </div>
      {(['home', 'chat'] as const).map(scene => (
        <div key={scene} className="round5-card">
          <strong>{scene === 'home' ? '首页氛围' : '聊天专注'}</strong>
          <label>遮罩 <input value={document?.sceneAppearance?.[scene]?.maskStrength ?? ''} onChange={event => setOverride(scene, 'maskStrength', event.target.value)} /></label>
          <label>面板透明度 <input value={document?.sceneAppearance?.[scene]?.opacity ?? ''} onChange={event => setOverride(scene, 'opacity', event.target.value)} /></label>
        </div>
      ))}
    </section>
  );
}
