import { useEffect, useState } from 'react';

export function ThemeCatalogPanel({ onError, onInstalled }: { onError: (text: string) => void; onInstalled: () => void }) {
  const [page, setPage] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function load(nextPage = 1) {
    if (!window.antiFace) return;
    try { setPage(await window.antiFace.catalogPage({ search, tag, page: nextPage, pageSize: 8 })); }
    catch (error) { onError(error instanceof Error ? error.message : '精选目录读不出来'); }
  }

  useEffect(() => { void load().catch(() => {}); }, []);

  async function open(itemId: string) {
    const item = await window.antiFace!.catalogGet(itemId);
    setDetail(item);
    const image = await window.antiFace!.catalogPreview(itemId);
    setPreview(image?.dataUrl || null);
  }

  async function install(mode: string) {
    if (!detail) return;
    try {
      const result = await window.antiFace!.catalogInstall(detail.itemId, mode);
      if (result?.needsConfirm) return onError(result.message);
      onInstalled();
      setDetail(await window.antiFace!.catalogGet(detail.itemId));
    } catch (error) {
      onError(error instanceof Error ? error.message : '没有加入个人库');
    }
  }

  return (
    <section className="round5-panel">
      <h2>内置精选</h2>
      <p>这些主题随应用离线可用。远程源未配置，没有线上社区。</p>
      <div className="round5-row">
        <input value={search} onChange={event => setSearch(event.target.value)} aria-label="搜索精选" placeholder="搜索" />
        <select value={tag} onChange={event => setTag(event.target.value)} aria-label="筛选风格">
          <option value="">全部</option>
          <option value="dark">深色</option>
          <option value="light">浅色</option>
          <option value="glass">玻璃</option>
          <option value="reading">阅读</option>
          <option value="low-distraction">低干扰</option>
        </select>
        <button type="button" onClick={() => void load(1)}>筛选</button>
      </div>
      <div className="round5-grid">
        {(page?.items || []).map((item: { itemId: string; name: string; summary: string; mode: string }) => (
          <button key={item.itemId} type="button" className="round5-card" onClick={() => void open(item.itemId)}>
            <strong>{item.name}</strong>
            <span>{item.mode === 'dark' ? '深色' : '浅色'}</span>
            <p>{item.summary}</p>
          </button>
        ))}
      </div>
      <div className="round5-row">
        <button type="button" disabled={!page || page.page <= 1} onClick={() => void load(page.page - 1)}>上一页</button>
        <span>{page ? `${page.page} / ${Math.max(1, Math.ceil(page.total / page.pageSize))}` : ''}</span>
        <button type="button" disabled={!page || page.page * page.pageSize >= page.total} onClick={() => void load(page.page + 1)}>下一页</button>
      </div>
      {detail && (
        <article className="round5-card">
          <h3>{detail.name}</h3>
          <p>{detail.author} · {detail.license}</p>
          <p>{detail.summary}</p>
          {preview && <img src={preview} alt="" />}
          {detail.installed && (
            <p className="catalog-installed-status" style={{ color: '#4ade80', fontSize: '13px', margin: '6px 0', fontWeight: 'bold' }}>
              ✓ 已加入个人库
            </p>
          )}
          {detail.installed?.dirty && <p>你改过已加入的副本，更新不会静默覆盖。</p>}
          <div className="round5-row">
            <button type="button" className="primary-button" onClick={() => void install('install')}>加入个人库</button>
            <button type="button" onClick={() => void install('copy')}>另存一份</button>
            <button type="button" onClick={() => void install('replace')}>替换已加入的副本</button>
          </div>
        </article>
      )}
    </section>
  );
}
