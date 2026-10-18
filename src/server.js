import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DecisionStore, renderConstraintsMarkdown, summarize } from './store.js';

const VERSION = '0.1.0';
const list = z.array(z.string()).optional();
const json = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v, null, 2) }] });
const safe = (fn) => async (args) => { try { return json(await fn(args)); } catch (e) { return { isError: true, content: [{ type: 'text', text: `Error: ${e.message}` }] }; } };

export function createServer(root) {
  const store = new DecisionStore(root);
  const server = new McpServer({ name: 'alethea', version: VERSION });

  const recordShape = {
    title: z.string().describe('Short title of the decision or constraint'),
    decision: z.string().optional().describe('What was decided / the constraint statement'),
    context: z.string().optional(), alternatives: z.union([z.string(), z.array(z.string())]).optional().describe('Options considered and rejected'),
    consequences: z.string().optional(),
    status: z.enum(['proposed', 'accepted', 'superseded', 'deprecated', 'rejected']).optional(),
    tags: list, requirements: list.describe('SpecGate ids: capability/requirement[#scenario]'),
    files: list.describe('Paths or globs this applies to'), tests: list, commits: list,
    rules: list.describe('Constraint rules: "forbid: term", "forbid: /regex/", "require: term", "forbid-path: glob"'),
  };

  server.registerTool('record_decision', {
    title: 'Record decision or constraint',
    description: 'Record an ADR-style decision (or a constraint with type="constraint") into .decisions/. Call after making a non-obvious choice.',
    inputSchema: { ...recordShape, type: z.enum(['decision', 'constraint']).optional(), supersedes: list },
  }, safe((a) => summarize(store.record(a))));

  server.registerTool('search_decisions', {
    title: 'Search decisions', description: 'BM25 search across decisions and constraints. Active (accepted/proposed) only unless include_inactive or status is set.',
    inputSchema: { query: z.string(), type: z.enum(['decision', 'constraint']).optional(), status: z.string().optional(), include_inactive: z.boolean().optional(), limit: z.number().int().min(1).max(50).optional() },
  }, safe((a) => store.search(a.query, { type: a.type, status: a.status, includeInactive: a.include_inactive, limit: a.limit })));

  server.registerTool('get_context_for_task', {
    title: 'Get context for task', description: 'Call BEFORE starting work. Returns active constraints in scope and the most relevant decisions for a task description and/or file paths.',
    inputSchema: { task: z.string().optional(), path: z.string().optional(), paths: list, limit: z.number().int().min(1).max(50).optional() },
  }, safe((a) => store.contextForTask(a)));

  server.registerTool('supersede_decision', {
    title: 'Supersede decision', description: 'Replace an existing decision/constraint with a new one. The old record is marked superseded and both are cross-linked.',
    inputSchema: { id: z.string(), ...recordShape },
  }, safe(({ id, ...rest }) => { const neu = store.supersede(id, rest); return { new: summarize(neu), superseded: summarize(store.get(id)) }; }));

  server.registerTool('list_constraints', {
    title: 'List constraints', description: 'List active constraints, optionally only those whose scope covers a path.',
    inputSchema: { path: z.string().optional(), include_inactive: z.boolean().optional() },
  }, safe((a) => store.constraints({ path: a.path, includeInactive: a.include_inactive }).map(summarize)));

  server.registerTool('check_conflicts', {
    title: 'Check conflicts', description: 'Check a proposed change (diff, plan or description, plus touched files) against active constraint rules. ok=false means an accepted constraint is violated.',
    inputSchema: { change: z.string(), files: list },
  }, safe((a) => store.checkConflicts(a)));

  server.registerTool('link_requirement', {
    title: 'Link requirement/tests/commits', description: 'Link a decision to SpecGate requirement ids (capability/requirement[#scenario]), test files and/or commits.',
    inputSchema: { id: z.string(), requirement: z.union([z.string(), z.array(z.string())]).optional(), tests: list, commits: list, files: list, validate: z.boolean().optional() },
  }, safe((a) => { const { record, warnings } = store.link(a.id, a); return { record: summarize(record), warnings }; }));

  server.registerResource('active-constraints', 'adm://constraints/active', {
    title: 'Active constraints', description: 'All accepted/proposed constraints for this repo, as markdown.', mimeType: 'text/markdown',
  }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: renderConstraintsMarkdown(store.constraints()) }] }));

  server.registerResource('decision', new ResourceTemplate('adm://decisions/{id}', {
    list: async () => ({ resources: store.all().map((r) => ({ uri: `adm://decisions/${r.id}`, name: `${r.id}: ${r.title}`, mimeType: 'application/json' })) }),
  }), { title: 'Decision record', mimeType: 'application/json' },
  async (uri, { id }) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(store.get(id), null, 2) }] }));

  return { server, store };
}
