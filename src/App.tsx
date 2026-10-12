import { useEffect, useRef, useState } from 'react';
import { AppearanceHistory } from '../core/appearance-history.cjs';
import {
  Activity,
  Check,
  ChevronRight,
  Download,
  ExternalLink,
  History,
  Layers3,
  Monitor,
  Palette,
  Plug,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Upload
} from 'lucide-react';
import { themes } from './themes';
import { ThemeCard } from './components/ThemeCard';
import { Preview } from './components/Preview';
import { AppearancePanel } from './components/AppearancePanel';
import { RealtimePanel } from './components/RealtimePanel';
import { HistoryPanel } from './components/HistoryPanel';
import { ThemeLibraryPanel } from './components/ThemeLibrary';
import { AutomationSettings } from './components/AutomationSettings';
import { NotificationSettings } from './components/NotificationSettings';
import { Round5Page } from './components/Round5Page';
import { Round6Page } from './components/Round6Page';
import { ApplySummaryModal } from './components/ApplySummaryModal';
import { CopyThemePartsModal } from './components/CopyThemePartsModal';
import { desktopAdapter } from './adapters/desktop';
import { defaultSettings, downloadSettings, parseSettings, readImage } from './lib/settings';
import packageJson from '../package.json';
import type { ConnectionStatus, PerformancePreset, RegionId, Settings, TargetWindow, TelemetryState, ThemeDocument } from './types';

const isDesktop = !!window.antiFace;
const initialStatus: ConnectionStatus = {
  state: 'detached',
  message: isDesktop ? '正在检测 Antigravity…' : '浏览器预览模式；请使用桌面版连接 Antigravity',
  host: null,
  probe: null,
  session: null
};

const stateNames: Record<ConnectionStatus['state'], string> = {
  detached: '未连接',
  probing: '检测中',
  ready: '可以应用',
  applied: '主题生效中',
  suspended: '已暂停',
  unsupported: '尚未兼容',
  error: '连接异常'
};

type Filter = 'all' | 'dark' | 'light' | 'glass';
type PageTab = 'studio' | 'realtime' | 'history' | 'connection' | 'round5' | 'round6';

export default function App() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState('正在读取设置');
  const [status, setStatus] = useState<ConnectionStatus>(initialStatus);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState<PageTab>('studio');
  const [appliedSettings, setAppliedSettings] = useState('');

  // 多窗口与遥测状态
  const [targets, setTargets] = useState<TargetWindow[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryState | null>(null);
  const [autoRestore, setAutoRestore] = useState(false);
  const [region, setRegion] = useState<RegionId>('global');
  const [round4, setRound4] = useState<any>(null);
  const [livePreview, setLivePreview] = useState(false);
  const previewRef = useRef(false);
  function setPreviewing(next: boolean) {
    previewRef.current = next;
    setLivePreview(next);
  }
  const [closeChoice, setCloseChoice] = useState(false);
  const [draftConflict, setDraftConflict] = useState<{ backgroundDoc: ThemeDocument } | null>(null);
  const [historyMarks, setHistoryMarks] = useState({ undo: false, redo: false });
  const historyRef = useRef<AppearanceHistory | null>(null);
  const documentRef = useRef<ThemeDocument | null>(null);
  const savedOk = useRef<Settings>(defaultSettings);
  const selectedRef = useRef<string | null>(null);
  const actionSerial = useRef(0);
  selectedRef.current = selectedTargetId;

  const imageInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const previewContainerRef = useRef<HTMLElement>(null);
  const [previewScene, setPreviewScene] = useState<'home' | 'chat'>('home');
  const [historyRetryId, setHistoryRetryId] = useState<string | null>(null);
  const [previewViewport, setPreviewViewport] = useState<{ width: number; height: number }>({ width: 1280, height: 800 });
  const [effectiveVisual, setEffectiveVisual] = useState<any>(null);
  const [effectiveAdjustments, setEffectiveAdjustments] = useState<any[]>([]);
  const [applySummary, setApplySummary] = useState<any>(null);
  const [showCopyPartsModal, setShowCopyPartsModal] = useState<boolean>(false);
  const theme = themes.find(t => t.id === settings.themeId) || themes[0];
  const dirty = !!status.session && appliedSettings !== JSON.stringify(settings);

  useEffect(() => {
    if (!previewContainerRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 50 && height > 50) {
          setPreviewViewport({ width: Math.round(width), height: Math.round(height) });
        }
      }
    });
    observer.observe(previewContainerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    const doc = round4?.document;
    if (!doc || !isDesktop || !window.antiFace?.analyzeReadability) {
      setEffectiveVisual(null);
      setEffectiveAdjustments([]);
      return;
    }
    window.antiFace.analyzeReadability(doc, selectedTargetId, previewViewport, previewScene, 'preview')
      .then(res => {
        if (!active) return;
        setEffectiveVisual(res?.effectiveVisual || null);
        setEffectiveAdjustments(res?.adjustments || []);
      })
      .catch(() => {
        if (active) {
          setEffectiveVisual(null);
          setEffectiveAdjustments([]);
        }
      });
    return () => { active = false; };
  }, [round4?.document, selectedTargetId, previewViewport, previewScene, isDesktop]);

  // 初始化设置与宿主检测
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const result = isDesktop
          ? await window.antiFace!.loadSettings()
          : { settings: JSON.parse(localStorage.getItem('anti-face-settings') || 'null') || defaultSettings, warning: null };
        if (alive) {
          const parsed = parseSettings(result.settings);
          savedOk.current = parsed;
          setSettings(parsed);
          setAutoRestore(parsed.autoRestoreOnReload === true);
          if (result.warning) setNotice({ kind: 'error', text: result.warning });
          if (isDesktop && window.antiFace?.studioState) {
            const studio = await window.antiFace.studioState().catch(() => null);
            if (alive && studio) {
              documentRef.current = studio.document || null;
              if (studio.document) historyRef.current = new AppearanceHistory(studio.document);
              setRound4(studio);
            }
          }
        }
      } catch {
        if (alive) setNotice({ kind: 'error', text: '无法读取之前的设置，已使用默认预览。' });
      } finally {
        if (alive) setLoaded(true);
      }
    })();

    if (isDesktop) {
      window.antiFace!.listTargets()
        .then(list => {
          if (alive) {
            setTargets(list);
            if (list.length > 0 && !selectedRef.current) {
              const current = list.find(t => t.isCurrent) || list[0];
              setSelectedTargetId(current.id);
            }
          }
        })
        .catch(() => {});
    }

    return () => { alive = false; };
  }, []);

  // 设置自动持久化
  useEffect(() => {
    if (!loaded) return;
    let alive = true;
    setSaved('正在保存…');
    const pending = settings;
    const timeout = setTimeout(async () => {
      try {
        if (isDesktop) await window.antiFace!.saveSettings(pending);
        else localStorage.setItem('anti-face-settings', JSON.stringify(pending));
        savedOk.current = pending;
        if (alive) setSaved('设置已保存到本机');
      } catch (error) {
        if (!alive) return;
        setSaved('保存失败，已回退');
        setNotice({ kind: 'error', text: error instanceof Error ? error.message : '设置保存失败，已回退到上次成功的配置' });
        setSettings(savedOk.current);
      }
    }, 350);
    return () => { alive = false; clearTimeout(timeout); };
  }, [settings, loaded]);

  // 定时心跳与遥测轮询
  useEffect(() => {
    if (!isDesktop) return;
    let alive = true;

    const pull = async () => {
      try {
        const newTargets = await window.antiFace!.listTargets();
        if (!alive) return;
        setTargets(newTargets);
        setSelectedTargetId(prev => {
          if (prev && !newTargets.some(target => target.id === prev)) return null;
          if (!prev && newTargets.length > 0) return (newTargets.find(target => target.isCurrent) || newTargets[0]).id;
          return prev;
        });
        const target = selectedRef.current;
        const newStatus = await desktopAdapter.status(target);
        if (alive && selectedRef.current === target) setStatus(newStatus);
        const newTelemetry = await window.antiFace!.getTelemetryState();
        if (alive && selectedRef.current === target) setTelemetry(newTelemetry);
      } catch { /* non-fatal poll error */ }
    };
    void pull();
    const timer = setInterval(() => { void pull(); }, 2500);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!isDesktop) return;
    let alive = true;
    setStatus({ ...initialStatus, state: 'probing', message: '正在检查所选窗口' });
    void desktopAdapter.inspect(selectedTargetId)
      .then(value => { if (alive) setStatus(value); })
      .catch(() => { if (alive) setStatus(initialStatus); });
    window.antiFace!.setTelemetryTarget(selectedTargetId)
      .then(state => { if (alive) setTelemetry(state); })
      .catch(() => {});
    return () => { alive = false; };
  }, [selectedTargetId]);

  async function run(label: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '操作失败，请重试' });
      if (isDesktop) setStatus(await desktopAdapter.status().catch(() => initialStatus));
    } finally {
      setBusy('');
    }
  }

  function superseded(op: number) {
    return actionSerial.current !== op;
  }

  async function apply() {
    const op = ++actionSerial.current;
    setBusy('正在应用…');
    setNotice(null);
    try {
      const target = selectedTargetId;
      const result = documentRef.current
        ? await window.antiFace!.applyDocument(documentRef.current, target)
        : await desktopAdapter.apply(settings, target);
      if (superseded(op)) return;
      const outcome = result as { stale?: boolean; code?: string; state?: string; message?: string; revisionSaved?: boolean; operationId?: string };
      if (outcome?.stale || outcome?.code === 'STALE' || outcome?.state === 'cancelled') {
        setNotice({ kind: 'error', text: outcome.message || '应用已取消' });
        if (isDesktop) setStatus(await desktopAdapter.status().catch(() => initialStatus));
        return;
      }
      if (selectedRef.current === target) setStatus(result);
      setAppliedSettings(JSON.stringify(settings));
      if (outcome?.revisionSaved === false) {
        setNotice({ kind: 'error', text: outcome.message || '主题已经应用，但版本历史没有写完。' });
        if (outcome.operationId) setHistoryRetryId(outcome.operationId);
      } else {
        setNotice({ kind: 'success', text: '已应用到 Antigravity。调整参数后，点击更新主题即可再次应用。' });
      }
      if (isDesktop) {
        const list = await window.antiFace!.listTargets();
        if (superseded(op)) return;
        setTargets(list);
      }
    } catch (error) {
      if (superseded(op)) return;
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '操作失败，请重试' });
      if (isDesktop) setStatus(await desktopAdapter.status().catch(() => initialStatus));
    } finally {
      if (!superseded(op)) setBusy('');
    }
  }

  async function handleInspectApplySummary() {
    if (!isDesktop) return;
    const target = selectedTargetId;
    const doc = documentRef.current;
    if (!doc) {
      setNotice({ kind: 'error', text: '当前没有可分析的主题草稿' });
      return;
    }
    setBusy('正在生成变更摘要…');
    try {
      const summary = await window.antiFace!.previewApply(doc, target);
      setApplySummary(summary);
    } catch (err: any) {
      setNotice({ kind: 'error', text: err.message || '获取应用前摘要失败' });
    } finally {
      setBusy('');
    }
  }

  async function confirmSummary(previewId: string) {
    if (!isDesktop) return;
    const op = ++actionSerial.current;
    setBusy('正在应用…');
    setNotice(null);
    try {
      const result = await window.antiFace!.confirmApply(previewId, {
        currentDocument: documentRef.current, targetId: selectedRef.current
      });
      if (superseded(op)) return;
      const outcome = result as { ok?: boolean; stale?: boolean; code?: string; state?: string; message?: string; revisionSaved?: boolean; operationId?: string };
      if (outcome?.ok === false || outcome?.stale || outcome?.code === 'STALE' || outcome?.state === 'cancelled') {
        setNotice({ kind: 'error', text: outcome.message || '应用已取消' });
        if (isDesktop) setStatus(await desktopAdapter.status().catch(() => initialStatus));
        return;
      }
      if (selectedRef.current === selectedTargetId) setStatus(result);
      setAppliedSettings(JSON.stringify(settings));
      if (outcome?.revisionSaved === false) {
        setNotice({ kind: 'error', text: outcome.message || '主题已经应用，但版本历史没有写完。' });
        if (outcome.operationId) setHistoryRetryId(outcome.operationId);
      } else {
        setNotice({ kind: 'success', text: '已通过确认应用到 Antigravity。' });
      }
      if (isDesktop) {
        const list = await window.antiFace!.listTargets();
        if (superseded(op)) return;
        setTargets(list);
      }
    } catch (error) {
      if (superseded(op)) return;
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '确认应用失败' });
      if (isDesktop) setStatus(await desktopAdapter.status().catch(() => initialStatus));
    } finally {
      if (!superseded(op)) setBusy('');
    }
  }

  async function restore() {
    const op = ++actionSerial.current;
    const target = selectedTargetId;
    setNotice(null);
    setBusy('正在恢复…');
    try {
      const result = await desktopAdapter.restore(target);
      if (superseded(op)) return;
      const outcome = result as { stale?: boolean; code?: string; message?: string };
      if (outcome?.stale || outcome?.code === 'STALE') {
        setNotice({ kind: 'error', text: outcome.message || '恢复已取消' });
        if (isDesktop) setStatus(await desktopAdapter.status().catch(() => initialStatus));
        return;
      }
      if (selectedRef.current === target) setStatus(result);
      setAppliedSettings('');
      setNotice({ kind: 'success', text: '已恢复 Antigravity 原始外观' });
      if (isDesktop) {
        const list = await window.antiFace!.listTargets();
        if (superseded(op)) return;
        setTargets(list);
      }
    } catch (error) {
      if (superseded(op)) return;
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '操作失败，请重试' });
      if (isDesktop) setStatus(await desktopAdapter.status().catch(() => initialStatus));
    } finally {
      if (!superseded(op)) setBusy('');
    }
  }

  async function chooseWallpaper() {
    if (!isDesktop) {
      imageInput.current?.click();
      return;
    }
    await run('选择壁纸', async () => {
      const wallpaper = await window.antiFace!.chooseWallpaper();
      const recent = await window.antiFace!.recentWallpaper().catch(() => null);
      if (wallpaper) {
        const current = documentRef.current;
        if (current) {
          updateDocument({ ...current, wallpaper: { ...current.wallpaper, legacyDataUrl: wallpaper, assetId: recent?.assetId || current.wallpaper.assetId } });
        } else setSettings(value => ({ ...value, appearance: { ...value.appearance, wallpaper } }));
      }
    });
  }

  async function importTheme() {
    if (!isDesktop) {
      importInput.current?.click();
      return;
    }
    await run('导入配置', async () => {
      const value = await window.antiFace!.importSettings();
      if (value) {
        const theme = parseSettings(value);
        setSettings(current => ({
          ...current,
          themeId: theme.themeId,
          appearance: theme.appearance,
          preset: theme.preset,
          autoRestoreOnReload: current.autoRestoreOnReload,
          history: current.history
        }));
        setNotice({ kind: 'success', text: '配置已导入预览，点击应用后才会改变客户端。' });
      }
    });
  }

  const handleAutoRestoreToggle = async (checked: boolean) => {
    const previous = autoRestore;
    setAutoRestore(checked);
    if (!isDesktop) return;
    try {
      await window.antiFace!.setAutoRestore(checked);
      setSettings(s => ({ ...s, autoRestoreOnReload: checked }));
    } catch (error) {
      setAutoRestore(previous);
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '自动恢复设置失败，已回退' });
    }
  };

  const handleSelectTarget = (targetId: string) => {
    selectedRef.current = targetId;
    setSelectedTargetId(targetId);
    setStatus({ ...initialStatus, state: 'probing', message: '正在检查所选窗口' });
  };

  const handlePresetChange = (preset: PerformancePreset) => {
    setSettings(s => ({ ...s, preset }));
  };

  function refreshHistory() {
    if(isDesktop && window.antiFace?.updateEditorSession) void window.antiFace.updateEditorSession({assetIds:[...(historyRef.current?.referencedAssetIds() || [])],dirty:historyRef.current?.canUndo === true,document:documentRef.current,targetId:selectedRef.current}).catch(error=>setNotice({kind:'error',text:error.message}));
    setHistoryMarks({ undo: historyRef.current?.canUndo === true, redo: historyRef.current?.canRedo === true });
  }

  function remember(next: ThemeDocument) {
    if (!historyRef.current) historyRef.current = new AppearanceHistory(documentRef.current || next);
    historyRef.current.push(next);
    refreshHistory();
  }

  function updateDocument(next: ThemeDocument, history: 'push' | 'replace' | 'none' = 'push') {
    documentRef.current = next;
    setRound4((current: any) => ({ ...(current || {}), document: next }));
    setSettings(current => ({
      ...current,
      themeId: next.baseThemeId,
      preset: next.preset === 'custom' ? undefined : next.preset,
      appearance: {
        ...current.appearance,
        blur: next.regions.global?.blur ?? current.appearance.blur,
        opacity: next.regions.global?.opacity ?? current.appearance.opacity,
        radius: next.regions.global?.radius ?? current.appearance.radius,
        wallpaper: next.wallpaper.legacyDataUrl
      }
    }));
    if (history === 'replace') {
      historyRef.current = new AppearanceHistory(next);
      refreshHistory();
    } else if (history === 'push') remember(next);
    if (!isDesktop) return;
    if (previewRef.current) {
      void window.antiFace!.updatePreview(next, selectedRef.current).catch(error => {
        setNotice({ kind: 'error', text: error instanceof Error ? error.message : '试穿更新失败' });
      });
    } else {
      // The draft belongs to the editing session until the user explicitly saves.
      void window.antiFace!.updateEditorSession({assetIds:[...(historyRef.current?.referencedAssetIds() || [])],dirty:historyRef.current?.canUndo === true,document:next,targetId:selectedRef.current}).catch(error => {
        setNotice({ kind: 'error', text: error instanceof Error ? error.message : '草稿保存失败' });
      });
    }
  }

  function selectBuiltin(themeId: string) {
    const base = themes.find(item => item.id === themeId);
    const current = documentRef.current;
    const next: ThemeDocument = current
      ? { ...current, id: 'draft', baseThemeId: themeId, name: base?.name || current.name }
      : current as unknown as ThemeDocument;
    setSettings(value => ({ ...value, themeId }));
    if (current) updateDocument(next, 'replace');
  }

  async function finishClose(choice: 'save' | 'cancel' | 'continue') {
    setCloseChoice(false);
    if (!isDesktop) return;
    const result = await window.antiFace!.resolvePreviewClose(choice);
    if (result?.error) {
      console.error('关闭试穿失败', result.error);
      setNotice({ kind: 'error', text: result.error });
    }
    if (choice !== 'continue') {
      setPreviewing(false);
      const latest = await window.antiFace!.studioState();
      setRound4(latest);
      if (choice === 'cancel' && latest?.document) {
        updateDocument(latest.document, 'replace');
      }
    }
  }

  function undoEdit() {
    const next = historyRef.current?.undo() as ThemeDocument | null;
    if (next) updateDocument(next, 'none');
    refreshHistory();
  }

  function redoEdit() {
    const next = historyRef.current?.redo() as ThemeDocument | null;
    if (next) updateDocument(next, 'none');
    refreshHistory();
  }

  function revertBaseline() {
    const next = historyRef.current?.revertToBaseline() as ThemeDocument | null;
    if (next) {
      updateDocument(next, 'none');
      setNotice({ kind: 'success', text: '已恢复进入编辑时的基线状态' });
    }
    refreshHistory();
  }

  useEffect(() => {
    if (!isDesktop || !window.antiFace?.onPreviewCloseRequested) return;
    return window.antiFace.onPreviewCloseRequested(() => setCloseChoice(true));
  }, []);

  useEffect(() => {
    if (!isDesktop || !window.antiFace?.onStudioChanged) return;
    return window.antiFace.onStudioChanged(snapshot => {
      if (!snapshot) return;
      setRound4(snapshot);
      const bgDoc = snapshot.document;
      if (!bgDoc) return;
      if(snapshot.editorResolved?.targetId===selectedRef.current) {documentRef.current=bgDoc;historyRef.current=new AppearanceHistory(bgDoc);refreshHistory();}
      const isDirty = historyRef.current?.canUndo;
      if (!isDirty && !livePreview) {
        documentRef.current = bgDoc;
        setSettings(current => ({
          ...current,
          themeId: bgDoc.baseThemeId,
          preset: bgDoc.preset === 'custom' ? undefined : bgDoc.preset,
          appearance: {
            ...current.appearance,
            blur: bgDoc.regions.global?.blur ?? current.appearance.blur,
            opacity: bgDoc.regions.global?.opacity ?? current.appearance.opacity,
            radius: bgDoc.regions.global?.radius ?? current.appearance.radius,
            wallpaper: bgDoc.wallpaper.legacyDataUrl
          }
        }));
      } else if (documentRef.current && (bgDoc.id !== documentRef.current.id || bgDoc.name !== documentRef.current.name)) {
        setDraftConflict({ backgroundDoc: bgDoc });
      }
    });
  }, [livePreview]);

  useEffect(() => {
    if (!isDesktop || !window.antiFace?.onSystemScheme) return;
    return window.antiFace.onSystemScheme(scheme => {
      setRound4((current: any) => current ? { ...current, automation: { ...current.automation, systemScheme: scheme } } : current);
    });
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.isComposing) return;
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if (typing || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoEdit();
        else undoEdit();
      } else if (key === 'y') {
        event.preventDefault();
        redoEdit();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [livePreview]);

  const visibleThemes = themes.filter(
    t =>
      (filter === 'all' || (filter === 'glass' ? t.glass : t.mode === filter)) &&
      (t.name + t.id + t.description).toLowerCase().includes(query.toLowerCase())
  );

  const canApply = isDesktop && ['ready', 'applied'].includes(status.state);

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="brand">
          <div className="brand-mark"><Layers3 size={23} /></div>
          <div>Anti Face<small>YOUR SPACE, YOUR WAY</small></div>
        </div>

        <span className="nav-caption">工作区</span>
        <nav aria-label="主导航">
          <button
            className={page === 'studio' ? 'nav-item active' : 'nav-item'}
            onClick={() => setPage('studio')}
          >
            <Palette size={18} />主题与外观
            {page === 'studio' && <ChevronRight size={14} />}
          </button>

          <button
            className={page === 'realtime' ? 'nav-item active' : 'nav-item'}
            onClick={() => setPage('realtime')}
          >
            <Activity size={18} />实时任务状态
            {page === 'realtime' && <ChevronRight size={14} />}
          </button>

          <button
            className={page === 'history' ? 'nav-item active' : 'nav-item'}
            onClick={() => setPage('history')}
          >
            <History size={18} />本地历史与趋势
            {page === 'history' && <ChevronRight size={14} />}
          </button>

          <button
            className={page === 'connection' ? 'nav-item active' : 'nav-item'}
            onClick={() => setPage('connection')}
          >
            <Plug size={18} />连接与兼容
            {page === 'connection' && <ChevronRight size={14} />}
          </button>
          <button
            className={page === 'round5' ? 'nav-item active' : 'nav-item'}
            onClick={() => setPage('round5')}
          >
            <Sparkles size={18} />阅读与精选
            {page === 'round5' && <ChevronRight size={14} />}
          </button>
          <button
            className={page === 'round6' ? 'nav-item active' : 'nav-item'}
            onClick={() => setPage('round6')}
          >
            <Sparkles size={18} />实用功能 (F01–F07)
            {page === 'round6' && <ChevronRight size={14} />}
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="local-label"><ShieldCheck size={16} />只属于你的工作空间</div>
          <p>主题与壁纸保存在本机。<br />随时换一种心情，随时恢复。</p>
          <div className="version-label">Anti Face Studio <span>v{packageJson.version}</span></div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <span>工作室</span>
            <ChevronRight size={13} />
            <strong>
              {page === 'studio' && '主题与外观'}
              {page === 'realtime' && '实时任务状态'}
              {page === 'history' && '本地历史与趋势'}
              {page === 'connection' && '连接与兼容'}
              {page === 'round5' && '阅读、诊断与精选'}
              {page === 'round6' && '实用功能与系统管理'}
            </strong>
          </div>
          <span className={'connection-pill ' + (canApply ? 'online' : '')}>
            <i />
            {isDesktop ? stateNames[status.state] : '浏览器预览'}
          </span>
        </header>

        <main>
          <div className="page-heading">
            <div>
              <span className="eyebrow">A LITTLE MORE YOU</span>
              <h1>
                {page === 'studio' && '让工作空间，有你的风格。'}
                {page === 'realtime' && '实时状态与 Token 监控。'}
                {page === 'history' && '本地任务统计与使用趋势。'}
                {page === 'connection' && '与 Antigravity 连接。'}
                {page === 'round5' && '阅读保护、真实对比和离线精选。'}
                {page === 'round6' && '一键恢复、快速切换、备份迁移与性能管理。'}
              </h1>
              <p>
                {page === 'studio' && '一套主题，一点灵感。打造让你想要停留的地方。'}
                {page === 'realtime' && '观察当前任务运行阶段、延迟、Token 速度与用量结构。'}
                {page === 'history' && '按日期、模型、项目查看历史统计，支持筛选、导出与清理。'}
                {page === 'connection' && '检查客户端状态，管理多窗口换肤与自动恢复设置。'}
                {page === 'round5' && '对比、构图和精选都经过本机主进程。远程主题源没有配置。'}
                {page === 'round6' && '全量恢复、多屏与DPI适配、自适应降级、可靠提醒及完整数据迁移。'}
              </p>
            </div>

            <div className="header-actions">
              {isDesktop && (
                <button
                  className="secondary-button"
                  style={{ color: '#fca5a5', borderColor: '#7f3232' }}
                  title="一键恢复所有窗口原貌"
                  onClick={() => void run('恢复所有窗口', async () => {
                    const res = await window.antiFace!.restoreAllTargets();
                    if (res?.recoveryReport) {
                      setNotice({
                        kind: res.recoveryReport.ok ? 'success' : 'error',
                        text: res.recoveryReport.summary
                      });
                    } else {
                      setNotice({ kind: 'success', text: '全部窗口原貌已恢复' });
                    }
                  })}
                >
                  <RefreshCw size={15} />恢复全部原貌
                </button>
              )}
              {isDesktop && (
                <button
                  className="secondary-button"
                  style={{ color: '#86efac', borderColor: '#3e5f49' }}
                  title="呼出主题快速切换浮窗"
                  onClick={() => void window.antiFace!.openQuickSwitcher()}
                >
                  <Sparkles size={15} />快速切换
                </button>
              )}
              <button className="secondary-button" disabled={!!busy || !loaded} onClick={importTheme}>
                <Upload size={15} />导入
              </button>
              <button
                className="secondary-button"
                disabled={!!busy || !loaded}
                onClick={() =>
                  run('导出配置', async () => {
                    if (isDesktop) {
                      const file = await window.antiFace!.exportSettings(settings);
                      if (file) setNotice({ kind: 'success', text: '主题配置已导出' });
                    } else downloadSettings(settings);
                  })
                }
              >
                <Download size={15} />导出
              </button>
            </div>
          </div>

          {round4?.round6?.safeStatus?.needsStartupChoice && (
            <div className="notice" role="dialog" aria-label="异常启动选择">
              <span>上次未正常退出；当前已阻止自动换肤和任务提醒。请选择启动方式。</span>
              <button onClick={async()=>{await window.antiFace!.enterSafeMode('STARTUP_CHOICE');setRound4(await window.antiFace!.studioState());}}>保持安全模式</button>
              <button onClick={async()=>{await window.antiFace!.exitSafeMode();setRound4(await window.antiFace!.studioState());}}>正常继续</button>
            </div>
          )}
          {closeChoice && (
            <div className="notice" role="dialog" aria-label="试穿未保存">
              <span>实时试穿还没保存。保存会保留当前效果并隐藏窗口，取消会恢复进入试穿前的样子。</span>
              <button type="button" onClick={() => void finishClose('save')}>保存并隐藏</button>
              <button type="button" onClick={() => void finishClose('cancel')}>取消试穿并隐藏</button>
              <button type="button" onClick={() => void finishClose('continue')}>继续编辑</button>
            </div>
          )}
          {draftConflict && (
            <div className="notice" role="dialog" aria-label="主题切换冲突">
              <span>后台已应用新主题「{draftConflict.backgroundDoc.name}」。当前有未保存的草稿，是否载入新主题？</span>
              <button
                type="button"
                onClick={() => {
                  updateDocument(draftConflict.backgroundDoc, 'replace');
                  setDraftConflict(null);
                }}
              >
                载入新主题
              </button>
              <button type="button" onClick={() => setDraftConflict(null)}>
                保留当前草稿
              </button>
            </div>
          )}
          {notice && (
            <div className={'notice ' + notice.kind} role={notice.kind === 'error' ? 'alert' : 'status'}>
              <span>{notice.text}</span>
              {historyRetryId && (
                <button
                  type="button"
                  onClick={() => void window.antiFace?.retryRevision(historyRetryId).then(result => {
                    if (result?.ok) {
                      setHistoryRetryId(null);
                      setNotice({ kind: 'success', text: '版本历史已经补写完成。' });
                    } else {
                      setNotice({ kind: 'error', text: result?.message || '版本历史仍然没有写完。' });
                    }
                  }).catch(error => {
                    setNotice({ kind: 'error', text: error instanceof Error ? error.message : '版本历史仍然没有写完。' });
                  })}
                >
                  重试写入历史
                </button>
              )}
              <button onClick={() => setNotice(null)} aria-label="关闭提示">×</button>
            </div>
          )}

          {page === 'studio' && (
            <>
              <div className="studio-grid">
                <section className="preview-section" ref={previewContainerRef}>
                  <div className="section-heading">
                    <h2>实时预览 <span>LIVE PREVIEW</span></h2>
                    <div className="preview-theme-name">
                      <span style={{ background: theme.accent }} />
                      {theme.name}
                    </div>
                  </div>
                  <Preview
                    theme={theme}
                    appearance={settings.appearance}
                    document={round4?.document || null}
                    effectiveVisual={effectiveVisual}
                    scene={previewScene}
                    onSceneChange={setPreviewScene}
                    adjustments={effectiveAdjustments}
                  />
                  <div className="preview-description">
                    <span><Monitor size={14} />Antigravity Desktop</span>
                    <span>预览调整不会自动应用到客户端。当前是编辑预览估算，不是已连接窗口的实测尺寸。</span>
                  </div>
                </section>

                <AppearancePanel
                  value={settings.appearance}
                  preset={settings.preset}
                  region={region}
                  onRegion={setRegion}
                  document={round4?.document || null}
                  onDocument={updateDocument}
                  onGesture={phase => {
                    const current = documentRef.current;
                    if (!current) return;
                    if (!historyRef.current) historyRef.current = new AppearanceHistory(current);
                    if (phase === 'start') historyRef.current.beginGesture('slider');
                    else {
                      historyRef.current.endGesture();
                      refreshHistory();
                    }
                  }}
                  onExtractPalette={async () => {
                    const assetId = documentRef.current?.wallpaper.assetId;
                    if (!assetId) return null;
                    return window.antiFace!.wallpaperPalette(assetId);
                  }}
                  onChange={appearance => {
                    const current = documentRef.current;
                    if (!current) {
                      setSettings(value => ({ ...value, appearance, preset: undefined }));
                      return;
                    }
                    updateDocument({
                      ...current,
                      preset: 'custom',
                      regions: { ...current.regions, global: { ...(current.regions.global || {}), blur: appearance.blur, opacity: appearance.opacity, radius: appearance.radius } },
                      wallpaper: { ...current.wallpaper, legacyDataUrl: appearance.wallpaper }
                    });
                  }}
                  onUndo={undoEdit}
                  onRedo={redoEdit}
                  onRevertBaseline={revertBaseline}
                  onCopyParts={() => setShowCopyPartsModal(true)}
                  canUndo={historyMarks.undo}
                  canRedo={historyMarks.redo}
                  undoLabel={historyRef.current?.nextUndoLabel}
                  redoLabel={historyRef.current?.nextRedoLabel}
                  onPresetChange={handlePresetChange}
                  onWallpaper={chooseWallpaper}
                  onReset={() => {
                    const current = documentRef.current;
                    if (!current) {
                      setSettings(value => ({ ...value, appearance: { ...defaultSettings.appearance }, preset: undefined }));
                      return;
                    }
                    updateDocument({
                      ...current,
                      colors: {},
                      regions: { global: null, sidebar: null, chat: null, composer: null, card: null },
                      wallpaper: { ...current.wallpaper, legacyDataUrl: null, assetId: null, blur: 0, maskStrength: 0, brightness: 100, saturate: 100, scale: 100, focusX: 50, focusY: 50 },
                      typography: { chatFontSize: null, lineHeight: null, contentWidth: null },
                      preset: 'custom'
                    });
                  }}
                />
              </div>

              <section className="theme-library">
                <div className="library-heading">
                  <div className="section-heading">
                    <h2>精选主题 <span>{themes.length} THEMES</span></h2>
                  </div>
                  <label className="search-field">
                    <Search size={15} />
                    <input
                      aria-label="搜索主题"
                      placeholder="寻找你的风格…"
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                    />
                  </label>
                </div>

                <div className="theme-filters" role="group" aria-label="主题分类">
                  {([['all', '全部'], ['dark', '深色'], ['light', '浅色'], ['glass', '玻璃']] as const).map(
                    ([key, label]) => (
                      <button
                        key={key}
                        aria-pressed={filter === key}
                        className={filter === key ? 'active' : ''}
                        onClick={() => setFilter(key)}
                      >
                        {label}
                      </button>
                    )
                  )}
                  <span>{visibleThemes.length} 套主题</span>
                </div>

                <div className="theme-grid">
                  {visibleThemes.map(t => (
                    <ThemeCard
                      key={t.id}
                      theme={t}
                      selected={theme.id === t.id}
                      onSelect={() => selectBuiltin(t.id)}
                    />
                  ))}
                </div>
                {visibleThemes.length === 0 && (
                  <div className="empty-state">没有找到匹配的主题。试试其他关键词。</div>
                )}
              </section>
              {isDesktop && round4 && (
                <ThemeLibraryPanel
                  items={round4.library?.items || round4.favorites || []}
                  currentDraft={documentRef.current}
                  onUpdateTags={async (id, tags) => {
                    await window.antiFace!.updateThemeTags(id, tags);
                    setRound4(await window.antiFace!.studioState());
                  }}
                  onApplyDraftParts={updatedDoc => {
                    updateDocument(updatedDoc, 'push');
                    setNotice({ kind: 'success', text: '已从所选主题复制部件到当前草稿（已加入撤销栈）' });
                  }}
                  onSave={async (name, tags) => {
                    const saved = await window.antiFace!.saveLibraryTheme(round4.document, name, tags);
                    setNotice({ kind: 'success', text: `已保存个人主题 ${saved.name}` });
                    setRound4(await window.antiFace!.studioState());
                  }}
                  onWriteBack={async () => {
                    const current = documentRef.current;
                    if (!current) {
                      setNotice({ kind: 'error', text: '还没有可写回的主题' });
                      return;
                    }
                    try {
                      const updated = await window.antiFace!.updateLibraryTheme(current);
                      setNotice({ kind: 'success', text: `已写回个人主题 ${updated.name}` });
                      setRound4(await window.antiFace!.studioState());
                    } catch (error) {
                      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '没有写回个人主题' });
                    }
                  }}
                  onRename={async (id, name) => { await window.antiFace!.renameLibraryTheme(id, name); setRound4(await window.antiFace!.studioState()); }}
                  onCopy={async id => { await window.antiFace!.copyLibraryTheme(id); setRound4(await window.antiFace!.studioState()); }}
                  onFavorite={async (id, favorite) => { await window.antiFace!.favoriteLibraryTheme(id, favorite); setRound4(await window.antiFace!.studioState()); }}
                  onDelete={async (id, name) => {
                    if (!window.confirm(`删除个人主题「${name}」？这不会清空当前宿主外观。`)) return;
                    await window.antiFace!.deleteLibraryTheme(id);
                    setRound4(await window.antiFace!.studioState());
                  }}
                  onImport={async () => {
                    try {
                      const imported = await window.antiFace!.importLibrary();
                      if (imported) setNotice({ kind: 'success', text: '主题包已导入。应用偏好没有被改动。' });
                    } catch (error) {
                      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '主题包导入失败' });
                    }
                    setRound4(await window.antiFace!.studioState());
                  }}
                  onExport={async id => { const file = await window.antiFace!.exportLibrary(id); if (file) setNotice({ kind: 'success', text: '个人主题已导出' }); }}
                  onReorder={async ids => { await window.antiFace!.reorderLibrary(ids); setRound4(await window.antiFace!.studioState()); }}
                  onApply={async id => {
                    try {
                      const found = await window.antiFace!.getLibraryTheme(id);
                      if (found?.document) {
                        updateDocument(found.document);
                        setNotice({ kind: 'success', text: `已切换到个人主题「${found.name}」草稿。点击应用后才会改变客户端。` });
                      } else {
                        setNotice({ kind: 'error', text: '未找到指定主题' });
                      }
                    } catch (error) {
                      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '没有切换到个人主题' });
                    }
                  }}
                />
              )}
            </>
          )}

          {page === 'realtime' && (
            <RealtimePanel
              telemetry={telemetry}
              targets={targets}
              selectedTargetId={selectedTargetId}
              onSelectTarget={handleSelectTarget}
              onRefresh={async () => {
                if (isDesktop) {
                  const state = await window.antiFace!.getTelemetryState();
                  setTelemetry(state);
                }
              }}
              onToggleMode={async mode => {
                if (isDesktop) {
                  const state = await window.antiFace!.setTelemetryMode(mode);
                  setTelemetry(state);
                }
              }}
            />
          )}

          {page === 'history' && (
            <HistoryPanel onNotice={setNotice} />
          )}

          {page === 'round5' && (
            <Round5Page
              document={round4?.document || null}
              targetId={selectedTargetId}
              onDocument={next => updateDocument(next, 'push')}
              onError={text => setNotice({ kind: 'error', text })}
              onInstalled={() => { void window.antiFace?.studioState().then(setRound4).catch(() => {}); }}
            />
          )}

          {page === 'round6' && (
            <Round6Page
              targets={targets}
              selectedTargetId={selectedTargetId}
              onNotice={setNotice}
            />
          )}

          {page === 'connection' && (
            <section className="connection-page">
              <div className="connection-card">
                <div className="connection-card-icon"><Plug size={25} /></div>
                <h2>{isDesktop ? stateNames[status.state] : '浏览器预览模式'}</h2>
                <p>{status.message}</p>
                <button
                  className="primary-button"
                  disabled={!isDesktop || !!busy}
                  onClick={() =>
                    run('正在检测…', async () => {
                      const target = selectedRef.current;
                      const res = await desktopAdapter.inspect(target);
                      if (selectedRef.current === target) setStatus(res);
                      if (isDesktop) {
                        const list = await window.antiFace!.listTargets();
                        setTargets(list);
                      }
                    })
                  }
                >
                  <RefreshCw size={15} />重新检测
                </button>
              </div>

              {/* 多窗口与自动恢复选项 */}
              <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--line)', borderRadius: '12px', padding: '20px', marginTop: '16px' }}>
                <h3 style={{ fontSize: '15px', margin: '0 0 12px' }}>换肤恢复与多窗口管理</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                    <input
                      type="checkbox"
                      checked={autoRestore}
                      onChange={e => handleAutoRestoreToggle(e.target.checked)}
                    />
                    <span>宿主刷新后自动恢复主题 (带竞态防护，手动恢复优先)</span>
                  </label>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!isDesktop || !!busy}
                    onClick={() => run('正在恢复全部窗口…', async () => {
                      setStatus(await window.antiFace!.restoreAll());
                      setAppliedSettings('');
                      setTargets(await window.antiFace!.listTargets());
                    })}
                  >
                    恢复全部窗口
                  </button>

                  {targets.length === 0 && (
                    <p style={{ margin: 0, color: 'var(--muted)', fontSize: '13px' }}>未发现已验证的 Antigravity 窗口。</p>
                  )}

                  {targets.length > 0 && (
                    <div>
                      <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '6px' }}>已检测宿主窗口:</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {targets.map(t => (
                          <div
                            key={t.id}
                            style={{
                              padding: '8px 12px',
                              borderRadius: '8px',
                              background: t.id === selectedTargetId ? 'rgba(197, 219, 168, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                              border: t.id === selectedTargetId ? '1px solid var(--accent)' : '1px solid var(--line)',
                              fontSize: '12px',
                              cursor: 'pointer'
                            }}
                            onClick={() => handleSelectTarget(t.id)}
                          >
                            <strong>{t.title}</strong>
                            <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                              状态: {t.state === 'applied' ? '主题生效中' : t.state === 'ready' ? '可以应用' : t.state === 'suspended' ? '已暂停' : t.state === 'detected' ? '未探测' : t.state === 'detached' ? '已断开' : '未知'}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {isDesktop && round4 && (
                <>
                  <AutomationSettings
                    value={{ ...round4.automation, next: round4.automation?.next, status: round4.automation?.status, systemScheme: round4.automation?.systemScheme }}
                    themes={themes.map(theme => ({ id: theme.id, name: theme.name }))}
                    onChange={async next => {
                      await window.antiFace!.setAutomation(next);
                      setRound4(await window.antiFace!.studioState());
                    }}
                    onPause={async kind => {
                      await window.antiFace!.pauseAutomation(kind);
                      setRound4(await window.antiFace!.studioState());
                    }}
                  />
                  <NotificationSettings
                    capability={round4.notifications}
                    preferences={{ ...round4.preferences, shortcutStatus: round4.shortcuts, shortcutNotice: round4.shortcutNotice }}
                    onChange={async next => {
                      const { shortcutStatus: _ignored, ...clean } = next;
                      void _ignored;
                      try{await window.antiFace!.setPreferences(clean);setRound4(await window.antiFace!.studioState());}catch(error:any){setNotice({kind:'error',text:error.message});}
                    }}
                    onPreview={() => void window.antiFace!.previewSound('preview')}
                    onMini={() => void window.antiFace!.openMini()}
                  />
                </>
              )}

              <dl className="diagnostics" style={{ marginTop: '16px' }}>
                <div><dt>客户端版本</dt><dd>{status.host?.version || '尚未检测'}</dd></div>
                <div><dt>安装位置</dt><dd>{status.host?.path || '未找到'}</dd></div>
                <div><dt>版本验证</dt><dd>{status.host?.compatibility === 'verified' ? '已通过此版本的换肤与还原验证' : '未验证'}</dd></div>
                <div>
                  <dt>页面结构</dt>
                  <dd>
                    {status.probe
                      ? Object.entries(status.probe.selectors).map(([selector, found]) => (
                          <span className="probe-result" key={selector}>
                            {found ? '✓' : '×'} {selector}
                          </span>
                        ))
                      : '未连接'}
                  </dd>
                </div>
                <div>
                  <dt>运行会话</dt>
                  <dd>
                    {status.session
                      ? themes.find(t => t.id === status.session?.themeId)?.name +
                        ' · ' +
                        new Date(status.session.appliedAt).toLocaleTimeString()
                      : '当前没有已应用的主题'}
                  </dd>
                </div>
              </dl>

              <div className="connection-help">
                <h3>如何使用</h3>
                <ol>
                  <li>打开 Antigravity Desktop，并等待主界面加载完成。</li>
                  <li>点击重新检测；连接成功后，选择主题并应用。</li>
                  <li>点击恢复原样，或退出 Anti Face，即可还原外观。</li>
                </ol>
                <p>
                  支持多窗口目标管理，可配置刷新后自动恢复。意外断开后，临时样式通常会在 35 秒内自动清除。客户端升级后需重新验证兼容性。
                </p>
                <p>
                  <ExternalLink size={13} /> 浏览器版支持主题预览、配置保存和导入导出；连接客户端请启动桌面版。
                </p>
              </div>
            </section>
          )}
        </main>

        <footer className="action-bar">
          <div className="current-theme">
            <div className="current-swatch" style={{ background: theme.gradient }}>
              <Sparkles size={18} style={{ color: theme.accent }} />
            </div>
            <div>
              <strong>
                {theme.name}
                {dirty && <span className="draft-badge">待应用</span>}
              </strong>
              <small>{saved}</small>
            </div>
          </div>

          <div className="apply-actions">
            <button type="button" className="secondary-button" disabled={!historyMarks.undo} onClick={undoEdit}>撤销</button>
            <button type="button" className="secondary-button" disabled={!historyMarks.redo} onClick={redoEdit}>重做</button>
            <span className="footer-status">
              {busy || (canApply ? status.message : isDesktop ? '请在连接与兼容中查看状态' : '桌面版可应用到客户端')}
            </span>
            {isDesktop && (
              <button type="button" className="secondary-button" onClick={() => void run('试穿', async () => {
                if (!livePreview) {
                  const state = await window.antiFace!.beginPreview(selectedTargetId);
                  setPreviewing(true);
                  setNotice({ kind: 'success', text: state?.message || '实时试穿会暂时修改当前反重力窗口；保存以保留，取消以恢复。' });
                } else {
                  const result = await window.antiFace!.commitPreview(selectedTargetId);
                  if (result?.ok === false || result?.phase !== 'idle') {
                    setNotice({ kind: 'error', text: result?.message || '试穿未完整保存，请重试' });
                    return;
                  }
                  setPreviewing(false);
                  setNotice({ kind: 'success', text: '试穿已保存' });
                }
              })}>{livePreview ? '保存并结束试穿' : '实时试穿'}</button>
            )}
            {livePreview && (
              <>
                <button type="button" className="secondary-button" onClick={() => void run('取消试穿', async () => {
                  const state = await window.antiFace!.cancelPreview(selectedTargetId);
                  setPreviewing(false);
                  if (state?.restoredDocument) updateDocument(state.restoredDocument, 'replace');
                  setNotice({ kind: state?.phase === 'suspended' ? 'error' : 'success', text: state?.message || '已取消试穿' });
                })}>取消试穿</button>
                <button type="button" className="secondary-button" onPointerDown={() => void window.antiFace!.comparePreview(true, selectedTargetId)} onPointerUp={() => void window.antiFace!.comparePreview(false, selectedTargetId)} onPointerCancel={() => void window.antiFace!.comparePreview(false, selectedTargetId)} onBlur={() => void window.antiFace!.comparePreview(false, selectedTargetId)}>按住查看试穿前</button>
              </>
            )}
            <button
              className="secondary-button"
              disabled={!status.session || busy === '正在恢复…'}
              onClick={restore}
            >
              恢复原样
            </button>
            {isDesktop && (
              <button
                type="button"
                className="secondary-button"
                disabled={!canApply || !!busy || !loaded}
                onClick={handleInspectApplySummary}
                title="查看本次应用前后的视觉与属性变更摘要"
              >
                <Sparkles size={14} /> 变更摘要
              </button>
            )}
            <button
              className="primary-button"
              disabled={!canApply || !!busy || !loaded}
              onClick={apply}
            >
              <Check size={16} />
              {status.session ? '更新主题' : '应用到 Antigravity'}
            </button>
          </div>
        </footer>
      </div>

      <input
        hidden
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="选择壁纸文件"
        onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file)
            void run('读取壁纸', async () => {
              const wallpaper = await readImage(file);
              setSettings(s => ({ ...s, appearance: { ...s.appearance, wallpaper } }));
            });
        }}
      />
      <input
        hidden
        ref={importInput}
        type="file"
        accept=".json,application/json"
        aria-label="导入主题文件"
        onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file)
            void run('读取配置', async () => {
              if (file.size > 8 * 1024 * 1024) throw new Error('配置文件不能超过 8 MB');
              const theme = parseSettings(JSON.parse(await file.text()));
              setSettings(current => ({
                ...current,
                themeId: theme.themeId,
                appearance: theme.appearance,
                preset: theme.preset,
                autoRestoreOnReload: current.autoRestoreOnReload,
                history: current.history
              }));
            });
        }}
      />
      {showCopyPartsModal && documentRef.current && (
        <CopyThemePartsModal
          currentDocument={documentRef.current}
          availableThemes={round4?.library?.items || []}
          onApply={updatedDoc => {
            setShowCopyPartsModal(false);
            updateDocument(updatedDoc, 'push');
            setNotice({ kind: 'success', text: '已从所选主题复制部件到当前草稿（已加入撤销栈）' });
          }}
          onClose={() => setShowCopyPartsModal(false)}
        />
      )}
      {applySummary && (
        <ApplySummaryModal
          summary={applySummary}
          targetName={targets.find(t => t.id === selectedTargetId)?.title || '当前窗口'}
          isApplying={busy.includes('应用')}
          onConfirm={async () => {
            const previewId = applySummary.previewId;
            setApplySummary(null);
            await confirmSummary(previewId);
          }}
          onClose={() => setApplySummary(null)}
        />
      )}
    </div>
  );
}
