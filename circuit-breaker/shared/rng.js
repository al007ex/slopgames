// A small seeded generator. The simulation never calls Math.random, so a run
// with the same seed and the same inputs plays out identically — which is what
// makes test/sim.test.js able to assert on outcomes instead of on ranges.

export function makeRng(seed = 1) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
