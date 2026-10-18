import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-'));
  fs.mkdirSync(path.join(dir, '.git'));
  return dir;
}
export function writeSpec(root, cap, text) {
  const d = path.join(root, 'openspec', 'specs', cap);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'spec.md'), text);
}
