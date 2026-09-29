// M6 — the social layer: clans, chat, names, the hat shop, leaderboard and minimap.

import { ok, eq, near, section } from './harness.js';
import { emptyGame, spawnAt, ticks, sent, drain } from './util.js';
import * as C from '#shared/config.js';
import { ITEMS } from '#shared/items.js';
import { HATS } from '#shared/hats.js';
import { cleanName, cleanChat } from '../server/filter.js';

const clanOf = (g, name) => [...g.clans.values()].find((c) => c.name === name);

section('Clans');
{
  const g = emptyGame();
  const boss = spawnAt(g, 5000, 5000, { name: 'Boss' });
  const a = spawnAt(g, 5200, 5000, { name: 'Anna' });
  const b = spawnAt(g, 5400, 5000, { name: 'Ben' });
  ok(g.createClan(boss, 'WOLVESXX'), 'anyone can start a clan');
  const clan = clanOf(g, 'WOLVESX');
  ok(clan, 'names are cut to 7 characters');
  ok(sent(a, 'clans').some((m) => m[1].includes('WOLVESX')), 'everyone hears about a new clan');
  ok(!g.createClan(a, 'WOLVESX'), 'names are unique');
  ok(!g.createClan(boss, 'OTHER'), 'you lead one clan at a time');

  ok(g.requestClan(a, clan.id), 'asking to join…');
  ok(sent(boss, 'request').some((m) => m[1] === a.sid && m[2] === 'Anna'), '…asks the owner');
  eq(a.clan, null, 'nobody joins until the owner says yes');
  ok(g.answerClan(boss, a.sid, true), 'the owner accepts');
  eq(a.clan, clan, 'and Anna is in');
  const members = sent(a, 'members').at(-1);
  eq(members[1], clan.id, 'members hear the clan’s id');
  eq(members[4].filter((v) => typeof v === 'string').join(','), 'Boss,Anna', 'and who is in it');
  g.requestClan(b, clan.id);
  ok(!g.answerClan(a, b.sid, true), 'only the owner can let people in');
  g.answerClan(boss, b.sid, false);
  eq(b.clan, null, 'a no is a no');

  const others = Array.from({ length: C.CLAN_MAX }, (_, i) => spawnAt(g, 3000 + i * 100, 9000));
  for (const o of others) { g.requestClan(o, clan.id); g.answerClan(boss, o.sid, true); }
  eq(clan.members.size, C.CLAN_MAX, `clans hold at most ${C.CLAN_MAX}`);

  ok(g.kickFromClan(boss, a.sid), 'the owner can kick');
  eq(a.clan, null, 'kicked is out');
  ok(!g.kickFromClan(others[0], others[1].sid), 'members cannot kick');
  const leaver = others[0];
  g.leaveClan(leaver);
  eq(leaver.clan, null, 'anyone can leave');
  drain(g);
  g.leaveClan(boss);
  ok(!g.clans.size && others.slice(1).every((o) => o.clan === null), 'when the owner leaves, the clan is gone');
  ok(sent(others[2], 'members').some((m) => m[1] === 0), 'and its members are told');
}

section('What a clan shares');
{
  const g = emptyGame();
  const owner = spawnAt(g, 5000, 5000);
  const mate = spawnAt(g, 5000, 5400);
  g.createClan(owner, 'MATES');
  g.requestClan(mate, clanOf(g, 'MATES').id); g.answerClan(owner, mate.sid, true);
  const spikes = ITEMS.find((i) => i.name === 'Spikes');
  const o = g.addObject({ x: 7000, y: 7000, scale: spikes.scale, item: spikes, owner });
  mate.x = 7000 + spikes.scale + C.PLAYER_SCALE - 2; mate.y = 7000;
  ticks(g, 1);
  eq(mate.health, 100, 'clan spikes do not hurt clan mates');
  const trap = ITEMS.find((i) => i.name === 'Pit Trap');
  const t = g.addObject({ x: 9000, y: 9000, scale: trap.scale, item: trap, owner });
  mate.x = 9300; mate.y = 9000; drain(g);
  ticks(g, 1);
  ok(sent(mate, 'objs').flatMap((m) => m[1]).includes(t.sid), 'clan mates can see each other’s hidden traps');
  void o;
  owner.x = 2000; owner.y = 3000; mate.x = 12000; mate.y = 11000; drain(g);
  ticks(g, Math.ceil(C.MINIMAP_MS / C.TICK_MS) + 1);
  const mm = sent(owner, 'mm').at(-1);
  ok(mm && Math.abs(mm[1][0] - mate.x) < 60 && Math.abs(mm[1][1] - mate.y) < 60, 'clan mates show on each other’s minimap, anywhere on the map');
  drain(g);
  g.mapPing(owner);
  ok(sent(mate, 'ping').length === 1, 'and a map ping reaches the whole clan');
  g.mapPing(owner);
  eq(sent(mate, 'ping').length, 1, 'but not more than once a second');
}

section('Chat');
{
  const g = emptyGame();
  const a = spawnAt(g, 5000, 5000);
  const near1 = spawnAt(g, 5300, 5000);
  const far = spawnAt(g, 12000, 12000);
  g.tick(); drain(g);
  g.chat(a, 'hello there');
  ok(sent(near1, 'chat').some((m) => m[1] === a.sid && m[2] === 'hello there'), 'people nearby see what you say');
  eq(sent(far, 'chat').length, 0, 'people across the map do not');
  g.chat(a, 'spam');
  eq(sent(near1, 'chat').length, 1, 'one message every half second');
  g.time += C.CHAT_COOLDOWN;
  g.chat(a, 'x'.repeat(80));
  eq(sent(near1, 'chat').at(-1)[2].length, C.MAX_CHAT, `and at most ${C.MAX_CHAT} characters`);
  eq(cleanChat('you are a shit player'), 'you are a **** player', 'rude words are starred out');
  eq(cleanChat('sh1t'), '****', 'even spelled with digits');
  eq(cleanChat('classic grass'), 'classic grass', 'but innocent words are left alone');
  g.killPlayer(a, null); g.time += 1000; drain(g);
  g.chat(a, 'from beyond');
  eq(sent(near1, 'chat').length, 0, 'the dead do not chat');
}

section('Names');
{
  eq(cleanName('  Ada  '), 'Ada', 'names are trimmed');
  eq(cleanName('a'.repeat(30)).length, C.MAX_NAME, `and cut to ${C.MAX_NAME} characters`);
  eq(cleanName(''), 'unknown', 'no name is "unknown"');
  eq(cleanName('<script>'), 'script', 'markup is stripped');
  eq(cleanName('fuckface'), 'unknown', 'rude names are not allowed');
  const g = emptyGame();
  const p = g.join();
  g.spawn(p, { name: 'Zed', skin: 99 });
  eq(p.skin, 0, 'an impossible skin colour falls back to the first');
}

section('The hat shop');
{
  const g = emptyGame();
  const p = spawnAt(g, 5000, 5000);
  const booster = HATS.find((h) => h.name === 'Booster Hat');
  ok(!g.buyHat(p, booster.id), 'no gold, no hat');
  p.gold = booster.price + 50;
  ok(g.buyHat(p, booster.id), 'with the gold you can buy it');
  eq(p.gold, 50, 'and it costs its price');
  ok(!g.buyHat(p, booster.id), 'you cannot buy a hat twice');
  ok(!g.buyHat(p, C.CLOWN_HAT), 'the clown hat is not for sale');
  ok(!g.equipHat(p, HATS.find((h) => h.name === 'Tank Gear').id), 'you cannot wear a hat you do not own');
  ok(g.equipHat(p, booster.id), 'you can wear one you do');
  eq(p.shownHat, booster.id, 'everyone sees it on you');
  p.moveDir = 0; ticks(g, 40);
  const top = (C.PLAYER_SPEED * C.TICK_MS) * Math.pow(C.DECEL, C.TICK_MS) / (1 - Math.pow(C.DECEL, C.TICK_MS));
  near(p.xVel / top, booster.spdMult, 0.01, 'the Booster Hat makes you 16% faster');
  g.equipHat(p, 0);
  eq(p.shownHat, 0, 'and it comes off again');

  const shark = HATS.find((h) => h.name === 'Shark Hat');
  const swim = (hat) => {
    const s = spawnAt(g, 3000, C.MAP / 2);
    if (hat) { s.hatsOwned.add(hat.id); g.equipHat(s, hat.id); }
    s.moveDir = -Math.PI / 2; ticks(g, 8);
    return { drift: s.x - 3000, climb: C.MAP / 2 - s.y };
  };
  const plain = swim(null); const finned = swim(shark);
  ok(finned.drift < plain.drift / 5, `the Shark Hat shrugs off the current (${finned.drift.toFixed(0)} vs ${plain.drift.toFixed(0)} units drift)`);
  ok(finned.climb > plain.climb * 1.5, 'and swims much faster');

  const tuff = HATS.find((h) => h.name === 'Tuff Hat');
  p.hatsOwned.add(tuff.id); p.health = 100;
  g.equipHat(p, tuff.id);
  eq(p.maxHealth, 750, 'the Tuff Hat raises your maximum health');
  eq(p.health, 100, 'without healing you');
  g.equipHat(p, 0);
  eq(p.maxHealth, 100, 'take it off and the extra goes');
}

section('Leaderboard');
{
  const g = emptyGame();
  const players = [30, 900, 12, 400, 5000, 1].map((gold, i) => { const p = spawnAt(g, 2000 + i * 1500, 3000); p.gold = gold; return p; });
  const extra = Array.from({ length: 8 }, (_, i) => { const p = spawnAt(g, 2000 + i * 1500, 11000); p.gold = 2; return p; });
  drain(g);
  g.leaderTimer = 0; g.tick();
  const board = sent(players[0], 'leaders').at(-1)[1];
  const golds = []; for (let i = 2; i < board.length; i += 3) golds.push(board[i]);
  eq(golds.length, 10, 'the board shows the top ten');
  eq(golds.slice(0, 4).join(','), '5000,900,400,30', 'richest first');
  drain(g); g.leaderTimer = 0; g.tick();
  eq(sent(players[0], 'leaders').length, 0, 'an unchanged board is not sent again');
  g.killPlayer(players[4], null);
  g.leaderTimer = 0; g.tick();
  ok(!sent(players[0], 'leaders').at(-1)[1].includes(5000), 'the dead drop off it');
  void extra;
}
