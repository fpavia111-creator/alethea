import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveRoot } from '../src/store.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'));

test('renamed to Alethea of Agents; adm commands kept', () => {
  assert.equal(pkg.name, '@kurtfrancisco/alethea');
  assert.equal(pkg.bin.alethea, 'bin/adm.js');
  assert.equal(pkg.bin['alethea-mcp'], 'bin/adm-mcp.js');
  assert.equal(pkg.bin.adm, 'bin/adm.js');
  assert.equal(pkg.bin['adm-mcp'], 'bin/adm-mcp.js');
  const r = spawnSync(process.execPath, [path.join(here, '..', 'bin', 'adm.js'), '--help'], { encoding: 'utf8' });
  assert.match(r.stdout + r.stderr, /Alethea of Agents/);
});
test('ALETHEA_ROOT preferred, ADM_ROOT still works', () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'al-')), b = fs.mkdtempSync(path.join(os.tmpdir(), 'al-'));
  const save = { ...process.env };
  try {
    process.env.ADM_ROOT = a; delete process.env.ALETHEA_ROOT;
    assert.equal(resolveRoot(), path.resolve(a));
    process.env.ALETHEA_ROOT = b;
    assert.equal(resolveRoot(), path.resolve(b));
  } finally { process.env = save; }
});
