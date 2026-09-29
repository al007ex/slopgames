# Sideways

Street drifting, takeovers and track drifting in one night city, in the
browser.

```bash
npm install
npm start
```

Then open <http://localhost:3207>. `npm test` runs the test suite (about 115
checks, a few seconds).

## Where

- **Downtown:** a grid of streets between lit towers, with parked cars, a
  roundabout and an empty car park. Chain slides together; sliding close to a
  wall is worth much more, and a crash throws the combo away.
- **The Pit:** the plaza where the boulevard meets Main Street. Drive into the
  ring and a takeover starts: two and a half minutes of donuts, figure eights,
  rollbacks, burnouts and limiter bangs before the sirens. The crowd's hype
  multiplies everything, and they creep closer as it builds.
- **Harbor Circuit:** a 2 km walled drift track down the boulevard. Laps are
  judged the way real drifting is: line (clipping points at the apexes and
  outer zones along the walls), angle and style.

## Controls

| | |
| --- | --- |
| Throttle / brake, hold to reverse | <kbd>W</kbd> / <kbd>S</kbd> or arrows |
| Steer | <kbd>A</kbd> <kbd>D</kbd> |
| Handbrake | <kbd>Space</kbd> |
| Clutch (tap for a clutch kick) | <kbd>Shift</kbd> |
| Two-step, from a stop | <kbd>F</kbd> |
| Shift up / down (manual) | <kbd>E</kbd> / <kbd>Q</kbd> |
| Camera · reset · horn · look back | <kbd>C</kbd> · <kbd>R</kbd> · <kbd>H</kbd> · <kbd>V</kbd> |
| Toggle gearbox · mute · pause | <kbd>T</kbd> · <kbd>M</kbd> · <kbd>Esc</kbd> |

A gamepad works too (triggers, stick, A handbrake, B clutch, X two-step,
bumpers shift), and phones get on-screen buttons.

**Moves**

- **Drift:** tap the handbrake (or kick the clutch) as you turn in, then hold
  the throttle. Steer into the corner for more angle, out of it to straighten.
- **Donut:** from a stop, hold a direction and the throttle.
- **Rollback:** at speed, *hold* the handbrake and a direction until the car is
  past sideways, then let the handbrake go and keep the direction and throttle
  held. It whips round, rolls backwards on smoking tyres and comes back round.
- **Burnout:** from a stop, throttle and brake together (the brakes lock the
  fronts only, like a line lock).
- **Flames:** clutch in and throttle to bounce off the limiter, or the
  two-step from a stop.

## How it works

- **The car** (`shared/vehicle.js`) is a two-axle rigid body at 240 Hz on
  combined-slip tyres, with an engine torque curve, turbo or supercharger,
  a clutch that can slip, a six-speed gearbox and a welded rear diff. The
  limiter cuts ignition and bounces, and cuts, lifts and upshifts raise
  afterfire pops that drive both the flames and the bangs.
- **The driver aids** (`shared/pilot.js`) are what make it easy on a keyboard.
  Steering is measured from where the car is going, not where it points, so
  hands off is automatic countersteer. A servo holds a slide at the angle
  the hands ask for and trades angle for speed the way a drifter does. A spin
  guard catches slides past saving, but steps aside when you hold the
  handbrake to commit to a rollback. *Pro* keeps a lighter guard; *Off* is
  just the tyres.
- **Doable, not just possible:** the tests drive every move with a scripted
  keyboard driver that only ever holds or taps keys ten times a second:
  drifts round 30–70 m circles on all three cars, clutch kicks, donuts,
  rollbacks, burnouts, the two-step and limiter, reverse, and twenty minutes
  of random mashing.
- **The sound** is synthesised, nothing is sampled. Every cylinder's
  exhaust pulse is fired at its crank angle into ringing pipes and a muffler
  (`client/js/audio/engine-worklet.js`), so the cross-plane V8 burbles, the
  straight six hums and the rotary buzzes. Tyres, wind, the crowd and the
  sirens are Web Audio nodes.
- **The picture** is three.js: towers with procedural windows, bloom on
  every light, pooled smoke, skid marks, exhaust flames, sparks and tail-light
  trails. The simulation is interpolated to the display rate.
- **The server** (`server/index.js`) only serves the files, answers the
  portal's health check and keeps three small score boards.
