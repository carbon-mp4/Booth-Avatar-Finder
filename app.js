// ── 状態 ──────────────────────────────────────────────────────────────
let selectedAvatar  = null;
let currentPage     = 1;
let lastHasNext     = false;
let seenItemIds     = new Set();
let isSearching     = false;

let allAvatars  = [];
let avatarPage  = 1;
const AVATARS_PER_PAGE = 20;

// お気に入り（localStorage）
let favorites = new Set(JSON.parse(localStorage.getItem('booth-favorites') || '[]'));

function saveFavorites() {
  localStorage.setItem('booth-favorites', JSON.stringify([...favorites]));
}

function setSearching(busy) {
  isSearching = busy;
  const overlay = document.getElementById('avatar-loading-overlay');
  overlay.classList.toggle('visible', busy);
}

// ── 起動 ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadAvatars();

  document.getElementById('avatar-search')
    .addEventListener('input', debounce(e => loadAvatars(e.target.value), 300));

  document.getElementById('search-btn')
    .addEventListener('click', () => searchItems());

  document.getElementById('keyword-input')
    .addEventListener('keypress', e => {
      if (e.key === 'Enter') searchItems();
    });

  document.getElementById('sort-select')
    .addEventListener('change', () => searchItems());

  // 価格スライダー
  const sliderMax = document.getElementById('price-max');
  const labelMax  = document.getElementById('price-max-label');

  function updatePriceLabel() {
    labelMax.textContent = parseInt(sliderMax.value) >= 5000 ? '上限なし' : parseInt(sliderMax.value).toLocaleString() + '円';
  }
  sliderMax.addEventListener('input', () => {
    updatePriceLabel();
    renderItems(allLoadedItems, lastHasNext);
  });
  document.getElementById('filter-clear').addEventListener('click', () => {
    sliderMax.value = 5000;
    updatePriceLabel();
    renderItems(allLoadedItems, lastHasNext);
  });
});

// ── 価格パース ─────────────────────────────────────────────────────────
function parsePrice(str) {
  if (!str || str === '無料') return 0;
  return parseInt(str.replace(/[¥,\s]/g, ''), 10) || 0;
}

function applyPriceFilter(items) {
  const maxVal = parseInt(document.getElementById('price-max').value, 10);
  if (maxVal >= 5000) return items;
  return items.filter(item => parsePrice(item.price) <= maxVal);
}

// ── アバター一覧 ───────────────────────────────────────────────────────
async function loadAvatars(q = '') {
  const list = document.getElementById('avatar-list');
  list.innerHTML = '<div class="loading">読み込み中...</div>';
  try {
    const res = await fetch(`/api/avatars?q=${encodeURIComponent(q)}`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    let avatars = await res.json();
    allAvatars = [
      ...avatars.filter(a => favorites.has(a.id)),
      ...avatars.filter(a => !favorites.has(a.id)),
    ];
    avatarPage = 1;
    renderAvatars();
  } catch (e) {
    allAvatars = [];
    avatarPage = 1;
    list.innerHTML = `<div class="empty">アバター一覧の取得に失敗しました: ${esc(e.message)}</div>`;
    document.getElementById('avatar-pagination').innerHTML = '';
  }
}

function renderAvatars() {
  const list = document.getElementById('avatar-list');
  const start = (avatarPage - 1) * AVATARS_PER_PAGE;
  const page  = allAvatars.slice(start, start + AVATARS_PER_PAGE);

  if (!allAvatars.length) {
    list.innerHTML = '<div class="empty">アバターが見つかりません</div>';
    renderAvatarPagination();
    return;
  }

  list.innerHTML = page.map(a => {
    const imgSrc = a.image_url
      ? `/api/proxy-image?url=${encodeURIComponent(a.image_url)}`
      : `/api/avatar-image/${a.id}`;
    const isSelected = selectedAvatar?.id === a.id;
    const isFav = favorites.has(a.id);
    return `
      <div class="avatar-card${isSelected ? ' selected' : ''}" data-id="${a.id}">
        <div class="avatar-thumb">
          <img src="${imgSrc}" alt="" loading="lazy">
        </div>
        <div class="avatar-info">
          <div class="avatar-name">${esc(a.name)}</div>
          <div class="avatar-meta">
            <span class="avatar-liked">♡ ${a.liked.toLocaleString()}</span>
            &nbsp;·&nbsp;${esc(a.shop_name)}
          </div>
        </div>
        <button class="fav-btn${isFav ? ' active' : ''}" data-id="${a.id}" title="お気に入り">
          ${isFav ? '★' : '☆'}
        </button>
      </div>`;
  }).join('');

  list.querySelectorAll('.avatar-card').forEach((card, i) => {
    card.addEventListener('click', () => selectAvatar(page[i]));
  });
  list.querySelectorAll('.fav-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id, 10);
      if (favorites.has(id)) { favorites.delete(id); } else { favorites.add(id); }
      saveFavorites();
      loadAvatars(document.getElementById('avatar-search').value);
    });
  });

  renderAvatarPagination();
}

function renderAvatarPagination() {
  const pag = document.getElementById('avatar-pagination');
  const total = Math.ceil(allAvatars.length / AVATARS_PER_PAGE);
  pag.innerHTML = '';
  if (total <= 1) return;

  if (avatarPage > 1) {
    const btn = document.createElement('button');
    btn.textContent = '←';
    btn.onclick = () => { avatarPage--; renderAvatars(); };
    pag.appendChild(btn);
  }
  const info = document.createElement('span');
  info.className = 'page-info';
  info.textContent = `${avatarPage} / ${total}`;
  pag.appendChild(info);
  if (avatarPage < total) {
    const btn = document.createElement('button');
    btn.textContent = '→';
    btn.onclick = () => { avatarPage++; renderAvatars(); };
    pag.appendChild(btn);
  }
}

// ── アバター選択 ───────────────────────────────────────────────────────
async function selectAvatar(avatar) {
  if (isSearching) return;

  selectedAvatar = avatar;
  currentPage = 1;

  document.querySelectorAll('.avatar-card').forEach(c => {
    c.classList.toggle('selected', parseInt(c.dataset.id) === avatar.id);
  });

  document.getElementById('selected-info').innerHTML = `
    <span class="selected-name">${esc(avatar.name)}</span>
    <span class="selected-shop">${esc(avatar.shop_name)}</span>`;

  document.getElementById('keyword-input').value = '';
  renderTagChips([]);
  searchItems();
}

// ── タグチップ ─────────────────────────────────────────────────────────
function renderTagChips(tags) {
  const area = document.getElementById('tag-area');
  if (!tags.length) { area.innerHTML = ''; return; }
  area.innerHTML = tags.slice(0, 8).map(t => `
    <span class="tag-chip">${esc(t)}</span>
  `).join('');
}

// ── アイテム検索 ───────────────────────────────────────────────────────
let allLoadedItems = [];

async function searchItems(append = false) {
  const userKeyword = document.getElementById('keyword-input').value.trim();
  const avatarId = selectedAvatar?.id ? String(selectedAvatar.id) : '';
  if (!avatarId && !userKeyword) return;

  if (!append) {
    currentPage = 1;
    seenItemIds.clear();
    allLoadedItems = [];
    document.getElementById('items-grid').innerHTML = '<div class="loading">検索中...</div>';
  }
  document.getElementById('pagination').innerHTML = '';

  const statusEl = document.getElementById('search-status');
  statusEl.innerHTML = avatarId
    ? `<span class="search-status-label">検索ID</span><span class="search-status-tag">${esc(avatarId)}</span>`
    : '';

  setSearching(true);

  try {
    const sort = document.getElementById('sort-select').value;
    const params = new URLSearchParams({ page: String(currentPage) });
    if (avatarId)    params.set('avatar_id', avatarId);
    if (userKeyword) params.set('keyword', userKeyword);
    if (sort)        params.set('sort', sort);

    const res = await fetch(`/api/items?${params}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const newItems = data.items.filter(item => !seenItemIds.has(item.id));
    newItems.forEach(item => seenItemIds.add(item.id));
    allLoadedItems = allLoadedItems.concat(newItems);
    lastHasNext = data.has_next;
    renderItems(allLoadedItems, data.has_next);
  } catch (e) {
    document.getElementById('items-grid').innerHTML =
      `<div class="empty">エラーが発生しました: ${esc(e.message)}</div>`;
  } finally {
    setSearching(false);
  }
}

function renderItems(items, hasNext) {
  const grid = document.getElementById('items-grid');
  const filtered = applyPriceFilter(items);

  if (!filtered.length) {
    grid.innerHTML = items.length
      ? '<div class="empty">価格フィルターに該当するアイテムがありません</div>'
      : '<div class="empty">アイテムが見つかりませんでした</div>';
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  grid.innerHTML = filtered.map(item => {
    const imgSrc = item.image_url
      ? `/api/proxy-image?url=${encodeURIComponent(item.image_url)}`
      : '';
    return `
      <a href="${item.url}" target="_blank" rel="noopener" class="item-card">
        <div class="item-thumb">
          ${imgSrc
            ? `<img src="${imgSrc}" alt="" loading="lazy">`
            : '<div class="no-image">No Image</div>'}
        </div>
        <div class="item-name">${esc(item.name)}</div>
        <div class="item-info">
          <div class="item-price">${esc(item.price)}</div>
          <div class="item-shop">${esc(item.shop_name)}</div>
        </div>
      </a>`;
  }).join('');

  // もっと読み込むボタン
  const pag = document.getElementById('pagination');
  pag.innerHTML = '';
  if (hasNext) {
    const btn = document.createElement('button');
    btn.textContent = 'もっと読み込む';
    btn.onclick = () => { currentPage++; searchItems(true); };
    pag.appendChild(btn);
  }
}

// ── ユーティリティ ────────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
