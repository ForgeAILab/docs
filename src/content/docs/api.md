---
title: "REST API & MCP tools"
description: "HTTP endpoints, pagination, SSE events, and the seven MCP tools."
editUrl: https://github.com/ForgeAILab/forge/edit/main/docs/api.md
---
# API Reference

All endpoints are under `/api/v1/`. The MCP endpoint is `POST /mcp`. The default
bind is `127.0.0.1:8080`.

## Authentication

Forge ships a real auth system. Every endpoint except `POST /api/v1/auth/register`,
`POST /api/v1/auth/login`, and `POST /api/v1/auth/refresh` requires a bearer token.
The first user to register becomes the admin and inherits any orphan resources
(bootstrap), so the first call after install should be `POST /api/v1/auth/register`.

Three token types, all sent as `Authorization: Bearer <token>`:

| Token | Where it comes from | Use for |
|-------|--------------------|---------|
| JWT access token | `POST /api/v1/auth/login` | Web UI / short-lived scripts. Refresh via `POST /api/v1/auth/refresh`. |
| Personal Access Token (`fg_…`) | `POST /api/v1/auth/tokens` | `forge-ctl`, MCP clients, long-running scripts. |
| Daemon registration token | Returned at daemon registration | Daemon `POST /api/v1/daemons/{id}/report` only. |

The MCP endpoint accepts a PAT or JWT in `Authorization: Bearer …` *or* as a
`?token=` query parameter (some MCP clients can only pass query strings). MCP
requests are scoped to the authenticated user's project memberships.

The CLI list endpoint (`GET /api/v1/clis`) filters daemons to those visible to
the caller (global visibility or owner match).

For the conceptual model behind these endpoints see
[architecture](/docs/architecture/).

## REST endpoints

### Auth & users

| Method | Path | Description |
|--------|------|-------------|
| POST   | `/api/v1/auth/register` | Register a user (first user becomes admin / bootstraps orphan resources) |
| POST   | `/api/v1/auth/login` | Issue a JWT + refresh token |
| POST   | `/api/v1/auth/refresh` | Rotate refresh token, return new access token |
| POST   | `/api/v1/auth/logout` | Revoke the current refresh token |
| GET    | `/api/v1/auth/me` | Return the current user (includes `is_admin`) |
| POST   | `/api/v1/auth/tokens` | Mint a `fg_…` Personal Access Token |
| GET    | `/api/v1/auth/tokens` | List PATs |
| DELETE | `/api/v1/auth/tokens/{id}` | Revoke a PAT |

### Projects, repos, members, integrations

| Method | Path | Description |
|--------|------|-------------|
| POST/GET/PATCH | `/api/v1/projects` `…/{id}` | CRUD project (and `paused_at`) |
| POST/GET       | `/api/v1/projects/{id}/repos` | Repos under a project |
| GET/POST/DELETE | `/api/v1/projects/{id}/members` | Project membership |
| GET/POST       | `/api/v1/projects/{id}/integrations` | GitHub / Gitea external issue sync config |
| GET/PATCH      | `/api/v1/projects/{id}/settings` | Project settings (hooks, review defaults, redaction patterns) |

### Tasks

| Method | Path | Description |
|--------|------|-------------|
| POST   | `/api/v1/projects/{id}/tasks` | Create task |
| GET    | `/api/v1/projects/{id}/tasks` | List tasks (paginated, filterable) |
| GET/PATCH/DELETE | `/api/v1/tasks/{id}` | Get / update / soft-delete task |
| POST   | `/api/v1/tasks/{id}/claim` | Claim task (auto-dispatches the executor) |
| POST   | `/api/v1/tasks/{id}/cancel` | Cancel task (idempotent) |
| POST   | `/api/v1/tasks/{id}/archive` | Archive task (hidden from default lists) |
| POST   | `/api/v1/tasks/{id}/transition` | Transition status; entering `review` returns `{task, review}` inline |
| POST   | `/api/v1/tasks/{id}/review` | Re-run the CI steps without changing state |
| POST   | `/api/v1/tasks/{id}/gates/{state}/approve` | Approve a generic gate |
| POST   | `/api/v1/tasks/{id}/gates/{state}/reject` | Reject a generic gate (consumes retry budget) |
| GET    | `/api/v1/tasks/{id}/transitions` | Audit log of state transitions |
| GET/POST/DELETE | `/api/v1/tasks/{id}/dependencies` | Task dependencies |
| GET/POST       | `/api/v1/tasks/{id}/comments` | Task comments |
| GET/POST/DELETE | `/api/v1/tasks/{id}/roles` | Per-task role assignments (`coder`, `reviewer`, …) |
| GET    | `/api/v1/tasks/{id}/workspace` | Worktree status + diff |

### Agents, daemons, executions, CLIs

| Method | Path | Description |
|--------|------|-------------|
| POST/GET | `/api/v1/agents` | Register / list agents |
| GET      | `/api/v1/agents/{id}` | Get agent |
| GET      | `/api/v1/daemons` | List daemons (filtered by membership) |
| POST     | `/api/v1/daemons/{id}/report` | Daemon CLI inventory + heartbeat (registration-token auth) |
| GET      | `/api/v1/clis` | CLIs visible to the caller |
| GET      | `/api/v1/tasks/{id}/executions` | List executions |
| GET      | `/api/v1/executions/{id}` | Get execution |
| GET      | `/api/v1/executions/{id}/logs` | Get JSONL execution logs |
| POST     | `/api/v1/executions/{id}/stop` | Stop an execution |
| POST     | `/api/v1/executions/{id}/follow-up` | Create a follow-up execution |
| GET      | `/api/v1/executor_types` | List adapter types (`claude_code`, `codex`, …) |
| GET      | `/api/v1/profiles` | Executor profile presets |

### Conversations, notifications, operations

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/v1/projects/{id}/conversations` | Chat conversations |
| POST     | `/api/v1/conversations/{id}/messages` | Send chat message |
| GET      | `/api/v1/notifications` | List notifications |
| POST     | `/api/v1/notifications/{id}/read` | Mark notification read |
| GET      | `/api/v1/projects/{id}/operations` | Operations snapshot (effective policies, exceptions) |
| GET/POST | `/api/v1/workflow_templates` | Workflow templates |
| POST     | `/api/v1/projects/{id}/workflow` | Apply / update a project workflow definition |
| GET      | `/api/v1/events` | Server-sent events stream |
| POST     | `/mcp` | MCP JSON-RPC endpoint |

## Pagination

All list endpoints use opaque keyset cursors: base64-encoded JSON
`{sort_by, sort_order, last_value, last_id}`. The `db` layer queries `limit + 1`
rows to determine `has_more`. The response field is `items` (not `data`).

### Query parameters

| Param | Description |
|-------|-------------|
| `cursor` | Opaque pagination cursor returned from the previous page |
| `limit` | Page size (default 20, max 100) |
| `sort_by` | `created_at`, `updated_at`, `priority`, `board_position`, `title`, `status`, `agent`, `task_type`, `id` |
| `sort_order` | `asc`, `desc` |
| `status` | Comma-separated status filter |
| `agent_id` | Comma-separated agent filter |
| `assignee_type` | Comma-separated assignee type filter (`agent`, `user`) |
| `assignee_id` | Comma-separated assignee id / user-handle filter |
| `include_cancelled` | Include cancelled tasks (default false unless `status` includes `cancelled`) |
| `include_archived` | Include archived tasks (default false) |
| `include_total` | Include total count in response |

## Errors

All errors render as:

```json
{
  "code": "version_conflict",
  "message": "task version mismatch",
  "details": { "expected": 3, "actual": 4 },
  "request_id": "req_..."
}
```

Common HTTP mappings:

| Status | When |
|--------|------|
| 400 | Validation failure |
| 404 | Resource not found |
| 409 | Optimistic version conflict, role assignment conflict |
| 412 | Workflow guard rejection (`before_exit` blocked the transition) |
| 422 | Illegal state transition |
| 500 | Internal error |

## Server-Sent Events

`GET /api/v1/events` streams `ForgeEvent` payloads from the in-memory event
bus. Useful for the web UI and for long-running scripts that want to react to
state changes (`task.status_changed`, `execution.completed`, …) without
polling.

## MCP tools

Forge exposes a JSON-RPC 2.0 tool surface at `POST /mcp` (PAT or JWT auth
required — see [Authentication](#authentication)). The MCP server has its own
`McpState` and does not depend on the `api` crate. Disable it entirely with
`forge --no-mcp`.

| Tool | Purpose |
|------|---------|
| `forge_create_task` | Create a new task (uses the project's primary repo) |
| `forge_list_tasks` | List tasks with optional status / sort filters |
| `forge_get_task` | Get task detail |
| `forge_update_task` | Update title, description, priority, or plan |
| `forge_assign_agent` | Atomic claim — assign an agent to a task |
| `forge_transition_task` | Move a task to a new workflow status |
| `forge_cancel_task` | Cancel a task |
| `forge_get_task_diff` | Get the code diff for a task's worktree |
| `forge_list_executions` | List executions for a task |
| `forge_follow_up_execution` | Send a follow-up message to resume an agent session |
| `forge_create_sub_tasks` | Create ordered subtasks under a parent task |
| `forge_add_task_dependency` | Declare that a task depends on another task |
| `forge_remove_task_dependency` | Remove a dependency between two tasks |
| `forge_list_task_dependencies` | List prerequisite tasks for a task |
| `forge_register_agent` | Register an agent executor |
| `forge_list_agents` | List registered agents with optional status filter |
| `forge_list_projects` | List projects |
| `forge_create_project` | Create a project |
| `forge_get_project` | Get a project including settings and lifecycle hooks |
| `forge_update_project` | Update project name, settings, or paused state |
| `forge_update_project_lifecycle_hooks` | Replace a project's lifecycle hooks |

For the conceptual model see [MCP for agents](/docs/concepts/mcp/) (how to wire
Claude Code, Codex, Cursor, etc.).

## Execution logs

Execution chat history is backed by Forge JSONL logs plus execution prompt
metadata, not by agent-private transcript storage. See
[execution logs](/docs/execution-logs/) for the adapter-specific details and
log schema.
