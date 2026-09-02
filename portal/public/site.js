// Slopgames portal — search/filter for the arcade grid, plus the embedded
// launcher that wakes a sleeping game server and keeps it awake while you play.

const launcher = document.querySelector('#launcher');
const frame = document.querySelector('#game-frame');
const kicker = document.querySelector('#launch-kicker');
const title = document.querySelector('#launch-title');
const text = document.querySelector('#launch-text');

let heartbeat;
let activeToken;
let lastFocus;

const names = Object.fromEntries(
  [...document.querySelectorAll('.game-card')].map((card) => [card.dataset.slug, card.dataset.name]),
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
  const embedded = Boolean(launcher && frame);
  closeLauncher();

  if (embedded) {
    launcher.classList.add('open');
    launcher.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    kicker.textContent = 'WAKING THE SERVER';
    title.textContent = `Starting ${names[slug] || slug}…`;
    text.textContent = 'A game server is spinning up. This usually takes just a few seconds.';
  }

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
    if (!embedded) return window.alert(message);
    launcher.classList.remove('playing');
    kicker.textContent = 'UNABLE TO START';
    title.textContent = 'Try again in a moment';
    text.textContent = message;
  }
}

document.querySelectorAll('[data-launch]').forEach((el) => {
  el.addEventListener('click', (event) => {
    event.preventDefault();
    play(el.dataset.launch, el);
  });
});
document.querySelectorAll('.close').forEach((el) => el.addEventListener('click', closeLauncher));
document.querySelector('#full-screen')?.addEventListener('click', () => {
  (frame.requestFullscreen || frame.webkitRequestFullscreen)?.call(frame);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && launcher?.classList.contains('open')) closeLauncher();
});
window.addEventListener('beforeunload', closeLauncher);

/* -------------------------------------------------------- search + tags */
const cards = [...document.querySelectorAll('.game-card')];
const search = document.querySelector('#search');
const chips = [...document.querySelectorAll('.chip')];
const empty = document.querySelector('#no-results');
const countLabel = document.querySelector('#result-count');
let activeTag = 'all';

function applyFilters() {
  const query = (search?.value || '').trim().toLowerCase();
  let shown = 0;

  for (const card of cards) {
    const haystack = `${card.dataset.name} ${card.dataset.tags} ${card.dataset.blurb || ''}`.toLowerCase();
    const matchesTag = activeTag === 'all' || card.dataset.tags.split(',').includes(activeTag);
    const matchesQuery = !query || haystack.includes(query);
    const visible = matchesTag && matchesQuery;
    card.hidden = !visible;
    if (visible) shown += 1;
  }

  if (empty) empty.hidden = shown > 0;
  if (countLabel) countLabel.textContent = `${String(shown).padStart(2, '0')} ${shown === 1 ? 'GAME' : 'GAMES'}`;
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
    for (const game of games) {
      const card = cards.find((item) => item.dataset.slug === game.slug);
      const badge = card?.querySelector('.badge.live');
      if (!badge) continue;
      // Only advertise presence when somebody is actually in there — a running
      // server with nobody playing is not a reason to shout.
      badge.hidden = !(game.state === 'running' && game.players > 0);
      badge.querySelector('b').textContent = game.players === 1 ? '1 PLAYING' : `${game.players} PLAYING`;
    }
  } catch { /* Presence is decorative; a failed poll changes nothing. */ }
}

refreshPresence();
setInterval(refreshPresence, 30_000);
