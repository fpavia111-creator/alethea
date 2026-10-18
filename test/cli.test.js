import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run } from '../src/cli.js';
import { tmpRepo } from './helpers.js';

const BIN = fileURLToPath(new URL('../bin/adm.js', import.meta.url));

test('help and unknown command', async () => {
  assert.match((await run(['--help'])).out, /Alethea of Agents/);
  assert.equal((await run([])).code, 2);
  assert.equal((await run(['bogus', '--root', tmpRepo()])).code, 2);
  assert.equal((await run(['record', '--nope'])).code, 2);
});
test('init, record, list, show, search, status', async () => {
  const root = tmpRepo(); const R = ['--root', root];
  assert.equal((await run(['init', ...R])).code, 0); assert.ok(fs.existsSync(path.join(root, '.decisions', '.gitignore')));
  const r = await run(['record', ...R, '--title', 'Use Vitest', '--decision', 'Vitest for unit tests', '--alternative', 'Jest', '--alternative', 'Mocha', '--file', 'test/**', '--req', 'testing/runner', '--tag', 'tests']);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /Recorded D-0001/);
  assert.match((await run(['list', ...R])).out, /D-0001 {2}\[accepted\] Use Vitest {2}-> testing\/runner/);
  assert.match((await run(['show', 'D-0001', ...R])).out, /## Alternatives\n\n- Jest\n- Mocha/);
  const s = JSON.parse((await run(['search', 'vitest', 'unit', ...R, '--json'])).out); assert.equal(s[0].id, 'D-0001');
  assert.equal((await run(['status', 'D-0001', 'deprecated', ...R])).code, 0);
  assert.match((await run(['list', ...R])).out, /\(none\)/); assert.match((await run(['list', '--all', ...R])).out, /deprecated/);
  assert.equal((await run(['show', 'D-0042', ...R])).code, 1);
  assert.equal((await run(['record', ...R, '--title', 'x'])).code, 1);
});
test('context, constraints, check (exit codes), supersede, link', async () => {
  const root = tmpRepo(); const R = ['--root', root];
  await run(['record', ...R, '--title', 'Fetch via ky', '--decision', 'Use ky HTTP client', '--file', 'src/api/**']);
  await run(['record', ...R, '--type', 'constraint', '--title', 'No axios', '--decision', 'Bundle size budget', '--rule', 'forbid: axios']);
  const ctx = await run(['context', '--task', 'add retry to http client', '--file', 'src/api/user.ts', ...R]);
  assert.match(ctx.out, /C-0001/); assert.match(ctx.out, /D-0001 .*file scope matches/);
  assert.match((await run(['constraints', ...R])).out, /forbid: axios/);
  const bad = await run(['check', '--change', 'import axios from "axios"', ...R]); assert.equal(bad.code, 1); assert.match(bad.out, /ERROR C-0001/);
  fs.writeFileSync(path.join(root, 'plan.txt'), 'use ky');
  assert.equal((await run(['check', '--change-file', path.join(root, 'plan.txt'), ...R])).code, 0);
  const sup = await run(['supersede', 'D-0001', '--title', 'Native fetch', '--decision', 'Node 20 has fetch', ...R]); assert.match(sup.out, /D-0002; D-0001 is now superseded/);
  const ln = await run(['link', 'D-0002', '--req', 'api/retries', '--commit', 'abc1234', '--test', 'test/api.test.ts', ...R, '--json']);
  assert.equal(ln.code, 0); assert.deepEqual(JSON.parse(ln.out).record.requirements, ['api/retries']); assert.match(ln.err, /does not exist/);
});
test('import and export', async () => {
  const root = tmpRepo(); const R = ['--root', root];
  fs.mkdirSync(path.join(root, 'docs', 'adr'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'adr', '0001-use-go.md'), '# 1. Use Go\n\n## Status\n\nAccepted\n\n## Decision\n\nGo.\n');
  assert.match((await run(['import', ...R])).out, /Imported 1/);
  const out = path.join(root, 'log.json');
  await run(['export', '--format', 'json', '--out', out, ...R]); assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).records[0].title, 'Use Go');
  assert.match((await run(['export', ...R])).out, /# Decision log/);
});
test('bin/adm.js runs as a real process', () => {
  const root = tmpRepo();
  execFileSync(process.execPath, [BIN, 'record', '--root', root, '--type', 'constraint', '--title', 'No eval', '--decision', 'Security', '--rule', 'forbid: eval']);
  const p = spawnSync(process.execPath, [BIN, 'check', '--root', root, '--change', 'eval(x)'], { encoding: 'utf8' });
  assert.equal(p.status, 1); assert.match(p.stdout, /No eval/);
});
