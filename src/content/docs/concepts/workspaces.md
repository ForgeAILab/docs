---
title: "Workspaces & worktrees"
description: "How Forge creates, locks, and cleans up the git worktree for each task."
---
# Workspaces & worktrees

Every task that runs code gets an isolated git worktree — a separate working directory checked out from the project's repo. Forge calls this the task's **workspace**. The workspace is created when the task is first claimed, reused on follow-up executions, and cleaned up when the task reaches a terminal state.

## One worktree per task

The worktree is created the first time a task is claimed. Subsequent claims (after a recovery, a reassignment, or a follow-up) reuse the same directory and the same branch — no re-cloning, no lost history.

### Which worktree a task uses

| Task kind | Worktree |
|-----------|---------|
| Root task | Its own workspace |
| Independent subtask | Its own workspace (parent workspace not required) |
| Ordered-turn subtask | Parent task's workspace (no separate workspace created) |
| Reviewer / auditor execution | Shares the workspace of the task being reviewed |

Reviewer and auditor executions share the task workspace and must still respect the workspace execution lock (see below).

For ordered-turn subtasks, the parent task must have an active coder assignment and an existing workspace. If no parent workspace exists when the orchestrator tries to run the next subtask turn, the execution is rejected with `PARENT_WORKSPACE_REQUIRED`.

## Filesystem locks

Only one mutating execution runs inside a workspace at a time. Before dispatching any executor, Forge acquires a `.forge.lock` file on the worktree directory. The lock is released when the execution completes, fails, or is cancelled.

If a second execution targets the same worktree while the lock is held, it either waits or is rejected according to the caller's policy. This serializes ordered-turn subtask turns and prevents follow-up executions from racing with an active coder.

**On startup**, Forge scans for stale lock files left by a previous run. Any lock with no associated running process is released automatically so the recovered task can be dispatched again.

## Path guardrails

Forge-managed file and git operations — things Forge does on behalf of the task (staging, commit metadata, worktree setup) — are validated against the task's assigned worktree path. Operations that resolve to a path outside the worktree root, including via `../` traversal or symlink escapes, are rejected.

This does not restrict the agent binary itself. Executors are trusted local code and can shell out wherever they want. The guardrail applies only to Forge's own internal file operations.

## Workspace cleanup

### On `done`

When a task transitions `merging → done`, the worktree directory is removed immediately as part of the same request. The workspace record's `status` is set to `cleaned` and a `workspace.cleaned` SSE event is emitted.

If the filesystem removal fails (e.g., a permission error or disk issue), the workspace row is marked `error` and the failure is logged, but the task stays `done`. Cleanup failure does not reverse a successful merge.

### On `cancelled`

When a task is cancelled, workspace cleanup is scheduled 24 hours later by default. This gives you time to inspect the worktree before it disappears.

The delay is controlled by the `FORGE_WORKSPACE_CLEANUP_DELAY_SECONDS` environment variable. Custom workflows can also declare per-terminal-state cleanup policies — `immediate`, or `delayed` with a custom seconds value — in the workflow definition.

### Summary

| Terminal state | Default cleanup |
|----------------|----------------|
| `done` | Immediate |
| `cancelled` | Delayed 24 hours |
| `merge_failed` | Immediate (no worktree to preserve after a failed merge) |
| Custom terminal state | Immediate unless a `cleanup` policy is declared in the workflow |

## Auto-recovery

If the workspace record exists but the worktree directory has been removed from disk (e.g., after an OS reboot or accidental deletion):

1. Forge checks whether the task branch still exists in the repo.
2. If the branch exists, Forge recreates the worktree with `git worktree add` and resumes without user intervention.
3. If the branch is also gone, Forge deletes the workspace record, sets `error_annotation.type = workspace_reset_required`, and transitions the task to `blocked`.

## User-confirmed workspace reset

When a task is `blocked` with a `workspace_reset_required` annotation, you can confirm a fresh start:

```bash
POST /api/v1/tasks/<task_id>/workspace/reset
```

This:
1. Removes any existing worktree directory.
2. Runs `git worktree prune` to clean stale references.
3. Deletes the old workspace record.
4. Clears `error_annotation`.
5. Creates a new workspace from the repo's default branch.

The task moves back to `todo` on the next claim. Note that commits on the prior task branch are not in the fresh workspace.

## Orphaned worktrees

At startup, Forge scans the workspace root for directories that are not associated with any active task. These are listed in the startup log but are never auto-deleted. Review and remove them manually when you are ready.

## Environment variables

| Variable | Effect |
|----------|--------|
| `FORGE_WORKSPACE_ROOT` | Root directory where Forge creates all worktrees. Defaults to `<data_dir>/workspaces`. |
| `FORGE_WORKSPACE_CLEANUP_DELAY_SECONDS` | Seconds to delay cleanup after cancellation. Overrides the compiled default of 86400 (24 hours). |

## Workspace Diff tab

The task detail view in the web UI has a **Workspace Diff** tab that shows the current uncommitted diff in the task's worktree. The same data is available via API:

```bash
GET /api/v1/tasks/<task_id>/workspace   # worktree status
GET /api/v1/tasks/<task_id>/diff        # full diff (also via MCP: forge_get_task_diff)
```

## Related pages

- [Tasks](/docs/concepts/tasks/) — lifecycle, claiming, and transitions
- [Subtasks and dependencies](/docs/concepts/subtasks-and-dependencies/) — how ordered-turn subtasks share the parent worktree
- [Review and merge](/docs/concepts/review-and-merge/) — merge operations that trigger cleanup
