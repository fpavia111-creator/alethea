---
name: agent-decision-memory
description: Use at the start and end of any coding task in a repo that has a .decisions/ folder or the agent-decision-memory MCP server. Loads past architecture decisions and constraints before work, checks plans against constraints, and records new decisions afterwards.
---

# Agent decision memory

This repo keeps its architecture decisions (ADR-style) and hard constraints in `.decisions/`, served by the `agent-decision-memory` MCP server. You do not remember earlier sessions; this is how you find out what was already decided.

## Before you change anything

1. Call `get_context_for_task` with the task text and every file path you expect to touch (`task`, `paths`).
2. Read every returned **constraint**. They are binding. If the task cannot be done without breaking one, stop and tell the user. Do not work around it quietly.
3. Read the returned **decisions**. Follow them unless the user explicitly asks to change course.
4. Note the returned `requirements` (SpecGate ids like `capability/requirement`). Tag new tests for them with `// @req <id>`.

## Before you commit or propose a diff

Call `check_conflicts` with a summary or the diff as `change` and the touched paths as `files`.
- `ok: false` means you broke an accepted constraint. Fix the change.
- `warnings` mean you picked an option an earlier decision rejected. Mention that to the user, and if they agree, supersede the decision (see below).

## After the work

- Made a non-obvious choice (a library, a pattern, a data model, a trade-off)? Call `record_decision` with `title`, `context`, `decision`, `alternatives` (what you rejected and why), `consequences`, the `files` globs it governs, and any `requirements`.
- Found a rule future agents must never break? Record it with `type: "constraint"` and machine-checkable `rules` (`"forbid: axios"`, `"forbid: /eval\\(/"`, `"require: @req"`, `"forbid-path: src/generated/**"`).
- Replacing an earlier decision? Use `supersede_decision`. Never delete or rewrite the old one.
- After tests or a commit exist, call `link_requirement` to attach the SpecGate ids, test files and commit sha.

Don't record trivial edits. One good decision beats ten notes.

The `adm://constraints/active` resource holds all active constraints if you want them in context up front.
