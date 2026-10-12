export function AutomationSettings({
  value,
  themes,
  onChange,
  onPause
}: {
  value: any;
  themes: { id: string; name: string }[];
  onChange: (next: any) => void;
  onPause: (kind: 'hour' | 'tomorrow' | 'resume' | 'restore') => void;
}) {
  const rules = value?.rules || [];
  return (
    <section className="connection-card" style={{ marginTop: 16 }}>
      <h2>自动切换</h2>
      <p>默认关闭。跟随系统和每天定时互相排斥，避免两套规则抢主题。{value?.status?.message || ''}</p>
      <p>下一次：{value?.next || '无计划'}</p>
      <p>当前系统外观：{value?.systemScheme === 'dark' ? '深色' : value?.systemScheme === 'light' ? '浅色' : '尚未读取'}。跟随系统时，系统主题变化后才会更换；手动暂停会停到你点击恢复。</p>
      <label className="slider-field">模式
        <select aria-label="自动切换模式" value={value?.mode || 'off'} onChange={event => onChange({ ...value, mode: event.target.value })}>
          <option value="off">关闭</option>
          <option value="system">跟随系统深浅色</option>
          <option value="schedule">每天定时</option>
        </select>
      </label>
      {value?.mode === 'system' && (
        <div className="header-actions">
          <label>浅色<select aria-label="浅色主题" value={value.lightThemeId || ''} onChange={event => onChange({ ...value, lightThemeId: event.target.value || null })}>{themes.map(theme => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</select></label>
          <label>深色<select aria-label="深色主题" value={value.darkThemeId || ''} onChange={event => onChange({ ...value, darkThemeId: event.target.value || null })}>{themes.map(theme => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</select></label>
        </div>
      )}
      {value?.mode === 'schedule' && (
        <button type="button" className="secondary-button" onClick={() => onChange({ ...value, rules: [...rules, { id: `rule-${Date.now()}`, time: '07:00', themeId: themes[0]?.id || 'graphite', scope: 'selected', enabled: true }] })}>添加时间点</button>
      )}
      {rules.map((rule: any) => (
        <div key={rule.id} className="header-actions" style={{ marginTop: 8 }}>
          <input aria-label={`时间 ${rule.id}`} value={rule.time} onChange={event => onChange({ ...value, rules: rules.map((item: any) => item.id === rule.id ? { ...item, time: event.target.value } : item) })} />
          <select aria-label={`主题 ${rule.id}`} value={rule.themeId} onChange={event => onChange({ ...value, rules: rules.map((item: any) => item.id === rule.id ? { ...item, themeId: event.target.value } : item) })}>
            {themes.map(theme => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
          </select>
          <button type="button" className="text-button" onClick={() => onChange({ ...value, rules: rules.filter((item: any) => item.id !== rule.id) })}>移除</button>
        </div>
      ))}
      <div className="header-actions" style={{ marginTop: 12 }}>
        <button type="button" className="secondary-button" onClick={() => onPause('hour')}>暂停 1 小时</button>
        <button type="button" className="secondary-button" onClick={() => onPause('tomorrow')}>暂停到明天</button>
        <button type="button" className="secondary-button" onClick={() => onPause('resume')}>恢复自动切换</button>
      </div>
    </section>
  );
}
