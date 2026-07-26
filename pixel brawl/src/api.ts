import type { BrawlerState } from '../server/store';

export interface Profile {
  id: string;
  name: string;
  coins: number;
  gems: number;
  tokens: number;
  exp: number;
  selected: string;
  brawlers: Record<string, BrawlerState>;
  trophies: number;
  highest: number;
  roadClaimed: number;
  stats: { games: number; wins: number; kills: number };
  freeBoxIn: number;
}

export interface Reward {
  kind: 'brawler' | 'pp' | 'coins' | 'gems' | 'tokens';
  amount: number;
  brawler?: string;
  rarity?: string;
  isNew?: boolean;
}

const TOKEN_KEY = 'pixelbrawl.token';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}
export function setToken(t: string) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers as any) };
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || 'Something went wrong');
  return data as T;
}

export const api = {
  register: (name: string, password: string) =>
    req<{ token: string; profile: Profile }>('/api/register', { method: 'POST', body: JSON.stringify({ name, password }) }),
  login: (name: string, password: string) =>
    req<{ token: string; profile: Profile }>('/api/login', { method: 'POST', body: JSON.stringify({ name, password }) }),
  profile: () => req<{ profile: Profile }>('/api/profile'),
  select: (brawler: string) => req<{ profile: Profile }>('/api/select', { method: 'POST', body: JSON.stringify({ brawler }) }),
  upgrade: (brawler: string) => req<{ profile: Profile }>('/api/upgrade', { method: 'POST', body: JSON.stringify({ brawler }) }),
  buy: (item: string) =>
    req<{ rewards: Reward[]; profile: Profile }>('/api/shop/buy', { method: 'POST', body: JSON.stringify({ item }) }),
  shop: () => req<{ items: any[] }>('/api/shop'),
  road: () => req<{ stops: any[] }>('/api/road'),
  claimRoad: () => req<{ rewards: Reward[]; profile: Profile }>('/api/road/claim', { method: 'POST' }),
  leaderboard: () => req<{ rows: any[]; online: number }>('/api/leaderboard'),
  status: () => req<{ online: number; inQueue: number; matches: number; accounts: number }>('/api/status'),
};
