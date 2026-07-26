import { BRAWLERS, getBrawler } from '@shared/brawlers';
import { MAX_POWER_LEVEL, RARITY_INFO, Rarity, UPGRADE_POINTS } from '@shared/constants';
import { brawlerDataUrl, itemDataUrl } from '../art/sprites';
import type { Profile } from '../api';
import { el } from './dom';

export function icon(name: 'trophy' | 'coin' | 'gemicon' | 'token' | 'star' | 'gem' | 'cube' | 'pp' | 'box', size = 14) {
  return el('img', { src: itemDataUrl(name, 4), style: { width: size + 'px', height: size + 'px' }, alt: name });
}

export function currency(kind: 'trophy' | 'coins' | 'gems' | 'tokens', value: number) {
  const map = { trophy: 'trophy', coins: 'coin', gems: 'gemicon', tokens: 'token' } as const;
  return el('div', { class: 'cur ' + kind }, icon(map[kind], 14), el('span', { text: value.toLocaleString() }));
}

export function ppNeededFor(level: number) {
  return UPGRADE_POINTS[Math.max(0, Math.min(UPGRADE_POINTS.length - 1, level - 1))];
}

export function brawlerCard(
  id: string,
  profile: Profile,
  opts: { selected?: boolean; onclick?: () => void } = {},
): HTMLElement {
  const def = getBrawler(id);
  const st = profile.brawlers[id] ?? { unlocked: false, level: 1, pp: 0, trophies: 0, highest: 0 };
  const rar = RARITY_INFO[def.rarity as Rarity];
  const need = ppNeededFor(st.level);
  const maxed = st.level >= MAX_POWER_LEVEL;

  const card = el(
    'div',
    {
      class: 'card' + (st.unlocked ? '' : ' locked') + (opts.selected ? ' selected' : ''),
      onclick: opts.onclick,
      role: 'button',
      tabindex: '0',
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') opts.onclick?.();
      },
    },
    el('div', { class: 'rarity-bar', style: { background: rar.color } }),
    st.unlocked ? el('div', { class: 'lvl', text: String(st.level) }) : null,
    el('img', { class: 'portrait', src: brawlerDataUrl(id, 4), alt: def.name }),
    el('div', { class: 'cname', text: def.name }),
    st.unlocked
      ? el('div', { class: 'trophy-chip' }, icon('trophy', 10), el('span', { text: String(st.trophies) }))
      : el('div', { class: 'tiny', text: 'LOCKED' }),
    st.unlocked
      ? el(
          'div',
          { class: 'pp-bar' },
          el('i', { style: { width: maxed ? '100%' : Math.min(100, (st.pp / need) * 100) + '%' } }),
          el('span', { text: maxed ? 'MAX' : `${st.pp}/${need}` }),
        )
      : null,
  );
  return card;
}

export function heroPanel(profile: Profile): HTMLElement {
  const def = getBrawler(profile.selected);
  const st = profile.brawlers[profile.selected];
  const rar = RARITY_INFO[def.rarity as Rarity];
  return el(
    'div',
    { class: 'panel hero' },
    el('img', { class: 'portrait-lg', src: brawlerDataUrl(profile.selected, 6), alt: def.name }),
    el(
      'div',
      { class: 'grow col', style: { gap: '4px' } },
      el('h2', { text: def.name, style: { color: rar.color } }),
      el('div', { class: 'tiny', text: def.title }),
      el(
        'div',
        { class: 'row', style: { gap: '6px', marginTop: '4px' } },
        el('div', { class: 'cur trophy' }, icon('trophy', 12), el('span', { text: String(st?.trophies ?? 0) })),
        el('div', { class: 'cur' }, el('span', { text: 'PWR ' + (st?.level ?? 1) })),
      ),
    ),
  );
}

export function rewardCard(r: { kind: string; amount: number; brawler?: string; rarity?: string; isNew?: boolean }) {
  if (r.kind === 'brawler' && r.brawler) {
    const def = getBrawler(r.brawler);
    const rar = RARITY_INFO[(r.rarity as Rarity) ?? def.rarity];
    return el(
      'div',
      { class: 'reward-card', style: { borderColor: rar.color } },
      el('img', { src: brawlerDataUrl(r.brawler, 3), alt: def.name }),
      el(
        'div',
        { class: 'grow' },
        el('div', { class: 'mid', style: { color: rar.color }, text: 'NEW BRAWLER!' }),
        el('div', { class: 'small', text: def.name }),
      ),
    );
  }
  if (r.kind === 'pp' && r.brawler) {
    const def = getBrawler(r.brawler);
    return el(
      'div',
      { class: 'reward-card' },
      el('img', { src: brawlerDataUrl(r.brawler, 3), alt: def.name }),
      el(
        'div',
        { class: 'grow' },
        el('div', { class: 'mid blue', text: `+${r.amount} CARDS` }),
        el('div', { class: 'small', text: def.name }),
      ),
    );
  }
  const map: Record<string, { icon: any; label: string; cls: string }> = {
    coins: { icon: 'coin', label: 'COINS', cls: 'gold' },
    gems: { icon: 'gemicon', label: 'GEMS', cls: 'green' },
    tokens: { icon: 'token', label: 'TOKENS', cls: 'blue' },
  };
  const m = map[r.kind] ?? map.coins;
  return el(
    'div',
    { class: 'reward-card' },
    el('img', { src: itemDataUrl(m.icon, 6), alt: m.label }),
    el(
      'div',
      { class: 'grow' },
      el('div', { class: 'mid ' + m.cls, text: `+${r.amount}` }),
      el('div', { class: 'small', text: m.label }),
    ),
  );
}

export function progressBar(frac: number, color = 'var(--gold)', label?: string) {
  return el(
    'div',
    { class: 'pp-bar', style: { height: '14px' } },
    el('i', { style: { width: Math.max(0, Math.min(100, frac * 100)) + '%', background: color } }),
    label ? el('span', { style: { fontSize: '8px' }, text: label }) : null,
  );
}

export function sortedBrawlers(profile: Profile) {
  return [...BRAWLERS].sort((a, b) => {
    const ua = profile.brawlers[a.id]?.unlocked ? 0 : 1;
    const ub = profile.brawlers[b.id]?.unlocked ? 0 : 1;
    if (ua !== ub) return ua - ub;
    const ta = profile.brawlers[a.id]?.trophies ?? 0;
    const tb = profile.brawlers[b.id]?.trophies ?? 0;
    if (ta !== tb) return tb - ta;
    return a.name.localeCompare(b.name);
  });
}
