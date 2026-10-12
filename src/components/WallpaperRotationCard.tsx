import React, { useState, useEffect } from 'react';
import {
  FolderOpen,
  Play,
  Pause,
  SkipForward,
  BookmarkCheck,
  RefreshCw,
  Sliders,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

interface WallpaperRotationCardProps {
  targetId?: string | null;
  onNotice?: (notice: { kind: 'error' | 'success'; text: string }) => void;
}

export function WallpaperRotationCard({ targetId, onNotice }: WallpaperRotationCardProps) {
  const [status, setStatus] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const isDesktop = typeof window !== 'undefined' && !!window.antiFace;

  const refreshStatus = async () => {
    if (!isDesktop) return;
    try {
      const res = await window.antiFace!.getRotationStatus(targetId);
      if (res) setStatus(res);
    } catch {}
  };

  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 4000);
    return () => clearInterval(interval);
  }, [targetId]);

  const handleChooseFolder = async () => {
    if (!isDesktop || busy) return;
    setBusy(true);
    try {
      const res = await window.antiFace!.rotationChooseFolder();
      if (!res.canceled && res.folderPath) {
        onNotice?.({ kind: 'success', text: `已设置壁纸文件夹: ${res.folderPath}` });
        await refreshStatus();
      }
    } catch (err: any) {
      onNotice?.({ kind: 'error', text: err.message || '选择文件夹失败' });
    } finally {
      setBusy(false);
    }
  };

  const handleToggleEnabled = async () => {
    if (!isDesktop || busy || !status) return;
    setBusy(true);
    try {
      const next = !status.enabled;
      await window.antiFace!.setRotationConfig({ ...status, enabled: next }, targetId);
      onNotice?.({ kind: 'success', text: next ? '壁纸轮换已启用' : '壁纸轮换已停用' });
      await refreshStatus();
    } catch (err: any) {
      onNotice?.({ kind: 'error', text: err.message || '更新轮换配置失败' });
    } finally {
      setBusy(false);
    }
  };

  const handleOrderChange = async (order: 'sequential' | 'shuffle') => {
    if (!isDesktop || busy || !status) return;
    setBusy(true);
    try {
      await window.antiFace!.setRotationConfig({ ...status, order }, targetId);
      await refreshStatus();
    } catch (err: any) {
      onNotice?.({ kind: 'error', text: err.message || '设置播放顺序失败' });
    } finally {
      setBusy(false);
    }
  };

  const handleIntervalChange = async (intervalSeconds: number) => {
    if (!isDesktop || busy || !status) return;
    setBusy(true);
    try {
      await window.antiFace!.setRotationConfig({ ...status, intervalSeconds }, targetId);
      await refreshStatus();
    } catch (err: any) {
      onNotice?.({ kind: 'error', text: err.message || '设置间隔时间失败' });
    } finally {
      setBusy(false);
    }
  };

  const handleRecursiveChange = async (recursive: boolean) => {
    if (!isDesktop || busy || !status) return;
    setBusy(true);
    try {
      await window.antiFace!.setRotationConfig({ ...status, recursive }, targetId);
      await refreshStatus();
    } catch (err: any) {
      onNotice?.({ kind: 'error', text: err.message || '设置子目录递归失败' });
    } finally {
      setBusy(false);
    }
  };

  const handleNext = async () => {
    if (!isDesktop || busy) return;
    setBusy(true);
    try {
      const res = await window.antiFace!.rotationNext(targetId);
      if (res?.ok) {
        onNotice?.({ kind: 'success', text: `已切换至下一张壁纸: ${res.filename}` });
        await refreshStatus();
      }
    } catch (err: any) {
      onNotice?.({ kind: 'error', text: err.message || '切换壁纸失败' });
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePause = async () => {
    if (!isDesktop || busy || !status) return;
    setBusy(true);
    try {
      if (status.paused && status.pauseReason === 'manual-paused') {
        await window.antiFace!.rotationResume(targetId);
        onNotice?.({ kind: 'success', text: '壁纸轮换已继续' });
      } else {
        await window.antiFace!.rotationPause(targetId);
        onNotice?.({ kind: 'success', text: '壁纸轮换已暂停' });
      }
      await refreshStatus();
    } catch (err: any) {
      onNotice?.({ kind: 'error', text: err.message || '操作失败' });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveToTheme = async () => {
    if (!isDesktop || busy) return;
    setBusy(true);
    try {
      const res = await window.antiFace!.rotationSaveToTheme(targetId);
      if (res?.ok) {
        onNotice?.({ kind: 'success', text: '已将当前轮换壁纸固化保存到主题文档' });
      }
    } catch (err: any) {
      onNotice?.({ kind: 'error', text: err.message || '保存到主题失败' });
    } finally {
      setBusy(false);
    }
  };

  if (!isDesktop) {
    return (
      <div className="card" style={{ padding: 16 }}>
        <p style={{ color: 'var(--muted)', margin: 0 }}>壁纸轮换仅在桌面应用模式下可用。</p>
      </div>
    );
  }

  const pauseReasonLabels: Record<string, string> = {
    'manual-paused': '手动已暂停',
    'safe-mode': '安全模式限制',
    'migration': '备份迁移限制',
    'previewing': '正在试穿',
    'manual-hold': '手动编辑保全中',
    'no-folder': '未选择文件夹',
    'folder-empty': '文件夹无可用图片',
    'disabled': '未启用'
  };

  return (
    <div className="card" style={{ padding: 16, marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sliders size={18} /> 本地壁纸文件夹轮换
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>
            自动从本地图片文件夹抽取壁纸应用至当前窗口（运行时临时覆盖，不反复污染保存主题）。
          </p>
        </div>
        <button
          type="button"
          className={status?.enabled ? 'primary-button' : 'secondary-button'}
          style={{ minWidth: 80 }}
          disabled={busy}
          onClick={handleToggleEnabled}
        >
          {status?.enabled ? '已启用' : '已停用'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <input
          type="text"
          readOnly
          value={status?.folderRef || ''}
          placeholder="点击右侧按钮选择壁纸文件夹..."
          style={{ flex: 1, padding: '6px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--line)', background: 'var(--panel)' }}
        />
        <button type="button" className="secondary-button" disabled={busy} onClick={handleChooseFolder}>
          <FolderOpen size={14} style={{ marginRight: 4 }} /> 选择文件夹
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>播放顺序</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className={status?.order === 'sequential' ? 'primary-button' : 'secondary-button'}
              style={{ flex: 1, padding: '4px 8px', fontSize: 12 }}
              onClick={() => handleOrderChange('sequential')}
            >
              顺序轮换
            </button>
            <button
              type="button"
              className={status?.order === 'shuffle' ? 'primary-button' : 'secondary-button'}
              style={{ flex: 1, padding: '4px 8px', fontSize: 12 }}
              onClick={() => handleOrderChange('shuffle')}
            >
              随机防重
            </button>
          </div>
        </div>

        <div>
          <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>轮换间隔</label>
          <select
            value={status?.intervalSeconds || 900}
            onChange={e => handleIntervalChange(Number(e.target.value))}
            style={{ width: '100%', padding: '6px 8px', fontSize: 13, borderRadius: 6, border: '1px solid var(--line)', background: 'var(--panel)', color: 'inherit' }}
          >
            <option value={60}>1 分钟 (测试)</option>
            <option value={300}>5 分钟</option>
            <option value={900}>15 分钟 (推荐)</option>
            <option value={1800}>30 分钟</option>
            <option value={3600}>1 小时</option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', paddingTop: 18 }}>
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={status?.recursive || false}
              onChange={e => handleRecursiveChange(e.target.checked)}
            />
            扫描子文件夹
          </label>
        </div>
      </div>

      {status?.enabled && (
        <div style={{ padding: 10, borderRadius: 6, background: 'var(--panel-muted, rgba(0,0,0,0.2))', border: '1px solid var(--line)', marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
            <span>
              已发现图片: <strong>{status.candidateCount || 0}</strong> 张
              {status.currentFilename && (
                <span style={{ marginLeft: 12, color: 'var(--accent)' }}>
                  当前: {status.currentFilename}
                </span>
              )}
            </span>
            {status.paused ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#f59e0b' }}>
                <AlertCircle size={14} /> {pauseReasonLabels[status.pauseReason] || status.pauseReason}
              </span>
            ) : (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#10b981' }}>
                <CheckCircle2 size={14} /> 运行中
              </span>
            )}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="secondary-button"
          disabled={busy || !status?.enabled || (status.candidateCount || 0) === 0}
          onClick={handleNext}
        >
          <SkipForward size={14} style={{ marginRight: 4 }} /> 下一张
        </button>

        <button
          type="button"
          className="secondary-button"
          disabled={busy || !status?.enabled}
          onClick={handleTogglePause}
        >
          {status?.paused && status?.pauseReason === 'manual-paused' ? (
            <><Play size={14} style={{ marginRight: 4 }} /> 继续</>
          ) : (
            <><Pause size={14} style={{ marginRight: 4 }} /> 暂停</>
          )}
        </button>

        <button
          type="button"
          className="secondary-button"
          disabled={busy || !status?.currentFilename}
          onClick={handleSaveToTheme}
          title="将当前轮换生效的壁纸写入已保存主题文档并创建版本历史"
        >
          <BookmarkCheck size={14} style={{ marginRight: 4 }} /> 保存当前壁纸到主题
        </button>
      </div>
    </div>
  );
}
