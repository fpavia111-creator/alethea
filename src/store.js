import fs from 'node:fs';
import path from 'node:path';
import { parse, serialize } from './frontmatter.js';
import { buildIndex, query, tokenize } from './search.js';
import { ACTIVE, STATUSES, REQ_RE, asArray, pathMatches, slugify, today, normPath } from './util.js';

const SECTIONS = ['context', 'decision', 'alternatives', 'consequences'];
const SECTION_TITLES = { context: 'Context', decision: 'Decision', alternatives: 'Alternatives', consequences: 'Consequences' };

/** Find the repo root: explicit > ALETHEA_ROOT (or legacy ADM_ROOT) > nearest ancestor with .decisions or .git > cwd. */
export function resolveRoot(explicit) {
  if (explicit) return path.resolve(explicit);
  const envRoot = process.env.ALETHEA_ROOT || process.env.ADM_ROOT;
  if (envRoot) return path.resolve(envRoot);
  let dir = process.cwd();
  for (;;) {
    if (fs.existsSync(path.join(dir, '.decisions')) || fs.existsSync(path.join(dir, '.git'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return process.cwd();
    dir = up;
  }
}

export class DecisionStore {
  constructor(root) {
    this.root = path.resolve(root);
    this.dir = path.join(this.root, '.decisions');
    this.indexFile = path.join(this.dir, '.index.json');
  }

  init() {
    fs.mkdirSync(this.dir, { recursive: true });
    const readme = path.join(this.dir, 'README.md');
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(readme, '# Decision memory\n\nManaged by agent-decision-memory (`adm`). One markdown file per decision (`D-*`) or constraint (`C-*`). Safe to edit by hand and review in pull requests.\n');
    }
    const gi = path.join(this.dir, '.gitignore');
    if (!fs.existsSync(gi)) fs.writeFileSync(gi, '.index.json\n');
    return this.dir;
  }

  files() {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir).filter((f) => /^[DC]-\d+.*\.md$/.test(f)).sort();
  }

  /** Load every record. Each record = frontmatter fields + parsed sections + file name. */
  all() {
    return this.files().map((f) => this.#load(f));
  }

  #load(file) {
    const { meta, body } = parse(fs.readFileSync(path.join(this.dir, file), 'utf8'));
    const rec = { ...meta, file };
    for (const k of ['tags', 'requirements', 'files', 'tests', 'commits', 'rules', 'supersedes', 'superseded_by']) rec[k] = asArray(meta[k]);
    const parts = body.split(/^## +/m);
    for (const p of parts.slice(1)) {
      const nl = p.indexOf('\n');
      const head = (nl < 0 ? p : p.slice(0, nl)).trim().toLowerCase();
      const key = SECTIONS.find((s) => head.startsWith(s.slice(0, 6)));
      if (key) rec[key] = (nl < 0 ? '' : p.slice(nl + 1)).trim();
    }
    return rec;
  }

  get(id) {
    const r = this.all().find((x) => x.id?.toLowerCase() === String(id).toLowerCase());
    if (!r) throw new Error(`No decision or constraint with id ${id}`);
    return r;
  }

  nextId(type) {
    const prefix = type === 'constraint' ? 'C' : 'D';
    const nums = this.files().filter((f) => f.startsWith(prefix + '-')).map((f) => parseInt(f.slice(2), 10));
    return `${prefix}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, '0')}`;
  }

  #write(rec) {
    const meta = {
      id: rec.id, type: rec.type, title: rec.title, status: rec.status, date: rec.date,
      tags: rec.tags, requirements: rec.requirements, files: rec.files, tests: rec.tests, commits: rec.commits,
      rules: rec.type === 'constraint' || rec.rules?.length ? rec.rules : undefined,
      supersedes: rec.supersedes?.length ? rec.supersedes : undefined,
      superseded_by: rec.superseded_by?.length ? rec.superseded_by : undefined,
      source: rec.source,
    };
    let body = `# ${rec.id}: ${rec.title}\n\n`;
    for (const s of SECTIONS) if (rec[s]) body += `## ${SECTION_TITLES[s]}\n\n${rec[s].trim()}\n\n`;
    this.init();
    const file = rec.file || `${rec.id}-${slugify(rec.title)}.md`;
    fs.writeFileSync(path.join(this.dir, file), serialize(meta, body));
    return { ...rec, file };
  }

  record(input) {
    const type = input.type === 'constraint' ? 'constraint' : 'decision';
    if (!input.title || !String(input.title).trim()) throw new Error('title is required');
    if (type === 'decision' && !input.decision) throw new Error('decision text is required');
    if (type === 'constraint' && !input.decision && !asArray(input.rules).length) throw new Error('a constraint needs decision text or at least one rule');
    const status = input.status || 'accepted';
    if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join(', ')}`);
    const requirements = asArray(input.requirements);
    for (const r of requirements) validateReqFormat(r);
    for (const r of asArray(input.rules)) parseRule(r);
    const rec = {
      id: this.nextId(type), type, title: String(input.title).trim(), status, date: input.date || today(),
      tags: asArray(input.tags), requirements, files: asArray(input.files).map(normPath),
      tests: asArray(input.tests).map(normPath), commits: asArray(input.commits), rules: asArray(input.rules),
      supersedes: [], superseded_by: [], source: input.source,
      context: input.context, decision: input.decision, alternatives: fmtList(input.alternatives), consequences: input.consequences,
    };
    const saved = this.#write(rec);
    for (const old of asArray(input.supersedes)) this.#markSuperseded(old, saved.id);
    return this.get(saved.id);
  }

  #markSuperseded(oldId, newId) {
    const old = this.get(oldId);
    const neu = this.get(newId);
    old.status = 'superseded';
    old.superseded_by = [...new Set([...old.superseded_by, newId])];
    neu.supersedes = [...new Set([...neu.supersedes, old.id])];
    this.#write(old); this.#write(neu);
  }

  supersede(oldId, input) {
    const old = this.get(oldId);
    if (old.status === 'superseded') throw new Error(`${old.id} is already superseded by ${old.superseded_by.join(', ')}`);
    return this.record({ type: old.type, tags: old.tags, requirements: old.requirements, files: old.files, ...input, supersedes: [old.id] });
  }

  setStatus(id, status) {
    if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join(', ')}`);
    const r = this.get(id); r.status = status; return this.#write(r);
  }

  link(id, { requirement, tests, commits, files, validate = true } = {}) {
    const r = this.get(id);
    const warnings = [];
    for (const req of asArray(requirement)) {
      validateReqFormat(req);
      if (validate) {
        const known = specgateRequirementIds(this.root);
        if (known && !known.has(req) && !known.has(req.split('#')[0])) warnings.push(`${req} was not found in openspec/specs (linked anyway)`);
      }
      if (!r.requirements.includes(req)) r.requirements.push(req);
    }
    for (const t of asArray(tests).map(normPath)) {
      if (!fs.existsSync(path.join(this.root, t))) warnings.push(`test file ${t} does not exist (linked anyway)`);
      if (!r.tests.includes(t)) r.tests.push(t);
    }
    for (const c of asArray(commits)) { if (!/^[0-9a-f]{4,40}$/i.test(c)) throw new Error(`commit must be a hex sha: ${c}`); if (!r.commits.includes(c)) r.commits.push(c); }
    for (const f of asArray(files).map(normPath)) if (!r.files.includes(f)) r.files.push(f);
    return { record: this.#write(r), warnings };
  }

  // ---------- index & search ----------
  #signature() {
    return this.files().map((f) => { const s = fs.statSync(path.join(this.dir, f)); return `${f}:${s.size}:${s.mtimeMs}`; }).join('|');
  }

  index() {
    const sig = this.#signature();
    try {
      const cached = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
      if (cached.signature === sig) return cached.index;
    } catch { /* rebuild */ }
    const idx = buildIndex(this.all().map((r) => ({
      id: r.id, title: r.title, tags: [...r.tags, ...r.requirements].join(' '),
      text: [r.context, r.decision, r.alternatives, r.consequences, r.rules.join(' '), r.files.join(' '), r.requirements.join(' ')].join('\n'),
    })));
    if (fs.existsSync(this.dir)) { try { fs.writeFileSync(this.indexFile, JSON.stringify({ signature: sig, index: idx })); } catch { /* read-only is fine */ } }
    return idx;
  }

  search(text, { status, type, limit = 10, includeInactive = false } = {}) {
    const byId = new Map(this.all().map((r) => [r.id, r]));
    return query(this.index(), text)
      .map(({ id, score }) => ({ ...summarize(byId.get(id)), score: round(score) }))
      .filter((r) => r.id && (status ? r.status === status : includeInactive || ACTIVE.has(r.status)) && (!type || r.type === type))
      .slice(0, limit);
  }

  constraints({ path: p, includeInactive = false } = {}) {
    return this.all().filter((r) => r.type === 'constraint' && (includeInactive || ACTIVE.has(r.status)) && (!p || inScope(r, p, this.root)));
  }

  /** Relevant active decisions + all in-scope active constraints for a task and/or file path. */
  contextForTask({ task = '', path: p, paths = [], limit = 8 } = {}) {
    const targets = [...asArray(p), ...asArray(paths)];
    const active = this.all().filter((r) => ACTIVE.has(r.status));
    const scores = new Map();
    const q = [task, ...targets.map((t) => normPath(t).replace(/[/._-]/g, ' '))].join(' ');
    if (q.trim()) for (const { id, score } of query(this.index(), q)) scores.set(id, score);
    const results = [];
    for (const r of active) {
      let score = scores.get(r.id) || 0;
      const fileHit = targets.some((t) => r.files.some((s) => pathMatches(s, t, this.root)) || r.tests.some((s) => pathMatches(s, t, this.root)));
      if (fileHit) score += 5;
      const why = [fileHit && 'file scope matches', scores.get(r.id) && 'text match'].filter(Boolean);
      if (score > 0) results.push({ ...summarize(r), score: round(score), why });
    }
    results.sort((a, b) => b.score - a.score);
    const constraints = active.filter((r) => r.type === 'constraint' && (r.files.length === 0 || targets.length === 0 || targets.some((t) => inScope(r, t, this.root))))
      .map(summarize);
    const decisions = results.filter((r) => r.type === 'decision').slice(0, limit);
    const requirements = [...new Set([...decisions, ...constraints].flatMap((r) => r.requirements))];
    return { task, paths: targets.map(normPath), constraints, decisions, requirements };
  }

  checkConflicts({ change = '', files = [] } = {}) {
    const text = String(change);
    const conflicts = [];
    for (const c of this.all().filter((r) => ACTIVE.has(r.status) && r.rules.length)) {
      const scoped = c.files.length === 0 || asArray(files).length === 0 || asArray(files).some((f) => inScope(c, f, this.root));
      if (!scoped) continue;
      for (const raw of c.rules) {
        const rule = parseRule(raw);
        const hit = rule.test(text, asArray(files).map(normPath));
        if (hit) conflicts.push({ id: c.id, title: c.title, type: c.type, rule: raw, severity: c.status === 'accepted' ? 'error' : 'warning', match: hit, requirements: c.requirements });
      }
    }
    // Soft signal: the change mentions a rejected alternative of an active decision.
    const warnings = [];
    const changeTokens = new Set(tokenize(text));
    for (const d of this.all().filter((r) => r.type === 'decision' && ACTIVE.has(r.status) && r.alternatives)) {
      for (const alt of d.alternatives.split('\n').map((l) => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean)) {
        const name = alt.split(/[:—–(]| - /)[0].trim();
        const toks = tokenize(name);
        if (toks.length && toks.length <= 4 && toks.every((t) => changeTokens.has(t))) warnings.push({ id: d.id, title: d.title, alternative: name, note: `"${name}" was considered and rejected in ${d.id}` });
      }
    }
    return { ok: !conflicts.some((c) => c.severity === 'error'), conflicts, warnings };
  }
}

/** Rules: "forbid: word", "forbid: /regex/i", "require: word", "forbid-path: glob". */
export function parseRule(raw) {
  const m = /^\s*(forbid|require|forbid-path)\s*:\s*(.+?)\s*$/i.exec(String(raw));
  if (!m) throw new Error(`Invalid rule "${raw}". Use "forbid: <term|/regex/>", "require: <term|/regex/>" or "forbid-path: <glob>"`);
  const kind = m[1].toLowerCase(); const pat = m[2];
  let re;
  const rx = /^\/(.+)\/([a-z]*)$/.exec(pat);
  if (rx) re = new RegExp(rx[1], rx[2].includes('i') ? rx[2] : rx[2] + 'i');
  else re = new RegExp(`(?<![A-Za-z0-9_])${pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`, 'i');
  return {
    kind, pattern: pat,
    test(text, files) {
      if (kind === 'forbid') { const mm = re.exec(text); return mm ? `found "${mm[0]}"` : null; }
      if (kind === 'require') return text.trim() && !re.test(text) ? `missing required "${pat}"` : null;
      const f = files.find((x) => pathMatches(pat, x)); return f ? `touches ${f}` : null;
    },
  };
}

export function validateReqFormat(r) {
  if (!REQ_RE.test(r)) throw new Error(`Requirement id "${r}" is not SpecGate format capability/requirement[#scenario] (lowercase, hyphenated)`);
}

/** Collect SpecGate 0.3 requirement ids from openspec/specs/<cap>/spec.md (and change deltas). Returns null if no specs. */
export function specgateRequirementIds(root) {
  const ids = new Set();
  const dirs = [path.join(root, 'openspec', 'specs')];
  const changes = path.join(root, 'openspec', 'changes');
  if (fs.existsSync(changes)) for (const c of fs.readdirSync(changes)) dirs.push(path.join(changes, c, 'specs'));
  let found = false;
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const cap of fs.readdirSync(d)) {
      const f = path.join(d, cap, 'spec.md');
      if (!fs.existsSync(f)) continue;
      found = true;
      let req = null;
      for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
        const r = /^###\s+Requirement:\s*(.+)$/.exec(line);
        if (r) { req = `${cap}/${slugify(r[1])}`; ids.add(req); continue; }
        const s = /^####\s+Scenario:\s*(.+)$/.exec(line);
        if (s && req) ids.add(`${req}#${slugify(s[1])}`);
      }
    }
  }
  return found ? ids : null;
}

function inScope(r, p, root) { return r.files.length === 0 || r.files.some((s) => pathMatches(s, p, root)); }
function round(n) { return Math.round(n * 1000) / 1000; }
function fmtList(v) { if (Array.isArray(v)) return v.map((x) => `- ${x}`).join('\n'); return v; }

export function summarize(r) {
  if (!r) return {};
  const out = { id: r.id, type: r.type, title: r.title, status: r.status, date: r.date, decision: r.decision, tags: r.tags, requirements: r.requirements, files: r.files, tests: r.tests, commits: r.commits, file: `.decisions/${r.file}` };
  if (r.rules.length) out.rules = r.rules;
  if (r.supersedes.length) out.supersedes = r.supersedes;
  if (r.superseded_by.length) out.superseded_by = r.superseded_by;
  return out;
}

export function renderConstraintsMarkdown(list) {
  if (!list.length) return '# Active constraints\n\n_None recorded._\n';
  return '# Active constraints\n\n' + list.map((c) => `## ${c.id}: ${c.title} (${c.status})\n\n${c.decision || ''}\n\n` +
    (c.rules.length ? `Rules: ${c.rules.map((x) => '`' + x + '`').join(', ')}\n\n` : '') +
    (c.files.length ? `Scope: ${c.files.join(', ')}\n\n` : 'Scope: whole repo\n\n') +
    (c.requirements.length ? `Requirements: ${c.requirements.join(', ')}\n\n` : '')).join('');
}
