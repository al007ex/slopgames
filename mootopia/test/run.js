// Runs every milestone's tests in order and prints a total.

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { state } from './harness.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv[2];
const files = readdirSync(dir).filter((f) => /^m\d+\.test\.js$/.test(f)).sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
let passed = 0; let failed = 0;
for (const f of files) {
  if (only && !f.startsWith(only)) continue;
  console.log(`\n━━ ${f}`);
  state.passed = 0; state.failed = 0;
  await import(path.join(dir, f));
  console.log(`\n${state.passed} passed, ${state.failed} failed`);
  passed += state.passed; failed += state.failed;
}
console.log(`\n━━ total: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
