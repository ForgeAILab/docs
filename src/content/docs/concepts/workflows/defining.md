---
title: "Defining a workflow"
description: "Write a custom workflow in JSON, validate it, and apply it to a project — either directly or via a template."
---

# Defining a workflow

A custom workflow replaces the default workflow entirely for a project. You
write it as JSON in `project.workflow_definition`, and Forge validates and
caches the resolved definition.

This page covers the JSON shape, the validation rules, and how to apply
workflows safely to projects that already have tasks. For the conceptual
model, see [How workflows work](/docs/concepts/workflows/how-it-works/).

## Minimum viable workflow

The smallest valid workflow has one `initial` state, at least one `terminal`
state, and every other state reachable from the initial state.

```json
{
  "roles": [
    { "name": "coder", "label": "Coder" }
  ],
  "states": [
    {
      "name": "ready",
      "kind": "initial",
      "column": "Todo",
      "label": "Ready"
    },
    {
      "name": "coding",
      "kind": "active",
      "role": "coder",
      "column": "In Progress",
      "label": "Coding"
    },
    {
      "name": "done",
      "kind": "terminal",
      "column": "Done",
      "label": "Done"
    },
    {
      "name": "cancelled",
      "kind": "terminal",
      "column": "Done",
      "label": "Cancelled"
    }
  ]
}
```

Apply it by PATCHing the project:

```bash
curl -X PATCH :8080/api/v1/projects/$PROJECT_ID \
  -H 'authorization: Bearer fg_…' \
  -H 'content-type: application/json' \
  -d '{"workflow_definition": "<JSON string>"}'
```

When `workflow_definition` is empty or `"{}"`, Forge resolves to the built-in
default workflow at runtime.

## Field reference

### `roles`

A list of declared roles. Each role can be referenced by `state.role`.

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Role identifier. `assignee` is reserved by the engine. |
| `label` | string | Display label for the UI. |

### `states`

A list of states. The order matters for column primary-state resolution (the
first state declared for a column is the drag target).

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | State identifier, unique within the workflow. |
| `kind` | enum | One of `backlog`, `initial`, `active`, `gate`, `terminal`, `custom`. |
| `role` | string? | Optional role binding. Active states default to `assignee` when omitted. |
| `column` | string | Kanban column label. Multiple states can share a column. |
| `label` | string | Display label for the UI. |
| `transitions` | list? | Outbound transitions. Optional; the cancellation path is implicit. |
| `gate_config` | object? | Only for `kind = gate`. See below. |
| `hooks` | object? | Per-phase hooks: `before_exit`, `on_exit`, `on_enter`, `after_enter`, `before_enter`. See [Lifecycle hooks](/docs/concepts/hooks/). |

### `state.transitions[]`

| Field | Type | Notes |
|-------|------|-------|
| `to` | string | Target state name. |
| `label` | string | Display label for the edge. |
| `audience` | enum | `all`, `agent_only`, `user_only` — who can trigger it. |

### `state.gate_config`

| Field | Type | Notes |
|-------|------|-------|
| `max_rejections` | int | Retry budget. See [Gates and retries](/docs/concepts/workflows/gates/). |
| `reject_target` | string | Where the task lands on rejection (typically the upstream active state). |
| `requires_human_approval` | bool | When `true`, the gate's auto-approve path is disabled. |

### Top-level fields

| Field | Type | Notes |
|-------|------|-------|
| `cancellation_state` | string? | Implicit cancellation target. Defaults to a terminal `cancelled` state if present. |
| `initial_state` | string? | Override the resolved initial state if you have an unusual graph. Most workflows omit this. |

## Validation rules

The API rejects a workflow definition with HTTP 400 if any of these fail:

- Exactly one state has `kind: initial`.
- At least one state has `kind: terminal`.
- Every non-initial state is reachable from the initial state.
- No state references a role that isn't declared in `roles`.
- `state.role = "assignee"` is only allowed on `kind: active` states.
- Every `gate_config.reject_target` references an existing state.
- `column` values are non-empty strings.

If validation fails, the response body includes the specific rule that
fired so you can fix the JSON and retry.

## Updating a workflow safely

Forge protects projects with active work from breaking workflow changes. When
you PATCH `workflow_definition`:

- States that have **no active tasks** can be added, renamed, or removed
  freely.
- States that **do** have active tasks cannot be removed. The API responds
  with HTTP 409 and a list of blocking tasks. Drain or migrate those tasks
  first (transition them to a terminal state, or cancel them).
- Adding new transitions is always safe.
- Removing transitions is safe as long as no task is mid-transit through the
  removed edge.

Pause the project (`PATCH projects/{id} {paused_at: …}`) before a major
workflow rewrite to keep new agent claims out while you migrate.

## Workflow template library

Forge ships built-in templates so you don't have to start from scratch. On
startup Forge writes them to `{data_dir}/workflows/`:

| Template | Description |
|----------|-------------|
| `default` | Full default workflow with planning and review gates. Human approval required for the planning gate. |
| `user-approval-review` | Like `default`, but reviewer is configured for human approval. |
| `no-user-approval` | Like `default`, but planning and review gates auto-cascade without human approval. |

You can also write your own YAML template files into that directory. Template
names must match `[a-z0-9][a-z0-9_-]{0,63}`.

### Applying a template

```
POST /api/v1/workflow_templates/{name}/apply
{ "project_id": "…" }
```

Applying a template **snapshots** its definition into the project — subsequent
edits to the template do not propagate to projects that have already applied
it. If you want to keep a project in lockstep with a template, write your own
sync workflow on top of the API.

The `default` template cannot be deleted via the API, but it regenerates
automatically on server startup if the file is missing.

## Workflow vs project settings

A workflow definition controls **states, transitions, and roles**.

A project's lifecycle hooks, default review config, redaction patterns, and
similar runtime knobs live in
[project settings](/docs/api/#projects-repos-members-integrations) and are
edited separately. Workflow updates don't blow those away, and vice versa.
