import express from 'express';
import axios from 'axios';
import path from 'path';
import { loadAvatars, toImageUrl } from './store';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

// Simple in-memory cache (5 minutes)
const cache = new Map<string, { data: unknown; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000;

function getCached(key: string): unknown | null {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expiry) { cache.delete(key); return null; }
  return entry.data;
}
function setCached(key: string, data: unknown): void {
  cache.set(key, { data, expiry: Date.now() + CACHE_TTL });
}

const BOOTH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};
const BOOTH_BROWSE_URL =
  'https://booth.pm/ja/browse/3D%E3%82%AD%E3%83%A3%E3%83%A9%E3%82%AF%E3%82%BF%E3%83%BC';

interface ScrapedItem {
  id: number;
  name: string;
  price: string;
  shop_name: string;
  url: string;
  image_url: string;
  liked: number;
}

function decodeHtml(str: string): string {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function parseItems(html: string): ScrapedItem[] {
  const items: ScrapedItem[] = [];
  const re = /data-product-id="(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const id = parseInt(m[1], 10);
    const start = m.index;
    const next = html.indexOf('data-product-id="', start + 1);
    const sec = html.slice(start, next > 0 ? next : start + 3000);
    const name  = sec.match(/data-product-name="([^"]*)"/)?.[1] ?? '';
    const price = sec.match(/data-product-price="([^"]*)"/)?.[1] ?? '';
    const brand = sec.match(/data-product-brand="([^"]*)"/)?.[1] ?? '';
    const img   = sec.match(/data-original="(https:\/\/booth\.pximg\.net[^"]*)"/)?.[1] ?? '';
    const liked = parseInt(sec.match(/data-product-wish-lists-count="(\d+)"/)?.[1] ?? '0', 10);
    items.push({
      id,
      name: decodeHtml(name),
      price: price ? `¥ ${parseInt(price, 10).toLocaleString()}` : '無料',
      shop_name: decodeHtml(brand),
      url: `https://booth.pm/ja/items/${id}`,
      image_url: img,
      liked,
    });
  }
  return items;
}

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// GET /api/avatars?q=xxx
app.get('/api/avatars', (req, res) => {
  const q = ((req.query.q as string) || '').toLowerCase().trim();
  let avatars = loadAvatars();
  if (q) {
    avatars = avatars.filter(a => {
      // タグが保存されていれば優先検索
      if (a.tags && a.tags.length > 0) {
        if (a.tags.some(t => t.toLowerCase().includes(q))) return true;
      }
      // 「」『』【】から抽出した短い名前で検索
      const bracketNames = [...a.name.matchAll(/[「『【]([^」』】]+)[」』】]/g)].map(m => m[1]);
      if (bracketNames.some(n => n.toLowerCase().includes(q))) return true;
      // スラッシュ前の最初のトークン（例: キプフェル Kipfel / ...）
      const firstToken = a.name.split(/[\s\u3000\/]/)[0].toLowerCase();
      if (firstToken.includes(q)) return true;
      // ショップ名
      if (a.shop_name.toLowerCase().includes(q)) return true;
      return false;
    });
  }
  avatars.sort((a, b) => b.liked - a.liked);
  res.json(avatars);
});

// 1フロントページ(=約150件)あたり何Boothページ分を並列取得するか
// Booth側の1ページ件数は条件で変動するため、150件に届きやすいよう広めに取得する
const PAGES_PER_BATCH = 20;
const ITEMS_PER_PAGE = 150;

async function fetchBoothPage(
  baseParams: Record<string, string>,
  boothPage: number,
): Promise<{ items: ScrapedItem[]; has_next: boolean } | null> {
  try {
    const response = await axios.get<string>(BOOTH_BROWSE_URL, {
      params: { ...baseParams, page: String(boothPage) },
      headers: BOOTH_HEADERS,
      timeout: 15000,
      responseType: 'text',
    });
    return {
      items: parseItems(response.data),
      has_next: response.data.includes('rel="next"'),
    };
  } catch {
    return null;
  }
}

// GET /api/items?avatar_id=xxx&keyword=xxx&page=1
app.get('/api/items', async (req, res) => {
  const avatar_id_raw = ((req.query.avatar_id as string) || '').trim();
  const avatar_id = /^\d+$/.test(avatar_id_raw) ? avatar_id_raw : '';
  const keyword = ((req.query.keyword as string) || '').trim();
  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10) || 1);
  const mergedQuery = [avatar_id, keyword].filter(Boolean).join(' ').trim();

  if (!mergedQuery) {
    res.json({ items: [], page: 1, has_next: false });
    return;
  }

  const cacheKey = `items:${avatar_id}:${mergedQuery}:${page}`;
  const cached = getCached(cacheKey);
  if (cached) { res.json(cached); return; }

  try {
    const baseParams: Record<string, string> = { sort: 'new_arrivals' };
    baseParams['q'] = mergedQuery;

    // フロントのpage=1 → Boothのpage 1,2,3 を並列取得
    const boothPages = Array.from(
      { length: PAGES_PER_BATCH },
      (_, i) => (page - 1) * PAGES_PER_BATCH + i + 1,
    );
    const results = await Promise.all(boothPages.map(p => fetchBoothPage(baseParams, p)));

    // 重複なしで結合
    const seenIds = new Set<number>();
    const items: ScrapedItem[] = [];
    for (const r of results) {
      if (!r) continue;
      for (const item of r.items) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          items.push(item);
        }
      }
    }

    items.sort((a, b) => b.liked - a.liked);

    const has_next = items.length > ITEMS_PER_PAGE || results.some(r => r?.has_next ?? false);
    const result   = { items: items.slice(0, ITEMS_PER_PAGE), page, has_next };
    setCached(cacheKey, result);
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/avatar-tags/:id  (IDからタグ一覧を取得)
app.get('/api/avatar-tags/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) { res.status(400).json({ tags: [] }); return; }

  const cacheKey = `avatar-tags:${id}`;
  const cached = getCached(cacheKey);
  if (cached) { res.json(cached); return; }

  try {
    const json = await axios.get<{ tags: { name: string }[] }>(
      `https://booth.pm/ja/items/${id}.json`,
      { headers: { ...BOOTH_HEADERS, Accept: 'application/json' }, timeout: 10000 }
    );
    const tags = (json.data.tags ?? []).map((t: { name: string }) => t.name);
    const result = { tags };
    setCached(cacheKey, result);
    res.json(result);
  } catch {
    res.json({ tags: [] });
  }
});

// GET /api/avatar-image/:id  (IDから画像URLを取得してリダイレクト)
app.get('/api/avatar-image/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) { res.status(400).send('Invalid ID'); return; }

  const cacheKey = `avatar-img:${id}`;
  const cached = getCached(cacheKey) as string | null;
  if (cached) { res.redirect(cached); return; }

  try {
    const json = await axios.get<{ images: { original: string }[] }>(
      `https://booth.pm/ja/items/${id}.json`,
      { headers: { ...BOOTH_HEADERS, Accept: 'application/json' }, timeout: 10000 }
    );
    const imageUrl = toImageUrl(json.data.images?.[0]?.original ?? '');
    if (!imageUrl) { res.status(404).send('No image'); return; }
    setCached(cacheKey, imageUrl);
    res.redirect(`/api/proxy-image?url=${encodeURIComponent(imageUrl)}`);
  } catch {
    res.status(500).send('Failed');
  }
});

// GET /api/proxy-image?url=xxx  (booth.pximg.net requires Referer)
app.get('/api/proxy-image', async (req, res) => {
  const url = req.query.url as string;
  if (!url || !url.startsWith('https://booth.pximg.net/')) {
    res.status(400).send('Invalid URL');
    return;
  }
  try {
    const response = await axios.get(url, {
      responseType: 'stream',
      headers: { ...BOOTH_HEADERS, Referer: 'https://booth.pm/' },
      timeout: 10000,
    });
    res.setHeader('Content-Type', (response.headers['content-type'] as string) || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    (response.data as NodeJS.ReadableStream).pipe(res);
  } catch {
    res.status(500).send('Image fetch failed');
  }
});

app.listen(PORT, () => {
  console.log(`\nBooth Avatar Finder: http://localhost:${PORT}\n`);
});
