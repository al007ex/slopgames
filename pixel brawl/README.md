# Pixel Brawl

A 2D pixel-art arena brawler in the spirit of the Brawl Stars beta, built as an
io-style web game. Accounts, trophies, brawler cards, boxes, upgrades, bots,
parties and four game modes — all in the browser, on phone or desktop.

```bash
npm install
npm run dev      # http://localhost:5173
```

For a single-process production server:

```bash
npm run preview  # builds the client, then serves it from the game server on :8080
```

## Modes

| Mode | Players | Rules |
| --- | --- | --- |
| **Gem Grab** | 3v3 | Hold 10 gems through a 15s countdown. Dying drops your gems. |
| **Showdown** | 8 FFA | Last brawler standing. Crates drop power cubes; poison closes in. |
| **Bounty** | 2v2 | Knockouts award the victim's star value. Most stars when time runs out. |
| **Duel** | 1v1 | Three lives each. |

Every mode can be queued **vs AI** (fills instantly) or **vs players** (real
matchmaking; bots top off the lobby after 9 seconds). Trophies count either way.
Parties of up to 4 queue together and are kept on the same team.

## Architecture

```
shared/     sim.ts, ai.ts, brawlers.ts, maps.ts   — runs on both sides
server/     express + ws, JSON-backed accounts, matchmaking, match rooms
src/        canvas renderer, HUD, controls, DOM menus, procedural pixel art
scripts/    simtest.ts — headless soak test
```

**Server-authoritative.** `shared/sim.ts` is the only source of truth for
movement, damage and scoring. Rooms tick it at 20 Hz and send each client a
snapshot built for *that* player — brawlers hidden in bushes are stripped
server-side, so a modified client cannot see them. Clients send input at 30 Hz
on an interval independent of the render loop, interpolate other entities with a
110 ms buffer, and locally predict their own movement with reconciliation.

AI matches and human matches run the exact same code path; bots are just slots
driven by `shared/ai.ts` (BFS pathfinding, aim leading, kiting to each brawler's
preferred range, projectile dodging, mode-specific objectives). If a human
disconnects mid-match, the AI takes over their brawler so the game stays fair.

**All art is generated at runtime** from palette-indexed character maps in
`src/art/sprites.ts` — 18 brawlers, environment tiles, items and a 5×7 bitmap
font. There are no image files, which is why the whole client is ~29 KB gzipped.
Sound is synthesised with WebAudio. The world renders to a low-resolution
offscreen buffer at an integer scale and is blitted up, so pixels stay crisp at
any resolution or device pixel ratio.

## Progression

18 brawlers across six rarities. Boxes drop cards (power points), coins, gems
and new brawlers; 20→550 cards and 20→1250 coins take a brawler from power 1 to
9, worth +40% health and damage. Trophies are per-brawler and follow the beta's
ladder — gains shrink and losses grow as you climb, with no losses under 50
trophies. A 22-stop trophy road pays out boxes, gems and brawlers.

## Controls

- **Desktop** — WASD to move, mouse to aim, left click to shoot, right click or
  Shift for your Super.
- **Phone** — left half of the screen is a floating move stick. Drag the attack
  button to aim and release to fire, or tap it to auto-aim. Same for Super.

## Testing

```bash
npm run typecheck
npx tsx scripts/simtest.ts
```

`simtest.ts` plays full bot matches in every mode plus a 40-map sweep, checking
that matches conclude, bots engage, ranks are assigned and no map generation
stalls. A full match simulates in ~40 ms.

## Notes

Passwords are bcrypt-hashed and sessions use HMAC-signed tokens. Accounts live in
`data/accounts.json` (gitignored), written atomically — swap `server/store.ts`
for a real database if you want to run this for more than a few friends.
