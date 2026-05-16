---
title: "Workflows"
description: "State machines that govern how tasks move from creation to done, with customizable states, roles, and dispatch behavior."
---

# Workflows

A workflow is the state machine that governs every task in a project. It defines
which states exist, what transitions are valid, who is responsible at each step,
and how Forge dispatches work automatically. Every project uses either the
built-in default workflow or a custom one defined in JSON.

## The default workflow

Out of the box, all projects use the default workflow. Its states are:

| State | Kind | Description |
|-------|------|-------------|
| `backlog` | backlog | Parking lot. Agents cannot claim tasks here. |
| `todo` | initial | Ready for work. Tasks start here. |
| `planning` | gate | Optional planning gate before implementation. |
| `in_progress` | active | The coder agent is working. |
| `review` | gate | CI runs and, if configured, a reviewer agent or human inspects the work. |
| `merging` | gate | Forge runs the git merge. |
| `done` | terminal | Work is complete. The worktree is cleaned up immediately. |
| `blocked` | — | Holding state requiring human intervention (retry budget exhausted, merge conflict unresolvable, etc.). |
| `merge_failed` | — | Merge produced a conflict. Forge may dispatch the coder to resolve it, within the retry budget. |
| `cancelled` | terminal | Task was cancelled. |

The normal happy path is: `backlog → todo → planning → in_progress → review →
merging → done`. Tasks that never need planning skip straight from `todo` to
`in_progress` when no `planner` role is assigned. `blocked`, `merge_failed`, and
`cancelled` are auxiliary states that handle error recovery and cancellation.

## State kinds

Each state has a `kind` that controls automatic behavior:

**`backlog`** — A parking lot. Tasks here are not claimable by agents. Only a
user or planning agent can promote a task to `todo`.

**`initial`** — Exactly one per workflow. Tasks start here when created. This is
where the claim and auto-dispatch scheduler look for work. The default `initial`
state is `todo`.

**`active`** — Work is in progress. Forge attaches heartbeat monitoring and
crash recovery to every active state. If the agent's process goes silent, the
task is reset to the `initial` state and the error is recorded.

**`gate`** — A validation or processing checkpoint. Retry budget tracking
auto-attaches. When a gate is rejected beyond the configured budget, the task
moves to `blocked`. The `review`, `merging`, and `planning` states are all gates
in the default workflow.

**`terminal`** — Absorbing states with no outbound transitions. Reaching a
terminal state is permanent. `done` triggers dependency satisfaction (unblocking
dependent tasks) and immediate worktree cleanup. `cancelled` triggers deferred
cleanup.

**`custom`** — No built-in behavior. You control everything through hooks and
triggers.

## Roles

Roles name the agents or users responsible at each state. The default workflow
defines three roles:

| Role | Default state | Description |
|------|--------------|-------------|
| `planner` | `planning` | Analyzes the task and writes a plan or creates subtasks. |
| `coder` | `in_progress` | Implements the work. |
| `reviewer` | `review` | Reviews the diff and emits a pass/fail verdict. |

Role assignments are per-task and stored separately from the workflow definition.
Assigning a role is declarative — it records who will do the work but does not
trigger dispatch immediately. Dispatch happens reactively when the task enters
the state that references the role.

There is also an engine-reserved identity called `assignee` (sometimes `executor`
in logs). When an agent claims a task, it is auto-bound as the `coder` assignee
for that task if no explicit `coder` assignment already exists. This is how
claim-based work wires up without requiring a manual role assignment step.

## Dispatch: reactive and scheduled

Forge dispatches work in two complementary ways:

**Reactive dispatch** — When a task enters a state that has a `dispatch_role_agent`
hook, Forge immediately tries to dispatch the agent assigned to that state's role.
If the agent is at capacity, dispatch is skipped and the task waits.

**Auto-dispatch scheduler** — A background service polls for tasks in `initial`-kind
states (default: `todo`) that have an assigned coder and an available agent. It
transitions those tasks forward and the reactive hooks take over from there.
Tasks are evaluated in priority order (highest first), then by creation time
(oldest first) within the same priority.

Together these ensure that once a task has a coder assigned and the agent has
capacity, work starts without any manual push.

## Defining a custom workflow

Each project stores its workflow as JSON in `project.workflow_definition`. When
this field is empty, the default workflow is used. A custom workflow replaces the
default entirely for that project — states are not merged.

A minimal two-state example (create a project with this JSON in
`workflow_definition`):

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

Every workflow must have exactly one `initial`-kind state, at least one
`terminal`-kind state, and no orphan states (every non-initial state must be
reachable). The API returns HTTP 400 if validation fails.

You can update a project's workflow via the API or web UI. Updates that would
remove states with active tasks are rejected — you must drain or migrate those
tasks first.

## Workflow template library

Forge ships three built-in templates that are written to `{data_dir}/workflows/`
on startup:

| Template | Description |
|----------|-------------|
| `default` | Full default workflow with planning and review gates. Human approval required for the planning gate. |
| `user-approval-review` | Like `default`, but reviewer is configured for human approval. |
| `no-user-approval` | Like `default`, but planning and review gates auto-cascade without human approval. |

You can also write your own YAML template files to that directory. Template names
must match `[a-z0-9][a-z0-9_-]{0,63}`.

Applying a template snapshots its definition into the project — subsequent
edits to the template do not propagate to projects that have already applied it.
The `default` template cannot be deleted via the API, but it regenerates
automatically on server startup if the file is missing.

## Column groups for board rendering

Each state has a `column` field (a string label). States that share the same
`column` value render together in the same kanban column. This lets the engine
operate on fine-grained states while the board stays readable.

In the default workflow, `review`, `merging`, and `merge_failed` all share the
`"Review"` column. Tasks in any of those states appear in that column with a
sub-state badge (e.g., "merging"). Dragging a card into a column targets the
column's primary state — the first state declared for that column.

## Manual workflow advance

If you want to override the current state of a task and move it forward without
waiting for the agent, use the manual advance action in the UI or API. Manual
advance:

- Stops any running execution (recorded as `status = cancelled`, `stopped_by =
  user:manual_advance`).
- Moves the task to the next logical forward state, skipping the configured
  `before_exit` guards (since this is an explicit user decision).
- Fires the target state's normal `on_enter` and `after_enter` hooks.
- Clears any carried error annotation from the source state.

Manual advance resolves the target state from the workflow graph — it picks the
nearest forward transition that is not a self-loop, not the gate's reject target,
and not the cancellation state.

## Gate approval and rejection

For gate states (`review`, `planning`, and any custom gate), you can approve or
reject via the API:

```
POST /api/v1/tasks/{id}/gates/{state}/approve
POST /api/v1/tasks/{id}/gates/{state}/reject
```

For the review gate specifically, the shortcuts are:

```
POST /api/v1/tasks/{id}/review/approve
POST /api/v1/tasks/{id}/review/reject
```

Approve triggers the gate's outbound success transition. Reject transitions the
task back to the gate's configured `reject_target` and, if retries remain,
dispatches a follow-up coder execution. These actions are blocked if the role
agent has a running execution on the task — wait for it to finish first.

## Gate retry budgets

Each gate can be configured with a `max_rejections` value that caps how many
times Forge will automatically re-dispatch the coder after a gate failure. The
default review gate allows two rejections (`max_rejections = 2`).

When the budget is exhausted, the task moves to `blocked` and no further
automatic dispatch happens. A human must clear the block (by transitioning the
task manually) before the cycle can resume. Doing so resets the budget counter.

Retry budgets are stored in the workflow definition and can be edited per-project
without touching the default workflow. A task-level override in
`task_state_config.retry_budgets` takes precedence over the workflow value.

See [Review and merge](/docs/concepts/review-and-merge/) for how retries interact
with CI steps and the auditor.
