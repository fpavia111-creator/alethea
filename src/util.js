import path from 'node:path';

export const STATUSES = ['proposed', 'accepted', 'superseded', 'deprecated', 'rejected'];
export const ACTIVE = new Set(['accepted', 'proposed']);
export const REQ_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*(?:#[a-z0-9]+(?:-[a-z0-9]+)*)?$/;

export function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'untitled';
}

/** Forward-slash, no leading ./ — so Windows paths match the same globs. */
export function normPath(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^[A-Za-z]:/, (d) => d.toLowerCase());
}

export function globToRegex(glob) {
  const g = normPath(glob);
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { re += g[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += g[i + 2] === '/' ? 2 : 1; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

/** A scope entry matches a path if it is a glob that matches, an exact path, or a directory prefix. */
export function pathMatches(scope, file, root) {
  let f = normPath(file);
  if (root && path.isAbsolute(file)) f = normPath(path.relative(root, file));
  const s = normPath(scope).replace(/\/$/, '');
  if (/[*?]/.test(s)) return globToRegex(s).test(f);
  const fl = f.toLowerCase(), sl = s.toLowerCase();
  return fl === sl || fl.startsWith(sl + '/');
}

export function today() { return new Date().toISOString().slice(0, 10); }

export function asArray(v) {
  if (v === undefined || v === null || v === '') return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}
