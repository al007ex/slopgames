// Keeps names and chat printable and free of the worst words.

import { MAX_NAME } from '#shared/config.js';

// Stems, matched after folding look-alike digits (1→i, 0→o, 3→e, 4→a, 5→s).
const BAD = ['fuck', 'shit', 'cunt', 'bitch', 'whore', 'slut', 'dick', 'cock', 'pussy', 'penis', 'vagina', 'rape', 'nigg', 'nigga', 'fag', 'retard', 'nazi', 'hitler', 'porn', 'pedo'];

const fold = (s) => s.toLowerCase().replace(/1/g, 'i').replace(/0/g, 'o').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/[^a-z]/g, '');

export const isRude = (s) => { const f = fold(s); return BAD.some((w) => f.includes(w)); };

export function cleanName(raw) {
  let name = String(raw ?? '').slice(0, MAX_NAME);
  name = name.replace(/[^\w:()/? -]+/g, ' ').replace(/[^\x20-\x7e]/g, ' ').replace(/\s+/g, ' ').trim();
  return name && !isRude(name) ? name : 'unknown';
}

export function cleanChat(raw) {
  const text = String(raw ?? '').replace(/[^\x20-\x7e]/g, '').trim();
  if (!text) return '';
  return text.split(/(\s+)/).map((word) => (/\S/.test(word) && isRude(word) ? '*'.repeat(word.length) : word)).join('');
}
