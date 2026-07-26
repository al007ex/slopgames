/**
 * Headless soak test: runs full bot matches in every mode and reports what
 * happened. Run with `npx tsx scripts/simtest.ts`.
 */
import { GameMode, MODES, TICK_DT } from '../shared/constants.js';
import { BRAWLERS } from '../shared/brawlers.js';
import { Sim, type SimPlayerCfg } from '../shared/sim.js';
import { botThink, makeBrain } from '../shared/ai.js';

function runMatch(mode: GameMode, seed: number, verbose = false) {
  const info = MODES[mode];
  const players: SimPlayerCfg[] = [];
  for (let i = 0; i < info.players; i++) {
    players.push({
      uid: 'b' + i,
      name: 'BOT' + i,
      brawler: BRAWLERS[(seed + i * 3) % BRAWLERS.length].id,
      bot: true,
      level: 1 + ((seed + i) % 4),
      trophies: 100,
      team: info.teams === info.players ? i : i % info.teams,
      difficulty: 0.7,
    });
  }
  const sim = new Sim({ mode, seed, players });
  const brains = players.map((_, i) => makeBrain(i));

  let ticks = 0;
  let shots = 0;
  let supers = 0;
  let kills = 0;
  let broken = 0;
  const t0 = Date.now();

  while (sim.phase !== 'over' && ticks < 60 * 20 * 6) {
    for (let i = 0; i < players.length; i++) {
      const p = sim.players[i];
      const cmd = botThink(sim, p, brains[i], TICK_DT);
      if (cmd.shoot) shots++;
      if (cmd.useSuper) supers++;
      sim.setInput(i, cmd);
    }
    sim.step(TICK_DT);
    for (const f of sim.fx) if (f.k === 'kill') kills++;
    broken = sim.broken.length;
    ticks++;
  }

  const ms = Date.now() - t0;
  const res = sim.results();
  const simSeconds = ticks * TICK_DT;

  if (verbose) {
    console.log(`\n=== ${info.name} (seed ${seed}) ===`);
    console.log(`  map ${sim.map.w}x${sim.map.h} ${sim.map.theme}  |  ended after ${simSeconds.toFixed(0)}s of match time`);
    console.log(`  winner: ${sim.winner < 0 ? 'draw' : 'team ' + sim.winner}  scores ${sim.scores.slice(0, 2).join(' - ')}`);
    console.log(`  ${kills} knockouts, ${broken} crates broken, ${shots} attack inputs, ${supers} supers`);
    console.log(`  sim cost: ${ms}ms wall for ${ticks} ticks (${(ms / ticks).toFixed(2)}ms/tick, ${(simSeconds / (ms / 1000)).toFixed(0)}x realtime)`);
    for (const r of res.sort((a, b) => a.rank - b.rank)) {
      console.log(
        `    #${r.rank} ${r.name.padEnd(6)} ${r.brawler.padEnd(9)} team${r.team}  ko:${r.kills}  score:${r.score}  dmg:${Math.round(r.damage)}`,
      );
    }
  }

  return { sim, ticks, kills, broken, shots, supers, ms, res };
}

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

console.log('Pixel Brawl — headless match soak test\n');

for (const mode of [GameMode.GemGrab, GameMode.Showdown, GameMode.Bounty, GameMode.Duel]) {
  const r = runMatch(mode, 12345 + Object.values(GameMode).indexOf(mode) * 7, true);
  console.log('');
  check(`${mode}: match reaches a conclusion`, r.sim.phase === 'over');
  check(`${mode}: bots deal damage`, r.res.some((x) => x.damage > 0), `max ${Math.round(Math.max(...r.res.map((x) => x.damage)))}`);
  check(`${mode}: every player gets a rank`, r.res.every((x) => x.rank > 0));
  check(`${mode}: nobody is stuck at spawn`, r.sim.players.every((p) => p.damageDone > 0 || p.kills > 0 || !p.alive || p.gems > 0 || p.cubes > 0));
}

// wider sweep over many seeds to catch map generation or rule stalls
console.log('\nSweeping 40 random maps across all modes...');
const modes = [GameMode.GemGrab, GameMode.Showdown, GameMode.Bounty, GameMode.Duel];
let stalls = 0;
let totalMs = 0;
for (let i = 0; i < 40; i++) {
  const mode = modes[i % modes.length];
  const r = runMatch(mode, 1000 + i * 977);
  totalMs += r.ms;
  if (r.sim.phase !== 'over') {
    stalls++;
    console.log(`  stalled: ${mode} seed ${1000 + i * 977}`);
  }
}
check('no match stalls across 40 generated maps', stalls === 0, `${stalls} stalls`);
console.log(`  (total sim work ${(totalMs / 1000).toFixed(1)}s for 40 full matches)`);

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
