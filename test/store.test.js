import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DecisionStore, parseRule, specgateRequirementIds } from '../src/store.js';
import { tmpRepo, writeSpec } from './helpers.js';

function seeded() {
  const s = new DecisionStore(tmpRepo());
  s.record({ title: 'Use Postgres for persistence', context: 'Need relational data', decision: 'Use PostgreSQL via pg', alternatives: ['MongoDB: no joins', 'SQLite'], consequences: 'Need a DB container', files: ['src/db/**'], requirements: ['storage/persistence'], tags: ['database'] });
  s.record({ type: 'constraint', title: 'No moment.js', decision: 'Use date-fns; moment is deprecated and heavy', rules: ['forbid: moment', 'forbid: /require\\([\'"]moment/'], files: ['src/**'] });
  s.record({ type: 'constraint', title: 'Never edit generated code', decision: 'Generated client is rebuilt from schema', rules: ['forbid-path: src/generated/**'] });
  return s;
}

test('record_decision writes readable markdown with frontmatter and sections', () => {
  const s = seeded();
  const files = fs.readdirSync(s.dir);
  assert.ok(files.includes('D-0001-use-postgres-for-persistence.md'));
  const txt = fs.readFileSync(path.join(s.dir, 'D-0001-use-postgres-for-persistence.md'), 'utf8');
  assert.match(txt, /^---\nid: "D-0001"/); assert.match(txt, /## Alternatives\n\n- MongoDB: no joins/);
  const r = s.get('d-0001');
  assert.equal(r.status, 'accepted'); assert.deepEqual(r.requirements, ['storage/persistence']); assert.equal(r.decision, 'Use PostgreSQL via pg');
  assert.equal(s.get('C-0001').type, 'constraint');
});
test('record validates input', () => {
  const s = new DecisionStore(tmpRepo());
  assert.throws(() => s.record({ title: 'x' }), /decision text/);
  assert.throws(() => s.record({ title: 'x', decision: 'y', requirements: ['Bad Id'] }), /SpecGate format/);
  assert.throws(() => s.record({ title: 'x', decision: 'y', status: 'maybe' }), /status/);
  assert.throws(() => s.record({ type: 'constraint', title: 'x', rules: ['ban: y'] }), /Invalid rule/);
});
test('search_decisions ranks and hides superseded by default', () => {
  const s = seeded();
  assert.equal(s.search('postgres database')[0].id, 'D-0001');
  s.supersede('D-0001', { title: 'Use SQLite for persistence', decision: 'Embedded SQLite is enough' });
  assert.ok(!s.search('postgres').some((r) => r.id === 'D-0001'));
  assert.ok(s.search('postgres', { includeInactive: true }).some((r) => r.id === 'D-0001'));
  assert.ok(fs.existsSync(s.indexFile));
});
test('get_context_for_task combines file scope and text relevance', () => {
  const s = seeded();
  const c = s.contextForTask({ task: 'add a connection pool', path: 'src/db/pool.js' });
  assert.equal(c.decisions[0].id, 'D-0001'); assert.ok(c.decisions[0].why.includes('file scope matches'));
  assert.deepEqual(c.constraints.map((x) => x.id).sort(), ['C-0001', 'C-0002']);
  assert.deepEqual(c.requirements, ['storage/persistence']);
  const other = s.contextForTask({ path: 'docs/readme.md' });
  assert.deepEqual(other.constraints.map((x) => x.id), ['C-0002']); assert.equal(other.decisions.length, 0);
});
test('supersede_decision cross-links and carries scope', () => {
  const s = seeded();
  const n = s.supersede('D-0001', { title: 'Use SQLite', decision: 'SQLite' });
  assert.equal(n.id, 'D-0002'); assert.deepEqual(n.supersedes, ['D-0001']); assert.deepEqual(n.files, ['src/db/**']);
  const old = s.get('D-0001'); assert.equal(old.status, 'superseded'); assert.deepEqual(old.superseded_by, ['D-0002']);
  assert.throws(() => s.supersede('D-0001', { title: 'x', decision: 'y' }), /already superseded/);
  assert.throws(() => s.supersede('D-0099', { title: 'x', decision: 'y' }), /No decision/);
});
test('list_constraints filters by path and status', () => {
  const s = seeded();
  assert.equal(s.constraints().length, 2);
  assert.deepEqual(s.constraints({ path: 'README.md' }).map((c) => c.id), ['C-0002']);
  s.setStatus('C-0002', 'deprecated');
  assert.equal(s.constraints().length, 1); assert.equal(s.constraints({ includeInactive: true }).length, 2);
});
test('check_conflicts flags forbid, forbid-path and rejected alternatives', () => {
  const s = seeded();
  const bad = s.checkConflicts({ change: "const m = require('moment')", files: ['src/app.js'] });
  assert.equal(bad.ok, false); assert.equal(bad.conflicts.length, 2); assert.equal(bad.conflicts[0].id, 'C-0001');
  assert.equal(s.checkConflicts({ change: 'using momentum scrolling', files: ['src/app.js'] }).ok, true, 'word boundary');
  assert.equal(s.checkConflicts({ change: 'moment', files: ['scripts/x.js'] }).ok, true, 'out of scope');
  const gen = s.checkConflicts({ change: 'regenerate', files: ['src/generated/client.ts'] });
  assert.equal(gen.conflicts[0].id, 'C-0002');
  const alt = s.checkConflicts({ change: 'Switch storage to MongoDB', files: ['src/db/x.js'] });
  assert.equal(alt.ok, true); assert.equal(alt.warnings[0].id, 'D-0001');
  s.record({ type: 'constraint', title: 'Draft rule', status: 'proposed', rules: ['forbid: lodash'] });
  const w = s.checkConflicts({ change: 'import lodash' }); assert.equal(w.ok, true); assert.equal(w.conflicts[0].severity, 'warning');
});
test('require rule', () => {
  assert.equal(parseRule('require: @req').test('add feature', []), 'missing required "@req"');
  assert.equal(parseRule('require: @req').test('// @req a/b', []), null);
});
test('link_requirement validates against SpecGate specs, tests and commits', () => {
  const s = seeded();
  writeSpec(s.root, 'storage', '# Storage\n\n### Requirement: Durable writes\nSHALL.\n\n#### Scenario: Crash during write\n- WHEN x\n');
  fs.mkdirSync(path.join(s.root, 'test')); fs.writeFileSync(path.join(s.root, 'test', 'db.test.js'), '');
  const ids = specgateRequirementIds(s.root);
  assert.ok(ids.has('storage/durable-writes#crash-during-write'));
  const { record, warnings } = s.link('D-0001', { requirement: ['storage/durable-writes', 'storage/nope'], tests: ['test\\db.test.js'], commits: ['abc1234'] });
  assert.deepEqual(record.requirements, ['storage/persistence', 'storage/durable-writes', 'storage/nope']);
  assert.deepEqual(record.tests, ['test/db.test.js']); assert.deepEqual(record.commits, ['abc1234']);
  assert.equal(warnings.length, 1); assert.match(warnings[0], /storage\/nope/);
  assert.throws(() => s.link('D-0001', { commits: ['not-a-sha'] }), /hex sha/);
  assert.throws(() => s.link('D-0001', { requirement: 'NoSlash' }), /SpecGate/);
});
test('reads SpecGate 0.3 repo specs when available', { skip: !fs.existsSync('/workspace/specgate-0.3/openspec') }, () => {
  const ids = specgateRequirementIds('/workspace/specgate-0.3');
  assert.ok(ids.has('gate/coverage-gate'));
});
test('hand-edited files are picked up and index refreshes', () => {
  const s = seeded();
  const f = path.join(s.dir, s.get('D-0001').file);
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('Use PostgreSQL via pg', 'Use PostgreSQL via pg with pgbouncer') + '\n');
  assert.equal(s.search('pgbouncer')[0].id, 'D-0001');
});
