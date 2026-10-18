// "Build" = syntax-check every source file and verify the package imports. No transpile step.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const files = ['bin', 'src', 'scripts', 'test'].flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.js')).map((f) => path.join(d, f)));
for (const f of files) execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
await import('../src/index.js');
for (const f of ['skills/agent-decision-memory/SKILL.md', 'README.md', 'LICENSE']) if (!fs.existsSync(f)) throw new Error(`missing ${f}`);
console.log(`build ok: ${files.length} files checked`);
