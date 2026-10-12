const path = require('node:path');
const { pathToFileURL } = require('node:url');
const themes = require('../shared/themes.json');

class QuickSwitcherController {
  constructor(deps) {
    this.BrowserWindow = deps.BrowserWindow;
    this.studio = deps.studioService;
    this.displayService = deps.displayService || null;
    this.window = null;
    this.recentThemes = [];
    this.maxRecent = 10;
  }

  isOpen() {
    return !!this.window && !this.window.isDestroyed();
  }

  show() {
    if (this.isOpen()) {
      this.window.show();
      this.window.focus();
      return;
    }

    const primary = this.displayService ? this.displayService.getPrimaryDisplay().workArea : { x: 0, y: 0, width: 1920, height: 1080 };
    const width = 480;
    const height = 560;
    const x = Math.round(primary.x + (primary.width - width) / 2);
    const y = Math.round(primary.y + (primary.height - height) / 3);

    const bounds = this.displayService
      ? this.displayService.clampBounds({ x, y, width, height })
      : { x, y, width, height };

    this.window = new this.BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      transparent: false,
      backgroundColor: '#181d1a',
      alwaysOnTop: true,
      resizable: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'switcher-preload.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });

    const switcherUrl = pathToFileURL(path.join(__dirname, 'switcher.html')).href;
    void this.window.loadURL(switcherUrl);

    this.window.once('ready-to-show', () => {
      if (this.window && !this.window.isDestroyed()) {
        this.window.show();
        this.window.focus();
      }
    });

    this.window.on('blur', () => {
      // 失去焦点时自动隐藏
      if (this.window && !this.window.isDestroyed()) {
        this.window.hide();
      }
    });

    this.window.on('closed', () => {
      this.window = null;
    });
  }

  hide() {
    if (this.isOpen()) {
      this.window.hide();
    }
  }

  close() {
    if (this.isOpen()) {
      this.window.close();
      this.window = null;
    }
  }

  toggle() {
    if (this.isOpen() && this.window.isVisible()) {
      this.hide();
    } else {
      this.show();
    }
  }

  async initData() {
    const targets = await this.studio.theme.listTargets().catch(() => []);
    const selectedTargetId = this.studio.selectedTargetId || (targets[0]?.id || null);

    // 整合全部主题：自定义主题 + 内置主题
    const custom = (this.studio.library?.data?.themes || []).map(t => ({
      id: t.id,
      name: t.name,
      preset: t.preset || '个人定制',
      favorite: !!t.favorite,
      tags: t.tags || [],
      document: t.document
    }));

    const builtIn = themes.map(t => ({
      id: t.id,
      name: t.name,
      preset: t.name,
      favorite: false,
      tags: this.studio.library?.data?.builtinMetadata?.[t.id]?.tags || [],
      accent: t.colors?.accent || '#4ade80'
    }));

    // 去重
    const customIds = new Set(custom.map(c => c.id));
    const allThemes = [...custom, ...builtIn.filter(b => !customIds.has(b.id))];

    const favorites = allThemes.filter(t => t.favorite);

    return {
      targets: targets.map(t => ({ id: t.id, title: t.title || t.id, isCurrent: t.isCurrent })),
      selectedTargetId,
      themes: allThemes,
      favorites,
      recentThemes: this.recentThemes,
      safeMode: this.studio.safeMode === true
    };
  }

  async selectTarget(targetId) {
    if(this.pendingConflict && this.pendingConflict.targetId!==targetId) this.conflictInvalidated=true;
    if (targetId) {
      this.studio.selectTarget(targetId);
    }
    return { ok: true, selectedTargetId: targetId };
  }

  async applyTheme(themeId, targetId) {
    if(this.studio.safeMode || this.studio.migrationActive) return {ok:false,code:'SAFE_MODE',applied:false,message:'安全模式或恢复期间不能切换主题'};
    const id = targetId || this.studio.selectedTargetId;
    if (!id) return { ok: false, message: '未选择目标窗口' };

    // 检查试穿草稿冲突
    const previewState = this.studio.preview.state(id);
    const dirty=this.studio.editorSession?.dirty && this.studio.editorSession?.targetId===id;
    if ((previewState && previewState.phase !== 'idle') || dirty) {
      const targetState=this.studio.round5?.getTargetState(id,false);
      this.conflictInvalidated=false;
      this.pendingConflict={targetId:id,themeId,instanceId:targetState?.instanceId,dirty};
      return { ok: false, conflict: true, targetId:id, themeId, message: '存在未保存的编辑草稿' };
    }

    const result = await this.studio.applyLibraryTheme(themeId, 'switcher', id);
    if (result && result.ok) {
      // 成功应用后才记录最近使用
      this.recentThemes = [themeId, ...this.recentThemes.filter(t => t !== themeId)].slice(0, this.maxRecent);
    }
    return result;
  }

  async resolveConflict(choice, targetId) {
    if(this.conflictInvalidated) return {ok:false,code:'STALE',resolved:'cancelled',message:'目标已切换，请重新请求应用'};
    const conflict=this.pendingConflict;
    const id=conflict?.targetId || targetId || this.studio.selectedTargetId;
    if(conflict && ((targetId && targetId!==id) || this.studio.round5?.getTargetState(id,false)?.instanceId!==conflict.instanceId)) return {ok:false,code:'STALE',resolved:'cancelled'};
    if(choice!=='save' && choice!=='discard') return {ok:false,resolved:'cancelled'};
    try {
      let result;
      if(choice==='save' && conflict?.historyRetry){
        result=await this.studio.round5.retryRemember(conflict.historyRetry);
        if(result?.ok===false)return {...result,resolved:'failed'};
      } else if(conflict?.dirty && this.studio.preview.state(id).phase==='idle') {
        if(choice==='save') {
          const document=this.studio.editorSession.document;
          await this.studio.saveDocument(document);
          result=await this.studio.round5?.remember(document,{source:'save',themeId:document.id,documentSaved:true,applied:false});
          if(result?.ok===false) {if(result.operationId)conflict.historyRetry=result.operationId;return {...result,resolved:'failed'};}
        }
        this.studio.editorSession.dirty=false;
        this.studio.editorResolved={targetId:id,choice};
        this.studio.onStudioChanged?.();result={ok:true,phase:'idle'};
      } else result=await (choice==='save'?this.studio.commitPreview(id):this.studio.cancelPreview(id));
      if(result?.ok===false && result.operationId && conflict) conflict.historyRetry=result.operationId;
      if(result?.ok===false || (result?.phase && result.phase!=='idle')) return {ok:false,resolved:'failed',code:result?.code||'SAVE_FAILED',message:result?.message||'试穿未结束',result};
      this.studio.editorResolved={targetId:id,choice};
      this.studio.onStudioChanged?.();
      this.pendingConflict=null;
      return {ok:true,resolved:choice==='save'?'saved':'discarded',targetId:id,themeId:conflict?.themeId};
    } catch(error) {return {ok:false,resolved:'failed',code:error.code||'SAVE_FAILED',message:error.message};}
  }

}

module.exports = { QuickSwitcherController };
