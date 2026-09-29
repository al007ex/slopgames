// Runs every test file in order and prints a total. `npm test physics` runs one.

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { state } from './harness.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv[2];
const files = readdirSync(dir).filter((f) => /^\d+-.+\.test\.js$/.test(f)).sort();
let passed = 0; let failed = 0;
for (const f of files) {
  if (only && !f.includes(only)) continue;
  console.log(`\n━━ ${f}`);
  state.passed = 0; state.failed = 0;
  await import(path.join(dir, f));
  console.log(`\n${state.passed} passed, ${state.failed} failed`);
  passed += state.passed; failed += state.failed;
}
console.log(`\n━━ total: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
