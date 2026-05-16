---
title: "Lifecycle hooks"
description: "Configurable actions wired to workflow state transitions — scripts, built-in plugins, blocking preflight checks, and cascade triggers."
---

# Lifecycle hooks

Hooks let you attach custom behavior to workflow transitions without changing
the workflow definition itself. They fire at specific points in the transition
from one state to another, and can run shell commands, trigger built-in
plugin actions, block a transition if a preflight check fails, or kick off an
automatic follow-up transition.

## How hooks execute

Every transition from state A to state B passes through four ordered hook
points:

| Phase | When it fires | Can block? |
|-------|--------------|-----------|
| `A.before_exit` | Before the status column is updated | Yes — returns HTTP 412 |
| `A.on_exit` | After the DB update, while A is no longer the current state | No (Log or Cascade) |
| `B.on_enter` | After entry into B is confirmed | No (Log or Cascade) |
| `B.after_enter` | After `on_enter`; can auto-transition again | No (Cascade, depth-limited to 3) |

**`before_exit` guards** run before anything is committed. A hook that returns
`Block` aborts the transition — the task status is unchanged and the API
returns HTTP 412 with the hook action name, rejection reason, and details.

**`on_exit` and `on_enter` effects** run after the DB is updated. Failure
policy is either `Log` (record and continue) or `Cascade(target)` (auto-move
the task to a recovery state). The task stays in its new state regardless of a
`Log`-policy failure.

**`after_enter` validators** can return `Cascade(target)` to trigger an
automatic follow-up transition. The cascade chain is limited to three levels.
If `after_enter` depends on a preceding `on_enter` hook that was skipped (for
example because no workspace exists), the cascade also skips — the task stays
in the entered state and waits for manual action.

### Before-enter barrier

States that dispatch an agent also support a `before_enter` phase: a set of
blocking checks that must pass before role dispatch is allowed. The lifecycle
order is:

```
source.before_exit
  → DB commit (status = target, entry barrier set)
  → source.on_exit
  → target.before_enter  (preflight; may block dispatch)
  → clear barrier
  → target.on_enter      (role dispatch)
  → target.after_enter
```

In the default workflow, review CI runs as a `before_enter` barrier on the
`review` state, before the reviewer agent is dispatched. If CI fails, the
task follows the review entry-failure policy (default: bounce back to
`in_progress` marked as a rejection). Blocking `before_work` script hooks
also run during the `before_enter` barrier on the `in_progress` state.

## Hook audiences

Each hook carries an `applies_to` field controlling which trigger sources
cause it to run:

| Audience | Matches |
|----------|---------|
| `all` (default) | Every transition regardless of who triggered it |
| `agent_only` | Transitions triggered by `agent:<id>` or `system` (including cascades that inherit an agent trigger) |
| `user_only` | Transitions triggered by `user:<handle>` only |

This lets you write agent-strict, human-lenient rules. For example, an
`agent_only` guard on `todo → in_progress` can enforce that agents go through
planning first, while a human dragging a card on the board bypasses it.

## Hook types

### Script hooks

Script hooks run a shell command in the task's worktree directory. Commands
can be inline shell snippets or paths to executable scripts. Scripts receive
task and project metadata as environment variables:

| Variable | Value |
|----------|-------|
| `FORGE_EVENT` | Lifecycle event name (e.g., `on_task_done`) |
| `FORGE_TASK_ID` | Task UUID |
| `FORGE_TASK_TITLE` | Task title |
| `FORGE_TASK_STATUS` | Current task status |
| `FORGE_TASK_PREVIOUS_STATUS` | Status before the triggering transition |
| `FORGE_PROJECT_ID` | Project UUID |
| `FORGE_PROJECT_NAME` | Project name |
| `FORGE_REPO_PATH` | Repo root path |
| `FORGE_WORKTREE_PATH` | Worktree path (empty if unavailable) |
| `FORGE_AGENT_ID` | Agent UUID (empty if no agent assigned) |
| `FORGE_EXECUTION_ID` | Execution UUID (empty if none) |

Default timeout is 30 seconds; configurable per hook. A timed-out or
non-zero-exit script is logged as a failure and does not affect subsequent
hooks or the task state (for non-blocking hooks).

### Plugin hooks

Plugin hooks call built-in named behaviors compiled into Forge. They run
in-process with access to the database and event bus. Available plugins
include:

| Plugin | Description |
|--------|-------------|
| `check_retry_budget` | Gate: enforce a maximum rejection count before escalation |
| `knowledge-inject` | Inject relevant project knowledge into the agent's context before work starts |
| `knowledge-capture` | Capture knowledge from completed executions on task done |
| `dispatch_role_agent` | Dispatch the assigned role agent (used internally by the default workflow) |
| `run_ci_steps` | Run configured CI steps (used in review pre-enter) |
| `run_merge` | Execute the merge operation |
| `auto_cascade_on_review_pass` | Auto-advance to merging after a passing review |
| `cancel_pending_subtasks` | Cancel non-done subtasks when the parent cancels |
| `propagate_done_to_subtasks` | Mark ordered-turn subtasks done when the parent reaches done |
| `satisfy_dependents` | Lift dependency gates when a task reaches done |
| `cleanup_workspace_now` / `schedule_workspace_cleanup` | Worktree cleanup on terminal transitions |
| `publish_task_blocked` | Emit a notification when a task is blocked |

Plugins each declare which lifecycle events they support. Configuring a plugin
on an unsupported event results in a `skipped (unsupported_event)` log entry —
not an error.

## Blocking hooks

A `before_work` script hook can be made blocking by adding `blocking: true` to
its definition. A blocking hook that fails prevents agent dispatch and leaves
the task at the `in_progress` pre-entry barrier. The task's `error_annotation`
records the failure type, hook identity, exit code, stderr summary, and
available recovery actions. The dispatcher will not retry automatically.

Recovery options for a blocked hook:

- **Retry** (`retry_hook`) — re-runs the hook with the same production context.
  If it passes, agent dispatch can proceed.
- **Skip once** (`skip_hook_once`) — records the bypass actor, timestamp, and
  reason; the next dispatch attempt skips that hook only.

Blocked hook output (command, exit code, stdout/stderr) is visible on the task
detail view. The UI distinguishes preflight failure from agent execution failure.

Blocking is only valid on `before_work` hooks. Setting `blocking: true` on any
other event is rejected or treated as non-blocking with a validation warning.

## Configuring hooks

Hooks are configured in project settings under `lifecycle_hooks`. The schema:

```json
{
  "lifecycle_hooks": {
    "<event>": [
      {
        "type": "script",
        "command": "npm test",
        "timeout_seconds": 60,
        "blocking": false,
        "success_exit_codes": [0]
      },
      {
        "type": "plugin",
        "name": "knowledge-capture",
        "enabled": true
      }
    ]
  }
}
```

**Events:** `before_work`, `on_work_start`, `on_work_stop`, `on_task_done`,
`on_task_cancel`.

`before_work` — fires when a task is about to enter a work state. Blocking
scripts in this event run as part of the `before_enter` barrier; non-blocking
hooks fire asynchronously.

`on_work_start` — fires after the executor has been dispatched (after a
successful `before_enter` pass).

`on_work_stop` — fires when a task exits an active state without reaching a
terminal state (agent yield, heartbeat loss, or gate entry).

`on_task_done` — fires when a task enters the `done` terminal state.

`on_task_cancel` — fires when a task is cancelled.

Multiple hooks on the same event execute in order. A failing hook does not
prevent subsequent hooks from running.

You can edit hooks in the project settings UI (Settings → Lifecycle Hooks) or
via `GET /PATCH /api/v1/projects/{id}/settings`.

### Example: notify on done

```json
{
  "lifecycle_hooks": {
    "on_task_done": [
      {
        "type": "script",
        "command": "curl -sS -X POST $WEBHOOK_URL -d \"{\\\"task\\\": \\\"$FORGE_TASK_TITLE\\\"}\"",
        "timeout_seconds": 10
      }
    ]
  }
}
```

### Example: blocking preflight check

```json
{
  "lifecycle_hooks": {
    "before_work": [
      {
        "type": "script",
        "command": "npm ci && npm run typecheck",
        "blocking": true,
        "timeout_seconds": 120,
        "success_exit_codes": [0]
      }
    ]
  }
}
```

## Execution logging

Every hook execution (script or plugin) is written to the task's log directory
as a JSONL file: `hook-{event}-{index}-{timestamp}.jsonl`. Each line records
event name, hook type, command or plugin name, duration, status, and captured
stdout/stderr (capped at 10 KB each). Hook logs are readable from the same
execution log endpoint as agent logs.

You can also test hooks outside a live task execution via the hook test API —
same environment construction, timeout behavior, and output capture as a
production run, without transitioning the task or launching an agent.

## Context-aware skipping

Hook actions check their preconditions before executing. If required context is
missing — no workspace, no agent assigned, no execution — the hook returns
`Skipped` with a reason rather than failing. A skipped hook does not trigger
the failure policy, does not emit a `transition.effect_failed` event, and does
not block the pipeline. Skipped outcomes are visible in the transition timeline.

This means the same workflow definition handles both agent-driven flows (all
hooks fire) and manual human-tracking flows (hooks gracefully no-op).
