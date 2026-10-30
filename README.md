# Alethea of Agents (`alethea`)

*Formerly **agent-decision-memory** (`adm`). The npm package is now `@kurtfrancisco/alethea` with commands `alethea` and `alethea-mcp`. The `adm` / `adm-mcp` commands, the MCP tool names, `ADM_ROOT` and the `.decisions/` folder keep working.*

[![CI](https://github.com/fpavia111-creator/alethea/actions/workflows/ci.yml/badge.svg)](https://github.com/fpavia111-creator/alethea/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@kurtfrancisco/alethea.svg)](https://www.npmjs.com/package/@kurtfrancisco/alethea)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.github.fpavia111--creator%2Falethea-blue)](https://registry.modelcontextprotocol.io)

> Persistent decision and constraint memory for coding agents: a local stdio MCP server and CLI that store ADR-style decisions as git-friendly markdown, linked to Janus of Agents (formerly SpecGate) requirement ids, tests and commits.

## Quickstart

**Install** (Node.js ≥ 20):

```bash
npm install -g @kurtfrancisco/alethea   # provides `alethea` and `alethea-mcp` (plus legacy `adm` / `adm-mcp`)
```

**Claude Code**

```bash
claude mcp add decision-memory -- npx -y -p @kurtfrancisco/alethea@0.2.1 alethea-mcp
```

**Cursor** — add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project). The same snippet works for Claude Desktop, VS Code and Windsurf:

```json
{ "mcpServers": { "decision-memory": { "command": "npx", "args": ["-y", "-p", "@kurtfrancisco/alethea@0.2.1", "alethea-mcp"] } } }
```

Restart the client and the tools appear. Full details below.


Coding agents forget what was decided between sessions. They bring back the library you removed last month, undo a trade-off nobody wrote down, and edit generated code. `adm` gives them a decision memory: a local **stdio MCP server** and a **CLI** that store ADR-style **decisions** and machine-checkable **constraints** as plain markdown in your repo's `.decisions/` folder. Each record can be linked to [SpecGate](#specgate-links) requirement ids, test files and commits.

- **Git-friendly storage.** One markdown file per record, with JSON-valued frontmatter (valid YAML). Review it in PRs and edit it by hand.
- **No native dependencies.** Search uses a pure-JS BM25 index, cached in `.decisions/.index.json` (gitignored). The only runtime deps are `@modelcontextprotocol/sdk` and `zod`.
- **Cross-platform.** Node ≥ 20 on Windows, macOS and Linux. Paths are normalized, so `src\db\x.ts` and `src/db/x.ts` match the same globs. No symlinks.

## Install (Windows PowerShell)

```powershell
cd C:\path\to\agent-decision-memory
npm ci            # uses the committed package-lock.json
npm run build     # syntax check + import check
npm test
npm link          # optional: puts `adm` and `adm-mcp` on PATH
```

macOS/Linux: run the same commands.

### Register with Claude Code

```powershell
claude mcp add decision-memory -- node C:\path\to\agent-decision-memory\bin\adm-mcp.js
```

The server uses the current directory to find the repo: the nearest ancestor that has `.decisions/` or `.git/`. To pin a repo, pass `--root C:\repo` or set `$env:ALETHEA_ROOT = "C:\repo"` (`ADM_ROOT` also works). A generic MCP client config looks like this:

```json
{ "mcpServers": { "decision-memory": { "command": "node", "args": ["C:/path/to/agent-decision-memory/bin/adm-mcp.js", "--root", "C:/repo"] } } }
```

### Install the skill

Copy the skill folder into your project (or into `$HOME\.claude\skills` to use it everywhere):

```powershell
New-Item -ItemType Directory -Force .claude\skills | Out-Null
Copy-Item -Recurse C:\path\to\agent-decision-memory\skills\agent-decision-memory .claude\skills\
```

The skill tells the agent to call `get_context_for_task` before it starts, `check_conflicts` before it commits, and `record_decision`, `supersede_decision` or `link_requirement` after the work. See the Claude Code skills docs: <https://code.claude.com/docs/en/skills>.

## MCP surface

| Tool | Purpose |
|---|---|
| `record_decision` | Record a decision (or `type: "constraint"`) with context, decision, alternatives, consequences, status, files, tests, commits, requirements, rules and supersedes |
| `search_decisions` | BM25 search. Returns active records only unless `include_inactive` or `status` is set |
| `get_context_for_task` | For task text and/or file paths: in-scope active constraints, the top decisions (file-scope matches boosted) and their requirement ids |
| `supersede_decision` | Write a replacement record. The old one becomes `superseded` and the two are cross-linked |
| `list_constraints` | Active constraints, optionally filtered to those whose scope covers a path |
| `check_conflicts` | Check a proposed change (text or diff plus files) against constraint rules. `ok:false` means an accepted constraint is violated. It also warns when the change picks an alternative that an active decision rejected |
| `link_requirement` | Attach SpecGate ids, test files and commit SHAs. Ids are checked against `openspec/specs` when present |

Resources: `adm://constraints/active` (markdown) and `adm://decisions/{id}` (JSON).

### Constraint rules

`forbid: axios` (whole word, case-insensitive), `forbid: /eval\(/` (regex), `require: @req` (the change text must contain it), and `forbid-path: src/generated/**` (glob on the touched files). A constraint applies only to its `files` scope; with no scope it covers the whole repo. A `proposed` constraint produces warnings. An `accepted` one produces errors.

## CLI

```powershell
adm init
adm record --title "Use date-fns" --decision "parseISO/format, ISO strings" --alternative "Moment.js: deprecated" --file "src/todos/**" --req todos/due-date
adm record --type constraint --title "No moment.js" --decision "bundle size" --rule "forbid: moment" --file "src/**"
adm context --task "validate due date" --file src/todos/create.ts
adm check --change-file .\my.diff --file src/todos/create.ts   # exit code 1 on a violation (CI-friendly)
adm supersede D-0001 --title "Use Fastify" --decision "..."
adm link D-0002 --req todos/due-date#invalid-date-rejected --commit 1a2b3c4 --test test/todos.test.ts
adm search "http server" --all
adm import --dir docs/adr          # Nygard (adr-tools) and MADR formats; idempotent
adm export --format json --out decisions.json   # or markdown
adm serve                          # same as adm-mcp
```

Every command also takes `--json` and `--root <dir>`. Run `npm run demo` to see an end-to-end run: it records with the CLI and queries through a real MCP client over stdio.

## Record format

```markdown
---
id: "D-0002"
type: "decision"
title: "Use date-fns for dates"
status: "accepted"
date: "2026-10-15"
tags: ["dates"]
requirements: ["todos/due-date"]
files: ["src/todos/**"]
tests: []
commits: []
---
# D-0002: Use date-fns for dates

## Context
## Decision
## Alternatives
## Consequences
```

Statuses: `proposed`, `accepted`, `superseded`, `deprecated` and `rejected`. Only `proposed` and `accepted` count as active. Supersession adds `supersedes` and `superseded_by` links.

## SpecGate links

Requirement ids use the SpecGate 0.3 format: `### Requirement: Due date` in `openspec/specs/todos/spec.md` becomes `todos/due-date`, and scenarios become `todos/due-date#invalid-date-rejected`. `link_requirement` reads `openspec/specs/*/spec.md` and `openspec/changes/*/specs/*/spec.md`. An unknown id is still linked, but you get a warning.

## How it compares

| Project | What it stores | Difference |
|---|---|---|
| [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) | Knowledge graph of code structure | Indexes code, not the reasons behind it |
| [Beads](https://github.com/steveyegge/beads) | Issue/task graph for agents | Tracks work items, not decisions or constraints |
| [Cognee](https://github.com/topoteretes/cognee) | General AI memory (graph + vectors) | General-purpose, and needs a heavier stack |
| [Graphiti](https://github.com/getzep/graphiti) | Temporal knowledge graphs | Needs a graph DB. Raw facts, no ADR structure |
| [MCP memory server](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) | Entity/relation notes in a JSON file | Unstructured notes, no rules or conflict checks |
| [Mem0](https://github.com/mem0ai/mem0) | User/agent memories | Personalization memory, not repo decisions |
| [adr-tools](https://github.com/npryce/adr-tools), [MADR](https://adr.github.io/madr/) | ADR markdown | Human-facing. No agent API, search or rule checks. `adm import` reads both formats |

## Limitations

- Conflict detection uses keyword, regex and glob rules. It does not understand meaning, so a rule like `forbid: moment` will not catch a paraphrase, and the rejected-alternative warning is a heuristic based on the alternative's name.
- BM25 is lexical (with light stemming). There are no embeddings, so synonyms are not matched.
- IDs are allocated per machine (`max + 1`). If two branches each record a decision, both can get the same number. Rename one by hand when you merge.
- The index is rebuilt in memory whenever any file's size or mtime changes. That is fine for hundreds of records but not tuned for tens of thousands.

## License

MIT © 2026 Kurt Francisco

## Contributing

Issues and pull requests are welcome at https://github.com/fpavia111-creator/alethea. See [CONTRIBUTING.md](CONTRIBUTING.md).
