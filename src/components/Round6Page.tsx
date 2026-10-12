import React, { useEffect, useState } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  RotateCcw,
  Zap,
  Monitor,
  Archive,
  Volume2,
  Bell,
  Play,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Sparkles,
  Download,
  Upload,
  RefreshCw,
  Sliders
} from 'lucide-react';
import type { TargetWindow } from '../types';
import { WallpaperRotationCard } from './WallpaperRotationCard';
import { AutoBackupCard } from './AutoBackupCard';

interface Round6PageProps {
  targets: TargetWindow[];
  selectedTargetId: string | null;
  onNotice: (notice: { kind: 'error' | 'success'; text: string }) => void;
}

export function Round6Page({ targets, selectedTargetId, onNotice }: Round6PageProps) {
  const [subTab, setSubTab] = useState<'recovery' | 'switcher' | 'display' | 'backup' | 'performance' | 'notify' | 'rotation'>('recovery');
  const [safeStatus, setSafeStatus] = useState<any>(null);
  const [recoveryReport, setRecoveryReport] = useState<any>(null);
  const [displays, setDisplays] = useState<any[]>([]);
  const [perfSummary, setPerfSummary] = useState<any>(null);
  const [perfMode, setPerfMode] = useState<string>('advisory');
  const [batteryAware, setBatteryAware] = useState<boolean>(true);

  // 备份导入状态
  const [backupInspection, setBackupInspection] = useState<any>(null);
  const [restorePreview, setRestorePreview] = useState<any>(null);
  const [restoreStrategy, setRestoreStrategy] = useState<'keep-both' | 'overwrite'>('keep-both');
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreSections,setRestoreSections]=useState({restoreAppearance:true,restorePreferences:true,restoreBindings:true,restoreRevisions:true});

  // 通知规则状态
  const [notifyRules, setNotifyRules] = useState<any>({
    onComplete: false,
    onFailed: true,
    onWaitingUser: false,
    desktop: false,
    sound: false,
    volume: 0.4,
    quietEnabled: false,
    quietStart: '22:00',
    quietEnd: '08:00',
    suppressInForeground: false
  });
  const [notifyCapability, setNotifyCapability] = useState<any>(null);

  const isDesktop = typeof window !== 'undefined' && !!window.antiFace;

  const refreshAll = async () => {
    if (!isDesktop) return;
    try {
      const safe = await window.antiFace!.safeModeStatus().catch(() => null);
      if (safe) setSafeStatus(safe);

      const disp = await window.antiFace!.getDisplayContext(selectedTargetId).catch(() => null);
      const allDisplays = await (window.antiFace as any).getDisplays?.() || [];
      if (allDisplays.length > 0) setDisplays(allDisplays);

      const perf = await window.antiFace!.getPerformanceSummary(selectedTargetId).catch(() => null);
      if (perf) {
        setPerfSummary(perf);
        setPerfMode(perf.mode || 'advisory');
        setBatteryAware(perf.batteryAware !== false);
      }

      const cap = await window.antiFace!.notificationCapability().catch(() => null);
      if (cap) {
        setNotifyCapability(cap);
        if (cap.prefs) setNotifyRules(cap.prefs);
      }
    } catch {}
  };

  useEffect(() => {
    refreshAll();
  }, [selectedTargetId]);

  useEffect(()=>()=>{if(backupInspection?.inspectionId)void window.antiFace?.cancelBackupInspection(backupInspection.inspectionId);},[backupInspection?.inspectionId]);

  // F01: 恢复所有窗口原貌
  const handleRestoreAll = async () => {
    if (!isDesktop) return;
    try {
      const res = await window.antiFace!.restoreAllTargets();
      if (res?.recoveryReport) {
        setRecoveryReport(res.recoveryReport);
        onNotice({
          kind: res.recoveryReport.ok ? 'success' : 'error',
          text: res.recoveryReport.summary || '恢复操作已完成'
        });
      } else {
        onNotice({ kind: 'success', text: '全部窗口原貌已恢复' });
      }
    } catch (err: any) {
      onNotice({ kind: 'error', text: `恢复执行失败: ${err.message}` });
    }
  };

  // 安全模式切换
  const handleToggleSafeMode = async () => {
    if (!isDesktop) return;
    try {
      if (safeStatus?.safeMode) {
        await window.antiFace!.exitSafeMode();
        onNotice({ kind: 'success', text: '已退出安全模式，常规规则已恢复' });
      } else {
        await window.antiFace!.enterSafeMode('USER_MANUAL');
        onNotice({ kind: 'success', text: '已进入安全模式，自动换肤与通知已抑制' });
      }
      refreshAll();
    } catch (err: any) {
      onNotice({ kind: 'error', text: `模式切换失败: ${err.message}` });
    }
  };

  // F03: 快速切换器
  const handleOpenSwitcher = async () => {
    if (!isDesktop) return;
    try {
      await window.antiFace!.openQuickSwitcher();
    } catch (err: any) {
      onNotice({ kind: 'error', text: `无法打开快速切换器: ${err.message}` });
    }
  };

  // F05: 备份导出
  const handleExportBackup = async () => {
    if (!isDesktop) return;
    try {
      setBackupBusy(true);
      const res = await window.antiFace!.exportBackup(null, { includeRevisions: true });
      if (res?.cancelled) return;
      if (res?.ok) {
        onNotice({
          kind: 'success',
          text: `备份导出成功！包含 ${res.themeCount} 个主题与 ${res.assetCount} 个壁纸资产。`
        });
      }
    } catch (err: any) {
      onNotice({ kind: 'error', text: `导出备份失败: ${err.message}` });
    } finally {
      setBackupBusy(false);
    }
  };

  // F05: 备份导入检验
  const handleInspectBackup = async () => {
    if (!isDesktop) return;
    try {
      setBackupBusy(true);
      if(backupInspection?.inspectionId) await window.antiFace!.cancelBackupInspection(backupInspection.inspectionId);
      const inspection = await window.antiFace!.inspectBackup(null);
      if (inspection?.cancelled) return;
      if (inspection?.valid) {
        setBackupInspection(inspection);
        const preview = await window.antiFace!.previewRestore(inspection);
        setRestorePreview(preview);
        onNotice({ kind: 'success', text: `备份包检验通过，共 ${inspection.stats.totalFiles} 个文件` });
      }
    } catch (err: any) {
      setBackupInspection(null);
      setRestorePreview(null);
      onNotice({ kind: 'error', text: `备份检查失败: ${err.message}` });
    } finally {
      setBackupBusy(false);
    }
  };

  // F05: 提交恢复
  const handleCommitRestore = async () => {
    if (!isDesktop || !backupInspection?.inspectionId) return;
    try {
      setBackupBusy(true);
      const res = await window.antiFace!.commitRestore(backupInspection.inspectionId, {
        strategy: restoreStrategy,
        ...restoreSections
      });
      if (res?.ok) {
        onNotice({ kind: 'success', text: res.message || '备份恢复成功！' });
        setBackupInspection(null);
        setRestorePreview(null);
      }
    } catch (err: any) {
      onNotice({ kind: 'error', text: `恢复提交失败: ${err.message}` });
    } finally {
      setBackupBusy(false);
    }
  };

  // F06: 性能设置更新
  const handleSavePerf = async (mode: string, battery: boolean) => {
    if (!isDesktop) return;
    try {
      setPerfMode(mode);
      setBatteryAware(battery);
      await window.antiFace!.setPerformancePrefs({ mode, batteryAware: battery });
      onNotice({ kind: 'success', text: '性能策略已更新' });
      refreshAll();
    } catch (err: any) {
      onNotice({ kind: 'error', text: `更新性能策略失败: ${err.message}` });
    }
  };

  // F07: 发送测试提醒与试听
  const handleTestSound = async () => {
    if (!isDesktop) return;
    try {
      const result=await window.antiFace!.previewSound(notifyRules.soundChoice && notifyRules.soundChoice!=='default' ? notifyRules.soundChoice : 'preview');
      if(result?.ok===false) throw new Error(result.error || '播放失败');
      onNotice({ kind: 'success', text: '已播放测试音效' });
    } catch (err: any) {
      onNotice({ kind: 'error', text: `播放失败: ${err.message}` });
    }
  };

  const handleTestNotification = async () => {
    if (!isDesktop) return;
    try {
      const result=await window.antiFace!.testNotification(notifyRules);
      if(result?.notificationStatus?.supported===false || result?.notifyError) throw new Error(result.notifyError || '操作系统通知接口不可用');
      onNotice({ kind: 'success', text: '已向系统请求测试通知；实际送达由系统决定' });
    } catch (err: any) {
      onNotice({ kind: 'error', text: `发送失败: ${err.message}` });
    }
  };

  const handlePause30Mins = async () => {
    if (!isDesktop) return;
    try {
      const until = Date.now() + 30 * 60 * 1000;
      const updated = { ...notifyRules, pausedUntil: until };
      setNotifyRules(updated);
      await (window.antiFace as any).setPreferences?.({ notifications: updated });
      onNotice({ kind: 'success', text: '提醒已暂停 30 分钟' });
    } catch (err: any) {
      onNotice({ kind: 'error', text: `暂停失败: ${err.message}` });
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#121614] text-[#d6ded8] overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-[#232d26]">
        <div>
          <h2 className="text-xl font-bold text-[#e5eae6] flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#529b68]" />
            实用工具与系统管理 (v0.5.1)
          </h2>
          <p className="text-xs text-[#788c7f] mt-1">
            七项高频功能：一键恢复与安全模式、快速切换器、多屏与DPI适配、完整备份与迁移、性能自适应、提醒规则
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRestoreAll}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#422222] hover:bg-[#582b2b] text-[#fca5a5] text-xs font-medium rounded-lg border border-[#7f3232] transition-colors"
            title="将所有受管窗口立即恢复原始外观"
          >
            <RotateCcw className="w-4 h-4" />
            恢复所有窗口原貌
          </button>
          <button
            onClick={handleOpenSwitcher}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#25382b] hover:bg-[#324a3a] text-[#86efac] text-xs font-medium rounded-lg border border-[#3e5f49] transition-colors"
          >
            <Zap className="w-4 h-4" />
            快速主题切换
          </button>
        </div>
      </div>

      {/* 安全模式全局横幅 */}
      {safeStatus?.safeMode && (
        <div className="mb-6 p-4 bg-[#3a2020] border border-[#8b3434] rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-6 h-6 text-[#ef4444]" />
            <div>
              <div className="text-sm font-semibold text-[#fecaca]">当前处于安全模式 (Safe Mode)</div>
              <div className="text-xs text-[#fca5a5] mt-0.5">
                已自动暂停自动换肤、场景检测与任务提醒。主题编辑、诊断、恢复与备份功能依然完整可用。
              </div>
            </div>
          </div>
          <button
            onClick={handleToggleSafeMode}
            className="px-3 py-1.5 bg-[#542525] hover:bg-[#6c2e2e] text-[#fee2e2] text-xs font-medium rounded-lg border border-[#991b1b]"
          >
            退出安全模式
          </button>
        </div>
      )}

      {/* 子导航标签 */}
      <div className="flex gap-2 mb-6 border-b border-[#232d26] pb-2">
        <button
          onClick={() => setSubTab('recovery')}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
            subTab === 'recovery' ? 'bg-[#29382e] text-[#4ade80]' : 'text-[#829688] hover:text-[#d6ded8]'
          }`}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          F01 一键恢复与安全模式
        </button>
        <button
          onClick={() => setSubTab('switcher')}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
            subTab === 'switcher' ? 'bg-[#29382e] text-[#4ade80]' : 'text-[#829688] hover:text-[#d6ded8]'
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          F03 主题快速切换器
        </button>
        <button
          onClick={() => setSubTab('display')}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
            subTab === 'display' ? 'bg-[#29382e] text-[#4ade80]' : 'text-[#829688] hover:text-[#d6ded8]'
          }`}
        >
          <Monitor className="w-3.5 h-3.5" />
          F04 多显示器与DPI
        </button>
        <button
          onClick={() => setSubTab('backup')}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
            subTab === 'backup' ? 'bg-[#29382e] text-[#4ade80]' : 'text-[#829688] hover:text-[#d6ded8]'
          }`}
        >
          <Archive className="w-3.5 h-3.5" />
          F05 完整备份与迁移
        </button>
        <button
          onClick={() => setSubTab('performance')}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
            subTab === 'performance' ? 'bg-[#29382e] text-[#4ade80]' : 'text-[#829688] hover:text-[#d6ded8]'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          F06 性能自适应
        </button>
        <button
          onClick={() => setSubTab('notify')}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
            subTab === 'notify' ? 'bg-[#29382e] text-[#4ade80]' : 'text-[#829688] hover:text-[#d6ded8]'
          }`}
        >
          <Bell className="w-3.5 h-3.5" />
          F07 任务提醒规则
        </button>
        <button
          onClick={() => setSubTab('rotation')}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
            subTab === 'rotation' ? 'bg-[#29382e] text-[#4ade80]' : 'text-[#829688] hover:text-[#d6ded8]'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          F02 本地壁纸轮换
        </button>
      </div>

      {/* F01: 恢复与安全模式 */}
      {subTab === 'recovery' && (
        <div className="space-y-6 max-w-4xl">
          <div className="bg-[#18201b] border border-[#2b392f] rounded-xl p-5">
            <h3 className="text-sm font-semibold text-[#e5eae6] mb-3 flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-[#529b68]" />
              受管窗口恢复状态
            </h3>
            <p className="text-xs text-[#829688] mb-4">
              恢复操作将同步开启事务屏障，作废所有在途异步注入、取消试穿并恢复页面干净的原貌。不会删除任何已保存的主题、壁纸或偏好配置。
            </p>
            {recoveryReport ? (
              <div className="bg-[#121614] border border-[#2a352c] rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span className={recoveryReport.ok ? 'text-[#4ade80]' : 'text-[#f87171]'}>
                    {recoveryReport.summary}
                  </span>
                  <span className="text-[#64746a]">{new Date(recoveryReport.timestamp).toLocaleTimeString()}</span>
                </div>
                <div className="grid grid-cols-1 gap-2 pt-2 border-t border-[#1e2721]">
                  {Object.values(recoveryReport.targets || {}).map((item: any) => (
                    <div key={item.targetId} className="flex items-center justify-between text-xs bg-[#171d19] p-2.5 rounded">
                      <span className="font-mono text-[#a1b3a6]">{item.targetId}</span>
                      <span className={`px-2 py-0.5 rounded text-[11px] ${
                        item.ok ? 'bg-[#1e3a27] text-[#86efac]' : 'bg-[#3b1d1d] text-[#fca5a5]'
                      }`}>
                        {item.message}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-xs text-[#637568] bg-[#121614] p-4 rounded-lg">
                当前尚无恢复记录。点击上方“恢复所有窗口原貌”可立即执行全量恢复。
              </div>
            )}
          </div>

          <div className="bg-[#18201b] border border-[#2b392f] rounded-xl p-5">
            <h3 className="text-sm font-semibold text-[#e5eae6] mb-3 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#529b68]" />
              安全模式控制
            </h3>
            <p className="text-xs text-[#829688] mb-4">
              启动时自动核对运行标记；若检测到上次非正常退出或启动连续崩溃，将提示进入安全模式。支持通过命令行参数 <code className="bg-[#121614] px-1 py-0.5 rounded text-[#a7f3d0]">--safe-mode</code> 显式启动。
            </p>
            <div className="flex items-center gap-4">
              <button
                onClick={handleToggleSafeMode}
                className={`px-4 py-2 text-xs font-medium rounded-lg border transition-colors ${
                  safeStatus?.safeMode
                    ? 'bg-[#293d2e] border-[#44664c] text-[#86efac] hover:bg-[#344f3b]'
                    : 'bg-[#382626] border-[#6b3838] text-[#fca5a5] hover:bg-[#482e2e]'
                }`}
              >
                {safeStatus?.safeMode ? '退出安全模式 (保留用户设置)' : '立即进入安全模式'}
              </button>
              <div className="text-xs text-[#708476]">
                启动状态：{safeStatus?.wasUnclean ? '上次存在非正常退出' : '上次退出状态正常'} (累计故障: {safeStatus?.failureCount || 0})
              </div>
            </div>
          </div>
        </div>
      )}

      {/* F03: 快速主题切换器 */}
      {subTab === 'switcher' && (
        <div className="space-y-6 max-w-4xl">
          <div className="bg-[#18201b] border border-[#2b392f] rounded-xl p-5">
            <h3 className="text-sm font-semibold text-[#e5eae6] mb-3 flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#529b68]" />
              主题快速切换浮窗
            </h3>
            <p className="text-xs text-[#829688] mb-4">
              轻量化无边框浮窗，支持多窗口目标选择、实时拼音/风格纯前端过滤（无任何多余网络或注入开销）、收藏置顶与最近使用历史。上下键高亮浏览，Enter 快速应用，Esc 关闭。
            </p>
            <div className="flex items-center gap-4">
              <button
                onClick={handleOpenSwitcher}
                className="px-4 py-2 bg-[#25382b] hover:bg-[#324a3a] text-[#86efac] text-xs font-medium rounded-lg border border-[#3e5f49] flex items-center gap-2"
              >
                <Zap className="w-4 h-4" />
                呼出快速切换器
              </button>
              <span className="text-xs text-[#728577]">
                支持在托盘菜单直接点击打开，或使用全局自定义快捷键（默认关闭以防热键冲突）。
              </span>
            </div>
          </div>
        </div>
      )}

      {/* F04: 多显示器与 DPI */}
      {subTab === 'display' && (
        <div className="space-y-6 max-w-4xl">
          <div className="bg-[#18201b] border border-[#2b392f] rounded-xl p-5">
            <h3 className="text-sm font-semibold text-[#e5eae6] mb-3 flex items-center gap-2">
              <Monitor className="w-4 h-4 text-[#529b68]" />
              屏幕工作区与视口检测
            </h3>
            <p className="text-xs text-[#829688] mb-4">
              防抖监听显示器热插拔与分辨率调整。窗口关闭或拔掉扩展屏时，自动将窗口坐标限制在当前安全可见的工作区内，保证标题栏与控制区不离屏。
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {displays.length > 0 ? (
                displays.map((disp, idx) => (
                  <div key={idx} className="bg-[#121614] border border-[#273229] p-3.5 rounded-lg space-y-1 text-xs">
                    <div className="font-semibold text-[#b8c7bc]">显示器 #{idx + 1} ({disp.id})</div>
                    <div className="text-[#728477]">逻辑边界: {disp.bounds.x}, {disp.bounds.y} ({disp.bounds.width}×{disp.bounds.height})</div>
                    <div className="text-[#728477]">工作区: {disp.workArea.x}, {disp.workArea.y} ({disp.workArea.width}×{disp.workArea.height})</div>
                    <div className="text-[#529b68] font-mono">DPR 缩放比: {disp.scaleFactor * 100}%</div>
                  </div>
                ))
              ) : (
                <div className="text-xs text-[#637568] bg-[#121614] p-4 rounded-lg col-span-2">
                  默认屏幕：100% 缩放 (1920×1080)
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* F05: 完整备份与迁移 */}
      {subTab === 'backup' && (
        <div className="space-y-6 max-w-4xl">
          <div className="bg-[#18201b] border border-[#2b392f] rounded-xl p-5">
            <h3 className="text-sm font-semibold text-[#e5eae6] mb-3 flex items-center gap-2">
              <Archive className="w-4 h-4 text-[#529b68]" />
              完整备份导出 (.antiface-backup)
            </h3>
            <p className="text-xs text-[#829688] mb-4">
              将全部自定义主题、壁纸资产图片、自动化偏好规则与脱敏项目绑定打包为一个受控的安全 Zip 归档。已自动排除敏感聊天正文、Token 历史、诊断缓存与 CDP 调试凭证。
            </p>
            <button
              onClick={handleExportBackup}
              disabled={backupBusy}
              className="px-4 py-2 bg-[#25382b] hover:bg-[#324a3a] text-[#86efac] text-xs font-medium rounded-lg border border-[#3e5f49] flex items-center gap-2 disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              {backupBusy ? '正在导出…' : '导出完整备份包'}
            </button>
          </div>

          <div className="bg-[#18201b] border border-[#2b392f] rounded-xl p-5">
            <h3 className="text-sm font-semibold text-[#e5eae6] mb-3 flex items-center gap-2">
              <Upload className="w-4 h-4 text-[#529b68]" />
              分阶段恢复与冲突解决
            </h3>
            <p className="text-xs text-[#829688] mb-4">
              严格执行三阶段安全恢复：首先进行只读校验（校验 hash、路径安全、512MB解压上限与图像解码），然后展示冲突预览，最后确认执行带恢复日志的事务提交；中断时启动恢复旧状态。
            </p>

            <div className="space-y-4">
              <button
                onClick={handleInspectBackup}
                disabled={backupBusy}
                className="px-4 py-2 bg-[#1f2822] hover:bg-[#2b372f] text-[#d1ded5] text-xs font-medium rounded-lg border border-[#36463a] flex items-center gap-2 disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${backupBusy ? 'animate-spin' : ''}`} />
                选择备份包并检验
              </button>

              {restorePreview && (
                <div className="bg-[#121614] border border-[#2e3b31] p-4 rounded-lg space-y-3 text-xs">
                  <div className="font-semibold text-[#86efac] flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    备份包已通过安全检查
                  </div>
                  <div className="grid grid-cols-3 gap-2 py-2 border-y border-[#1e2721] text-[#9bb0a2]">
                    <div>待导入主题: {restorePreview.themeStats.total} 套</div>
                    <div>新增主题: {restorePreview.themeStats.newCount} 套</div>
                    <div className={restorePreview.themeStats.conflictCount > 0 ? 'text-[#fca5a5]' : ''}>
                      冲突主题: {restorePreview.themeStats.conflictCount} 套
                    </div>
                  </div>

                  {restorePreview.themeStats.conflictCount > 0 && (
                    <div className="space-y-2">
                      <div className="text-[#e2e8e4] font-medium">冲突处理策略：</div>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name="strategy"
                            checked={restoreStrategy === 'keep-both'}
                            onChange={() => setRestoreStrategy('keep-both')}
                          />
                          <span>保留两份（为导入主题生成新 ID 副本）</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name="strategy"
                            checked={restoreStrategy === 'overwrite'}
                            onChange={() => setRestoreStrategy('overwrite')}
                          />
                          <span>明确覆盖现有冲突主题</span>
                        </label>
                      </div>
                    </div>
                  )}

                  <div>{([['restoreAppearance','当前外观',true],['restorePreferences','偏好设置',restorePreview.hasPreferences],['restoreBindings','项目绑定（恢复后需重新关联）',restorePreview.hasBindings],['restoreRevisions','版本历史',restorePreview.hasRevisions]] as const).filter(([, , present])=>present).map(([key,label])=><label key={key}><input type="checkbox" checked={restoreSections[key]} onChange={e=>setRestoreSections({...restoreSections,[key]:e.target.checked})}/>{label}</label>)}</div>
                  <div className="pt-2">
                    <button onClick={async()=>{if(backupInspection?.inspectionId)await window.antiFace!.cancelBackupInspection(backupInspection.inspectionId);setBackupInspection(null);setRestorePreview(null);}}>取消恢复</button>
                    <button
                      onClick={handleCommitRestore}
                      disabled={backupBusy}
                      className="px-4 py-2 bg-[#2d5237] hover:bg-[#386644] text-[#dcfce7] font-semibold rounded-lg text-xs"
                    >
                      确认执行事务恢复
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <AutoBackupCard onNotice={onNotice} />
        </div>
      )}

      {/* F06: 性能自适应 */}
      {subTab === 'performance' && (
        <div className="space-y-6 max-w-4xl">
          <div className="bg-[#18201b] border border-[#2b392f] rounded-xl p-5">
            <h3 className="text-sm font-semibold text-[#e5eae6] mb-3 flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#529b68]" />
              性能自适应策略
            </h3>
            <p className="text-xs text-[#829688] mb-4">
              当前没有可靠的帧时间采样，不会按掉帧猜测并自动调整。选择自动后，只在系统报告电池或交流电变化时限制壁纸与区域模糊（省电不超过 8px），恢复交流电后回到已保存效果。
              <strong className="text-[#a7f3d0]"> 严格保证：只在渲染变量层覆盖，绝不修改主题原始文件，不产生多余撤销历史。</strong>
            </p>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-[#b8c7bd] block mb-2">策略模式：</label>
                <div className="flex gap-4 text-xs">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="perfMode"
                      value="off"
                      checked={perfMode === 'off'}
                      onChange={() => handleSavePerf('off', batteryAware)}
                    />
                    <span>完全关闭 (保持用户原始模糊)</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="perfMode"
                      value="advisory"
                      checked={perfMode === 'advisory'}
                      onChange={() => handleSavePerf('advisory', batteryAware)}
                    />
                    <span>仅建议 (默认：显示电源状态，不自动修改外观)</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="perfMode"
                      value="auto"
                      checked={perfMode === 'auto'}
                      onChange={() => handleSavePerf('auto', batteryAware)}
                    />
                    <span>自动调整 (可靠电源事件触发；当前未采集 FPS)</span>
                  </label>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  id="batteryAware"
                  checked={batteryAware}
                  onChange={e => handleSavePerf(perfMode, e.target.checked)}
                />
                <label htmlFor="batteryAware" className="cursor-pointer">
                  电池供电自动降级为省电模式
                </label>
              </div>

              <div className="bg-[#121614] border border-[#273229] p-3.5 rounded-lg text-xs space-y-1">
                <div className="text-[#86efac] font-medium">当前运行状态：</div>
                <div className="text-[#8ba091]">生效分档: {perfSummary?.tier || 'normal'} ({perfSummary?.reason || '正常运行'})</div>
                <div className="text-[#728577]">电源状态: {perfSummary?.powerSource || 'unknown'}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* F07: 任务提醒规则 */}
      {subTab === 'notify' && (
        <div className="space-y-6 max-w-4xl">
          <div className="bg-[#18201b] border border-[#2b392f] rounded-xl p-5">
            <h3 className="text-sm font-semibold text-[#e5eae6] mb-3 flex items-center gap-2">
              <Bell className="w-4 h-4 text-[#529b68]" />
              任务结果提醒高级规则
            </h3>
            <p className="text-xs text-[#829688] mb-4">
              失败和等待提醒会遵守静音时段、前台抑制和 30 分钟暂停。当前来源不能证明整任务完成，完成提醒不会自动触发。
            </p>

            <div className="mb-4 p-3 bg-[#1e2621] border border-[#314036] rounded-lg flex items-start gap-2.5 text-xs text-[#9bb0a2]">
              <AlertTriangle className="w-4 h-4 text-[#eab308] shrink-0 mt-0.5" />
              <div>
                <strong className="text-[#e2e8e4]">真实性硬边界声明：</strong>
                当前 Antigravity 日志源未暴露逐任务的可靠终态定界，不能把单个工具或规划步骤完成当成整任务完成。因此整任务自动完成提醒保持禁用；仅在明确标为 FAILED / ERROR 时触发失败提醒。
              </div>
            </div>

            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyRules.onFailed}
                    onChange={e => setNotifyRules({ ...notifyRules, onFailed: e.target.checked })}
                  />
                  <span>任务明确失败时提醒 (onFailed)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyRules.onWaitingUser}
                    onChange={e => setNotifyRules({ ...notifyRules, onWaitingUser: e.target.checked })}
                  />
                  <span>需要用户输入时提醒 (onWaitingUser)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyRules.desktop}
                    onChange={e => setNotifyRules({ ...notifyRules, desktop: e.target.checked })}
                  />
                  <span>启用桌面横幅通知</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyRules.sound}
                    onChange={e => setNotifyRules({ ...notifyRules, sound: e.target.checked })}
                  />
                  <span>启用提示音效</span>
                </label>
              </div>

              <label>提示音 <select aria-label="提醒声音" value={notifyRules.soundChoice || 'default'} onChange={e=>setNotifyRules({...notifyRules,soundChoice:e.target.value})}>
                <option value="default">按事件</option><option value="completed">完成音</option><option value="failed">失败音</option><option value="waiting_user">等待音</option>
              </select></label>
              <label><input type="checkbox" checked={notifyRules.suppressInForeground === true} onChange={e=>setNotifyRules({...notifyRules,suppressInForeground:e.target.checked})}/>宿主处于前台时抑制横幅</label>
              <label><input type="checkbox" checked={notifyRules.quietEnabled === true} onChange={e=>setNotifyRules({...notifyRules,quietEnabled:e.target.checked})}/>启用静音时段</label>
              <input aria-label="静音开始" type="time" value={notifyRules.quietStart || '22:00'} onChange={e=>setNotifyRules({...notifyRules,quietStart:e.target.value})}/>
              <input aria-label="静音结束" type="time" value={notifyRules.quietEnd || '08:00'} onChange={e=>setNotifyRules({...notifyRules,quietEnd:e.target.value})}/>
              <button onClick={async()=>{try{await window.antiFace!.setPreferences({notifications:notifyRules});onNotice({kind:'success',text:'提醒规则已保存'});}catch(error:any){onNotice({kind:'error',text:error.message});}}}>保存提醒规则</button>
              <div className="pt-2 border-t border-[#232d26] flex items-center gap-4">
                <button
                  onClick={handleTestSound}
                  className="px-3 py-1.5 bg-[#25332a] hover:bg-[#324438] text-[#86efac] font-medium rounded border border-[#395041] flex items-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5" />
                  试听提示音
                </button>
                <button
                  onClick={handleTestNotification}
                  className="px-3 py-1.5 bg-[#25332a] hover:bg-[#324438] text-[#86efac] font-medium rounded border border-[#395041] flex items-center gap-1.5"
                >
                  <Bell className="w-3.5 h-3.5" />
                  发送测试通知
                </button>
                <button
                  onClick={handlePause30Mins}
                  className="px-3 py-1.5 bg-[#2f2727] hover:bg-[#3d3232] text-[#fca5a5] font-medium rounded border border-[#583939]"
                >
                  暂停提醒 30 分钟
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* F02: 本地壁纸文件夹轮换 */}
      {subTab === 'rotation' && (
        <div className="space-y-6 max-w-4xl">
          <WallpaperRotationCard targetId={selectedTargetId} onNotice={onNotice} />
        </div>
      )}
    </div>
  );
}
