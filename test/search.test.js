import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, query, tokenize } from '../src/search.js';
import { parse, serialize } from '../src/frontmatter.js';
import { globToRegex, pathMatches } from '../src/util.js';

test('tokenize drops stopwords and stems plurals', () => {
  assert.deepEqual(tokenize('The Databases and caching'), ['database', 'cach']);
});
test('BM25 ranks title matches above body matches', () => {
  const idx = buildIndex([{ id: 'a', title: 'Use Postgres', tags: '', text: 'database' }, { id: 'b', title: 'Logging', tags: '', text: 'we once mentioned postgres' }]);
  const r = query(idx, 'postgres');
  assert.equal(r[0].id, 'a'); assert.equal(r.length, 2);
  assert.deepEqual(query(idx, 'kubernetes'), []);
});
test('frontmatter round-trips and tolerates hand-written YAML', () => {
  const t = serialize({ id: 'D-0001', tags: ['a', 'b'], title: 'x: "y"' }, '# body');
  assert.deepEqual(parse(t).meta, { id: 'D-0001', tags: ['a', 'b'], title: 'x: "y"' });
  assert.deepEqual(parse('---\r\nstatus: accepted\r\ntags: [db, perf]\r\n---\r\nhi').meta, { status: 'accepted', tags: ['db', 'perf'] });
});
test('globs and Windows paths match', () => {
  assert.ok(globToRegex('src/**/*.ts').test('src/a/b/c.ts'));
  assert.ok(globToRegex('src/**/*.ts').test('src/c.ts'));
  assert.ok(pathMatches('src/db', 'src\\db\\pool.js'));
  assert.ok(!pathMatches('src/db', 'src/dbx/pool.js'));
});
