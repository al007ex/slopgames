import {
  GameMode,
  MAX_POWER_LEVEL,
  MODES,
  POWER_SCALE,
  RARITY_INFO,
  Rarity,
  TEAM_COLORS,
  UPGRADE_COINS,
  UPGRADE_POINTS,
} from '@shared/constants';
import { getBrawler } from '@shared/brawlers';
import type { MatchOverMsg } from '@shared/types';
import { brawlerDataUrl, itemDataUrl } from '../art/sprites';
import { sfx } from '../audio';
import type { Reward } from '../api';
import { icon, rewardCard } from './components';
import { el, wait } from './dom';

const layer = () => document.getElementById('overlays')!;

export function toast(msg: string, ok = false) {
  const t = el('div', { class: 'toast' + (ok ? ' ok' : ''), text: msg });
  layer().appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .25s, transform .25s';
    t.style.opacity = '0';
    t.style.transform = 'translate(-50%, -14px)';
    setTimeout(() => t.remove(), 260);
  }, 2400);
}

/* ------------------------------ box opening ------------------------------ */

export function openBoxes(rewards: Reward[], title = 'BRAWL BOX'): Promise<void> {
  return new Promise((resolve) => {
    const list = el('div', { class: 'col', style: { gap: '8px', width: '100%' } });
    const stage = el(
      'div',
      { class: 'boxstage' },
      el('h2', { text: title, class: 'gold' }),
      el('img', { class: 'boxsprite', src: itemDataUrl('box', 8), alt: 'box' }),
      el('div', { class: 'small blink', text: 'TAP TO OPEN' }),
    );
    const dialog = el('div', { class: 'dialog', style: { position: 'relative' } }, stage);
    const root = el('div', { class: 'overlay' }, dialog);
    layer().appendChild(root);

    let opened = false;
    const open = async () => {
      if (opened) return;
      opened = true;
      sfx.box();
      const flash = el('div', { class: 'flash' });
      dialog.appendChild(flash);
      setTimeout(() => flash.remove(), 340);
      stage.replaceChildren(el('h2', { text: title, class: 'gold' }), list);

      for (const r of rewards) {
        list.appendChild(rewardCard(r));
        if (r.kind === 'brawler') sfx.uiBig();
        else sfx.pickup();
        await wait(190);
      }
      const btn = el('button', {
        class: 'btn-gold btn-lg',
        text: 'CONTINUE',
        style: { width: '100%', marginTop: '6px' },
        onclick: () => {
          sfx.ui();
          root.remove();
          resolve();
        },
      });
      stage.appendChild(btn);
    };

    root.addEventListener('click', open);
  });
}

/* -------------------------------- queueing ------------------------------- */

export interface QueueHandle {
  update(text: string): void;
  close(): void;
}

export function queueOverlay(mode: GameMode, vsBots: boolean, onCancel: () => void): QueueHandle {
  const info = MODES[mode];
  const status = el('div', { class: 'small', text: vsBots ? 'CREATING MATCH' : 'SEARCHING FOR PLAYERS' });
  const dots = el('span', { class: 'dots' });
  const root = el(
    'div',
    { class: 'overlay' },
    el(
      'div',
      { class: 'dialog center col', style: { gap: '14px' } },
      el('h1', { text: info.name, style: { color: info.color } }),
      el('div', { class: 'small', text: vsBots ? 'PRACTICE VS AI' : `${info.players} PLAYERS - RANKED` }),
      el('div', { class: 'spinner' }),
      el('div', { class: 'row center', style: { justifyContent: 'center' } }, status, dots),
      el('button', {
        class: 'btn-red',
        text: 'CANCEL',
        onclick: () => {
          sfx.ui();
          onCancel();
        },
      }),
    ),
  );
  layer().appendChild(root);
  return {
    update: (text: string) => (status.textContent = text),
    close: () => root.remove(),
  };
}

/* -------------------------------- results -------------------------------- */

export function resultsOverlay(msg: MatchOverMsg, mode: GameMode, onClose: () => void) {
  const won = msg.result === 'victory';
  const draw = msg.result === 'draw';
  const color = won ? 'var(--gold)' : draw ? 'var(--blue)' : 'var(--red)';
  const heading = won ? 'VICTORY!' : draw ? 'DRAW' : 'DEFEAT';
  won ? sfx.victory() : sfx.defeat();

  const rows = [...msg.rows].sort((a, b) => a.rank - b.rank || b.kills - a.kills);
  const rowEls = rows.map((r, i) => {
    const def = getBrawler(r.brawler);
    const isYou = r.slot === msg.you;
    const teamCol = TEAM_COLORS[r.team % TEAM_COLORS.length];
    return el(
      'div',
      { class: 'result-row' + (isYou ? ' you' : ''), style: { animationDelay: i * 55 + 'ms' } },
      el('div', { class: 'gold', text: '#' + r.rank }),
      el('img', { src: brawlerDataUrl(r.brawler, 2), alt: def.name }),
      el(
        'div',
        { class: 'grow', style: { minWidth: '0', overflow: 'hidden' } },
        el('div', { style: { color: teamCol, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, text: r.name }),
        el('div', { class: 'tiny', text: `${r.kills} KO  ${r.bot ? 'BOT' : ''}` }),
      ),
      el('div', { class: 'muted', text: String(r.score) }),
      el('div', {
        class: r.trophyDelta > 0 ? 'green' : r.trophyDelta < 0 ? 'red' : 'muted',
        text: r.trophyDelta > 0 ? '+' + r.trophyDelta : String(r.trophyDelta),
      }),
    );
  });

  const rewards = msg.rewards ?? { trophies: 0, tokens: 0, coins: 0, exp: 0 };
  const root = el(
    'div',
    { class: 'overlay' },
    el(
      'div',
      { class: 'dialog col', style: { gap: '10px' } },
      el('h1', { class: 'center', text: heading, style: { color } }),
      el('div', { class: 'center small', text: MODES[mode].name }),
      el('div', { class: 'col', style: { gap: '4px', maxHeight: '46vh', overflowY: 'auto' } }, ...rowEls),
      el(
        'div',
        { class: 'row wrap', style: { justifyContent: 'center', gap: '6px' } },
        el(
          'div',
          { class: 'cur trophy' },
          icon('trophy', 12),
          el('span', { text: (rewards.trophies >= 0 ? '+' : '') + rewards.trophies }),
        ),
        el('div', { class: 'cur tokens' }, icon('token', 12), el('span', { text: '+' + rewards.tokens })),
        el('div', { class: 'cur coins' }, icon('coin', 12), el('span', { text: '+' + rewards.coins })),
      ),
      el('button', {
        class: 'btn-gold btn-lg',
        text: 'CONTINUE',
        onclick: () => {
          sfx.ui();
          root.remove();
          onClose();
        },
      }),
    ),
  );
  layer().appendChild(root);
}

/* ---------------------------- brawler detail ----------------------------- */

export function brawlerDialog(
  id: string,
  profile: { brawlers: Record<string, { unlocked: boolean; level: number; pp: number; trophies: number; highest: number }>; coins: number; selected: string },
  actions: { onUpgrade: () => void; onSelect: () => void },
) {
  const def = getBrawler(id);
  const st = profile.brawlers[id];
  const rar = RARITY_INFO[def.rarity as Rarity];
  const maxed = st.level >= MAX_POWER_LEVEL;
  const needPp = UPGRADE_POINTS[Math.min(UPGRADE_POINTS.length - 1, st.level - 1)];
  const needCoins = UPGRADE_COINS[Math.min(UPGRADE_COINS.length - 1, st.level - 1)];
  const scale = POWER_SCALE[Math.min(POWER_SCALE.length - 1, st.level - 1)];
  const canUp = !maxed && st.pp >= needPp && profile.coins >= needCoins;

  const root = el(
    'div',
    { class: 'overlay', onclick: (e: MouseEvent) => e.target === root && root.remove() },
    el(
      'div',
      { class: 'dialog col', style: { gap: '10px' } },
      el(
        'div',
        { class: 'row' },
        el('img', { src: brawlerDataUrl(id, 5), alt: def.name, style: { width: '96px', height: '80px' } }),
        el(
          'div',
          { class: 'grow col', style: { gap: '3px' } },
          el('h2', { text: def.name, style: { color: rar.color } }),
          el('div', { class: 'tiny', style: { color: rar.color }, text: rar.name }),
          el('div', { class: 'tiny', text: def.title }),
          st.unlocked
            ? el('div', { class: 'row', style: { gap: '5px', marginTop: '3px' } },
                el('div', { class: 'cur trophy' }, icon('trophy', 11), el('span', { text: String(st.trophies) })),
                el('div', { class: 'cur' }, el('span', { text: 'PWR ' + st.level })),
              )
            : el('div', { class: 'tiny red', text: 'NOT UNLOCKED YET' }),
        ),
      ),
      el('div', { class: 'small', text: def.desc }),
      el(
        'div',
        { class: 'col', style: { gap: '4px' } },
        el('div', { class: 'stat' }, el('span', { text: 'HEALTH' }), el('span', { class: 'gold', text: String(Math.round(def.hp * scale)) })),
        el(
          'div',
          { class: 'stat' },
          el('span', { text: 'ATTACK - ' + def.attack.name }),
          el('span', { class: 'gold', text: `${Math.round(def.attack.damage * scale)} x${def.attack.count}` }),
        ),
        el('div', { class: 'stat' }, el('span', { text: 'SUPER - ' + def.super.name }), el('span', { class: 'gold', text: String(Math.round(def.super.damage * scale)) })),
        el('div', { class: 'stat' }, el('span', { text: 'RELOAD' }), el('span', { class: 'gold', text: def.attack.reload.toFixed(2) + 'S' })),
        el('div', { class: 'stat' }, el('span', { text: 'RANGE' }), el('span', { class: 'gold', text: Math.round(def.attack.range / 16) + ' TILES' })),
      ),
      el('div', { class: 'small', style: { color: 'var(--purple)' }, text: 'SUPER: ' + def.super.desc }),
      st.unlocked
        ? el(
            'div',
            { class: 'col', style: { gap: '6px' } },
            maxed
              ? el('div', { class: 'center gold small', text: 'MAX POWER REACHED' })
              : el(
                  'div',
                  { class: 'col', style: { gap: '6px' } },
                  el(
                    'div',
                    { class: 'pp-bar', style: { height: '16px' } },
                    el('i', { style: { width: Math.min(100, (st.pp / needPp) * 100) + '%' } }),
                    el('span', { style: { fontSize: '8px' }, text: `${st.pp} / ${needPp} CARDS` }),
                  ),
                  el(
                    'button',
                    {
                      class: canUp ? 'btn-green' : '',
                      disabled: !canUp,
                      onclick: () => {
                        actions.onUpgrade();
                        root.remove();
                      },
                    },
                    el('span', {}, `UPGRADE TO PWR ${st.level + 1}  `),
                    icon('coin', 12),
                    el('span', { text: ' ' + needCoins }),
                  ),
                ),
            profile.selected === id
              ? el('div', { class: 'center small gold', text: 'CURRENTLY SELECTED' })
              : el('button', {
                  class: 'btn-gold',
                  text: 'SELECT BRAWLER',
                  onclick: () => {
                    actions.onSelect();
                    root.remove();
                  },
                }),
          )
        : el('div', { class: 'center small muted', text: `FIND ${def.name} IN BRAWL BOXES` }),
      el('button', { class: 'btn-ghost btn-sm', text: 'CLOSE', onclick: () => root.remove() }),
    ),
  );
  layer().appendChild(root);
}

export function confirmDialog(title: string, body: string, onYes: () => void) {
  const root = el(
    'div',
    { class: 'overlay' },
    el(
      'div',
      { class: 'dialog col center', style: { gap: '12px' } },
      el('h2', { text: title }),
      el('div', { class: 'small', text: body }),
      el(
        'div',
        { class: 'row', style: { gap: '8px' } },
        el('button', { class: 'btn-ghost grow', text: 'CANCEL', onclick: () => root.remove() }),
        el('button', {
          class: 'btn-red grow',
          text: 'YES',
          onclick: () => {
            root.remove();
            onYes();
          },
        }),
      ),
    ),
  );
  layer().appendChild(root);
}
