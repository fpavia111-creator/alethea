#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '../src/server.js';
import { resolveRoot } from '../src/store.js';

const i = process.argv.indexOf('--root');
const root = resolveRoot(i > 0 ? process.argv[i + 1] : undefined);
const { server } = createServer(root);
await server.connect(new StdioServerTransport());
process.stderr.write(`agent-decision-memory MCP server on stdio (root: ${root})\n`);
