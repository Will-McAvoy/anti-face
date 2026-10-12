export interface Theme {
  id: string;
  name: string;
  description: string;
  mode: 'dark' | 'light';
  accent: string;
  background: string;
  panel: string;
  foreground: string;
  muted: string;
  gradient: string;
  glass: boolean;
}

export interface Appearance {
  blur: number;
  opacity: number;
  radius: number;
  wallpaper: string | null;
}

export type PerformancePreset = 'performance' | 'balanced' | 'visual';

export interface Settings {
  schemaVersion: 1;
  themeId: string;
  appearance: Appearance;
  preset?: PerformancePreset;
  /** 应用偏好：宿主刷新后是否自动恢复主题。不随主题配置导入导出。 */
  autoRestoreOnReload?: boolean;
  /** 应用偏好：本地历史开关和手动清理阈值。不随主题配置导入导出。 */
  history?: { enabled: boolean; retentionDays: 7 | 30 | 90 };
}

export interface HostInfo {
  installed: boolean;
  path: string | null;
  version: string | null;
  fingerprint: string | null;
  compatibility: 'untested' | 'verified' | 'not-installed';
}

export interface AppliedSession {
  id: string;
  hostFingerprint: string;
  themeId: string;
  styleId: string;
  appliedAt: string;
}

export interface CapabilityProbe {
  title: string;
  selectors: Record<string, boolean>;
  variables: Record<string, boolean>;
  supportsBackdropFilter: boolean;
  sessionId: string | null;
}

export interface ConnectionStatus {
  state: 'detached' | 'probing' | 'ready' | 'applied' | 'suspended' | 'unsupported' | 'error';
  message: string;
  host: HostInfo | null;
  probe: CapabilityProbe | null;
  session: AppliedSession | null;
}

export interface TargetWindow {
  id: string;
  title: string;
  url: string;
  state: string;
  isCurrent: boolean;
}

export type TaskPhase =
  | 'idle'
  | 'queued'
  | 'running'
  | 'generating'
  | 'tool_running'
  | 'waiting_user'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unknown';

export interface TaskState {
  phase: TaskPhase;
  taskId: string | null;
  conversationId: string | null;
  activeToolsCount: number;
  isStale: boolean;
  observedSeconds: number | null;
  durationKind?: 'observed' | 'frozen' | 'unavailable';
  unavailableReason?: string | null;
  lastUpdateIso: string | null;
}

export interface TelemetryMetrics {
  latencyMs: number | null;
  rollingSpeed: number | null;
  rollingSpeedStatus: 'valid' | 'warming_up' | 'stale' | 'unavailable';
  averageSpeedToks: number | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  totalInput: number | null;
  cacheRate: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalOutput: number | null;
  visibleOutput: number | null;
  totalTokens: number | null;
  model: string | null;
  project: string;
  targetId: string | null;
  targetTitle: string | null;
  connectionStatus: string;
  provenance: 'real' | 'fixture';
  isStale: boolean;
  lastUpdated: string | null;
  unavailableReason?: string | null;
}

export interface TelemetryCapabilities {
  streamingSpeed: boolean;
  streamingExplanation: string;
  finalTokens: boolean;
  cacheRate: boolean;
  provenance: string;
  unavailableReason?: string | null;
}

export interface TelemetryState {
  taskState: TaskState;
  metrics: TelemetryMetrics;
  capabilities: TelemetryCapabilities;
}

export interface HistoryRecord {
  schemaVersion: number;
  id: string;
  requestId: string | null;
  taskId: string | null;
  occurredAt: string | null;
  observedAt?: string | null;
  model: string;
  project: string;
  status: string;
  durationSeconds: number | null;
  latencyMs: number | null;
  averageSpeedToks: number | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  attempts: number | null;
  isComplete: boolean;
  provenance: string;
  hostVersion: string | null;
}

export interface HistorySummary {
  totalRecords: number;
  knownTotalInput: number;
  knownTotalOutput: number;
  knownTotalCached: number;
  missingOutputCount: number;
  hasMissingData: boolean;
  averageOutputSpeed: number | null;
  averageOutputTokens: number | null;
  retryCount: number | null;
  missingAttemptsCount: number;
}

export interface HistoryQueryResult {
  records: HistoryRecord[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  availableModels: string[];
  availableProjects: string[];
  corruptCount: number;
  summary: HistorySummary;
}

export type RegionId = 'global' | 'sidebar' | 'chat' | 'composer' | 'card';
export interface RegionOverride {
  opacity?: number;
  blur?: number;
  radius?: number;
  borderWidth?: number;
  borderStrength?: number;
  shadow?: 'none' | 'soft' | 'medium';
}
export interface NormalizedRect { x: number; y: number; width: number; height: number }
export interface ThemeDocument {
  schemaVersion: 1 | 2;
  id: string;
  name: string;
  baseThemeId: string;
  colors: Partial<Record<'accent' | 'background' | 'panel' | 'foreground' | 'muted' | 'border' | 'selection', string>>;
  regions: Record<RegionId, RegionOverride | null>;
  wallpaper: {
    assetId: string | null;
    legacyDataUrl: string | null;
    fit: 'cover' | 'contain';
    focusX: number;
    focusY: number;
    scale: number;
    blur: number;
    brightness: number;
    saturate: number;
    maskColor: string;
    maskStrength: number;
    composition?: {
      subjectRect: NormalizedRect | null;
      textSafeRect: NormalizedRect | null;
      policy: 'manual' | 'protect-subject' | 'protect-text' | 'balanced';
    };
  };
  readability?: { mode: 'off' | 'suggest' | 'auto'; targetContrast: number; locks: string[] };
  sceneAppearance?: {
    mode: 'off' | 'auto' | 'home' | 'chat';
    home: { maskStrength: number | null; opacity: number | null };
    chat: { maskStrength: number | null; opacity: number | null };
  };
  typography: { chatFontSize: number | null; lineHeight: number | null; contentWidth: number | null };
  preset: PerformancePreset | 'custom';
}

export interface AntiFaceAPI {
  inspectHost(): Promise<HostInfo>;
  chooseWallpaper(): Promise<string | null>;
  loadSettings(): Promise<{ settings: Settings; warning: string | null }>;
  saveSettings(value: Settings): Promise<Settings>;
  importSettings(): Promise<Settings | null>;
  exportSettings(value: Settings): Promise<string | null>;
  inspect(targetId?: string | null): Promise<ConnectionStatus>;
  status(targetId?: string | null): Promise<ConnectionStatus>;
  apply(value: Settings, targetId?: string | null): Promise<ConnectionStatus>;
  restore(targetId?: string | null): Promise<ConnectionStatus>;
  restoreAll(): Promise<ConnectionStatus>;

  // F5 多窗口与自动恢复
  listTargets(): Promise<TargetWindow[]>;
  setAutoRestore(enabled: boolean): Promise<void>;

  // F1, F2, F3 实时遥测
  getTelemetryState(): Promise<TelemetryState>;
  setTelemetryMode(mode: 'host' | 'fixture'): Promise<TelemetryState>;
  setTelemetryTarget(targetId: string | null): Promise<TelemetryState>;

  // F4 历史
  getHistorySettings(): Promise<{ enabled: boolean; retentionDays: number }>;
  setHistorySettings(value: { enabled?: boolean; retentionDays?: number }): Promise<{ enabled: boolean; retentionDays: number }>;
  queryHistory(filter?: {
    dateRange?: 'all' | 'today' | '7d' | '30d';
    model?: string;
    project?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  }): Promise<HistoryQueryResult>;
  exportHistory(options: { format: 'csv' | 'json'; filter?: any }): Promise<string | null>;
  cleanupHistory(scope: 'all' | 'older_than_retention' | { startDate: string; endDate: string }): Promise<{ deletedCount: number; remainingCount: number }>;
  version(): Promise<string>;
  studioState(): Promise<any>;
  updateEditorSession(value: any): Promise<any>;
  beginPreview(targetId?: string | null): Promise<any>;
  updatePreview(document: ThemeDocument, targetId?: string | null): Promise<any>;
  commitPreview(targetId?: string | null): Promise<any>;
  cancelPreview(targetId?: string | null): Promise<any>;
  comparePreview(holding: boolean, targetId?: string | null): Promise<any>;
  listLibrary(query?: {
    search?: string;
    query?: string;
    tags?: string[];
    tagMode?: 'AND' | 'OR';
    colorScheme?: 'dark' | 'light' | null;
    hasWallpaper?: boolean | null;
    favoritesOnly?: boolean;
    untaggedOnly?: boolean;
    page?: number;
    pageSize?: number;
  }): Promise<any>;
  getLibraryTheme(id: string): Promise<any>;
  saveLibraryTheme(document: ThemeDocument, name?: string, tags?: string[]): Promise<any>;
  updateLibraryTheme(document: ThemeDocument): Promise<any>;
  renameLibraryTheme(id: string, name: string): Promise<any>;
  copyLibraryTheme(id: string): Promise<any>;
  favoriteLibraryTheme(id: string, favorite: boolean): Promise<any>;
  reorderLibrary(ids: string[]): Promise<any>;
  deleteLibraryTheme(id: string): Promise<any>;
  importLibrary(): Promise<any>;
  exportLibrary(id: string): Promise<string | null>;
  saveDocument(document: ThemeDocument): Promise<any>;
  wallpaperPalette(assetId: string): Promise<{ colors: { hex: string }[]; hint?: { note: string } | null }>;
  recentWallpaper(): Promise<{ assetId: string; dataUrl: string } | null>;
  applyDocument(document: ThemeDocument, targetId?: string | null): Promise<ConnectionStatus>;
  getAutomation(): Promise<any>;
  setAutomation(value: any): Promise<any>;
  pauseAutomation(kind: string): Promise<any>;
  getPreferences(): Promise<any>;
  setPreferences(value: any): Promise<any>;
  shortcutStatus(): Promise<any>;
  openMini(): Promise<any>;
  closeMini(): Promise<any>;
  notificationCapability(): Promise<any>;
  previewSound(name?: string): Promise<any>;
  onStudioChanged(callback: (snapshot: any) => void): () => void;
  onSystemScheme(callback: (scheme: 'light' | 'dark') => void): () => void;
  onPreviewCloseRequested(callback: () => void): () => void;
  resolvePreviewClose(choice: 'save' | 'cancel' | 'continue'): Promise<any>;
  analyzeReadability(document: ThemeDocument, targetId?: string | null, viewport?: { width: number; height: number }, previewScene?: string, contextKind?: string): Promise<any>;
  adoptReadability(document: ThemeDocument, fields?: string[], targetId?: string | null, suggestionId?: string | null): Promise<ThemeDocument>;
  inspectDiagnostics(targetId?: string | null): Promise<any>;
  exportDiagnostics(targetId?: string | null): Promise<any>;
  watchScene(targetId?: string | null): Promise<any>;
  unwatchScene(targetId?: string | null): Promise<any>;
  pollScene(targetId?: string | null): Promise<{ scene: string }>;
  explainScene(document: ThemeDocument, targetId?: string | null, scene?: string): Promise<any>;
  takeCapture(value: { targetId?: string | null; phase?: 'before' | 'after'; groupId?: string; clip?: { x: number; y: number; width: number; height: number } | null; region?: 'full' | 'chat' | 'composer' | 'sidebar' | 'card' | null; hideSensitive?: boolean; viewport?: { width: number; height: number } }): Promise<any>;
  listCaptures(targetId?: string | null): Promise<any>;
  captureImage(groupId: string, phase: 'before' | 'after'): Promise<any>;
  clearCaptures(targetId?: string | null): Promise<any>;
  invalidateCaptures(targetId?: string | null): Promise<any>;
  exportCapture(groupId: string, phase: 'before' | 'after'): Promise<string | null>;
  generateThemes(assetId: string, locks?: Record<string, string>, requestId?: string): Promise<any>;
  cancelGenerate(requestId: string): Promise<any>;
  adoptColors(document: ThemeDocument, colors: Record<string, string>): Promise<ThemeDocument>;
  identifyProject(targetId?: string | null): Promise<any>;
  identifyWorkspace(workspaceId: string, targetId?: string | null): Promise<any>;
  listBindings(targetId?: string | null): Promise<any>;
  saveBinding(value: { projectKey: string; themeId: string; targetId?: string | null }): Promise<any>;
  removeBinding(projectKey: string): Promise<any>;
  bindSession(themeId: string, targetId?: string | null, label?: string): Promise<any>;
  resumeAutomationTarget(targetId?: string | null): Promise<any>;
  listRevisions(themeId: string): Promise<any>;
  diffRevisions(leftId: string, rightId: string): Promise<any>;
  restoreRevision(revisionId: string, selection: any, confirm: boolean): Promise<any>;
  retryRevision(operationId: string): Promise<any>;
  pinRevision(themeId: string, revisionId: string, pinned: boolean): Promise<any>;
  listRecoveryCandidates(themeId: string): Promise<any>;
  adoptRecoveryCandidate(revisionId: string): Promise<any>;
  catalogPage(query?: { search?: string; tag?: string; mode?: string; page?: number; pageSize?: number }): Promise<any>;
  catalogGet(itemId: string): Promise<any>;
  catalogPreview(itemId: string): Promise<any>;
  catalogInstall(itemId: string, mode?: string): Promise<any>;

  // Round 6: 七项功能 API
  restoreAllTargets(): Promise<any>;
  safeModeStatus(): Promise<{ safeMode: boolean; reason?: string | null; failureCount?: number }>;
  enterSafeMode(reason?: string): Promise<any>;
  exitSafeMode(): Promise<any>;

  openQuickSwitcher(): Promise<any>;
  toggleQuickSwitcher(): Promise<any>;

  getDisplayContext(targetId?: string | null): Promise<any>;
  getDisplays?(): Promise<any[]>;

  exportBackup(filePath?: string | null, options?: any): Promise<any>;
  inspectBackup(filePath?: string | null): Promise<any>;
  cancelBackupInspection(inspectionId: string): Promise<any>;
  previewRestore(inspection: any): Promise<any>;
  commitRestore(filePath: string, options?: any): Promise<any>;

  getPerformanceSummary(targetId?: string | null): Promise<any>;
  setPerformancePrefs(prefs: any): Promise<any>;

  testNotification(prefs: any): Promise<any>;

  // Round 7: 五项功能 API
  updateThemeTags(id: string, tags: string[]): Promise<any>;
  copyThemeParts(targetDoc: ThemeDocument, sourceDoc: ThemeDocument, selectedGroups: string[], options?: any): Promise<{ changed: boolean; document: ThemeDocument; modifiedGroups: string[] }>;
  
  rotationChooseFolder(): Promise<any>;
  getRotationStatus(targetId?: string | null): Promise<any>;
  setRotationConfig(config: any, targetId?: string | null): Promise<any>;
  rotationNext(targetId?: string | null): Promise<any>;
  rotationPause(targetId?: string | null): Promise<any>;
  rotationResume(targetId?: string | null): Promise<any>;
  rotationSaveToTheme(targetId?: string | null): Promise<any>;

  previewApply(document: ThemeDocument, targetId?: string | null): Promise<any>;
  confirmApply(previewId: string, options?: any): Promise<any>;

  getAutoBackupStatus(): Promise<any>;
  setAutoBackupConfig(config: any): Promise<any>;
  runAutoBackupNow(): Promise<any>;
  chooseAutoBackupFolder(): Promise<any>;
  openAutoBackupFolder(): Promise<any>;
}

export interface ThemeLibraryEntry {
  id: string;
  name: string;
  favorite: boolean;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  document: ThemeDocument;
  thumbnailAssetId: string | null;
  sourceItemId?: string;
  sourceVersion?: number;
  sourceHash?: string;
  dirty?: boolean;
}

declare global {
  interface Window {
    antiFace?: AntiFaceAPI;
  }
}
