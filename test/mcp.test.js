import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer } from '../src/server.js';
import { tmpRepo, writeSpec } from './helpers.js';

let client, root;
const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }); return { ...r, data: r.isError ? null : JSON.parse(r.content[0].text) }; };

before(async () => {
  root = tmpRepo();
  writeSpec(root, 'auth', '### Requirement: Session tokens\nSHALL.\n');
  const { server } = createServer(root);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: 'test', version: '1' }); await client.connect(b);
});
after(() => client?.close());

test('lists all seven tools and the constraints resource', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['check_conflicts', 'get_context_for_task', 'link_requirement', 'list_constraints', 'record_decision', 'search_decisions', 'supersede_decision']);
  const { resources } = await client.listResources();
  assert.ok(resources.some((r) => r.uri === 'adm://constraints/active'));
});
test('record_decision tool', async () => {
  const r = await call('record_decision', { title: 'JWT sessions', decision: 'Use short-lived JWTs', alternatives: ['Server sessions'], files: ['src/auth/**'] });
  assert.equal(r.data.id, 'D-0001');
  const c = await call('record_decision', { type: 'constraint', title: 'No localStorage tokens', decision: 'Tokens live in httpOnly cookies', rules: ['forbid: localStorage'], files: ['src/**'] });
  assert.equal(c.data.id, 'C-0001');
  const bad = await call('record_decision', { title: 'x' }); assert.equal(bad.isError, true);
});
test('search_decisions tool', async () => {
  const r = await call('search_decisions', { query: 'jwt short-lived' });
  assert.equal(r.data[0].id, 'D-0001');
  assert.equal((await call('search_decisions', { query: 'jwt', type: 'constraint' })).data.length, 0);
});
test('get_context_for_task tool', async () => {
  const r = await call('get_context_for_task', { task: 'refresh session tokens', path: 'src/auth/refresh.ts' });
  assert.equal(r.data.decisions[0].id, 'D-0001'); assert.equal(r.data.constraints[0].id, 'C-0001');
});
test('list_constraints tool and active-constraints resource', async () => {
  assert.equal((await call('list_constraints', {})).data[0].id, 'C-0001');
  assert.equal((await call('list_constraints', { path: 'docs/x.md' })).data.length, 0);
  const res = await client.readResource({ uri: 'adm://constraints/active' });
  assert.match(res.contents[0].text, /C-0001: No localStorage tokens/);
  const one = await client.readResource({ uri: 'adm://decisions/D-0001' });
  assert.equal(JSON.parse(one.contents[0].text).title, 'JWT sessions');
});
test('check_conflicts tool', async () => {
  const r = await call('check_conflicts', { change: 'localStorage.setItem("token", t)', files: ['src/auth/login.ts'] });
  assert.equal(r.data.ok, false); assert.equal(r.data.conflicts[0].id, 'C-0001');
  const w = await call('check_conflicts', { change: 'move to server sessions', files: ['src/auth/a.ts'] });
  assert.equal(w.data.ok, true); assert.equal(w.data.warnings[0].id, 'D-0001');
});
test('link_requirement tool', async () => {
  const r = await call('link_requirement', { id: 'D-0001', requirement: 'auth/session-tokens', commits: ['deadbeef'] });
  assert.deepEqual(r.data.record.requirements, ['auth/session-tokens']); assert.deepEqual(r.data.warnings, []);
  const w = await call('link_requirement', { id: 'D-0001', requirement: 'auth/unknown' }); assert.equal(w.data.warnings.length, 1);
  assert.equal((await call('link_requirement', { id: 'D-0001', requirement: 'BAD' })).isError, true);
});
test('supersede_decision tool', async () => {
  const r = await call('supersede_decision', { id: 'D-0001', title: 'Opaque session ids', decision: 'Use opaque ids in Redis' });
  assert.equal(r.data.new.id, 'D-0002'); assert.equal(r.data.superseded.status, 'superseded');
  assert.ok(!(await call('search_decisions', { query: 'jwt' })).data.some((x) => x.id === 'D-0001'));
});
test('real stdio transport: server process answers a client', async () => {
  const bin = fileURLToPath(new URL('../bin/adm-mcp.js', import.meta.url));
  const c = new Client({ name: 'stdio-test', version: '1' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [bin, '--root', root], stderr: 'ignore' }));
  const r = await c.callTool({ name: 'list_constraints', arguments: {} });
  assert.equal(JSON.parse(r.content[0].text)[0].id, 'C-0001');
  await c.close();
});
