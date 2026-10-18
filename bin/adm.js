#!/usr/bin/env node
import { run } from '../src/cli.js';

const argv = process.argv.slice(2);
const res = await run(argv);
if (res.code === -1) {
  const i = argv.indexOf('--root');
  if (i > 0) process.env.ALETHEA_ROOT = process.env.ADM_ROOT = argv[i + 1];
  await import('./adm-mcp.js');
} else {
  if (res.out) process.stdout.write(res.out);
  if (res.err) process.stderr.write(res.err);
  process.exitCode = res.code;
}
