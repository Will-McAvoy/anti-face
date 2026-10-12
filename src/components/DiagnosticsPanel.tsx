import { useState } from 'react';

const stateText: Record<string, string> = {
  supported: '支持',
  unsupported: '不支持',
  'not-present': '当前页面没有',
  unknown: '还不确定',
  detached: '未连接',
  ready: '可以应用',
  applied: '已应用'
};

export function DiagnosticsPanel({ targetId, onError }: { targetId: string | null; onError: (text: string) => void }) {
  const [report, setReport] = useState<any>(null);
  const [preview, setPreview] = useState<string>('');

  async function inspect() {
    if (!window.antiFace) return;
    try {
      const next = await window.antiFace.inspectDiagnostics(targetId);
      setReport(next);
      setPreview(JSON.stringify(next, null, 2));
    } catch (error) {
      onError(error instanceof Error ? error.message : '诊断失败');
    }
  }

  async function save() {
    if (!window.antiFace) return;
    try {
      const saved = await window.antiFace.exportDiagnostics(targetId);
      if (saved?.saved) setPreview(JSON.stringify(saved.preview || saved.report, null, 2));
      if (saved?.ok === false) onError(saved.message || '还没有可导出的诊断');
    } catch (error) {
      onError(error instanceof Error ? error.message : '导出失败');
    }
  }

  return (
    <section className="round5-panel">
      <h2>诊断中心</h2>
      <p>只做被动检查，不会因此改掉宿主外观。导出前可以先看字段，里面不含聊天和项目路径。</p>
      <div className="round5-row">
        <button type="button" className="primary-button" onClick={() => void inspect()}>重新检查</button>
        <button type="button" className="secondary-button" onClick={() => void save()}>导出诊断</button>
      </div>
      {report && (
        <div className="round5-card">
          <p>连接：{stateText[report.connection?.state] || report.connection?.message}</p>
          <p>场景：{report.scene?.scene === 'home' ? '首页' : report.scene?.scene === 'chat' ? '聊天' : '还不确定'}</p>
          <ul>
            {(report.regions || []).map((row: { id: string; state: string }) => (
              <li key={row.id}>{row.id}：{stateText[row.state] || row.state}</li>
            ))}
          </ul>
          {(report.actions || []).map((item: { id: string; label: string }) => <p key={item.id}>{item.label}</p>)}
        </div>
      )}
      {preview && <pre className="round5-pre">{preview}</pre>}
    </section>
  );
}
