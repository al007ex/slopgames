# Stormwall

A 100-player build-and-shoot battle royale in the browser, in the mould of the
genre's first season. Drop from the Drop Blimp, harvest everything, throw up
walls and ramps in a heartbeat, loot chests you can hear through walls, and be
the last one standing as the storm closes in. Solo, duos or squads — matches
fill with bots when there are not enough people.

```bash
cd stormwall
npm install
npm start
```

Then open <http://localhost:3500>. It needs a keyboard and mouse.

## Playing

| | |
| --- | --- |
| Move / sprint / jump / crouch | WASD · hold Shift · Space · C |
| Aim / fire | mouse · right button · left button |
| Weapons | 1 pickaxe, 2–6 slots, mouse wheel · R reload · V drop |
| Build | Q wall, F floor, Z ramp, X cone · left click places **one** piece · right click switches wood / brick / metal · B leaves build mode |
| Edit | G on one of your builds, click tiles (drag to paint), G again to confirm, right click resets |
| Interact | E: pick up, open chests, hold to revive a teammate |
| Team | T pings where you aim |
| Map / scores | M · hold Tab |

**Harvest** with the pickaxe (one swing per half second): every tree, rock, car,
container, piece of furniture and wall on the island has health and a material,
and a weak-point marker moves round what you are hitting — hit it for double.

**Build** on a global grid: walls, floors, ramps and cones cost 10 of a
material. Pieces start weak and build up to full health — wood in 2.5 s, brick
in 9, metal in 15 — so wood is what you fight with. Edit your own builds into
doors, windows, floor holes and turned stairs. Knock out what holds a structure
up and the rest comes down.

**Fight** with the first season's arsenal — pistol, revolver, tactical SMG,
assault, burst and scoped rifles, pump and tactical shotguns, bolt-action
sniper, rocket and grenade launchers — in five rarities. Bloom opens up while
you move and fire and settles to a perfectly accurate first shot; shotguns fall
off hard; snipers do 2.5× to the head. Heal with bandages (to 75), med kits and
shield potions.

**Survive** the storm: ten phases, each a wait while the next circle shows on
the map and a shrink while the wall moves in, damage climbing from 1 to 10 a
second, down to nothing.

## Modes

- **Solo, duos, squads.** A minute on the pre-game island (nothing hurts; it all
  vanishes at launch), then the blimp. In teams, lethal damage knocks you down
  instead: crawl, bleed out over 40 s, or get revived in 10 s by a teammate.
- **Practice.** A sandbox with a full kit and materials. Nobody wins.

Every match earns XP (placement, eliminations, survival), coins — earned by
playing, never bought — and progress on three daily challenges. Coins and
levels unlock outfits, gliders and pickaxes, which change nothing but looks.
Career stats, K/D and leaderboards are in the lobby.

## How it is built

```
shared/   world generation, terrain, collision, the character controller,
          build pieces and rules, weapons, loot tables, the storm, protocol —
          everything the server and the browser must agree on
server/   matches (a fixed-order tick), replication, building, combat, loot,
          storm, match flow, bots, teams, matchmaking, accounts
client/   Three.js renderer, prediction, build and edit modes, HUD, lobby, audio
test/     one file per milestone, 446 assertions
```

- **Server-authoritative at 30 Hz.** Every tick runs in the same order —
  input → movement → build placement → weapon fire → damage → storm →
  replication — so a wall placed this tick stops a shot fired this tick.
- **One island, generated twice.** The 5.12 km map (twenty named places,
  ~13,500 build pieces, ~13,000 props) is generated from a fixed seed on the
  server and again in the browser, bit for bit — only exact arithmetic is used,
  never `Math.sin` — so only *changes* are ever sent: a broken wall, a new ramp,
  loot on the floor.
- **Interest management.** The world is split into 64 m replication cells;
  each client gets players near it every tick (far ones at a lower rate) and
  structure changes only for the cells around it. A hundred bots with twenty
  thousand pieces tick in about 2 ms.
- **Prediction and reconciliation.** The client runs the same character
  controller on its own inputs, replays unacknowledged ones on each correction,
  predicts builds and its own shots (spread comes from a shared hash, so tracers
  match), and draws everyone else 100 ms in the past.
- **Lag-compensated hitscan.** Shots are traced against other players rewound
  to the shooter's view time (capped at 300 ms).
- **Checked, not trusted.** Inputs are rate-limited by a token bucket; every
  placement, edit, shot, swing and pickup is validated for reach, aim, rules and
  rate on the server.
- **Bots** drop, loot (through doors, up stairs, down through roofs), rotate
  ahead of the storm, heal, fight, wall up, ramp up hills and revive squadmates.
- **Accounts** need no password: the browser keeps a random secret and the
  server stores a hash of it, in `data/accounts.json`.

## Tests

```bash
npm test          # all milestones, ~1.5 minutes
node test/run.js m7   # just one (a full 100-bot match, start to finish)
```

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `PORT` | 3500 | |
| `HOST` | all interfaces (loopback when `NODE_ENV=production`) | |
| `PREGAME_SECONDS` | 60 | length of the pre-game island |
| `MAX_MATCHES` | 3 | matches run at once; more players queue |
| `DATA_DIR` | `stormwall/data` | where accounts are stored |
| `REGION_NAME`, `REGIONS` | `Main` | this server's region, and a JSON list of others to offer |

Stormwall is an original game made for this collection. It borrows the shape of
a genre, not anyone's names or art.
