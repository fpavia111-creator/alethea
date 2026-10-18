// End-to-end demo: record decisions with the real `adm` CLI in a scratch repo,
// then query them through a real MCP client talking to `adm-mcp` over stdio.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ADM = path.join(here, '..', 'bin', 'adm.js');
const MCP = path.join(here, '..', 'bin', 'adm-mcp.js');
const repo = process.argv[2] ? path.resolve(process.argv[2]) : fs.mkdtempSync(path.join(os.tmpdir(), 'adm-demo-'));
fs.mkdirSync(path.join(repo, 'openspec', 'specs', 'todos'), { recursive: true });
fs.writeFileSync(path.join(repo, 'openspec', 'specs', 'todos', 'spec.md'), '# Todos\n\n### Requirement: Due date\nA todo SHALL accept an ISO due date.\n\n#### Scenario: Invalid date rejected\n- WHEN the date is invalid\n- THEN it is rejected\n');
fs.mkdirSync(path.join(repo, 'docs', 'adr'), { recursive: true });
fs.writeFileSync(path.join(repo, 'docs', 'adr', '0001-use-express.md'), '# 1. Use Express\n\nDate: 2025-06-01\n\n## Status\n\nAccepted\n\n## Context\n\nWe need an HTTP server.\n\n## Decision\n\nUse Express 4.\n\n## Consequences\n\nCallback-style middleware.\n');

const adm = (...a) => { const out = execFileSync(process.execPath, [ADM, ...a, '--root', repo], { encoding: 'utf8' }); console.log(`$ adm ${a.map((x) => (/\s/.test(x) ? JSON.stringify(x) : x)).join(' ')}\n${out.trimEnd()}\n`); };
console.log(`Scratch repo: ${repo}\n\n== 1. Record with the CLI ==\n`);
adm('init');
adm('import', '--dir', 'docs/adr');
adm('record', '--title', 'Use date-fns for dates', '--context', 'Due dates need parsing and formatting', '--decision', 'Use date-fns parseISO/format; store dates as ISO strings', '--alternative', 'Moment.js: deprecated, large bundle', '--alternative', 'Luxon', '--consequences', 'Tree-shakeable; no global locale state', '--file', 'src/todos/**', '--req', 'todos/due-date', '--tag', 'dates');
adm('record', '--type', 'constraint', '--title', 'No moment.js', '--decision', 'moment is in maintenance mode and bloats the bundle', '--rule', 'forbid: moment', '--file', 'src/**');
adm('record', '--type', 'constraint', '--title', 'Do not hand-edit generated API client', '--decision', 'src/generated is rebuilt from openapi.yaml', '--rule', 'forbid-path: src/generated/**');
adm('supersede', 'D-0001', '--title', 'Use Fastify instead of Express', '--decision', 'Fastify 5 for schema validation and speed', '--alternative', 'Express', '--file', 'src/server/**');
adm('link', 'D-0002', '--req', 'todos/due-date#invalid-date-rejected', '--commit', '1a2b3c4d');

console.log('== 2. Query over stdio with a real MCP client ==\n');
const client = new Client({ name: 'adm-demo', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [MCP, '--root', repo], stderr: 'ignore' }));
console.log('server:', client.getServerVersion());
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }); const d = JSON.parse(r.content[0].text); console.log(`\n-> ${name} ${JSON.stringify(args)}`); return d; };

let d = await call('get_context_for_task', { task: 'validate the due date when creating a todo', paths: ['src/todos/create.ts'] });
console.log('constraints:', d.constraints.map((c) => `${c.id} ${c.title}`)); console.log('decisions:', d.decisions.map((x) => `${x.id} ${x.title} [${x.why}] score=${x.score}`)); console.log('requirements:', d.requirements);
d = await call('search_decisions', { query: 'express http server' });
console.log('active hits:', d.map((x) => `${x.id} ${x.title} (${x.status})`));
d = await call('search_decisions', { query: 'express http server', include_inactive: true });
console.log('incl. superseded:', d.map((x) => `${x.id} ${x.title} (${x.status})`));
d = await call('check_conflicts', { change: "import moment from 'moment'; const due = moment(input)", files: ['src/todos/create.ts'] });
console.log('ok:', d.ok, d.conflicts.map((c) => `${c.id}: ${c.rule} -> ${c.match}`));
d = await call('check_conflicts', { change: 'regenerate fetch wrapper', files: ['src/generated/client.ts'] });
console.log('ok:', d.ok, d.conflicts.map((c) => `${c.id}: ${c.rule} -> ${c.match}`));
d = await call('check_conflicts', { change: 'switch date handling to Luxon', files: ['src/todos/x.ts'] });
console.log('ok:', d.ok, 'warnings:', d.warnings.map((w) => w.note));
d = await call('record_decision', { title: 'Reject invalid due dates with 400', decision: 'Return HTTP 400 with code INVALID_DUE_DATE', files: ['src/todos/**'], requirements: ['todos/due-date#invalid-date-rejected'] });
console.log('recorded:', d.id, d.file);
d = await call('link_requirement', { id: d.id, requirement: 'todos/not-a-real-req' });
console.log('warnings:', d.warnings);
d = await call('list_constraints', { path: 'README.md' });
console.log('constraints for README.md:', d.map((c) => c.id));
const res = await client.readResource({ uri: 'adm://constraints/active' });
console.log('\n-> resource adm://constraints/active\n' + res.contents[0].text);
await client.close();
console.log('== 3. Files on disk ==\n' + fs.readdirSync(path.join(repo, '.decisions')).join('\n'));
