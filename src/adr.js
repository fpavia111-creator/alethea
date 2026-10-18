import fs from 'node:fs';
import path from 'node:path';
import { parse } from './frontmatter.js';
import { summarize } from './store.js';
import { STATUSES } from './util.js';

/**
 * Import Nygard-style ADRs (docs/adr/0001-title.md: "# 1. Title", "## Status", "## Context"...)
 * and MADR files (optional frontmatter status, "## Context and Problem Statement", "## Considered Options",
 * "## Decision Outcome"). Superseded links ("Superseded by [2](0002-x.md)") are preserved.
 */
export function importAdrs(store, dir = 'docs/adr', { dryRun = false } = {}) {
  const abs = path.resolve(store.root, dir);
  if (!fs.existsSync(abs)) throw new Error(`ADR directory not found: ${abs}`);
  const already = new Set(store.all().map((r) => r.source).filter(Boolean));
  const files = fs.readdirSync(abs).filter((f) => /^\d+.*\.md$/i.test(f)).sort();
  const parsed = files.map((f) => ({ f, ...parseAdr(fs.readFileSync(path.join(abs, f), 'utf8'), f) }));
  const imported = []; const skipped = [];
  const map = new Map(); // ADR number -> new id
  for (const a of parsed) {
    const source = `${dir.replace(/\\/g, '/')}/${a.f}`;
    if (already.has(source)) { skipped.push({ file: source, reason: 'already imported' }); continue; }
    if (dryRun) { imported.push({ file: source, title: a.title, status: a.status }); continue; }
    const rec = store.record({ title: a.title, status: a.status === 'superseded' ? 'accepted' : a.status, date: a.date, context: a.context, decision: a.decision || '(see source ADR)', alternatives: a.alternatives, consequences: a.consequences, tags: ['imported-adr'], source });
    map.set(a.num, rec.id);
    imported.push({ file: source, id: rec.id, title: rec.title, status: a.status, supersededBy: a.supersededBy });
  }
  if (!dryRun) {
    for (const i of imported) for (const n of i.supersededBy || []) {
      const newer = map.get(n);
      if (newer) markPair(store, i.id, newer);
    }
    for (const i of imported) if (i.status === 'superseded' && store.get(i.id).status !== 'superseded') store.setStatus(i.id, 'superseded');
  }
  return { imported, skipped };
}

function markPair(store, oldId, newId) {
  const fsOld = store.get(oldId); const fsNew = store.get(newId);
  rewrite(store, fsOld, { status: 'superseded', superseded_by: [...new Set([...fsOld.superseded_by, newId])] });
  rewrite(store, fsNew, { supersedes: [...new Set([...fsNew.supersedes, oldId])] });
}

function rewrite(store, rec, patch) {
  // Re-record through the frontmatter file directly to keep a single writer format.
  const file = path.join(store.dir, rec.file);
  const { meta, body } = parse(fs.readFileSync(file, 'utf8'));
  Object.assign(meta, patch);
  const lines = ['---', ...Object.entries(meta).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${JSON.stringify(v)}`), '---', ''];
  fs.writeFileSync(file, lines.join('\n') + body.replace(/\s+$/, '') + '\n');
}

export function parseAdr(text, filename = '') {
  const { meta, body } = parse(text);
  const num = parseInt(filename, 10);
  const titleLine = /^#\s+(.+)$/m.exec(body);
  let title = (meta.title || (titleLine ? titleLine[1] : filename)).replace(/^(ADR[-\s]?)?\d+[.:]?\s*/i, '').trim();
  const sections = {};
  for (const p of body.split(/^##\s+/m).slice(1)) {
    const nl = p.indexOf('\n');
    sections[p.slice(0, nl < 0 ? undefined : nl).trim().toLowerCase()] = nl < 0 ? '' : p.slice(nl + 1).trim();
  }
  const pick = (...keys) => { for (const [k, v] of Object.entries(sections)) if (keys.some((x) => k.startsWith(x))) return v; return undefined; };
  const statusText = String(meta.status || pick('status') || (/^Status:\s*(.+)$/im.exec(body) || [])[1] || 'accepted');
  const lower = statusText.toLowerCase();
  const status = STATUSES.find((s) => lower.includes(s)) || (lower.includes('deprecat') ? 'deprecated' : 'accepted');
  const supersededBy = [...statusText.matchAll(/superseded by[^\n]*?(\d+)/gi)].map((m) => parseInt(m[1], 10));
  const date = meta.date || (/^Date:\s*(\d{4}-\d{2}-\d{2})/im.exec(body) || [])[1];
  return {
    num, title, status, date: date ? String(date) : undefined, supersededBy,
    context: pick('context'), decision: pick('decision'), alternatives: pick('considered options', 'alternatives', 'options'), consequences: pick('consequences'),
  };
}

export function exportRecords(store, format = 'markdown', { includeInactive = true } = {}) {
  const recs = store.all().filter((r) => includeInactive || ['accepted', 'proposed'].includes(r.status));
  if (format === 'json') {
    return JSON.stringify({ exportedAt: new Date().toISOString(), count: recs.length, records: recs.map((r) => ({ ...summarize(r), context: r.context, alternatives: r.alternatives, consequences: r.consequences, source: r.source })) }, null, 2);
  }
  if (format !== 'markdown') throw new Error('format must be markdown or json');
  let out = `# Decision log\n\n| ID | Type | Title | Status | Requirements |\n|---|---|---|---|---|\n`;
  out += recs.map((r) => `| ${r.id} | ${r.type} | ${r.title} | ${r.status} | ${r.requirements.join(', ')} |`).join('\n') + '\n\n';
  for (const r of recs) {
    out += `## ${r.id}: ${r.title}\n\n- Status: ${r.status}${r.superseded_by.length ? ` (by ${r.superseded_by.join(', ')})` : ''}\n- Date: ${r.date}\n`;
    if (r.supersedes.length) out += `- Supersedes: ${r.supersedes.join(', ')}\n`;
    if (r.requirements.length) out += `- Requirements: ${r.requirements.join(', ')}\n`;
    if (r.tests.length) out += `- Tests: ${r.tests.join(', ')}\n`;
    if (r.commits.length) out += `- Commits: ${r.commits.join(', ')}\n`;
    if (r.rules.length) out += `- Rules: ${r.rules.join('; ')}\n`;
    out += '\n';
    for (const [k, t] of [['context', 'Context'], ['decision', 'Decision'], ['alternatives', 'Alternatives'], ['consequences', 'Consequences']]) if (r[k]) out += `### ${t}\n\n${r[k]}\n\n`;
  }
  return out;
}
