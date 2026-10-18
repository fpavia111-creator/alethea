import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DecisionStore, resolveRoot, summarize, renderConstraintsMarkdown } from './store.js';
import { importAdrs, exportRecords } from './adr.js';

const HELP = `Alethea of Agents (alethea, formerly agent-decision-memory / adm) - decision memory for coding agents

Usage: alethea <command> [options]   ("adm" still works; global: --root <dir>, --json)

  init                                   create .decisions/
  record --title T --decision D [--type decision|constraint] [--context C]
         [--alternative A]... [--consequences X] [--status S] [--tag t]...
         [--req cap/req]... [--file glob]... [--test path]... [--commit sha]...
         [--rule "forbid: x"]... [--supersedes ID]...
  list [--all]                           list records (active only unless --all)
  show <id>                              print one record
  search <query> [--all] [--limit n]
  context [--task T] [--file path]...    decisions + constraints relevant to a task
  supersede <id> --title T --decision D [...record options]
  status <id> <status>                   proposed|accepted|superseded|deprecated|rejected
  constraints [--file path] [--all]
  check [--change TEXT | --change-file F] [--file path]...  exit 1 on violated constraints
  link <id> [--req cap/req]... [--test path]... [--commit sha]... [--no-validate]
  import [--dir docs/adr] [--dry-run]    import existing ADRs
  export [--format markdown|json] [--out file] [--active]
  serve                                  run the MCP server on stdio
`;

const OPTIONS = {
  root: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  title: { type: 'string' }, decision: { type: 'string' }, type: { type: 'string' }, context: { type: 'string' },
  alternative: { type: 'string', multiple: true }, consequences: { type: 'string' }, status: { type: 'string' },
  tag: { type: 'string', multiple: true }, req: { type: 'string', multiple: true }, file: { type: 'string', multiple: true },
  test: { type: 'string', multiple: true }, commit: { type: 'string', multiple: true }, rule: { type: 'string', multiple: true },
  supersedes: { type: 'string', multiple: true }, all: { type: 'boolean' }, limit: { type: 'string' }, task: { type: 'string' },
  change: { type: 'string' }, 'change-file': { type: 'string' }, 'no-validate': { type: 'boolean' }, dir: { type: 'string' },
  'dry-run': { type: 'boolean' }, format: { type: 'string' }, out: { type: 'string' }, active: { type: 'boolean' },
};

function recordInput(v) {
  return { title: v.title, decision: v.decision, type: v.type, context: v.context, alternatives: v.alternative, consequences: v.consequences,
    status: v.status, tags: v.tag, requirements: v.req, files: v.file, tests: v.test, commits: v.commit, rules: v.rule, supersedes: v.supersedes };
}

const line = (r) => `${r.id}  [${r.status}] ${r.type === 'constraint' ? '(constraint) ' : ''}${r.title}${r.requirements?.length ? '  -> ' + r.requirements.join(', ') : ''}`;

/** Returns { code, out, err } so tests can call it in-process. */
export async function run(argv, { env = process.env, fetchImpl } = {}) {
  let parsed;
  try { parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true }); }
  catch (e) { return { code: 2, out: '', err: `${e.message}\n` }; }
  const { values: v, positionals: [cmd, ...pos] } = parsed;
  if (!cmd || v.help || cmd === 'help') return { code: cmd || v.help ? 0 : 2, out: HELP, err: '' };
  const store = new DecisionStore(resolveRoot(v.root));
  const out = (data, text) => ({ code: 0, out: (v.json ? JSON.stringify(data, null, 2) : text) + '\n', err: '' });
  try {
    switch (cmd) {
      case 'init': return out({ dir: store.init() }, `Initialized ${store.init()}`);
      case 'record': { const r = store.record(recordInput(v)); return out(summarize(r), `Recorded ${r.id} -> .decisions/${r.file}`); }
      case 'list': { const rs = store.all().filter((r) => v.all || ['accepted', 'proposed'].includes(r.status)); return out(rs.map(summarize), rs.map(line).join('\n') || '(none)'); }
      case 'show': { const r = store.get(need(pos[0], 'id')); return out(r, fs.readFileSync(path.join(store.dir, r.file), 'utf8').trimEnd()); }
      case 'search': { const rs = store.search(need(pos.join(' '), 'query'), { includeInactive: v.all, limit: v.limit ? +v.limit : 10 }); return out(rs, rs.map((r) => `${r.score.toFixed(2)}  ${line(r)}`).join('\n') || '(no matches)'); }
      case 'context': {
        const c = store.contextForTask({ task: v.task || pos.join(' '), paths: v.file });
        const txt = ['Constraints:', ...c.constraints.map((r) => '  ' + line(r) + (r.rules?.length ? `  rules: ${r.rules.join('; ')}` : '')), 'Decisions:', ...c.decisions.map((r) => `  ${line(r)}  (${r.why.join(', ')})`), `Requirements: ${c.requirements.join(', ') || '-'}`].join('\n');
        return out(c, txt);
      }
      case 'supersede': { const r = store.supersede(need(pos[0], 'id'), recordInput(v)); return out(summarize(r), `Recorded ${r.id}; ${pos[0]} is now superseded`); }
      case 'status': { const r = store.setStatus(need(pos[0], 'id'), need(pos[1], 'status')); return out(summarize(r), `${r.id} -> ${r.status}`); }
      case 'constraints': { const cs = store.constraints({ path: v.file?.[0], includeInactive: v.all }); return out(cs.map(summarize), renderConstraintsMarkdown(cs).trimEnd()); }
      case 'check': {
        const change = v['change-file'] ? fs.readFileSync(v['change-file'], 'utf8') : v.change ?? pos.join(' ');
        const res = store.checkConflicts({ change, files: v.file });
        const txt = res.ok && !res.conflicts.length && !res.warnings.length ? 'OK: no conflicts with active constraints'
          : [...res.conflicts.map((c) => `${c.severity.toUpperCase()} ${c.id} ${c.title}: rule "${c.rule}" ${c.match}`), ...res.warnings.map((w) => `WARN ${w.id}: ${w.note}`)].join('\n');
        const r = out(res, txt); r.code = res.ok ? 0 : 1; return r;
      }
      case 'link': { const { record, warnings } = store.link(need(pos[0], 'id'), { requirement: v.req, tests: v.test, commits: v.commit, files: v.file, validate: !v['no-validate'] }); const r = out({ record: summarize(record), warnings }, `Linked ${record.id}: ${record.requirements.join(', ')}`); r.err = warnings.map((w) => `warning: ${w}\n`).join(''); return r; }
      case 'import': { const res = importAdrs(store, v.dir || 'docs/adr', { dryRun: v['dry-run'] }); return out(res, `${v['dry-run'] ? 'Would import' : 'Imported'} ${res.imported.length}, skipped ${res.skipped.length}\n` + res.imported.map((i) => `  ${i.id || '-'} <- ${i.file} [${i.status}]`).join('\n')); }
      case 'export': {
        const text = exportRecords(store, v.format || 'markdown', { includeInactive: !v.active });
        if (v.out) { fs.writeFileSync(v.out, text); return { code: 0, out: `Wrote ${v.out}\n`, err: '' }; }
        return { code: 0, out: text, err: '' };
      }
      case 'serve': return { code: -1, out: '', err: '' };
      default: return { code: 2, out: '', err: `Unknown command: ${cmd}\n${HELP}` };
    }
  } catch (e) { return { code: 1, out: '', err: `Error: ${e.message}\n` }; }
}

function need(v, name) { if (!v) throw new Error(`missing ${name}`); return v; }
