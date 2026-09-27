// Runs every milestone's test file in order, each in its own process, and adds
// up the tallies. `node test/run.js m3` runs only files whose name contains m3.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || '';
const files = readdirSync(here).filter((f) => f.endsWith('.test.js') && f.includes(filter))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

let passed = 0, failed = 0, crashed = 0;
for (const file of files) {
  console.log(`\n━━ ${file}`);
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, file)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
    child.on('exit', (c) => {
      const m = out.match(/(\d+) passed, (\d+) failed\s*$/);
      if (m) { passed += Number(m[1]); failed += Number(m[2]); } else crashed++;
      resolve(c);
    });
  });
  if (code && !failed) crashed++;
}
console.log(`\n━━ total: ${passed} passed, ${failed} failed${crashed ? `, ${crashed} file(s) crashed` : ''}`);
if (failed || crashed) process.exitCode = 1;
