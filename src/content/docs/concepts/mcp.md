---
title: "MCP for agents"
description: "Wire Claude Code, Codex, Cursor, or any MCP client to Forge's JSON-RPC 2.0 tool surface."
---

# MCP for agents

Model Context Protocol (MCP) is a JSON-RPC 2.0 standard for agent-to-tool
integration. An MCP-compatible client (Claude Code, Codex, Cursor, or any other) sends
tool calls over HTTP; Forge's MCP server dispatches them to the right handler and
returns structured results. This lets an AI agent create, claim, and transition Forge
tasks without going through the REST API directly.

## Endpoint

```
POST http://127.0.0.1:8080/mcp
```

Forge implements MCP protocol version `2025-03-26`. The server responds HTTP 200 for
all JSON-RPC replies, including errors (per spec). Disable the endpoint entirely with:

```bash
forge --no-mcp
# or in forge.toml:
[server]
mcp_enabled = false
```

When disabled, `POST /mcp` returns HTTP 404. All other routes are unaffected.

## Authentication

Every MCP request requires a PAT (`fg_…`) or JWT access token. Pass it in either of
two ways:

```http
Authorization: Bearer fg_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

or as a query parameter (useful when your client cannot set request headers):

```
POST http://127.0.0.1:8080/mcp?token=fg_xxx...
```

Unauthenticated requests receive HTTP 401 before the JSON-RPC handler runs. See
[Auth & users](/docs/concepts/auth/) for how to create a PAT.

## Project scoping

Pass `project_id` in each tool call, or scope the entire MCP session to one project
by adding an `x-forge-project-id` header. When a project is scoped at the session
level, Forge enforces that the authenticated user is a member. Non-member access to an
owned project returns JSON-RPC error `-32001 "project not accessible"`. System projects
(created before bootstrap) are accessible to all authenticated users.

## Client setup

### Claude Code

Add Forge to your Claude Code MCP config. The config file lives at
`~/.claude/claude_desktop_config.json` (or `~/.claude.json` — check your Claude Code
version):

```json
{
  "mcpServers": {
    "forge": {
      "url": "http://127.0.0.1:8080/mcp",
      "headers": {
        "Authorization": "Bearer fg_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

Restart Claude Code after saving. Run `/mcp` in the Claude Code prompt to verify
`forge` appears and its tools are listed.

### Codex

Codex uses the same MCP HTTP format. Add to your Codex config (typically
`~/.codex/config.json` or the project-level `codex.json`):

```json
{
  "mcpServers": {
    "forge": {
      "url": "http://127.0.0.1:8080/mcp",
      "headers": {
        "Authorization": "Bearer fg_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

If your Codex version does not support custom headers, use the query-param form:

```json
{
  "mcpServers": {
    "forge": {
      "url": "http://127.0.0.1:8080/mcp?token=fg_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    }
  }
}
```

### Cursor and other MCP clients

Cursor and generic MCP clients that support HTTP transport accept:

- **Endpoint:** `http://127.0.0.1:8080/mcp`
- **Auth:** `Authorization: Bearer <pat>` header, or append `?token=<pat>` to the URL

Refer to your client's MCP configuration docs for the exact field names.

## Tool surface

The full input schemas are available from the server itself via `tools/list`. For the
reference table see [API reference — MCP tools](/docs/api/#mcp-tools).

Tools by category:

| Category | Tools |
|----------|-------|
| Tasks | `forge_create_task`, `forge_list_tasks`, `forge_get_task`, `forge_update_task`, `forge_assign_agent`, `forge_transition_task`, `forge_cancel_task` |
| Subtasks & dependencies | `forge_create_sub_tasks`, `forge_add_task_dependency`, `forge_remove_task_dependency`, `forge_list_task_dependencies` |
| Diff & executions | `forge_get_task_diff`, `forge_list_executions`, `forge_follow_up_execution` |
| Agents | `forge_register_agent`, `forge_list_agents` |
| Projects | `forge_list_projects`, `forge_create_project`, `forge_get_project`, `forge_update_project`, `forge_update_project_lifecycle_hooks` |

### `forge_create_task`

Creates a root task. Pass `project_id` and `title`. The task is created in the
project's primary repo — `repo_id` is not exposed at the MCP layer.

### `forge_create_sub_tasks`

Creates one or more subtasks under a root task. The order of the `subtasks` array
determines display order (`subtask_order`). By default subtasks are independent and
each can be claimed separately. Pass `mode: "ordered_turn"` on a subtask to make it
inherit the parent's assigned coder and execute in turn. Nested subtasks (subtask of a
subtask) are rejected. See [subtasks and dependencies](/docs/concepts/subtasks-and-dependencies/)
for the full execution model.

### `forge_transition_task`

Moves a task to a new status. Requires `task_id`, `status`, and `version` (optimistic
concurrency — use the `version` from the last `forge_get_task` response). A stale
version returns JSON-RPC error `-32002` with `"version conflict"` in the message.

Valid statuses: `todo`, `in_progress`, `review`, `merging`, `merge_failed`, `done`,
`cancelled`, `blocked`.

## Example workflow

Here is how a typical agent session looks using Claude Code:

```
You: Break "add dark mode" into Forge tasks for project proj_abc, then claim the first one.

Claude: [calls forge_create_task × 3, then forge_assign_agent on the first task]
        Created three tasks. Claimed "Implement CSS variables" (task_xyz). Starting work.

You: What does the diff look like so far?

Claude: [calls forge_get_task_diff with task_id = "task_xyz"]
        Here is the current diff: ...

You: Looks good — move it to review.

Claude: [calls forge_transition_task with status = "review", version = current]
        Task is now in review.
```

The agent can also check execution logs (`forge_list_executions`, then
`forge_follow_up_execution` to send a follow-up instruction to a running or completed
execution), add dependencies between tasks (`forge_add_task_dependency`), or comment
on a task via the REST API at `POST /api/v1/tasks/{id}/comments`.
