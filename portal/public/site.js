const launcher = document.querySelector('#launcher');
const frame = document.querySelector('#game-frame');
const title = document.querySelector('#launch-title');
const text = document.querySelector('#launch-text');
const kicker = document.querySelector('#launch-kicker');
let heartbeat; let activeToken;
const names = { duostrike: 'DuoStrike', 'pixel-brawl': 'Pixel Brawl' };
function closeLauncher() { clearInterval(heartbeat); activeToken = null; if (frame) frame.removeAttribute('src'); if (launcher) { launcher.classList.remove('open'); launcher.setAttribute('aria-hidden', 'true'); } }
async function play(slug) {
  const embedded = Boolean(launcher && frame);
  closeLauncher(); if (embedded) { launcher.classList.add('open'); launcher.setAttribute('aria-hidden', 'false'); kicker.textContent = 'WAKING THE SERVER'; title.textContent = `Starting ${names[slug]}…`; text.textContent = 'A game server is spinning up. This generally takes just a few seconds.'; }
  try {
    const res = await fetch(`/api/games/${slug}/launch`, { method: 'POST' }); const data = await res.json(); if (!res.ok) throw new Error(data.error);
    activeToken = data.token;
    if (!embedded) return window.location.assign(data.url);
    kicker.textContent = 'NOW PLAYING'; title.textContent = names[slug]; text.textContent = 'Your session keeps this server awake while you play.'; frame.src = data.url;
    heartbeat = setInterval(() => { if (activeToken) fetch(`/api/games/${slug}/heartbeat`, { method: 'POST', headers: { 'X-Game-Session': activeToken } }).catch(() => {}); }, 25_000);
  } catch (error) { if (embedded) { kicker.textContent = 'UNABLE TO START'; title.textContent = 'Try again in a moment'; text.textContent = error.message || 'The game server is unavailable.'; } else window.alert(error.message || 'The game server is unavailable.'); }
}
document.querySelectorAll('[data-launch]').forEach((button) => button.addEventListener('click', () => play(button.dataset.launch)));
document.querySelectorAll('.close').forEach((button) => button.addEventListener('click', closeLauncher));
document.querySelector('#full-screen')?.addEventListener('click', () => frame.requestFullscreen?.());
window.addEventListener('beforeunload', closeLauncher);
