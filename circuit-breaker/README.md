# Circuit Breaker

A neon maze tower defence. Packets enter on the left of a circuit board and walk
to your core on the right. You cannot wall the route off — only bend it — so the
game is about making the walk long, and then about heat.

```bash
cd circuit-breaker
npm start          # no dependencies to install
```

Then open <http://localhost:3300>.

## The idea

Most tower defence is placed and then watched. The twist here is **heat**: every
tower warms up as it fires, and a tower that hits the ceiling shuts down until it
has cooled off. Cheap towers run cool and reliable; the Rail Cannon and Laser Grid
run hot enough to shut themselves down on their own.

**Overclock** is the active half of that. It doubles a tower's rate of fire for
five seconds and ignores the ceiling while it runs — then the shutdown lands the
moment it ends. Spending it on the right ten seconds of a boss wave is most of
the skill in the game.

## Playing

| Input | Does |
| --- | --- |
| Click a shop card, then a cell | Build |
| Click a tower | Inspect, upgrade, overclock or sell it |
| <kbd>1</kbd>–<kbd>5</kbd> | Pick a tower |
| <kbd>Esc</kbd> | Cancel |
| <kbd>Space</kbd> | Send the next wave early, for a bonus |
| <kbd>Q</kbd> | Surge — damages and stuns everything, long cooldown |

Twenty-five waves, three of them bosses. Sending a wave early pays a bonus for
the build time you skip, which is the main way to get ahead of the curve.

### Towers

| Tower | Cost | Role |
| --- | --- | --- |
| Pulse Node | 55₡ | Cheap, fast, runs cool. Falls off against armour. |
| Cryo Vent | 95₡ | Slows a small area. Almost no damage, never overheats. |
| Arc Relay | 130₡ | Chains between three packets. Wants a crowd. |
| Rail Cannon | 175₡ | Slow, splashing, and the answer to armour. Runs hot. |
| Laser Grid | 220₡ | Ramps up the longer it holds one target. Runs hottest. |

Packets get armour as the waves go on, and armour is flat reduction — which is
what stops a wall of the cheapest tower from being the whole answer.

## Layout

```
shared/     the simulation — no DOM, no canvas, imported by the client and the tests
client/     canvas rendering, the DOM panels, input
server/     static files, /health for the portal, and a small high-score board
test/       174 assertions over the board, the balance data and the simulation
```

`shared/sim.js` is the entire game and knows nothing about a screen, which is why
`npm test` can play thousands of simulated seconds in a few hundred milliseconds.
The seeded generator in `shared/rng.js` means a run is reproducible.

```bash
npm test
```

## Notes for the portal

The game is served under `/circuit-breaker/`, so nothing here may load an absolute
path. Client modules import `#shared/…`, which Node resolves through the
`"imports"` field in `package.json` and the browser resolves through the import
map in `client/index.html`. Both land on the same files.

`/health` reports `{ ok, online }`; `online` counts browsers that have pinged
`/api/ping` in the last two minutes, which is how the portal knows whether anyone
is still playing before it puts the server to sleep.
