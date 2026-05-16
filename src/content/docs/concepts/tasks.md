---
title: "Tasks"
description: "What a task is, how it moves through its lifecycle, and how to create, claim, and transition one."
---
# Tasks

A task is the unit of work in Forge. It has a title, an optional description, a lifecycle status, and optional configuration for the CI review gate. Each task gets its own isolated git worktree and an audit log of every status transition.

## Anatomy of a task

| Field | Purpose |
|-------|---------|
| `title` | Short label shown in the UI and on the kanban board |
| `description` | Full prompt sent to the executing agent |
| `review_config.ci_steps` | Shell commands run when the task enters `review` |
| `review_config.review_prompt` | Optional prompt template for the auditor agent |
| Role assignments | `coder`, `reviewer`, `planner`, and custom roles, each pointing to an agent or a user |
| `dependencies` | Other tasks that must finish before this one can be claimed |
| `comments` | Threaded notes from humans or agents, preserved on the task record |
| Transition audit log | Every status change, who triggered it, and whether it was a gate rejection |

## Lifecycle

The default workflow moves a task through:

```
backlog → todo → planning → in_progress → review → merging → done
```

At any non-terminal point a task can also be `blocked` (waiting on human action) or move to the auxiliary states `merge_failed` and `cancelled`.

| Status | Meaning |
|--------|---------|
| `backlog` | Created but not yet queued for work |
| `todo` | Queued; waiting for an agent or user to claim it |
| `planning` | A planning agent is decomposing the work |
| `in_progress` | The coder agent is working |
| `review` | CI steps are running; optional auditor agent runs afterward |
| `merging` | Forge is merging the task branch |
| `done` | Merged; worktree cleaned up |
| `blocked` | Waiting for manual intervention (workspace error, gate exhaustion, etc.) |
| `merge_failed` | Merge produced a conflict; manual resolution required |
| `cancelled` | Terminal; worktree cleanup is delayed 24 hours by default |

Custom workflows can rename or restructure these states. The engine derives all behavior from the workflow graph — nothing is hardcoded to specific state names.

## Creating a task

### REST

```bash
curl -sS -X POST :8080/api/v1/projects/<project_id>/tasks \
  -H 'content-type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{
    "title": "Add rate limiting",
    "description": "Add per-IP rate limiting to POST /api/v1/auth/login.",
    "review_config": {
      "ci_steps": ["cargo test -p api --test auth"]
    }
  }'
```

### MCP

```json
{
  "method": "tools/call",
  "params": {
    "name": "forge_create_task",
    "arguments": {
      "title": "Add rate limiting",
      "description": "Add per-IP rate limiting to POST /api/v1/auth/login."
    }
  }
}
```

The MCP tool `forge_create_task` uses the project's primary repo and falls back to the project's default `review_config` when none is supplied.

## Claiming a task

Claiming is atomic. A single `POST /api/v1/tasks/{id}/claim` request checks all guards in one database transaction, then creates the execution row and dispatches the executor:

```bash
curl -sS -X POST :8080/api/v1/tasks/<task_id>/claim \
  -H 'content-type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"agent_id": "<agent_id>", "overrides": null}'
```

The claim is rejected if:

- The agent's `paused` flag is set — HTTP 409 `agent_paused`.
- The project has `paused_at` set and the claimer is an agent — HTTP 409 `project_paused`. Human claims on paused projects succeed.
- A dependency task is not yet `done` and the claimer is not that dependency's context holder — HTTP 409 `dependency_gate`.

The **context holder** for a dependency is the agent or user who last executed it (i.e., submitted it to `review`). That person alone may claim a dependent task while the dependency is still in `review` or `merging`. Once all dependencies reach `done`, anyone can claim.

Claiming via the MCP tool `forge_assign_agent` follows the same rules.

## Transitions

### Manual transitions

```bash
curl -sS -X POST :8080/api/v1/tasks/<task_id>/transition \
  -H 'content-type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"status": "review", "version": 2}'
```

The `version` field implements optimistic concurrency. If the task's current version does not match, the server returns HTTP 409 `version_conflict`. Fetch the task, get the latest version, and retry.

### System-triggered transitions

- When a coder agent finishes, the task auto-transitions `in_progress → review` and the CI steps run.
- When CI passes and a reviewer agent is assigned, the reviewer executes. When the reviewer verdict is pass, the task waits in `review` for a `merging` transition.
- `POST .../transition` with `{"status": "merging"}` runs the git merge synchronously. The response contains the post-merge task state — either `done` or `merge_failed` — in the same request body, so no polling is needed.

### Entering `review`

Transitioning into `review` fires the CI steps and returns `{task, review}` inline:

```json
{
  "task": { "id": "...", "status": "review", ... },
  "review": {
    "id": "...",
    "status": "passed",
    "attempt_number": 1,
    "step_results": [{ "exit_code": 0, ... }]
  }
}
```

If `ci_steps` is empty, the review auto-passes. Each `in_progress → review` creates a new `review` row with a monotonically increasing `attempt_number`, preserving all prior attempts for audit.

### Cancel vs. interrupt

`POST /api/v1/tasks/{id}/cancel` is terminal — the task moves to `cancelled` and the worktree cleanup is scheduled (24-hour delay by default). Cancellation is always available from any non-terminal state.

`POST /api/v1/executions/{id}/stop` stops the current execution without changing the task's workflow state. The task enters a paused condition documented in its `error_annotation`; background systems will not auto-resume it until you take an explicit recovery action.

## Reassignment

Role assignments can be changed any time the task is in a non-terminal state. Rules differ by role:

**Coder role** is load-bearing. If you reassign the coder while a coder execution is running:
1. The running execution is cancelled.
2. The new assignee is recorded.
3. The task moves back to `todo` (no auto-claim).
4. The prior `review_passed_at` flag is cleared — the next review cycle runs fully.

The reassignment endpoint accepts two optional flags:

- `reset_worktree: true` — runs `git reset --hard HEAD && git clean -fd` inside the existing worktree (drops uncommitted edits; keeps commits and the worktree directory).
- `reset_workspace: true` — tears down the entire workspace directory (the next claim starts fresh from the base branch).

**Non-coder roles** (reviewer, planner, custom) are plain upserts. No execution is cancelled, no state transition happens.

Reassignment is human-only; no MCP tool surfaces it.

```bash
# Reassign the coder with a clean worktree
curl -sS -X POST :8080/api/v1/tasks/<task_id>/roles/coder \
  -H 'content-type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"agent_id": "<new_agent_id>", "reset_worktree": true}'
```

## Archive

`POST /api/v1/tasks/{id}/archive` hides the task from default list views without deleting it. Include `include_archived=true` in list queries to see archived tasks.

## Transition audit log

Every status change is recorded. Retrieve the full log:

```bash
GET /api/v1/tasks/<task_id>/transitions
```

Each entry includes the `from_state`, `to_state`, who triggered it (`triggered_by`), whether it was a gate rejection (`rejection: true`), and an optional `trigger_reason` (the reviewer's feedback, for example).

## Dependencies

```bash
# Add a dependency
POST /api/v1/tasks/<task_id>/dependencies
{ "depends_on_id": "<other_task_id>" }

# List dependencies
GET /api/v1/tasks/<task_id>/dependencies
```

Dependent tasks remain in `todo`; the dependency gate is enforced at claim time, not as a separate status.

## Related pages

- [Workspaces](/docs/concepts/workspaces/) — how worktrees are created and managed per task
- [Review and merge](/docs/concepts/review-and-merge/) — CI gate and merge details
- [Subtasks and dependencies](/docs/concepts/subtasks-and-dependencies/) — ordered-turn and independent subtask modes
- [API reference](/docs/api/) — full endpoint list
