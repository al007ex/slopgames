# Design notes

What actually shipped, what changed on the way, and what I would not trust yet.

---

## What made it in

Everything in the brief's priority order landed, plus the optional items:

- **Room/lobby flow** — 4-character codes, hard 2-player cap, ready toggles,
  start gated on both slots filled and both ready, play-again, minimal
  reconnect (pause + rejoin with the same code).
- **Movement kit** — WASD, mouse look, sprint with FOV kick, slide (low hitbox,
  slides under obstacles), jump, wall jump, crouch, ADS. Plus coyote time and
  jump buffering, which are not in the brief but are the difference between
  "sweaty" and "sticky".
- **Combat** — hitscan rifle and shotgun with reload and visible ammo, sword
  with swing and right-click block. Server-authoritative hit registration.
- **All five co-op task mechanics**, one per task, seven tasks across the
  campaign.
- **Seven levels plus an end screen**, with hub returns before every fight.
- **NPCs and currency** — quest giver, cosmetic-only shopkeeper, hint giver on
  a cooldown.
- **Hints everywhere** — persistent objective line, live per-player task
  status, waypoint arrow that clamps to the screen edge, and an in-world
  objective beacon.
- **Juice** — muzzle flash, tracers, impact and blood particles, hit markers,
  damage numbers, screen shake, sword arc, camera roll on slides.

### Deliberately left out

- **No inventory** beyond a coin counter and an unlocked-colours list.
- **No procedural generation.** Every level is hand-placed primitives.
- **One enemy AI script.** Dummies, gunmen, brutes, swordsmen, zombies and
  runners differ only by the stats block in `shared/constants.js` — health,
  speed, damage, range, cooldown, colour, scale, and a `ranged` flag. There is
  no second code path.
- **No skill trees, stat upgrades or crafting.**
- **No physics engine.** Custom kinematic movement against an AABB collider.
  This was the right call: it made the movement testable in Node and made
  "why did I get stuck here" answerable by reading forty lines.

---

## Decisions worth recording

**The client owns its own position.** The brief requires one authority for hit
registration and task completion, not for movement. Letting each client own its
own transform removes the entire class of prediction/reconciliation bugs, at the
cost of trusting players about where they stand. For a two-player co-op game
with no leaderboard, that trade is free. The server still validates *proximity*
for every task action, so you cannot flip a switch from across the map.

**Exit zones are boxes, not radii.** The first version used a radius around a
point behind each gate. A player pressed against a closed gate could be inside
that radius, so levels completed themselves. Boxes placed behind the gate line
fixed it.

**A separate scene for the viewmodel.** The gun was a child of the world camera
at first. At a 95° FOV the grip sits ~7 cm from the lens and fills a quarter of
the screen. The viewmodel now renders in its own scene with a fixed 58° camera
on a cleared depth buffer, which also means the FOV slider and sprint kick no
longer warp the weapon. Every viewmodel is modelled with its origin at the rear
so nothing can poke behind the near plane.

**One simulation clock.** Gameplay timers originally read `Date.now()` while
everything else advanced on `dt`. It worked in production only because the tick
happens to run on a real interval. Now everything reads a `clock` advanced by
`tick(dt)`, which made an entire 11-stage campaign testable in milliseconds.

**Falling in the gauntlet keeps your core.** Dropping it would mean re-climbing
the wall-jump shaft after one missed jump. Keeping it costs nothing and keeps
the level finishable.

---

## Bugs the tests caught

Worth listing because none were visible from screenshots:

- **The arena relay was unreachable.** Its ramp rose to the catwalk's *base*
  (4.5) rather than its *top* (5.0). With the player's 0.42 collider radius they
  meet the catwalk edge while still at 4.38 — a 0.62 step against a 0.55 limit.
  The Defend & Explore task, and therefore the level, could not be completed.
- **Slides were too short to slide under anything.** At the original friction a
  slide died after ~0.35 s, well before crossing the bar it was designed for.
  Now ~0.88 s.
- **A perfect wall-jump chain peaked 1 cm below the gauntlet's core ledge.**
  Four jumps at a slightly stronger impulse now clears it with margin.
- **Enemy attacks never landed in simulated time** — the `Date.now()` problem
  above.
- **The first shot of every run was silently swallowed** by the rate limiter,
  because the clock and `lastShotAt` both started at zero.
- **Shared materials were cached by colour**, so recolouring one task console
  would have recoloured every box that happened to share its colour.

---

## Known limits

- **Reconnect is minimal, as the brief allows.** The run pauses and any player
  can take the empty slot with the room code — there is no identity check, so
  a stranger with your code could take a dropped partner's place. Fine for a
  4-character code shared between friends; not fine if this were public.
- **Rooms are in memory.** A server restart drops every run in progress.
- **A backgrounded tab stops simulating.** Browsers pause `requestAnimationFrame`
  in hidden tabs, so a player who switches away freezes in place while the
  server keeps running. Normal for browser games, but it means you cannot test
  two clients in one window.
- **Enemy pathing is deliberately dumb** — move toward the nearest player, and
  if blocked, strafe along the obstacle for a moment. It works because the
  arenas are open and the horde keep has four ramps. It would not survive a
  maze-shaped level.
- **No audio.** Not in the brief, and it was the honest thing to cut to keep
  everything else solid.
- **Untested by hand.** The campaign logic and movement are covered by 118
  automated assertions, and every level has been rendered and inspected, but
  two humans have not sat down and played it start to finish. The feel of the
  gunplay in particular — recoil, rate of fire, wave pacing — is tuned by
  reasoning, not by playing, and is the first thing I would revisit.
