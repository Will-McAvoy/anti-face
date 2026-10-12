import React, { useState, useEffect } from 'react';
import {
  Archive,
  FolderOpen,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Clock,
  ShieldCheck
} from 'lucide-react';

interface AutoBackupCardProps {
  onNotice?: (notice: { kind: 'error' | 'success'; text: string }) => void;
}

export function AutoBackupCard({ onNotice }: AutoBackupCardProps) {
  const [status, setStatus] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const isDesktop = typeof window !== 'undefined' && !!window.antiFace;

  const refreshStatus = async () => {
    if (!isDesktop) return;
    try {
      const res = await window.antiFace!.getAutoBackupStatus();
      if (res) setStatus(res);
    } catch {}
  };

  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleChooseFolder = async () => {
    if (!isDesktop || busy) return;
    setBusy(true);
    try {
      const res = await window.antiFace!.chooseAutoBackupFolder();
      if (!res.canceled && res.folderPath) {
        onNotice?.({ kind: 'success', text: `已设置自动备份保存文件夹: ${res.folderPath}` });
        await refreshStatus();
      }
    } catch (err: any) {
      onNotice?.({ kind: 'error', text: err.message || '选择文件夹失败' });
    } finally {
      setBusy(false);
    }
  };

  const handleOpenFolder = async () => {
    if (!isDesktop) return;
    try {
      const res = await window.antiFace!.openAutoBackupFolder();
      if (!res.ok) {
        onNotice?.({ kind: 'error', text: res.message || '打开目录失败' });
      }
    } catch (err: any) {
      onNotice?.({ kind: 'error', text: err.message || '打开目录失败' });
    }
  };

  const handleToggleEnabled = async () => {
    if (!isDesktop || busy || !status) return;
    setBusy(true);
    try {
      const next = !status.enabled;
      await window.antiFace!.setAutoBackupConfig({ ...status, enabled: next });
      onNotice?.({ kind: 'success', text: next ? '自动备份已启用' : '自动备份已停用' });
      await refreshStatus();
    } catch (err: any) {
      onNotice?.({ kind: 'error', text: err.message || '更新备份配置失败' });
    } finally {
      setBusy(false);
    }
  };

  const handleScheduleChange = async (schedule: 'afterMajorChange' | 'daily') => {
    if (!isDesktop || busy || !status) return;
    setBusy(true);
    try {
      await window.antiFace!.setAutoBackupConfig({ ...status, schedule });
      await refreshStatus();
    } catch (err: any) {
      onNotice?.({ kind: 'error', text: err.message || '设置触发时机失败' });
    } finally {
      setBusy(false);
    }
  };

  const handleRetainCountChange = async (retainCount: number) => {
    if (!isDesktop || busy || !status) return;
    const clamped = Math.max(1, Math.min(50, retainCount));
    setBusy(true);
    try {
      await window.antiFace!.setAutoBackupConfig({ ...status, retainCount: clamped });
      await refreshStatus();
    } catch (err: any) {
      onNotice?.({ kind: 'error', text: err.message || '设置保留份数失败' });
    } finally {
      setBusy(false);
    }
  };

  const handleRetainDaysChange = async (retainDays: number) => {
    if (!isDesktop || busy || !status) return;
    const clamped = Math.max(1, Math.min(365, retainDays));
    setBusy(true);
    try {
      await window.antiFace!.setAutoBackupConfig({ ...status, retainDays: clamped });
      await refreshStatus();
    } catch (err: any) {
      onNotice?.({ kind: 'error', text: err.message || '设置保留天数失败' });
    } finally {
      setBusy(false);
    }
  };

  const handleRunNow = async () => {
    if (!isDesktop || busy) return;
    setBusy(true);
    try {
      const res = await window.antiFace!.runAutoBackupNow();
      if (res?.skipped) {
        onNotice?.({ kind: 'success', text: '数据自上次备份后未发生变更，跳过冗余打包。' });
      } else if (res?.ok) {
        onNotice?.({ kind: 'success', text: `自动备份创建成功: ${res.filename}` });
      }
      await refreshStatus();
    } catch (err: any) {
      onNotice?.({ kind: 'error', text: err.message || '备份失败' });
    } finally {
      setBusy(false);
    }
  };

  if (!isDesktop) return null;

  return (
    <div className="bg-[#18201b] border border-[#2b392f] rounded-xl p-5 mt-6">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-sm font-semibold text-[#e5eae6] flex items-center gap-2">
            <Archive className="w-4 h-4 text-[#529b68]" />
            自动备份与保留策略 (F05)
          </h3>
          <p className="text-xs text-[#829688] mt-1">
            在主题库增删改或偏好保存后自动防抖打包（2分钟防抖，最短间隔5分钟），按数量与天数安全轮转清理。
            <strong className="text-[#a7f3d0]"> 铁律保底：至少保留 1 份有效备份，绝不误删用户手动文件。</strong>
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={handleToggleEnabled}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
            status?.enabled
              ? 'bg-[#25382b] text-[#86efac] border-[#3e5f49]'
              : 'bg-[#1f2822] text-[#829688] border-[#2e3b31]'
          }`}
        >
          {status?.enabled ? '自动备份已开启' : '自动备份已关闭'}
        </button>
      </div>

      {/* 备份存储目录选择 */}
      <div className="mb-4">
        <label className="text-xs font-semibold text-[#b8c7bd] block mb-1.5">备份目标目录</label>
        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={status?.directoryRef || ''}
            placeholder="请选择用于存放自动备份文件的文件夹..."
            className="flex-1 px-3 py-1.5 text-xs bg-[#121614] border border-[#2e3b31] rounded-lg text-[#d1ded5]"
          />
          <button
            type="button"
            disabled={busy}
            onClick={handleChooseFolder}
            className="px-3 py-1.5 bg-[#1f2822] hover:bg-[#2b372f] text-[#d1ded5] text-xs font-medium rounded-lg border border-[#36463a] flex items-center gap-1.5"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            选择目录
          </button>
          {status?.directoryRef && (
            <button
              type="button"
              onClick={handleOpenFolder}
              className="px-3 py-1.5 bg-[#1f2822] hover:bg-[#2b372f] text-[#86efac] text-xs font-medium rounded-lg border border-[#36463a] flex items-center gap-1.5"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              打开目录
            </button>
          )}
        </div>
      </div>

      {/* 策略参数设置 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4 text-xs">
        <div>
          <label className="text-[#829688] block mb-1">触发时机</label>
          <select
            value={status?.schedule || 'afterMajorChange'}
            onChange={e => handleScheduleChange(e.target.value as any)}
            className="w-full px-2.5 py-1.5 bg-[#121614] border border-[#2e3b31] rounded-lg text-[#d1ded5]"
          >
            <option value="afterMajorChange">重大数据修改后 (推荐)</option>
            <option value="daily">每日定时备份</option>
          </select>
        </div>

        <div>
          <label className="text-[#829688] block mb-1">保留数量上限 (份)</label>
          <input
            type="number"
            min={1}
            max={50}
            value={status?.retainCount ?? 7}
            onChange={e => handleRetainCountChange(Number(e.target.value))}
            className="w-full px-2.5 py-1.5 bg-[#121614] border border-[#2e3b31] rounded-lg text-[#d1ded5]"
          />
        </div>

        <div>
          <label className="text-[#829688] block mb-1">保留最长时间 (天)</label>
          <input
            type="number"
            min={1}
            max={365}
            value={status?.retainDays ?? 30}
            onChange={e => handleRetainDaysChange(Number(e.target.value))}
            className="w-full px-2.5 py-1.5 bg-[#121614] border border-[#2e3b31] rounded-lg text-[#d1ded5]"
          />
        </div>
      </div>

      {/* 状态反馈卡片 */}
      <div className="bg-[#121614] border border-[#2e3b31] rounded-lg p-3 text-xs space-y-1.5 mb-4 text-[#9bb0a2]">
        <div className="flex justify-between items-center">
          <span>
            上次自动备份: {status?.lastBackupTime ? new Date(status.lastBackupTime).toLocaleString() : '暂无记录'}
          </span>
          {status?.pendingDebounce && (
            <span className="text-[#f59e0b] flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> 等待修改防抖中...
            </span>
          )}
        </div>
        {status?.lastBackupFile && (
          <div className="text-[11px] text-[#6ee7b7] truncate" title={status.lastBackupFile}>
            最近文件: {status.lastBackupFile.split(/[/\\]/).pop()}
          </div>
        )}
        {status?.lastError && (
          <div className="text-[#fca5a5] flex items-center gap-1 text-[11px]">
            <AlertTriangle className="w-3.5 h-3.5" /> 上次备份异常: {status.lastError}
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !status?.directoryRef}
          onClick={handleRunNow}
          className="px-4 py-2 bg-[#25382b] hover:bg-[#324a3a] text-[#86efac] text-xs font-medium rounded-lg border border-[#3e5f49] flex items-center gap-1.5 disabled:opacity-50"
        >
          <Play className="w-3.5 h-3.5" />
          {busy ? '正在执行备份…' : '立即执行一次自动备份'}
        </button>
      </div>
    </div>
  );
}
