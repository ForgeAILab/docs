---
title: "Knowledge"
description: "How Forge's built-in knowledge base stores project conventions and injects them into agent prompts."
---
# Knowledge

Forge has a built-in knowledge base per project. It is a curated set of short notes — lessons learned, project conventions, non-obvious gotchas — stored as Markdown files in your repository. Two lifecycle plugins manage the knowledge base automatically: one injects relevant entries into agent prompts before work begins, and one captures new knowledge from completed tasks.

## Directory layout

The knowledge base lives under `docs/knowledge/` in the project repository:

```
docs/knowledge/
├── KNOWLEDGE.md          # Index / table of contents
├── architecture/         # Architecture decisions and patterns
├── gotchas/              # Non-obvious pitfalls and workarounds
├── patterns/             # Reusable code patterns and conventions
├── environment/          # Setup, tooling, and environment notes
├── debugging/            # Debugging techniques and known issues
└── conventions/          # Project-specific conventions and standards
```

Additional category directories can be added. Category names must be lowercase kebab-case.

If `docs/knowledge/` does not exist when the capture plugin first fires, the plugin creates the directory structure and a `KNOWLEDGE.md` index stub.

## Entry format

Each entry is a Markdown file with YAML frontmatter. Required frontmatter fields:

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Human-readable title |
| `category` | string | Matches the parent directory name |
| `tags` | list of strings | Lowercase search terms (at least one required) |
| `created_by` | string | Agent ID, plugin name, or `"user"` for manual entries |
| `task_id` | string (optional) | The task that produced this knowledge |
| `created_at` | string | ISO 8601 timestamp |
| `updated_at` | string | ISO 8601 timestamp |

The body must start with a 1–2 sentence summary, followed by details or code examples. Entries should stay under 100 lines. One concept per file. File names are lowercase kebab-case derived from the title, with a `.md` suffix, placed in the correct category subdirectory.

Example:

```markdown
---
title: "sqlx Row::get panics on NULL — use try_get"
category: gotchas
tags: [sqlx, database, null, rust]
created_by: "agent-abc123"
task_id: "task-xyz789"
created_at: "2026-03-15T10:22:00Z"
updated_at: "2026-03-15T10:22:00Z"
---

`sqlx::Row::get()` panics when the column value is NULL. Use `try_get()` instead and handle the `Err` variant.

```rust
// Panics on NULL:
let name: String = row.get("display_name");

// Safe:
let name: Option<String> = row.try_get("display_name").ok();
```
```

## The knowledge index

`docs/knowledge/KNOWLEDGE.md` is a table of contents. Each entry appears as:

```
- [Title](category/filename.md) — tag1, tag2
```

Entries are grouped by category and sorted alphabetically. The capture plugin regenerates `KNOWLEDGE.md` each time it writes a new entry. If the index becomes stale (an entry exists in a category subdirectory but is missing from the index), the entry is still discoverable via file search — individual entry files are authoritative.

## The knowledge-inject plugin

The `knowledge-inject` plugin fires on the `before_work` lifecycle event, before the agent is dispatched. It:

1. Checks whether `docs/knowledge/KNOWLEDGE.md` exists. If not, skips with reason `no_knowledge_base` and proceeds normally.
2. Searches entry frontmatter and bodies for terms related to the task (title words, mentioned file paths, module names).
3. Selects the top ~5 most relevant entries.
4. Appends a "Knowledge Context" section to the agent's dispatch prompt with entry summaries.

Total injected content is capped at ~2,000 tokens to preserve the agent's context budget.

## The knowledge-capture plugin

The `knowledge-capture` plugin fires on the `on_task_done` lifecycle event. It reads the completed task's execution logs — assistant messages, tool calls, file changes — and identifies non-obvious patterns: gotchas encountered, architecture decisions made, debugging techniques that worked, conventions established.

The plugin skips entries for:

- Information already in the knowledge base.
- Trivial facts.
- Temporary workarounds.
- Task-specific implementation details that will not generalise.

When the task's worktree is still available, the plugin commits new and updated knowledge files to the task branch. The commit message indicates automated knowledge capture. If no meaningful knowledge is found, the plugin returns `skipped` with reason `no_knowledge_found` and writes nothing.

## User curation

The knowledge base is ordinary files in your repository. You review and curate captured entries through your normal PR workflow:

- When a task branch includes new files in `docs/knowledge/`, they appear in the PR diff alongside code changes. Edit quality, adjust categories, or delete entries before merging.
- To write a manual entry, create a Markdown file following the frontmatter schema above with `created_by: "user"`. The knowledge-inject plugin will discover it on the next dispatch.

## Related pages

- [Hooks](/docs/concepts/hooks/) — lifecycle events that trigger the inject and capture plugins
- [Tasks](/docs/concepts/tasks/) — task lifecycle and execution model
- [Agents](/docs/concepts/agents/) — how agents receive dispatched prompts
