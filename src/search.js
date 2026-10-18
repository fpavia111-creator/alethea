// Pure-JS BM25 index (no native deps). Persisted as JSON so repeated CLI/MCP calls skip re-tokenising.
const STOP = new Set('a an and are as at be by for from has have in is it its of on or that the this to was were will with we our not no use using'.split(' '));

export function tokenize(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t)).map(stem);
}

function stem(t) {
  if (t.length > 5 && t.endsWith('ing')) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  if (t.length > 4 && t.endsWith('ed')) return t.slice(0, -2);
  return t;
}

export function buildIndex(docs) {
  // docs: [{ id, fields: { title, body, tags, ... } }] — title & tags weighted x3
  const index = { version: 1, docs: {}, df: {}, avgdl: 0, n: 0 };
  let total = 0;
  for (const d of docs) {
    const tokens = [...tokenize(d.title).flatMap((t) => [t, t, t]), ...tokenize(d.tags).flatMap((t) => [t, t, t]), ...tokenize(d.text)];
    const tf = {};
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
    index.docs[d.id] = { len: tokens.length, tf };
    for (const t of Object.keys(tf)) index.df[t] = (index.df[t] || 0) + 1;
    total += tokens.length;
  }
  index.n = docs.length;
  index.avgdl = index.n ? total / index.n : 0;
  return index;
}

export function query(index, text, { k1 = 1.2, b = 0.75 } = {}) {
  const q = [...new Set(tokenize(text))];
  const out = [];
  for (const [id, d] of Object.entries(index.docs)) {
    let score = 0;
    for (const t of q) {
      const f = d.tf[t];
      if (!f) continue;
      const df = index.df[t] || 0;
      const idf = Math.log(1 + (index.n - df + 0.5) / (df + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / (index.avgdl || 1))));
    }
    if (score > 0) out.push({ id, score });
  }
  return out.sort((a, b2) => b2.score - a.score);
}
