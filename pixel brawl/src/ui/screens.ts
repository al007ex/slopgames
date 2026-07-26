import { GameMode, MODE_LIST, MODES, RARITY_INFO, Rarity } from '@shared/constants';
import { getBrawler } from '@shared/brawlers';
import { api } from '../api';
import { itemDataUrl } from '../art/sprites';
import { audioEnabled, sfx, setAudioEnabled } from '../audio';
import type { App } from '../main';
import { brawlerCard, currency, heroPanel, icon, sortedBrawlers } from './components';
import { el } from './dom';
import { brawlerDialog, confirmDialog, openBoxes, toast } from './overlays';

/* --------------------------------- chrome -------------------------------- */

export function topbar(app: App): HTMLElement {
  const p = app.profile!;
  return el(
    'div',
    { class: 'topbar' },
    el('div', { class: 'namechip' }, el('span', { class: 'gold', text: p.name })),
    el('div', { class: 'grow' }),
    currency('trophy', p.trophies),
    currency('coins', p.coins),
    currency('gems', p.gems),
    currency('tokens', p.tokens),
    el('button', {
      class: 'btn-sm btn-ghost',
      text: 'MENU',
      onclick: () => {
        sfx.ui();
        app.go('settings');
      },
    }),
  );
}

const TABS: { id: App['screen']; label: string }[] = [
  { id: 'home', label: 'BRAWL' },
  { id: 'brawlers', label: 'BRAWLERS' },
  { id: 'shop', label: 'SHOP' },
  { id: 'road', label: 'ROAD' },
  { id: 'rank', label: 'RANK' },
];

export function navbar(app: App): HTMLElement {
  return el(
    'div',
    { class: 'navbar' },
    ...TABS.map((t) =>
      el('button', {
        class: 'btn-sm' + (app.screen === t.id ? ' active' : ''),
        text: t.label,
        onclick: () => {
          sfx.ui();
          app.go(t.id);
        },
      }),
    ),
  );
}

/* ---------------------------------- home --------------------------------- */

export function homeScreen(app: App): HTMLElement {
  const p = app.profile!;
  const modeCards = MODE_LIST.map((m) =>
    el(
      'button',
      {
        class: 'mode-card' + (app.mode === m.id ? ' active' : ''),
        onclick: () => {
          sfx.ui();
          app.mode = m.id;
          app.render();
        },
      },
      el('div', { class: 'badge', style: { background: m.color, color: '#12091f' }, text: m.short }),
      el(
        'div',
        { class: 'mtext' },
        el('div', { style: { color: m.color, fontSize: 'clamp(9px,2.2vw,13px)' }, text: m.name }),
        el('div', { class: 'mdesc', text: m.desc }),
      ),
    ),
  );

  const partyPanel = app.party
    ? el(
        'div',
        { class: 'panel col', style: { gap: '8px' } },
        el(
          'div',
          { class: 'row-between' },
          el('h3', { text: 'PARTY ' + app.party.code }),
          el('button', {
            class: 'btn-sm btn-red',
            text: 'LEAVE',
            onclick: () => {
              sfx.ui();
              app.net.send({ t: 'party_leave' });
            },
          }),
        ),
        el(
          'div',
          { class: 'row wrap', style: { gap: '6px' } },
          ...app.party.members.map((m) =>
            el(
              'div',
              { class: 'namechip' },
              el('img', { src: itemDataUrl('star', 3), style: { width: '10px', height: '10px' } }),
              el('span', { text: m.name }),
            ),
          ),
        ),
        el('div', { class: 'tiny', text: 'SHARE THE CODE. THE LEADER STARTS THE MATCH FOR EVERYONE.' }),
      )
    : el(
        'div',
        { class: 'panel row wrap', style: { gap: '8px' } },
        el('button', {
          class: 'btn-sm btn-blue grow',
          text: 'CREATE PARTY',
          onclick: () => {
            sfx.ui();
            app.net.send({ t: 'party_create' });
          },
        }),
        el('button', {
          class: 'btn-sm btn-ghost grow',
          text: 'JOIN WITH CODE',
          onclick: () => {
            sfx.ui();
            const code = prompt('PARTY CODE');
            if (code) app.net.send({ t: 'party_join', code });
          },
        }),
      );

  return el(
    'div',
    { class: 'screen' },
    el(
      'div',
      { class: 'screen-inner' },
      heroPanel(p),
      el('h3', { text: 'CHOOSE A GAME MODE' }),
      el('div', { class: 'modes' }, ...modeCards),
      el('h3', { text: 'OPPONENTS' }),
      el(
        'div',
        { class: 'seg' },
        el('button', {
          class: app.vsBots ? 'on' : '',
          text: 'VS AI',
          onclick: () => {
            sfx.ui();
            app.vsBots = true;
            app.render();
          },
        }),
        el('button', {
          class: !app.vsBots ? 'on' : '',
          text: 'VS PLAYERS',
          onclick: () => {
            sfx.ui();
            app.vsBots = false;
            app.render();
          },
        }),
      ),
      el('div', {
        class: 'tiny center',
        text: app.vsBots
          ? 'INSTANT MATCH AGAINST BOTS - TROPHIES STILL COUNT'
          : 'QUEUE WITH REAL PLAYERS - BOTS FILL EMPTY SLOTS AFTER 9S',
      }),
      el('button', {
        class: 'btn-gold btn-lg',
        text: `PLAY ${MODES[app.mode].name}`,
        onclick: () => {
          sfx.uiBig();
          app.play();
        },
      }),
      partyPanel,
    ),
  );
}

/* -------------------------------- brawlers -------------------------------- */

export function brawlersScreen(app: App): HTMLElement {
  const p = app.profile!;
  const list = sortedBrawlers(p);
  const owned = list.filter((b) => p.brawlers[b.id]?.unlocked).length;

  return el(
    'div',
    { class: 'screen' },
    el(
      'div',
      { class: 'screen-inner' },
      el(
        'div',
        { class: 'row-between wrap' },
        el('h2', { text: 'BRAWLERS' }),
        el('div', { class: 'small', text: `${owned} / ${list.length} UNLOCKED` }),
      ),
      el(
        'div',
        { class: 'grid' },
        ...list.map((b) =>
          brawlerCard(b.id, p, {
            selected: p.selected === b.id,
            onclick: () => {
              sfx.ui();
              brawlerDialog(b.id, p, {
                onUpgrade: async () => {
                  try {
                    const r = await api.upgrade(b.id);
                    app.setProfile(r.profile);
                    sfx.uiBig();
                    toast(`${getBrawler(b.id).name} IS NOW POWER ${r.profile.brawlers[b.id].level}`, true);
                  } catch (e) {
                    toast((e as Error).message);
                  }
                },
                onSelect: async () => {
                  try {
                    const r = await api.select(b.id);
                    app.setProfile(r.profile);
                    app.net.send({ t: 'select', brawler: b.id });
                    sfx.ui();
                  } catch (e) {
                    toast((e as Error).message);
                  }
                },
              });
            },
          }),
        ),
      ),
    ),
  );
}

/* ---------------------------------- shop ---------------------------------- */

export function shopScreen(app: App): HTMLElement {
  const p = app.profile!;
  const root = el('div', { class: 'screen' });
  const inner = el('div', { class: 'screen-inner' });
  root.appendChild(inner);

  inner.appendChild(el('h2', { text: 'SHOP' }));
  inner.appendChild(
    el(
      'div',
      { class: 'row wrap', style: { gap: '6px' } },
      currency('coins', p.coins),
      currency('gems', p.gems),
      currency('tokens', p.tokens),
    ),
  );

  const grid = el('div', { class: 'col', style: { gap: '8px' } });
  inner.appendChild(grid);
  grid.appendChild(el('div', { class: 'small muted', text: 'LOADING...' }));

  api
    .shop()
    .then(({ items }) => {
      grid.replaceChildren();
      for (const it of items) {
        const free = it.currency === 'free';
        const readyIn = free ? p.freeBoxIn : 0;
        const ready = !free || readyIn <= 0;
        const costLabel = free
          ? ready
            ? 'FREE'
            : `${Math.ceil(readyIn / 3600000)}H`
          : String(it.cost);
        const curIcon = it.currency === 'gems' ? 'gemicon' : it.currency === 'tokens' ? 'token' : 'coin';

        grid.appendChild(
          el(
            'div',
            { class: 'panel row wrap', style: { gap: '10px', alignItems: 'center' } },
            el('img', {
              src: itemDataUrl(it.kind === 'coins' ? 'coin' : 'box', it.kind === 'coins' ? 6 : 4),
              style: { width: '56px', height: '56px' },
              alt: it.name,
            }),
            el(
              'div',
              { class: 'grow col', style: { gap: '3px', minWidth: '130px' } },
              el('div', { class: 'mid gold', text: it.name }),
              el('div', { class: 'tiny', text: it.desc }),
            ),
            el(
              'button',
              {
                class: ready ? 'btn-green' : '',
                disabled: !ready,
                onclick: async () => {
                  try {
                    const r = await api.buy(it.id);
                    app.setProfile(r.profile);
                    if (it.kind === 'coins') {
                      sfx.pickup();
                      toast(`+${it.amount} COINS`, true);
                      app.render();
                    } else {
                      await openBoxes(r.rewards, it.name);
                      app.render();
                    }
                  } catch (e) {
                    sfx.ui();
                    toast((e as Error).message);
                  }
                },
              },
              free ? el('span', { text: costLabel }) : icon(curIcon as any, 12),
              free ? null : el('span', { text: ' ' + costLabel }),
            ),
          ),
        );
      }
    })
    .catch(() => grid.replaceChildren(el('div', { class: 'small red', text: 'SHOP UNAVAILABLE' })));

  return root;
}

/* ------------------------------- trophy road ------------------------------ */

export function roadScreen(app: App): HTMLElement {
  const p = app.profile!;
  const root = el('div', { class: 'screen' });
  const inner = el('div', { class: 'screen-inner' });
  root.appendChild(inner);

  inner.appendChild(el('h2', { text: 'TROPHY ROAD' }));
  inner.appendChild(
    el('div', { class: 'row', style: { gap: '8px' } }, currency('trophy', p.trophies), el('div', { class: 'tiny', text: `HIGHEST ${p.highest}` })),
  );

  // claim sits above the (long, scrolling) road so it is always reachable
  const claimSlot = el('div');
  inner.appendChild(claimSlot);

  const list = el('div', { class: 'road panel' });
  inner.appendChild(list);
  list.appendChild(el('div', { class: 'small muted', text: 'LOADING...' }));

  api
    .road()
    .then(({ stops }) => {
      list.replaceChildren();
      let claimable = false;
      stops.forEach((s: any, i: number) => {
        const done = i < p.roadClaimed;
        const next = i === p.roadClaimed;
        if (next && p.highest >= s.trophies) claimable = true;
        const label =
          s.reward.kind === 'box'
            ? 'BRAWL BOX'
            : s.reward.kind === 'bigbox'
              ? 'BIG BOX'
              : s.reward.kind === 'brawler'
                ? getBrawler(s.reward.brawler).name
                : `${s.reward.amount} ${s.reward.kind.toUpperCase()}`;
        list.appendChild(
          el(
            'div',
            { class: 'road-stop' + (done ? ' done' : next ? ' next' : '') },
            el('div', { class: 'dot' }),
            el('div', { class: 'cur trophy' }, icon('trophy', 11), el('span', { text: String(s.trophies) })),
            el('div', { class: 'grow small', text: label }),
            done ? el('div', { class: 'tiny gold', text: 'CLAIMED' }) : null,
          ),
        );
      });

      claimSlot.appendChild(
        el('button', {
          class: claimable ? 'btn-gold btn-lg' : 'btn-lg',
          disabled: !claimable,
          style: { width: '100%' },
          text: claimable ? 'CLAIM REWARDS' : 'EARN MORE TROPHIES',
          onclick: async () => {
            try {
              const r = await api.claimRoad();
              app.setProfile(r.profile);
              if (r.rewards.length) await openBoxes(r.rewards, 'TROPHY ROAD');
              app.render();
            } catch (e) {
              toast((e as Error).message);
            }
          },
        }),
      );
    })
    .catch(() => list.replaceChildren(el('div', { class: 'small red', text: 'ROAD UNAVAILABLE' })));

  return root;
}

/* ------------------------------- leaderboard ------------------------------ */

export function rankScreen(app: App): HTMLElement {
  const root = el('div', { class: 'screen' });
  const inner = el('div', { class: 'screen-inner' });
  root.appendChild(inner);
  inner.appendChild(el('h2', { text: 'LEADERBOARD' }));

  const list = el('div', { class: 'col panel', style: { gap: '4px' } });
  inner.appendChild(list);
  list.appendChild(el('div', { class: 'small muted', text: 'LOADING...' }));

  api
    .leaderboard()
    .then(({ rows, online }) => {
      list.replaceChildren();
      inner.insertBefore(el('div', { class: 'tiny', text: `${online} BRAWLERS ONLINE` }), list);
      if (!rows.length) list.appendChild(el('div', { class: 'small muted', text: 'NO RANKED PLAYERS YET' }));
      rows.forEach((r: any, i: number) => {
        const you = r.name === app.profile!.name;
        list.appendChild(
          el(
            'div',
            { class: 'stat', style: you ? { borderColor: 'var(--gold)' } : undefined },
            el('span', { text: `#${i + 1}  ${r.name}` }),
            el('span', { class: 'gold', text: `${r.trophies}` }),
          ),
        );
      });
    })
    .catch(() => list.replaceChildren(el('div', { class: 'small red', text: 'LEADERBOARD UNAVAILABLE' })));

  return root;
}

/* -------------------------------- settings -------------------------------- */

export function settingsScreen(app: App): HTMLElement {
  const p = app.profile!;
  const soundBtn = el('button', {
    class: audioEnabled() ? 'btn-green' : 'btn-ghost',
    text: audioEnabled() ? 'SOUND: ON' : 'SOUND: OFF',
    onclick: () => {
      setAudioEnabled(!audioEnabled());
      localStorage.setItem('pixelbrawl.sound', audioEnabled() ? '1' : '0');
      sfx.ui();
      app.render();
    },
  });

  return el(
    'div',
    { class: 'screen' },
    el(
      'div',
      { class: 'screen-inner' },
      el('h2', { text: 'SETTINGS' }),
      el(
        'div',
        { class: 'panel col', style: { gap: '6px' } },
        el('h3', { text: 'ACCOUNT' }),
        el('div', { class: 'stat' }, el('span', { text: 'NAME' }), el('span', { class: 'gold', text: p.name })),
        el('div', { class: 'stat' }, el('span', { text: 'MATCHES' }), el('span', { class: 'gold', text: String(p.stats.games) })),
        el('div', { class: 'stat' }, el('span', { text: 'WINS' }), el('span', { class: 'gold', text: String(p.stats.wins) })),
        el('div', { class: 'stat' }, el('span', { text: 'KNOCKOUTS' }), el('span', { class: 'gold', text: String(p.stats.kills) })),
        el('div', { class: 'stat' }, el('span', { text: 'HIGHEST TROPHIES' }), el('span', { class: 'gold', text: String(p.highest) })),
      ),
      el('div', { class: 'panel col', style: { gap: '6px' } }, el('h3', { text: 'AUDIO' }), soundBtn),
      el(
        'div',
        { class: 'panel col', style: { gap: '6px' } },
        el('h3', { text: 'HOW TO PLAY' }),
        el('div', { class: 'small', text: 'PC: WASD TO MOVE, MOUSE TO AIM, LEFT CLICK TO SHOOT, RIGHT CLICK OR SHIFT FOR SUPER.' }),
        el('div', { class: 'small', text: 'PHONE: LEFT SIDE JOYSTICK MOVES. DRAG THE ATTACK BUTTON TO AIM, RELEASE TO FIRE. TAP IT TO AUTO-AIM.' }),
        el('div', { class: 'small', text: 'HIDE IN BUSHES TO AMBUSH. BREAK CRATES FOR POWER CUBES IN SHOWDOWN.' }),
      ),
      el(
        'div',
        { class: 'panel col', style: { gap: '6px' } },
        el('h3', { text: 'RARITIES' }),
        ...Object.entries(RARITY_INFO)
          .filter(([k]) => k !== Rarity.Starting)
          .map(([, v]) => el('div', { class: 'stat' }, el('span', { style: { color: v.color }, text: v.name }), el('span', { text: `${v.cards} CARDS` }))),
      ),
      el('button', {
        class: 'btn-red',
        text: 'LOG OUT',
        onclick: () => confirmDialog('LOG OUT?', 'YOUR PROGRESS IS SAVED ON THE SERVER.', () => app.logout()),
      }),
      el('button', {
        class: 'btn-ghost',
        text: 'BACK',
        onclick: () => {
          sfx.ui();
          app.go('home');
        },
      }),
    ),
  );
}

/* ---------------------------------- auth ---------------------------------- */

export function authScreen(app: App): HTMLElement {
  let mode: 'login' | 'register' = 'login';
  const root = el('div', { class: 'screen', style: { justifyContent: 'center' } });

  const build = () => {
    const name = el('input', { type: 'text', placeholder: 'NAME', maxlength: '14', autocomplete: 'username' }) as HTMLInputElement;
    const pass = el('input', {
      type: 'password',
      placeholder: 'PASSWORD',
      autocomplete: mode === 'login' ? 'current-password' : 'new-password',
    }) as HTMLInputElement;
    const err = el('div', { class: 'tiny red center', text: '' });

    const submit = async () => {
      const n = name.value.trim();
      const p = pass.value;
      if (!n || !p) {
        err.textContent = 'ENTER A NAME AND PASSWORD';
        return;
      }
      btn.disabled = true;
      btn.textContent = 'PLEASE WAIT...';
      try {
        const r = mode === 'login' ? await api.login(n, p) : await api.register(n, p);
        sfx.uiBig();
        app.onAuth(r.token, r.profile);
      } catch (e) {
        err.textContent = (e as Error).message.toUpperCase();
        root.querySelector('.dialog')?.classList.add('shake');
        setTimeout(() => root.querySelector('.dialog')?.classList.remove('shake'), 340);
      } finally {
        btn.disabled = false;
        btn.textContent = mode === 'login' ? 'SIGN IN' : 'CREATE ACCOUNT';
      }
    };

    const btn = el('button', { class: 'btn-gold btn-lg', text: mode === 'login' ? 'SIGN IN' : 'CREATE ACCOUNT', onclick: submit });
    for (const i of [name, pass]) i.addEventListener('keydown', (e) => e.key === 'Enter' && submit());

    return el(
      'div',
      { class: 'screen-inner', style: { maxWidth: '440px', margin: 'auto' } },
      el(
        'div',
        { class: 'dialog col', style: { gap: '12px' } },
        el('h1', { class: 'center gold', text: 'PIXEL BRAWL' }),
        el('div', { class: 'tiny center', text: 'A RETRO ARENA BRAWLER' }),
        el(
          'div',
          { class: 'seg' },
          el('button', {
            class: mode === 'login' ? 'on' : '',
            text: 'SIGN IN',
            onclick: () => {
              mode = 'login';
              root.replaceChildren(build());
            },
          }),
          el('button', {
            class: mode === 'register' ? 'on' : '',
            text: 'NEW PLAYER',
            onclick: () => {
              mode = 'register';
              root.replaceChildren(build());
            },
          }),
        ),
        name,
        pass,
        err,
        btn,
        el('div', { class: 'tiny center', text: '3-14 CHARACTERS. PASSWORD AT LEAST 4.' }),
      ),
    );
  };

  root.appendChild(build());
  return root;
}

export function modeColor(m: GameMode) {
  return MODES[m].color;
}
