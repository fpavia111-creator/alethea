// Minimal, dependency-free frontmatter: every value is written as JSON (which is valid YAML),
// so files stay human-readable, diff cleanly, and parse without a YAML library.
export function serialize(meta, body) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null) continue;
    lines.push(`${k}: ${JSON.stringify(v)}`);
  }
  lines.push('---', '');
  return lines.join('\n') + body.replace(/\s+$/, '') + '\n';
}

export function parse(text) {
  text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const mm = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!mm) continue;
    meta[mm[1]] = parseValue(mm[2].trim());
  }
  return { meta, body: m[2].replace(/^\n/, '') };
}

function parseValue(raw) {
  if (raw === '') return '';
  try { return JSON.parse(raw); } catch { /* fall through: hand-edited plain YAML */ }
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return raw.slice(1, -1).split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }
  return raw.replace(/^['"]|['"]$/g, '');
}
