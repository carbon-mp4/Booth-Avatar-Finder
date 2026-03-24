import axios from 'axios';
import {
  loadAvatars,
  saveAvatars,
  loadSeenIds,
  saveSeenIds,
  toImageUrl,
  AvatarRecord,
} from './store';

const BROWSE_BASE =
  'https://booth.pm/ja/browse/3D%E3%82%AD%E3%83%A3%E3%83%A9%E3%82%AF%E3%82%BF%E3%83%BC';
const ITEM_JSON_BASE = 'https://booth.pm/ja/items';
const ID_PATTERN = /\/items\/(\d+)/;
const MIN_LIKED = 100;
const REQUIRED_TAG = 'VRChat';
const ITEM_DELAY_MS = 1500;   // アイテムJSON取得間隔
const PAGE_DELAY_MS = 3000;   // ページ遷移間隔
const MAX_SAVE = 3000;

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

interface BoothItemJson {
  id: number;
  name: string;
  price: string;
  is_adult: boolean;
  url: string;
  wish_lists_count: number;
  shop: { name: string };
  tags: { name: string }[];
  images: { original: string; resized: string }[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractIdsFromHtml(html: string): number[] {
  const ids: number[] = [];
  const re = /data-product-id="(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    ids.push(parseInt(m[1], 10));
  }
  return ids;
}

function hasNextPage(html: string): boolean {
  return html.includes('rel="next"');
}

function now(): string {
  return new Date().toISOString();
}

async function fetchItemJson(id: number): Promise<BoothItemJson | null> {
  try {
    const res = await axios.get<BoothItemJson>(`${ITEM_JSON_BASE}/${id}.json`, {
      headers: { ...HEADERS, Accept: 'application/json' },
      timeout: 10000,
    });
    return res.data;
  } catch (err) {
    console.warn(`  Failed to fetch item ${id}: ${(err as Error).message}`);
    return null;
  }
}

export async function fetchAvatars(): Promise<void> {
  const seenIds = loadSeenIds();
  const avatars = loadAvatars();

  let page = 1;
  let totalSaved = 0;
  let totalScanned = 0;

  console.log('Starting avatar fetch (new arrivals, VRChat tag)...');
  console.log(`Existing records: ${avatars.length}, Seen IDs: ${seenIds.size}`);

  outer: while (true) {
    let html: string;
    try {
      const res = await axios.get<string>(BROWSE_BASE, {
        params: { sort: 'new_arrivals', 'tags[]': 'VRChat', page },
        headers: HEADERS,
        timeout: 15000,
        responseType: 'text',
      });
      html = res.data;
    } catch (err) {
      console.error(`Failed to fetch browse page ${page}: ${(err as Error).message}`);
      break;
    }

    const ids = extractIdsFromHtml(html);
    if (ids.length === 0) {
      console.log('No items found on page.');
      break;
    }

    console.log(`\nPage ${page}: ${ids.length} items found.`);

    for (const id of ids) {
      totalScanned++;

      // Already known → skip
      if (seenIds.has(id)) {
        continue;
      }

      // Always record ID
      seenIds.add(id);

      await sleep(ITEM_DELAY_MS);

      const item = await fetchItemJson(id);
      if (!item) continue;

      // Filter: wish_lists_count >= 100
      if (item.wish_lists_count < MIN_LIKED) {
        console.log(`  Skip [${id}] liked=${item.wish_lists_count} (< ${MIN_LIKED})`);
        continue;
      }

      // Filter: must have VRChat tag
      const hasVRChat = item.tags.some(
        (t) => t.name.toLowerCase() === REQUIRED_TAG.toLowerCase()
      );
      if (!hasVRChat) {
        console.log(`  Skip [${id}] no VRChat tag`);
        continue;
      }

      // Canonical URL
      const urlMatch = item.url.match(ID_PATTERN);
      const canonicalUrl = urlMatch
        ? `https://booth.pm/ja/items/${urlMatch[1]}`
        : item.url;

      const timestamp = now();

      // Update if already exists
      const existingIndex = avatars.findIndex((a) => a.id === item.id);
      if (existingIndex >= 0) {
        avatars[existingIndex] = {
          ...avatars[existingIndex],
          name: item.name,
          price: item.price,
          shop_name: item.shop?.name ?? '',
          liked: item.wish_lists_count,
          is_adult: item.is_adult,
          url: canonicalUrl,
          updated_at: timestamp,
        };
        console.log(`  Updated: [${id}] ${item.name} (liked: ${item.wish_lists_count})`);
      } else {
        const imageUrl = toImageUrl(item.images?.[0]?.original ?? '');
        avatars.push({
          id: item.id,
          name: item.name,
          price: item.price,
          shop_name: item.shop?.name ?? '',
          liked: item.wish_lists_count,
          is_adult: item.is_adult,
          url: canonicalUrl,
          image_url: imageUrl,
          tags: item.tags.map((t) => t.name),
          first_seen: timestamp,
          updated_at: timestamp,
        });
        totalSaved++;
        console.log(`  Saved: [${id}] ${item.name} (liked: ${item.wish_lists_count})`);
      }

      // Stop at MAX_SAVE new records
      if (totalSaved >= MAX_SAVE) {
        console.log(`\nReached ${MAX_SAVE} new records. Stopping.`);
        break outer;
      }
    }

    if (!hasNextPage(html)) {
      console.log('Reached last page.');
      break;
    }

    page++;
    await sleep(PAGE_DELAY_MS);
  }

  saveAvatars(avatars);
  saveSeenIds(seenIds);

  console.log(`\nDone. Scanned: ${totalScanned}, New saves: ${totalSaved}`);
  console.log(`Total records in avatars.json: ${avatars.length}`);
}
