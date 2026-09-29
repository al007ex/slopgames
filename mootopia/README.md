# Mootopia

A cosy top-down gather, build and fight `.io` game in the classic 2015 mould:
chop trees and mine rock, age up, build a windmill village, and defend it
from other players, wolves, boars and a boss bear.

```bash
npm install
npm start
```

Then open <http://localhost:3600>. `npm test` runs the test suite (about 350
checks, a couple of minutes).

## Controls

| | |
| --- | --- |
| Move | <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or arrows |
| Aim | mouse |
| Hit, or place what you are holding | click or <kbd>Space</kbd> |
| Pick a tool or item | <kbd>1</kbd>–<kbd>9</kbd> or click the hotbar |
| Food / trap or pad / spikes | <kbd>Q</kbd> / <kbd>F</kbd> / <kbd>V</kbd> |
| Auto-hit | <kbd>E</kbd> |
| Lock aim | <kbd>X</kbd> |
| Ping your clan | <kbd>R</kbd> |
| Chat | <kbd>Enter</kbd> |

## What is in it

- A 14,400-unit map: snow along the top, desert along the bottom, a river
  through the middle with a current, and grassland between.
- Wood, food, stone and gold. Ages 1–100 with an upgrade pick at each of
  ages 2–9: 16 weapons (primaries and secondaries) with gold, diamond and
  ruby finishes earned by use, and 23 buildings (walls, spikes, windmills,
  mines, saplings, traps, pads, turrets, platforms, blockers, teleporters,
  spawn pads).
- Nine hats bought with gold, each with its own effect, and the clown hat
  for anyone caught eating straight after every hit.
- Clans, chat, a leaderboard, a minimap with clan-mates and pings.
- Deer, foxes, wolves, boars, tuskers, a boss bear and a treasure chest.
- Bots that fill a quiet server and step aside as real players arrive.

## How it works

- **Server** (`server/`): authoritative, 9 ticks a second, like the classic
  games. Each player is sent only what is on their screen.
- **Wire** (`shared/protocol.js`): binary, on typed arrays. One-byte
  opcodes, u16 positions and angles, and one batched frame per tick. A
  crowded 40-player screen costs each player about 5.5 KB/s.
- **Smooth PvP** (`client/js/predict.js`): your own movement is predicted
  with the server's exact step (`shared/physics.js`) and reconciled when
  the server answers. Everyone else is drawn from a short snapshot buffer.
  Your melee swing starts on the click.
- **True sizes** (`shared/sprites.js`): all the art is drawn with one pen,
  an outline 8 pixels thick, so every sprite is drawn at 0.5 world units
  per pixel and every outline on screen matches. Hitboxes are measured
  from the same sprites: a circle with the area of the solid silhouette.
  After changing art, run `node tools/measure-sprites.mjs`; the tests fail
  if the table is stale. Load the game with `?hitboxes` to see every
  hitbox.

## Art

The sprites in `client/img` are from the author's own game, Mootopia. The
boar, tusker, bear, treasure chest, cactus, turret, blocker, musket,
McGrabby claw and all the ground decorations are drawn in code
(`client/js/assets.js`) with the same pen.
