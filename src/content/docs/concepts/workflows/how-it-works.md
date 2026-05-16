---
title: "How workflows work"
description: "State kinds, roles, dispatch, board columns, and manual advance — the mechanics behind every Forge workflow."
---

# How workflows work

Every workflow — default or custom — is built from a small set of primitives:
states classified by `kind`, declared `roles`, and transitions between states.
Forge attaches automatic behavior based on those primitives so you don't have
to wire dispatch, retry tracking, or cleanup yourself.

## State kinds

Each state has a `kind` that controls what Forge does for you automatically:

**`backlog`** — A parking lot. Tasks here are not claimable by agents. Only a
user or planning agent can promote a task to `todo`.

**`initial`** — Exactly one per workflow. Tasks start here when created. This is
where the claim flow and the auto-dispatch scheduler look for work. The default
`initial` state is `todo`.

**`active`** — Work is in progress. Forge attaches heartbeat monitoring and
crash recovery to every active state. If the agent's process goes silent, the
task resets to the `initial` state and the error is recorded on the audit log.

**`gate`** — A validation or processing checkpoint. Retry budget tracking
auto-attaches. When a gate is rejected beyond the configured budget, the task
moves to `blocked`. The `review`, `merging`, and `planning` states are all
gates in the default workflow. See
[Gates and retries](/docs/concepts/workflows/gates/) for details.

**`terminal`** — Absorbing states with no outbound transitions. Reaching a
terminal state is permanent. `done` triggers dependency satisfaction
(unblocking dependent tasks) and immediate worktree cleanup. `cancelled`
triggers deferred cleanup.

**`custom`** — No built-in behavior. You control everything through hooks and
triggers. Use this when none of the above kinds fit.

## Roles

Roles name the agents or users responsible at each state. The default workflow
defines three:

| Role | Default state | What it does |
|------|--------------|--------------|
| `planner` | `planning` | Analyzes the task and writes a plan or creates subtasks. |
| `coder` | `in_progress` | Implements the work. |
| `reviewer` | `review` | Reviews the diff and emits a pass/fail verdict. |

Role assignments are per-task and stored separately from the workflow
definition. Assigning a role is declarative — it records who will do the work
but does not trigger dispatch immediately. Dispatch happens reactively when the
task enters the state that references the role.

There is also an engine-reserved identity called `assignee` (sometimes
`executor` in logs). When an agent claims a task, it is auto-bound as the
`coder` assignee for that task if no explicit `coder` assignment already
exists. This is how claim-based work wires up without requiring a manual role
assignment step.

A custom workflow can declare any roles it wants — `designer`, `qa`,
`triager`, etc. — and reference them from `state.role`. See
[Defining a workflow](/docs/concepts/workflows/defining/).

## Dispatch: reactive and scheduled

Forge dispatches work in two complementary ways.

**Reactive dispatch** — When a task enters a state that has a
`dispatch_role_agent` hook, Forge immediately tries to dispatch the agent
assigned to that state's role. If the agent is at capacity, dispatch is skipped
and the task waits until capacity frees up.

**Auto-dispatch scheduler** — A background service polls for tasks in
`initial`-kind states (default: `todo`) that have an assigned coder and an
available agent. It transitions those tasks forward, and the reactive hooks
take over from there. Tasks are evaluated in priority order (highest first),
then by creation time (oldest first) within the same priority.

Together these ensure that once a task has a coder assigned and the agent has
capacity, work starts without any manual push.

## Column groups for board rendering

Each state has a `column` field (a string label). States that share the same
`column` value render together in the same kanban column. This lets the engine
operate on fine-grained states while the board stays readable.

In the default workflow, `review`, `merging`, and `merge_failed` all share the
`"Review"` column. Tasks in any of those states appear in that column with a
sub-state badge (e.g. "merging"). Dragging a card into a column targets the
column's primary state — the first state declared for that column.

## Manual workflow advance

If you want to override the current state of a task and move it forward
without waiting for the agent, use the manual advance action in the UI or
API. Manual advance:

- Stops any running execution (recorded as `status = cancelled`,
  `stopped_by = user:manual_advance`).
- Moves the task to the next logical forward state, skipping the configured
  `before_exit` guards (since this is an explicit user decision).
- Fires the target state's normal `on_enter` and `after_enter` hooks.
- Clears any carried error annotation from the source state.

Manual advance resolves the target state from the workflow graph — it picks
the nearest forward transition that is not a self-loop, not the gate's reject
target, and not the cancellation state.

For approving or rejecting a gate explicitly (which respects retry budgets and
fires the gate's normal transitions), see
[Gates and retries](/docs/concepts/workflows/gates/) instead.
