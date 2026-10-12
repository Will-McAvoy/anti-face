import { useState, useMemo } from 'react';
import { Tag, Plus, X, Filter, Sparkles, Copy, Sun, Moon, Image, Check } from 'lucide-react';
import type { ThemeDocument } from '../types';
import {
  normalizeTag,
  normalizeTags,
  deriveColorScheme,
  matchesThemeFilters,
  getTagCounts
} from '../../core/theme-tags.cjs';
import { CopyThemePartsModal } from './CopyThemePartsModal';

function ThemeThumbnail({ document }: { document?: ThemeDocument }) {
  if (!document) return null;
  const accent = document.colors?.accent || '#d2e3bb';
  const background = document.colors?.background || '#151817';
  const wallpaper = document.wallpaper?.legacyDataUrl;
  return (
    <div
      style={{
        width: '100%',
        height: 44,
        borderRadius: 6,
        marginBottom: 8,
        background: wallpaper ? `url("${wallpaper}") center/cover no-repeat` : background,
        border: '1px solid var(--line)',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 3,
          background: accent
        }}
      />
    </div>
  );
}

export interface LibraryThemeItem {
  id: string;
  name: string;
  favorite?: boolean;
  tags?: string[];
  updatedAt?: string;
  document?: ThemeDocument;
}

export function ThemeLibraryPanel({
  items,
  currentDraft,
  onSave,
  onRename,
  onCopy,
  onFavorite,
  onDelete,
  onImport,
  onExport,
  onApply,
  onReorder,
  onWriteBack,
  onUpdateTags,
  onApplyDraftParts
}: {
  items: LibraryThemeItem[];
  currentDraft?: ThemeDocument | null;
  onSave: (name: string, tags?: string[]) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onCopy: (id: string) => Promise<void>;
  onFavorite: (id: string, favorite: boolean) => Promise<void>;
  onDelete: (id: string, name: string) => Promise<void>;
  onImport: () => Promise<void>;
  onExport: (id: string) => Promise<void>;
  onApply: (id: string) => Promise<void>;
  onReorder?: (ids: string[]) => Promise<void>;
  onWriteBack?: () => Promise<void>;
  onUpdateTags?: (id: string, tags: string[]) => Promise<void>;
  onApplyDraftParts?: (updatedDoc: ThemeDocument) => void;
}) {
  const [name, setName] = useState('');
  const [newThemeTagsInput, setNewThemeTagsInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 12;

  // F01 标签与多维筛选状态
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagMode, setTagMode] = useState<'AND' | 'OR'>('AND');
  const [colorSchemeFilter, setColorSchemeFilter] = useState<'all' | 'dark' | 'light'>('all');
  const [wallpaperFilter, setWallpaperFilter] = useState<'all' | 'has' | 'none'>('all');
  const [untaggedOnly, setUntaggedOnly] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  // 标签编辑弹窗状态: { themeId: string, tags: string[], input: string } | null
  const [tagEditorState, setTagEditorState] = useState<{ id: string; name: string; tags: string[]; inputText: string } | null>(null);

  // F04 局部复制弹窗状态
  const [copyPartsSourceDoc, setCopyPartsSourceDoc] = useState<ThemeDocument | null>(null);

  // 完整库标签统计
  const allTagCounts = useMemo(() => {
    return getTagCounts(items);
  }, [items]);

  // 组合过滤
  const visible = useMemo(() => {
    return items.filter(item => matchesThemeFilters(item, {
      query: search,
      tags: selectedTags,
      tagMode,
      colorScheme: colorSchemeFilter,
      hasWallpaper: wallpaperFilter === 'all' ? undefined : (wallpaperFilter === 'has'),
      untaggedOnly,
      favoritesOnly
    }));
  }, [items, search, selectedTags, tagMode, colorSchemeFilter, wallpaperFilter, untaggedOnly, favoritesOnly]);

  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = visible.slice((safePage - 1) * pageSize, safePage * pageSize);

  const allFavorites = items.filter(item => item.favorite);
  const allFavoriteIds = allFavorites.map(item => item.id);

  const toggleTagFilter = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
    setPage(1);
  };

  const clearAllFilters = () => {
    setSearch('');
    setSelectedTags([]);
    setColorSchemeFilter('all');
    setWallpaperFilter('all');
    setUntaggedOnly(false);
    setFavoritesOnly(false);
    setPage(1);
  };

  const handleSaveWithTags = async () => {
    const rawTags = newThemeTagsInput.split(/[,，\s]+/).filter(Boolean);
    const normalized = normalizeTags(rawTags);
    await onSave(name.trim() || '我的主题', normalized);
    setName('');
    setNewThemeTagsInput('');
  };

  // 快速添加标签
  const handleAddTagInEditor = () => {
    if (!tagEditorState || !tagEditorState.inputText.trim()) return;
    const nextTag = normalizeTag(tagEditorState.inputText);
    if (!nextTag) return;
    if (tagEditorState.tags.some(t => t.toLowerCase() === nextTag.toLowerCase())) {
      setTagEditorState({ ...tagEditorState, inputText: '' });
      return;
    }
    const nextTags = [...tagEditorState.tags, nextTag];
    setTagEditorState({
      ...tagEditorState,
      tags: nextTags,
      inputText: ''
    });
  };

  const handleRemoveTagInEditor = (tagToRemove: string) => {
    if (!tagEditorState) return;
    setTagEditorState({
      ...tagEditorState,
      tags: tagEditorState.tags.filter(t => t !== tagToRemove)
    });
  };

  const handleSaveTagsFromEditor = async () => {
    if (!tagEditorState) return;
    const finalTags = normalizeTags(tagEditorState.tags);
    if (onUpdateTags) {
      await onUpdateTags(tagEditorState.id, finalTags);
    } else if (typeof window !== 'undefined' && window.antiFace) {
      await window.antiFace.updateThemeTags(tagEditorState.id, finalTags);
    }
    setTagEditorState(null);
  };

  const activeFilterCount = (selectedTags.length > 0 ? 1 : 0) +
    (colorSchemeFilter !== 'all' ? 1 : 0) +
    (wallpaperFilter !== 'all' ? 1 : 0) +
    (untaggedOnly ? 1 : 0) +
    (favoritesOnly ? 1 : 0) +
    (search.trim() ? 1 : 0);

  return (
    <section className="theme-library">
      {/* 头部标题与搜索 */}
      <div className="library-heading">
        <div className="section-heading">
          <h2>我的主题 <span>{visible.length} / {items.length}</span></h2>
        </div>
        <label className="search-field" style={{ minWidth: 240 }}>
          <input
            aria-label="搜索我的主题"
            placeholder="搜索名称、ID 或标签..."
            value={search}
            onChange={event => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>

      {/* F01 标签与多维筛选工具栏 */}
      <div style={{
        margin: '12px 0',
        padding: '12px 14px',
        borderRadius: 8,
        background: 'var(--panel-muted, rgba(0,0,0,0.15))',
        border: '1px solid var(--line)'
      }}>
        {/* 第一行：色调、壁纸、收藏、未分类维度按钮 */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Filter size={13} /> 维度筛选:
          </span>

          {/* 深浅色调 */}
          <div style={{ display: 'flex', borderRadius: 6, border: '1px solid var(--line)', overflow: 'hidden' }}>
            <button
              type="button"
              className={colorSchemeFilter === 'all' ? 'primary-button' : 'secondary-button'}
              style={{ padding: '3px 8px', fontSize: 12, borderRadius: 0 }}
              onClick={() => { setColorSchemeFilter('all'); setPage(1); }}
            >
              全部色彩
            </button>
            <button
              type="button"
              className={colorSchemeFilter === 'dark' ? 'primary-button' : 'secondary-button'}
              style={{ padding: '3px 8px', fontSize: 12, borderRadius: 0, display: 'flex', alignItems: 'center', gap: 3 }}
              onClick={() => { setColorSchemeFilter('dark'); setPage(1); }}
            >
              <Moon size={11} /> 深色
            </button>
            <button
              type="button"
              className={colorSchemeFilter === 'light' ? 'primary-button' : 'secondary-button'}
              style={{ padding: '3px 8px', fontSize: 12, borderRadius: 0, display: 'flex', alignItems: 'center', gap: 3 }}
              onClick={() => { setColorSchemeFilter('light'); setPage(1); }}
            >
              <Sun size={11} /> 浅色
            </button>
          </div>

          {/* 壁纸 */}
          <div style={{ display: 'flex', borderRadius: 6, border: '1px solid var(--line)', overflow: 'hidden' }}>
            <button
              type="button"
              className={wallpaperFilter === 'all' ? 'primary-button' : 'secondary-button'}
              style={{ padding: '3px 8px', fontSize: 12, borderRadius: 0 }}
              onClick={() => { setWallpaperFilter('all'); setPage(1); }}
            >
              全部背景
            </button>
            <button
              type="button"
              className={wallpaperFilter === 'has' ? 'primary-button' : 'secondary-button'}
              style={{ padding: '3px 8px', fontSize: 12, borderRadius: 0, display: 'flex', alignItems: 'center', gap: 3 }}
              onClick={() => { setWallpaperFilter('has'); setPage(1); }}
            >
              <Image size={11} /> 有壁纸
            </button>
            <button
              type="button"
              className={wallpaperFilter === 'none' ? 'primary-button' : 'secondary-button'}
              style={{ padding: '3px 8px', fontSize: 12, borderRadius: 0 }}
              onClick={() => { setWallpaperFilter('none'); setPage(1); }}
            >
              纯色
            </button>
          </div>

          {/* 收藏过滤 */}
          <button
            type="button"
            className={favoritesOnly ? 'primary-button' : 'secondary-button'}
            style={{ padding: '3px 8px', fontSize: 12 }}
            onClick={() => { setFavoritesOnly(!favoritesOnly); setPage(1); }}
          >
            ★ 仅看收藏 ({allFavorites.length})
          </button>

          {/* 无标签 */}
          <button
            type="button"
            className={untaggedOnly ? 'primary-button' : 'secondary-button'}
            style={{ padding: '3px 8px', fontSize: 12 }}
            onClick={() => { setUntaggedOnly(!untaggedOnly); setPage(1); }}
          >
            无标签主题
          </button>

          {activeFilterCount > 0 && (
            <button
              type="button"
              className="text-button"
              style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}
              onClick={clearAllFilters}
            >
              清空筛选 ({activeFilterCount})
            </button>
          )}
        </div>

        {/* 第二行：库中已有标签 Chip 栏与 AND/OR 模式切换 */}
        {Object.keys(allTagCounts).length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Tag size={13} /> 标签:
            </span>

            {/* AND/OR 切换开关 */}
            {selectedTags.length > 1 && (
              <button
                type="button"
                className="secondary-button"
                style={{ padding: '2px 6px', fontSize: 11, marginRight: 4 }}
                onClick={() => setTagMode(m => m === 'AND' ? 'OR' : 'AND')}
                title="点击切换多标签筛选逻辑"
              >
                模式: <strong>{tagMode === 'AND' ? '全部满足 (AND)' : '任一满足 (OR)'}</strong>
              </button>
            )}

            {(allTagCounts as Array<{ tag: string; count: number }>).map(({ tag, count }) => {
              const active = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTagFilter(tag)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '3px 8px',
                    borderRadius: 14,
                    fontSize: 12,
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
                    background: active ? 'rgba(var(--accent-rgb, 210, 227, 187), 0.18)' : 'var(--panel)',
                    color: active ? 'var(--accent)' : 'inherit',
                    cursor: 'pointer'
                  }}
                >
                  #{tag} <span style={{ opacity: 0.65, fontSize: 10 }}>{String(count)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 新建与另存工具栏 */}
      <div className="header-actions" style={{ margin: '12px 0', gap: 8, flexWrap: 'wrap' }}>
        <input
          aria-label="新主题名称"
          value={name}
          placeholder="新主题名称"
          onChange={event => setName(event.target.value)}
          style={{ width: 140 }}
        />
        <input
          aria-label="新主题标签"
          value={newThemeTagsInput}
          placeholder="标签（以逗号或空格分隔）"
          onChange={event => setNewThemeTagsInput(event.target.value)}
          style={{ width: 180 }}
        />
        <button
          type="button"
          className="secondary-button"
          onClick={() => void handleSaveWithTags()}
        >
          另存为我的主题
        </button>
        <button type="button" className="secondary-button" onClick={() => void onWriteBack?.()}>
          写回当前主题
        </button>
        <button type="button" className="secondary-button" onClick={() => void onImport()}>
          导入主题包
        </button>
      </div>

      {visible.length === 0 && (
        <div className="empty-state">
          {items.length === 0 ? '还没有个人主题。内置主题仍在上面，编辑后可以另存。' : '没有找到符合当前筛选条件的主题。'}
        </div>
      )}

      {/* 收藏顺序调节 */}
      {onReorder && visible.some(item => item.favorite) && (
        <div className="header-actions" style={{ marginBottom: 12 }}>
          <span>收藏顺序:</span>
          {visible.filter(item => item.favorite).map(item => {
            const globalIndex = allFavoriteIds.indexOf(item.id);
            const canUp = globalIndex > 0;
            const canDown = globalIndex >= 0 && globalIndex < allFavoriteIds.length - 1;

            const handleMove = (offset: -1 | 1) => {
              if (globalIndex < 0) return;
              const targetIndex = globalIndex + offset;
              if (targetIndex < 0 || targetIndex >= allFavoriteIds.length) return;
              const next = [...allFavoriteIds];
              [next[globalIndex], next[targetIndex]] = [next[targetIndex], next[globalIndex]];
              void onReorder(next);
            };

            return (
              <span key={item.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '2px 6px', background: 'var(--panel)', borderRadius: 4, border: '1px solid var(--line)', fontSize: 12 }}>
                {item.name}
                <button type="button" className="text-button" disabled={!canUp} onClick={() => handleMove(-1)}>↑</button>
                <button type="button" className="text-button" disabled={!canDown} onClick={() => handleMove(1)}>↓</button>
              </span>
            );
          })}
        </div>
      )}

      {/* 主题卡片网格 */}
      <div className="theme-grid">
        {pageItems.map(item => {
          const itemTags = Array.isArray(item.tags) ? item.tags : [];
          return (
            <article key={item.id} className="theme-card" style={{ padding: 12, display: 'flex', flexDirection: 'column' }}>
              <ThemeThumbnail document={item.document} />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <strong style={{ fontSize: 14 }}>{item.name}</strong>
                {item.favorite && <span style={{ color: '#f59e0b', fontSize: 13 }}>★</span>}
              </div>

              <small style={{ display: 'block', color: 'var(--muted)', margin: '4px 0 8px' }}>
                {item.updatedAt ? new Date(item.updatedAt).toLocaleString() : item.id.slice(0, 8)}
              </small>

              {/* F01 标签 Chip 栏展示 */}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', margin: '4px 0 10px', minHeight: 22 }}>
                {itemTags.map(tag => (
                  <span
                    key={tag}
                    style={{
                      fontSize: 10,
                      padding: '1px 6px',
                      borderRadius: 10,
                      background: 'var(--panel-muted, rgba(255,255,255,0.08))',
                      color: 'var(--accent)',
                      border: '1px solid var(--line)'
                    }}
                  >
                    #{tag}
                  </span>
                ))}
                <button
                  type="button"
                  className="text-button"
                  style={{ fontSize: 10, padding: '1px 4px', color: 'var(--muted)' }}
                  onClick={() => setTagEditorState({ id: item.id, name: item.name, tags: [...itemTags], inputText: '' })}
                >
                  <Plus size={10} style={{ marginRight: 2 }} /> 标签
                </button>
              </div>

              {/* 操作按钮栏 */}
              <div className="header-actions" style={{ marginTop: 'auto', flexWrap: 'wrap', gap: 6 }}>
                <button type="button" className="text-button" onClick={() => void onApply(item.id)}>应用</button>
                <button type="button" className="text-button" onClick={() => void onFavorite(item.id, !item.favorite)}>
                  {item.favorite ? '取消收藏' : '收藏'}
                </button>
                <button type="button" className="text-button" onClick={() => void onCopy(item.id)}>复制</button>
                {currentDraft && item.document && onApplyDraftParts && (
                  <button
                    type="button"
                    className="text-button"
                    style={{ color: 'var(--accent)' }}
                    onClick={() => setCopyPartsSourceDoc(item.document || null)}
                    title="从该主题选择性复制部件到当前草稿"
                  >
                    部件复制
                  </button>
                )}
                <button type="button" className="text-button" onClick={() => {
                  const next = window.prompt('新的主题名称', item.name);
                  if (next) void onRename(item.id, next);
                }}>重命名</button>
                <button type="button" className="text-button" onClick={() => void onExport(item.id)}>导出</button>
                <button type="button" className="text-button" onClick={() => void onDelete(item.id, item.name)}>删除</button>
              </div>
            </article>
          );
        })}
      </div>

      {/* 分页控制 */}
      {totalPages > 1 && (
        <div className="header-actions" style={{ justifyContent: 'center', marginTop: 16 }}>
          <button
            type="button"
            className="secondary-button"
            disabled={safePage <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
          >
            上一页
          </button>
          <span style={{ fontSize: 13, alignSelf: 'center', margin: '0 8px' }}>
            第 {safePage} / {totalPages} 页 (共 {visible.length} 项)
          </span>
          <button
            type="button"
            className="secondary-button"
            disabled={safePage >= totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          >
            下一页
          </button>
        </div>
      )}

      {/* F01 标签编辑弹窗 */}
      {tagEditorState && (
        <div className="modal-backdrop" style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: 16
        }}>
          <div className="modal-dialog" style={{
            background: 'var(--panel)',
            borderRadius: 8,
            border: '1px solid var(--line)',
            width: '100%',
            maxWidth: 420,
            padding: 18,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Tag size={16} /> 编辑标签 · {tagEditorState.name}
              </h3>
              <button type="button" className="text-button" onClick={() => setTagEditorState(null)}>
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, minHeight: 36 }}>
              {tagEditorState.tags.length === 0 ? (
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>暂无标签</span>
              ) : (
                tagEditorState.tags.map(tag => (
                  <span
                    key={tag}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '2px 8px',
                      borderRadius: 12,
                      background: 'rgba(var(--accent-rgb, 210, 227, 187), 0.15)',
                      color: 'var(--accent)',
                      border: '1px solid var(--accent)',
                      fontSize: 12
                    }}
                  >
                    #{tag}
                    <button
                      type="button"
                      className="text-button"
                      style={{ padding: 0, color: 'inherit' }}
                      onClick={() => handleRemoveTagInEditor(tag)}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))
              )}
            </div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              <input
                type="text"
                placeholder="输入标签（支持中文、英文、夜间、编程等）"
                value={tagEditorState.inputText}
                onChange={e => setTagEditorState({ ...tagEditorState, inputText: e.target.value })}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTagInEditor();
                  }
                }}
                style={{ flex: 1, padding: '6px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--line)', background: 'var(--background)' }}
              />
              <button type="button" className="secondary-button" onClick={handleAddTagInEditor}>
                添加
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="secondary-button" onClick={() => setTagEditorState(null)}>
                取消
              </button>
              <button type="button" className="primary-button" onClick={() => void handleSaveTagsFromEditor()}>
                保存标签
              </button>
            </div>
          </div>
        </div>
      )}

      {/* F04 局部复制弹窗 */}
      {copyPartsSourceDoc && currentDraft && onApplyDraftParts && (
        <CopyThemePartsModal
          currentDocument={currentDraft}
          availableThemes={items}
          onApply={onApplyDraftParts}
          onClose={() => setCopyPartsSourceDoc(null)}
        />
      )}
    </section>
  );
}

export type { ThemeDocument };
