// Shared assertions for the three test files, so each of them is only the
// interesting part.

export const state = { passed: 0, failed: 0 };

export const ok = (cond, label, extra = '') => {
  if (cond) { state.passed++; console.log(`  ✓ ${label}`); }
  else { state.failed++; console.log(`  ✗ ${label}${extra ? `  — ${extra}` : ''}`); }
};

export const eq = (actual, expected, label) =>
  ok(actual === expected, label, `expected ${expected}, got ${actual}`);

export const near = (actual, expected, tolerance, label) =>
  ok(Math.abs(actual - expected) <= tolerance, label, `expected ~${expected}, got ${actual}`);

export const section = (name) => console.log(`\n${name}`);

export function report() {
  console.log(`\n${state.passed} passed, ${state.failed} failed`);
  if (state.failed) process.exit(1);
}
