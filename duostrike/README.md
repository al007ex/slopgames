# DUOSTRIKE

A two-player co-op arena adventure that runs in a browser tab. Krunker-style
movement and hitscan gunplay, Among Us-style co-op tasks, a short campaign with
NPC villagers between fights.

**Exactly two players.** Not one, not three. Every level has at least one thing
in it that a single player physically cannot finish.

---

## Run it locally

```bash
npm install
```

```bash
npm start
```

Open <http://localhost:3000> in two browser tabs (or two machines on the same
network — use the host's LAN IP). There is no build step: Three.js and the
shared modules are served straight out of `node_modules` and `shared/`.

```bash
npm test
```

Runs the campaign integration test and the movement-kit test. Both are plain
Node scripts, no test framework.

---

## The two-player room flow

1. **Landing page** — type a name, then either **Create Room** (you get a
   4-character code like `NVZM`) or **Join Room** (type your partner's code).
2. **Lobby** — two slots. Both must be filled and both players must press
   **Ready** before **Start Game** unlocks. A third player trying to join is
   turned away.
3. **Campaign** — 11 stages, played in order. Progress is tracked *per room*,
   not per player, so you are always on the same level as your partner. Level
   gates only open when the shared objective is done, and the stage only
   advances when **both** players stand in the exit zone.
4. **End screen** — a recap, then **Play Again** returns both players to a fresh
   lobby.

If a player disconnects, the run pauses and both see a reconnect screen. They
rejoin by entering the same room code; the run resumes where it stopped. Empty
rooms are dropped after a minute.

---

## Controls

| Input | Action |
| --- | --- |
| `W A S D` | Move |
| Mouse | Look |
| `Shift` | Sprint (adds a slight FOV kick) |
| `Ctrl` | Slide — hold while sprinting; low hitbox, fits under obstacles |
| `Space` | Jump. In the air against a wall, jumps *off* the wall |
| `C` | Crouch |
| Left click | Fire / swing |
| Right click | Aim down sights (guns) or block (sword) |
| `R` | Reload |
| `1` `2` `3` | Rifle, shotgun, sword (mouse wheel also cycles) |
| `E` | Interact — talk, flip switches, hold positions, pick things up |
| `Esc` | Release the mouse and open settings (FOV, sensitivity, invert Y) |

Click the game to recapture the mouse.

---

## The five co-op task mechanics

Every task in the game is exactly one of these — never a combination.

| Mechanic | How it works |
| --- | --- |
| **Hold Interact** | Stand on a pad and hold `E`. Step off and progress resets. |
| **Synced Switch** | Two switches, one each, thrown within 3 seconds of each other. |
| **Fetch & Deliver** | Carry a glowing core to a terminal. Carrying slows you and blocks sprint. |
| **Defend & Explore** | One player holds a position while the other reaches and triggers something elsewhere. The holder cannot also trigger it. |
| **Pattern Match** | A console flashes 4 coloured pads; repeat the order. |

Live status for both players is shown in the top-left tracker, so you can see
whether your partner is on their pad without asking.

---

## The campaign

| # | Level | What it is |
| --- | --- | --- |
| 1 | Training Grounds | An NPC trainer walks both of you through move, sprint, jump, slide, wall jump and shoot. Each drill clears only when **both** players have done it. |
| 2 | Village Hub | Quest giver, cosmetic shopkeeper, hint giver. One Hold Interact task. Revisited between every fight. |
| 3 | Gunfight Arena | Three waves of gunmen. Defend & Explore: one holds the generator, the other runs the relay up the east ramp. |
| 4 | Swordfight Corridor | Armoured guards that shrug off bullets — use the sword. Synced Switch opens the exit. |
| 5 | Slide & Jump Gauntlet | No combat. Ramps, gaps, wall-jump shaft, slide-under bars. Fetch & Deliver the core. Falling resets you to a checkpoint. |
| 6 | Zombie Horde Survival | Six escalating waves around a central keep with four ramps. A Hold Interact task activates at wave 4. |
| 7 | The Broadcast | Defend & Explore plus Pattern Match, with three combat waves running underneath. |

You return to the hub before each fight to spend currency and get a hint.

---

## NPCs and currency

Coin comes from kills and completed tasks — small flat amounts, no economy.
The shopkeeper sells **colours only**; nothing on sale changes a stat, so
there is no balance to get wrong. The hint giver returns one short, concrete
sentence about what you are currently stuck on, on a 25-second cooldown.

---

## Architecture

```
shared/          imported by BOTH the browser and the server
  constants.js     movement tuning, weapon stats, enemy stats, cosmetics
  levels.js        every level as data: boxes, ramps, tasks, waves, NPCs
  collision.js     AABB collider + raycasting
server/
  index.js         express + socket.io, serves the client and shared modules
  rooms.js         room codes, 2-player cap, the shared 20 Hz tick
  game.js          the authoritative simulation
client/
  index.html, css/style.css
  js/main.js       boot, state machine, frame loop
  js/player.js     kinematic movement (Node-importable, so it is tested)
  js/world.js      scene building, level geometry, task props
  js/weapons.js    viewmodels, ammo, the local half of shooting
  js/actors.js     blocky humanoids for players, enemies and NPCs
  js/fx.js, hud.js, net.js, input.js
test/
  campaign.test.js full campaign run against the real GameRoom
  movement.test.js real movement against real level colliders
```

**One authority.** The server decides every outcome two clients could disagree
about: enemy positions, who got hit, how much damage, whether a task is
complete, and when the level advances. Clients send intent (`I fired along this
ray`, `I am holding E`) and render what comes back. Clients own only their own
position, which keeps movement responsive without needing reconciliation.

**`shared/` is shared literally.** The browser and Node import the same
`collision.js`, so the two sides can never disagree about where a wall is. The
same file resolves as `/shared/collision.js` over HTTP and as a relative path in
Node.

**Simulation clock.** Every gameplay timer reads a `clock` advanced only by
`tick(dt)`, never `Date.now()`. That makes the whole sim deterministic and
testable — `campaign.test.js` runs an entire 11-stage campaign in milliseconds.

---

## Deploying

The server is a single Node process serving both the API and the static client,
so anywhere that runs Node works — Render, Railway, Fly, Glitch.

- Build command: `npm install`
- Start command: `npm start`
- The server listens on `process.env.PORT`, falling back to 3000.

Nothing is persisted, so no database or volume is needed. Rooms live in memory
and disappear when the process restarts. Sticky sessions are only relevant if
you run more than one instance — with a single instance, none of it applies.
