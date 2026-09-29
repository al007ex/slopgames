// Slopgames portal: the game rows, search, and the launcher that wakes a
// sleeping game server and keeps it awake while you play.

const launcher = document.querySelector('#launcher');
const frame = document.querySelector('#game-frame');
const title = document.querySelector('#launch-title');
const text = document.querySelector('#launch-text');

let heartbeat;
let activeToken;
let lastFocus;

const names = Object.fromEntries(
  [...document.querySelectorAll('.tile')].map((tile) => [tile.dataset.slug, tile.dataset.name]),
);

/* ------------------------------------------------------------- launcher */
function closeLauncher() {
  clearInterval(heartbeat);
  activeToken = null;
  if (frame) frame.removeAttribute('src');
  if (!launcher) return;
  launcher.classList.remove('open', 'playing');
  launcher.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  lastFocus?.focus?.();
}

async function play(slug, source) {
  lastFocus = source ?? null;
  // On phones and tablets a game gets the whole screen: the embedded 16:9
  // frame would squeeze it into a strip. Each game keeps its own server awake
  // with the same heartbeat, so nothing is lost by leaving this page. The
  // "starting" card still shows either way, because waking a server can take
  // a couple of seconds and a tap with no response feels broken.
  const fullPage = window.matchMedia('(max-width: 720px), (pointer: coarse)').matches;
  const overlay = Boolean(launcher);
  const embedded = overlay && Boolean(frame) && !fullPage;
  closeLauncher();

  if (overlay) {
    launcher.classList.add('open');
    launcher.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    title.textContent = `Loading ${names[slug] || slug}…`;
    text.textContent = '';
  }
  remember(slug);

  try {
    const res = await fetch(`/api/games/${slug}/launch`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    activeToken = data.token;

    if (!embedded) return window.location.assign(data.url);

    launcher.classList.add('playing');
    frame.src = data.url;
    frame.focus();
    heartbeat = setInterval(() => {
      if (activeToken) {
        fetch(`/api/games/${slug}/heartbeat`, {
          method: 'POST',
          headers: { 'X-Game-Session': activeToken },
        }).catch(() => {});
      }
    }, 25_000);
  } catch (error) {
    const message = error.message || 'The game server is unavailable.';
    if (!overlay) return window.alert(message);
    launcher.classList.remove('playing');
    title.textContent = 'Try again in a moment';
    text.textContent = message;
  }
}

// Delegated, so tiles added later (continue playing, reordered picks) launch too.
document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-launch]');
  if (!el) return;
  event.preventDefault();
  play(el.dataset.launch, el);
});
document.querySelectorAll('.close').forEach((el) => el.addEventListener('click', closeLauncher));
document.querySelector('#full-screen')?.addEventListener('click', () => {
  (frame.requestFullscreen || frame.webkitRequestFullscreen)?.call(frame);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && launcher?.classList.contains('open')) closeLauncher();
});
window.addEventListener('beforeunload', closeLauncher);
// Coming Back from a full-page game can restore this page from the browser's
// cache exactly as it was left — with the "Starting…" card still up.
window.addEventListener('pageshow', (event) => { if (event.persisted) closeLauncher(); });

/* ------------------------------------------------ what you've played */
const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
};

function remember(slug) {
  const recent = store.get('sg_recent', []).filter((s) => s !== slug);
  recent.unshift(slug);
  store.set('sg_recent', recent.slice(0, 12));
  const plays = store.get('sg_plays', {});
  plays[slug] = (plays[slug] || 0) + 1;
  store.set('sg_plays', plays);
}

const source = Object.fromEntries([...document.querySelectorAll('#featured .tile')].map((tile) => [tile.dataset.slug, tile]));
function copyTile(slug, size) {
  const tile = source[slug]?.cloneNode(true);
  if (!tile) return null;
  tile.className = `tile ${size}`;
  tile.querySelector('img')?.setAttribute('loading', 'eager');
  return tile;
}

function renderContinue() {
  const row = document.querySelector('#continue');
  const recent = store.get('sg_recent', []).filter((slug) => source[slug]);
  if (!row || !recent.length) return;
  const strip = row.querySelector('.strip');
  strip.replaceChildren(...recent.map((slug) => copyTile(slug, 'mini')));
  row.hidden = false;
}

// Top picks lean towards what you play: games that share a category with
// your favourites come first, anything new next, the rest after.
function renderPicks(live = {}) {
  const box = document.querySelector('.picks');
  const plays = store.get('sg_plays', {});
  if (!box || (!Object.keys(plays).length && !Object.keys(live).length)) return;
  const liked = {};
  for (const [slug, n] of Object.entries(plays)) for (const tag of source[slug]?.dataset.tags.split(',') || []) liked[tag] = (liked[tag] || 0) + n;
  const order = Object.keys(source);
  const score = (slug) => {
    const tags = source[slug].dataset.tags.split(',');
    return tags.reduce((sum, tag) => sum + (liked[tag] || 0), 0) * 0.3
      + (source[slug].querySelector('.tile-badge.new') ? 2 : 0)
      + Math.min(3, live[slug] || 0)
      - order.indexOf(slug) * 0.01;
  };
  const count = box.children.length;
  const picked = [...order].sort((a, b) => score(b) - score(a)).slice(0, count);
  box.replaceChildren(...picked.map((slug, i) => copyTile(slug, i === 0 || i === count - 1 ? 'big' : 'small')));
}

renderContinue();
renderPicks();

/* ------------------------------------------------------ search + categories */
const rows = [...document.querySelectorAll('main > .row:not(#results)')];
const results = document.querySelector('#results');
const resultsTitle = document.querySelector('#results-title');
const resultTiles = [...document.querySelectorAll('#results .tile')];
const search = document.querySelector('#search');
const chips = [...document.querySelectorAll('.chip')];
const empty = document.querySelector('#no-results');
let activeTag = 'all';

function applyFilters() {
  const query = (search?.value || '').trim().toLowerCase();
  const filtering = Boolean(query) || activeTag !== 'all';
  for (const row of rows) row.hidden = filtering || (row.id === 'continue' && !row.querySelector('.tile'));
  results.hidden = !filtering;
  if (!filtering) return;
  let shown = 0;
  for (const tile of resultTiles) {
    const matchesTag = activeTag === 'all' || tile.dataset.tags.split(',').includes(activeTag);
    const matchesQuery = !query || `${tile.dataset.name} ${tile.dataset.tags}`.toLowerCase().includes(query);
    tile.hidden = !(matchesTag && matchesQuery);
    if (!tile.hidden) shown += 1;
  }
  resultsTitle.textContent = query ? `Results for “${search.value.trim()}”` : `${activeTag[0].toUpperCase()}${activeTag.slice(1)} games`;
  empty.hidden = shown > 0;
}

search?.addEventListener('input', applyFilters);
chips.forEach((chip) => {
  chip.addEventListener('click', () => {
    activeTag = chip.dataset.tag;
    chips.forEach((other) => other.setAttribute('aria-pressed', String(other === chip)));
    applyFilters();
  });
});

/* ------------------------------------------------- live player presence */
async function refreshPresence() {
  try {
    const res = await fetch('/api/games');
    if (!res.ok) return;
    const { games } = await res.json();
    const live = {};
    for (const game of games) if (game.state === 'running' && game.players > 0) live[game.slug] = game.players;
    for (const tile of document.querySelectorAll('.tile')) {
      const badge = tile.querySelector('.tile-live');
      const n = live[tile.dataset.slug] || 0;
      badge.hidden = !n;
      badge.querySelector('b').textContent = `${n} playing`;
    }
  } catch { /* Presence is decorative; a failed poll changes nothing. */ }
}

refreshPresence();
setInterval(refreshPresence, 30_000);
