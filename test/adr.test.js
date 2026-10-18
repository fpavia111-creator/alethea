import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DecisionStore } from '../src/store.js';
import { importAdrs, exportRecords, parseAdr } from '../src/adr.js';
import { tmpRepo } from './helpers.js';

function withAdrs() {
  const root = tmpRepo(); const d = path.join(root, 'docs', 'adr'); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, '0001-record-architecture-decisions.md'), '# 1. Record architecture decisions\n\nDate: 2024-01-02\n\n## Status\n\nAccepted\n\n## Context\n\nWe need to record decisions.\n\n## Decision\n\nWe will use ADRs.\n\n## Consequences\n\nSee Nygard.\n');
  fs.writeFileSync(path.join(d, '0002-use-rest.md'), '# 2. Use REST\n\n## Status\n\nSuperseded by [3. Use GraphQL](0003-use-graphql.md)\n\n## Context\n\nAPI style.\n\n## Decision\n\nREST.\n');
  fs.writeFileSync(path.join(d, '0003-use-graphql.md'), '---\nstatus: accepted\ndate: 2024-03-01\n---\n# Use GraphQL\n\n## Context and Problem Statement\n\nClients over-fetch.\n\n## Considered Options\n\n- REST\n- gRPC\n\n## Decision Outcome\n\nGraphQL with Apollo.\n');
  return new DecisionStore(root);
}

test('parseAdr handles Nygard and MADR', () => {
  const a = parseAdr('# 2. Use REST\n\n## Status\n\nSuperseded by [3](0003-x.md)\n\n## Decision\n\nREST\n', '0002-use-rest.md');
  assert.equal(a.title, 'Use REST'); assert.equal(a.status, 'superseded'); assert.deepEqual(a.supersededBy, [3]);
});
test('import ADRs preserves supersession and is idempotent', () => {
  const s = withAdrs();
  const dry = importAdrs(s, 'docs/adr', { dryRun: true }); assert.equal(dry.imported.length, 3); assert.equal(s.all().length, 0);
  const res = importAdrs(s); assert.equal(res.imported.length, 3);
  const [d1, d2, d3] = s.all();
  assert.equal(d1.date, '2024-01-02'); assert.equal(d1.decision, 'We will use ADRs.');
  assert.equal(d2.status, 'superseded'); assert.deepEqual(d2.superseded_by, [d3.id]); assert.deepEqual(d3.supersedes, [d2.id]);
  assert.equal(d3.decision, 'GraphQL with Apollo.'); assert.match(d3.alternatives, /gRPC/); assert.equal(d3.source, 'docs/adr/0003-use-graphql.md');
  assert.equal(importAdrs(s).skipped.length, 3);
  assert.throws(() => importAdrs(s, 'nope'), /not found/);
});
test('export markdown and JSON', () => {
  const s = withAdrs(); importAdrs(s);
  const md = exportRecords(s, 'markdown'); assert.match(md, /\| D-0002 \| decision \| Use REST \| superseded/); assert.match(md, /### Decision\n\nGraphQL/);
  const j = JSON.parse(exportRecords(s, 'json')); assert.equal(j.count, 3); assert.equal(j.records[2].supersedes[0], 'D-0002');
  assert.equal(JSON.parse(exportRecords(s, 'json', { includeInactive: false })).count, 2);
  assert.throws(() => exportRecords(s, 'xml'), /format/);
});
