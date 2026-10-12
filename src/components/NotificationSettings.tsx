import {useEffect,useState} from 'react';
function ShortcutInput({value,aria,onCommit}:{value:string;aria:string;onCommit:(value:string|null)=>void}){
  const [draft,setDraft]=useState(value);
  useEffect(()=>setDraft(value),[value]);
  return <input aria-label={aria} value={draft} placeholder="Ctrl+Shift+A" onChange={e=>setDraft(e.target.value)} onBlur={()=>onCommit(draft || null)} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/>;
}
export function NotificationSettings({ capability, preferences, onChange, onPreview, onMini }: {
  capability: any;
  preferences: any;
  onChange: (next: any) => void;
  onPreview: () => void;
  onMini: () => void;
}) {
  const notifications = preferences?.notifications || {};
  const set = (patch: Record<string, unknown>) => onChange({ ...preferences, notifications: { ...notifications, ...patch } });
  return (
    <section className="connection-card" style={{ marginTop: 16 }}>
      <h2>提醒与声音</h2>
      <p>{capability?.complete}</p>
      <p>{capability?.failed}</p>
      {capability?.external && <p>{capability.external}</p>}
      <p>正式提醒默认关闭。预听不会当作任务完成。</p>
      {([
        ['onFailed', '失败时提醒'],
        ['onWaitingUser', '等待用户时提醒'],
        ['desktop', '桌面通知'],
        ['sound', '播放声音'],
        ['quietEnabled', '启用静音时段']
      ] as const).map(([key, label]) => (
        <label key={key} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input type="checkbox" checked={notifications[key] === true} onChange={event => set({ [key]: event.target.checked })} />
          {label}
        </label>
      ))}
      <label className="slider-field">完成提醒保持关闭，因为当前日志不能可靠判断整个任务已完成。</label>
      <label className="slider-field">音量
        <input aria-label="提示音音量" type="range" min={0} max={100} value={Math.round((notifications.volume ?? 0.4) * 100)} onChange={event => set({ volume: Number(event.target.value) / 100 })} />
      </label>
      <div className="header-actions">
        <input aria-label="静音开始" value={notifications.quietStart || '22:00'} onChange={event => set({ quietStart: event.target.value })} />
        <input aria-label="静音结束" value={notifications.quietEnd || '08:00'} onChange={event => set({ quietEnd: event.target.value })} />
        <button type="button" className="secondary-button" onClick={onPreview}>预听</button>
      </div>
      <label style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input type="checkbox" checked={preferences?.tray?.closeToTray === true} onChange={event => onChange({ ...preferences, tray: { closeToTray: event.target.checked } })} />
        关闭窗口时保留在托盘（默认仍是退出）
      </label>
      <label style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input type="checkbox" checked={preferences?.shortcuts?.enabled === true} onChange={event => onChange({ ...preferences, shortcuts: { ...preferences.shortcuts, enabled: event.target.checked } })} />
        启用全局快捷键。默认不注册。实际注册状态：{preferences?.shortcutStatus ? JSON.stringify(preferences.shortcutStatus.registered || {}) : '尚未读取'}
      </label>
      {([
        ['toggleWindow', '显示或隐藏主窗口', '显示隐藏快捷键'],
        ['nextFavorite', '下一收藏主题', '下一收藏快捷键'],
        ['previousFavorite', '上一收藏主题', '上一收藏快捷键'],
        ['restoreHost', '恢复宿主原样', '恢复原样快捷键'],
        ['quickSwitcher', '主题快速切换器', '快速切换快捷键']
      ] as const).map(([key, label, aria]) => {
        const saved = preferences?.shortcuts?.bindings?.[key] || '';
        const registered = preferences?.shortcutStatus?.registered?.[key];
        return (
          <label className="slider-field" key={key}>{label}
            <ShortcutInput aria={aria} value={saved} onCommit={value=>onChange({...preferences,shortcuts:{...preferences.shortcuts,bindings:{...preferences.shortcuts?.bindings,[key]:value}}})}/>
            <small>{registered ? `已注册 ${registered}` : '未注册'}</small>
          </label>
        );
      })}
      {preferences?.shortcutNotice && <p>{preferences.shortcutNotice}</p>}
      <div className="header-actions">
        <button type="button" className="secondary-button" onClick={onMini}>打开迷你窗</button>
      </div>
    </section>
  );
}
