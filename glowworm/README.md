# Glowworm

A multiplayer neon snake game in the slither.io mould. Eat glowing pellets to
grow, cut other worms off so their heads hit your body, and turn the ones you
catch into a trail of food. Plays with a mouse, a keyboard or a touchscreen.

```bash
cd glowworm
npm install
npm start
```

Then open <http://localhost:3400> — in two windows to see each other.

## Playing

| | Desktop | Phone / tablet |
| --- | --- | --- |
| Steer | Point with the mouse, or ←/→ (A/D) | Drag anywhere — a joystick appears under your thumb |
| Boost | Hold a mouse button, or Space / ↑ / W | Hold ⚡, or put a second finger down |

Your own body never kills you; everyone else's does, and so does the red edge
of the arena. Two worms can never take each other out: you only die if your
head is in the body of a worm that is still alive, so in a head-on — or when
two heads cross into each other's bodies — the smaller worm dies and the bigger
one survives (a coin settles an exact tie).

Boosting costs length and drops it behind you as food, so a boosting worm is
worth chasing. Around thirty bots with deliberately stupid names keep the arena
busy, and they step aside as people join.

## How it is built

```
shared/   rules and tuning, the binary wire protocol, a seeded RNG
server/   the world simulation, bot AI, a spatial grid, and the socket server
client/   canvas renderer, interpolation, input, and the DOM around it
test/     227 assertions: protocol, simulation, client timing, input, end-to-end
```

- **Server-authoritative.** Clients only ever send a heading and whether they
  are boosting; movement, eating and every collision are decided on the server,
  at 30 ticks a second.
- **Binary and frugal.** Snapshots go out 15 times a second and carry only the
  snakes on your screen. Body points travel as int8 offsets from the previous
  point, quantised against the *reconstructed* point so rounding cannot build up
  down a long tail — about two bytes a point. A spectator costs tens of KB/s.
- **Smooth despite that.** The client renders about 100 ms in the past and
  blends between the snapshots either side, locking its clock to the fastest
  recent arrival so jitter does not show. Events (food eaten, deaths) are
  tick-stamped and wait for that clock, so a pellet vanishes when the head that
  ate it actually reaches it on screen.
- **Cheap to draw.** Each snake is one path stroked a few times — shadow,
  outline, body, bands, shine — rather than hundreds of circles, and pellets are
  pre-rendered glow sprites blended additively. That keeps a crowded screen at
  60 fps on a phone.

```bash
npm test
```

## Notes for the portal

The game is served under `/glowworm/`, so nothing loads from an absolute path.
The socket URL is resolved relative to the page (`ws` → `/glowworm/ws`), and
client modules import `#shared/…`, which Node resolves through the `"imports"`
field in `package.json` and the browser through the import map in
`client/index.html`.

`/health` reports `{ ok, online, playing, snakes }`. `online` counts open
sockets, which is what tells the portal someone is still here before it puts the
server to sleep.
