// Slopgames portal: the game rows, search, and the launcher that wakes a
// sleeping game server and keeps it awake while you play. A game plays in the
// stage on its own page, or in the overlay from any list of tiles.
//
// Site extensions (ads, for instance) can set window.slopgames.beforePlay to
// an async function that runs before a game starts, and listen for the
// slopgames:play and slopgames:close events on document.

const launcher = document.querySelector('#launcher');
const overlayFrame = document.querySelector('#game-frame');
const title = document.querySelector('#launch-title');
const text = document.querySelector('#launch-text');
const stage = document.querySelector('#stage');

let heartbeat;
let active = null; // { slug, token, since }
let lastFocus;

const names = Object.fromEntries(
  [...document.querySelectorAll('[data-slug][data-name]')].map((el) => [el.dataset.slug, el.dataset.name]),
);

function announce(type, detail) {
  document.dispatchEvent(new CustomEvent(`slopgames:${type}`, { detail }));
}

async function beforePlay(slug) {
  const hook = window.slopgames?.beforePlay;
  if (typeof hook !== 'function') return;
  // A hook that never settles must not keep anyone from their game.
  await Promise.race([Promise.resolve().then(() => hook(slug)).catch(() => {}), new Promise((r) => setTimeout(r, 30_000))]);
}

/* ------------------------------------------------------------- launcher */
function stop() {
  clearInterval(heartbeat);
  if (active) announce('close', { slug: active.slug, seconds: Math.round((Date.now() - active.since) / 1000) });
  active = null;
}

function closeLauncher() {
  stop();
  if (overlayFrame) overlayFrame.removeAttribute('src');
  if (!launcher) return;
  launcher.classList.remove('open', 'playing');
  launcher.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  lastFocus?.focus?.();
}

function stageState(state, message = '') {
  stage.classList.toggle('loading', state === 'loading');
  stage.classList.toggle('playing', state === 'playing');
  stage.querySelector('.stage-status').textContent = message;
  document.querySelector('[data-fullscreen]').hidden = state !== 'playing';
}

async function play(slug, source) {
  lastFocus = source ?? null;
  // On phones and tablets a game gets the whole screen: an embedded 16:9
  // frame would squeeze it into a strip. Each game keeps its own server awake
  // with the same heartbeat, so nothing is lost by leaving this page.
  const fullPage = window.matchMedia('(max-width: 720px), (pointer: coarse)').matches;
  const inStage = Boolean(stage) && stage.dataset.slug === slug && !fullPage;
  const overlay = !inStage && Boolean(launcher);
  const frame = inStage ? stage.querySelector('.stage-frame') : overlayFrame;
  const embedded = (inStage || overlay) && Boolean(frame) && !fullPage;
  closeLauncher();

  if (inStage) stageState('loading', `Starting ${names[slug] || slug}…`);
  if (overlay) {
    launcher.classList.add('open');
    launcher.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    title.textContent = `Loading ${names[slug] || slug}…`;
    text.textContent = '';
  }
  remember(slug);

  try {
    await beforePlay(slug);
    const res = await fetch(`/api/games/${slug}/launch`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    active = { slug, token: data.token, since: Date.now() };
    announce('play', { slug });

    if (!embedded) return window.location.assign(data.url);

    if (inStage) { frame.hidden = false; stageState('playing'); } else launcher.classList.add('playing');
    frame.src = data.url;
    frame.focus();
    const { token } = active;
    heartbeat = setInterval(() => {
      fetch(`/api/games/${slug}/heartbeat`, { method: 'POST', headers: { 'X-Game-Session': token } }).catch(() => {});
    }, 25_000);
  } catch (error) {
    const message = error.message || 'The game server is unavailable.';
    if (inStage) return stageState('idle', `${message} Try again in a moment.`);
    if (!overlay) return window.alert(message);
    launcher.classList.remove('playing');
    title.textContent = 'Try again in a moment';
    text.textContent = message;
  }
}

function fullscreen(el) {
  (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
}

// Delegated, so tiles added later (continue playing, reordered picks) launch too.
document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-launch]');
  if (!el || event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
  event.preventDefault();
  play(el.dataset.launch, el);
});
document.querySelectorAll('.close').forEach((el) => el.addEventListener('click', closeLauncher));
document.querySelector('#full-screen')?.addEventListener('click', () => fullscreen(overlayFrame));
document.querySelector('[data-fullscreen]')?.addEventListener('click', () => fullscreen(stage));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && launcher?.classList.contains('open')) closeLauncher();
});
window.addEventListener('pagehide', stop);
// Coming back from a full-page game can restore this page from the browser's
// cache exactly as it was left, with the "Starting…" card still up.
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  closeLauncher();
  if (stage) stageState('idle');
});

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
const sizes = { big: '(max-width: 720px) 100vw, 34vw', small: '(max-width: 720px) 50vw, 17vw', mini: '132px' };
function copyTile(slug, size) {
  const tile = source[slug]?.cloneNode(true);
  if (!tile) return null;
  tile.className = `tile ${size}`;
  const img = tile.querySelector('img');
  img?.setAttribute('loading', 'eager');
  img?.setAttribute('sizes', sizes[size]);
  return tile;
}

function renderContinue() {
  const row = document.querySelector('#continue');
  const recent = store.get('sg_recent', []).filter((slug) => source[slug]);
  if (!row || !recent.length) return;
  row.querySelector('.strip').replaceChildren(...recent.map((slug) => copyTile(slug, 'mini')));
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

/* ---------------------------------------------------------------- search */
// On the home page the search filters in place; anywhere else it submits to
// the home page, which picks the query up from the address.
const search = document.querySelector('#search');
const results = document.querySelector('#results');
if (search && results) {
  const rows = [...document.querySelectorAll('main > .row:not(#results)')];
  const resultsTitle = document.querySelector('#results-title');
  const resultTiles = [...results.querySelectorAll('.tile')];
  const empty = document.querySelector('#no-results');
  const apply = () => {
    const query = search.value.trim().toLowerCase();
    for (const row of rows) row.hidden = Boolean(query) || (row.id === 'continue' && !row.querySelector('.tile'));
    results.hidden = !query;
    if (!query) return;
    let shown = 0;
    for (const tile of resultTiles) {
      tile.hidden = !`${tile.dataset.name} ${tile.dataset.tags}`.toLowerCase().includes(query);
      if (!tile.hidden) shown += 1;
    }
    resultsTitle.textContent = `Results for “${search.value.trim()}”`;
    empty.hidden = shown > 0;
  };
  search.value = new URLSearchParams(window.location.search).get('q') || '';
  search.form.addEventListener('submit', (event) => { event.preventDefault(); apply(); });
  search.addEventListener('input', () => {
    apply();
    const url = new URL(window.location.href);
    if (search.value.trim()) url.searchParams.set('q', search.value.trim()); else url.searchParams.delete('q');
    history.replaceState(null, '', url);
  });
  if (search.value) apply();
}

/* ------------------------------------------------- live player presence */
async function refreshPresence() {
  try {
    const res = await fetch('/api/games');
    if (!res.ok) return;
    const { games } = await res.json();
    const live = {};
    for (const game of games) if (game.state === 'running' && game.players > 0) live[game.slug] = game.players;
    for (const badge of document.querySelectorAll('.tile-live, .stage-live')) {
      const slug = badge.closest('[data-slug]')?.dataset.slug || stage?.dataset.slug;
      const n = live[slug] || 0;
      badge.hidden = !n;
      badge.querySelector('b').textContent = `${n} playing`;
    }
  } catch { /* Presence is decorative; a failed poll changes nothing. */ }
}

refreshPresence();
setInterval(refreshPresence, 30_000);
