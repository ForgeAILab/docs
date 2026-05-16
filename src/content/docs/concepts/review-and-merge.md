---
title: "Review and merge"
description: "How Forge runs CI, invokes an optional AI auditor, handles gate failures, and merges work into the target branch."
---

# Review and merge

When a task transitions into `review`, Forge runs a configurable review pipeline
inline and returns the result in a single response. From there, the task either
advances to `merging` (where the actual git merge happens) or bounces back to the
coder with a corrective prompt.

## CI steps

Each task's `review_config.ci_steps` is an ordered list of shell strings. Forge
runs each one as `bash -lc "<step>"` inside the task's worktree:

```json
{
  "review_config": {
    "ci_steps": [
      "npm run build",
      "npm test"
    ]
  }
}
```

Steps run sequentially. The first non-zero exit code marks the review as failed
and records the step index, exit code, and tail of stderr. If `ci_steps` is
absent or empty, the CI phase is automatically treated as passed.

Every `in_progress → review` transition creates a new `review` row with a
monotonically increasing `attempt_number` for that task. The row starts with
`status = running`, then is updated to `passed` or `failed` when the runner
finishes. Review rows are never deleted — cancelled attempts remain in the audit
log.

The transition response returns both the updated task and the review result in a
single `{ task, review }` payload, so the caller does not need a follow-up
request to learn whether CI passed.

## The auditor (optional AI reviewer)

After CI steps pass, Forge can optionally dispatch an AI auditor agent to inspect
the diff. The auditor is configured by assigning an agent to the `reviewer` role
on the task (via `task_role_assignment`). Codex is the typical auditor choice.

The auditor receives the task diff and an optional `review_config.review_prompt`.
It must emit a verdict in its final message using the marker format
`===REVIEW: PASS===` or `===REVIEW: FAIL===`. The review runner assembles the
full message text from the auditor's JSONL log (concatenating all
`kind == "assistant"` entries in order) before parsing the verdict, so
streaming-token splits do not affect detection.

When the executor and auditor both target Codex and the executor's thread is
still live, the auditor reuses that thread via `start_review` before falling
back to a fork or a fresh start. This keeps the reviewer's context warm at no
extra cost when the same model handled both implementation and review.

## What happens when review passes

When CI passes and the auditor (if configured) returns a pass verdict:

1. The review row is updated to `status = passed` and `review_passed_at` is set
   on the task.
2. The `after_enter` cascade on `review` auto-transitions the task to `merging`.
3. `MergeService` runs `git merge forge/{task_id}` into the target branch
   (`task.merge_config.target_branch`, falling back to `repo.default_branch`)
   synchronously, within the same request.
4. On a clean merge, the task advances to `done` and the worktree is cleaned up
   immediately. The response body reports `status = done`.

## Failed reviews and follow-up dispatch

When a review fails — either from a failing CI step or an auditor `FAIL` verdict
— and the task still has retries in the [gate budget](/docs/concepts/workflows/gates/),
Forge automatically:

1. Dispatches a new coder execution. For Codex executors, the prior thread is
   forked (`resume_thread_id`) so the coder picks up where it left off.
2. Sets a corrective prompt summarising what failed (failing step names and stderr
   excerpts for CI failures; the auditor's verdict message for AI rejections).
3. Transitions the task from `review` back to `in_progress`.

When the budget is exhausted, the task moves to `blocked` instead. No further
automatic dispatch happens until a human clears the block.

Failed review diagnostics — step results, stderr excerpts, auditor verdicts —
are always stored on the review row. The task does not need to enter `blocked` to
surface this information; you can inspect it in the UI or via the API while the
task remains in `review`.

## Human approve and reject

If no reviewer agent is assigned, or if the `reviewer` role is assigned to a
user, the gate waits in `awaiting_human` for manual action:

```
POST /api/v1/tasks/{id}/review/approve
POST /api/v1/tasks/{id}/review/reject
  Body: { "reason": "needs more error handling" }   # optional
```

Approving updates the review row to `passed` and triggers the same merge cascade
as an automatic pass. Rejecting updates the row to `failed` and, if retries
remain, dispatches a follow-up coder execution with the rejection reason as the
corrective prompt.

Neither action is available while a reviewer agent has a running execution on
that task. The API returns HTTP 409 in that case — wait for the agent to finish.

## Merge conflicts and the conflict cycle

When the git merge produces a conflict:

1. Forge aborts the merge (`git merge --abort`) to restore the target branch.
2. The conflict details and affected paths are recorded on the execution.
3. The task transitions to `merge_failed`.

If the task's merge-fix retry budget has not been exhausted, Forge immediately
dispatches the coder again with a prompt instructing it to rebase onto the base
branch and resolve the conflicts. The task returns to `in_progress` so the normal
cascade can carry the fix back through `review → merging`.

Re-entry into `review` after a merge-conflict fix cycle skips the auditor.
Because `review_passed_at` is already set (the auditor approved the work before
the merge attempt), Forge runs only CI steps. The review row records `verdict =
pass_ci_only` on success. A CI failure on this re-review clears `review_passed_at`
and routes the task to `blocked`.

The merge-fix budget is independent of the review retry budget. The default
merge-fix budget is 1, meaning one conflict-fix attempt is permitted per
merge-conflict cycle. Exhausting it lands the task in `merge_failed` for manual
intervention.

Both budgets reset when a human clears the block (e.g., by transitioning the
task back to `todo` or re-claiming it).

## Merge strategy and work mode

How the merge is executed depends on the repo's `work_mode`:

| Work mode | Behavior |
|-----------|----------|
| Direct commit | Forge merges the task branch directly into the default branch within the same request. The task reaches `done` when the merge succeeds. |
| Pull request | Forge publishes the task branch as a pull request and waits. The task stays in `merging` until the PR is merged externally. Human action completes the flow. |

In pull-request mode, Forge does not merge itself — it creates or updates the PR
and the task remains in the merge state. The PR must be merged through the normal
code-review process outside Forge. Once merged, the task advances to `done`.

## Configurable retry budgets

The two retry budgets are stored in the workflow definition and can be edited
per-project:

| Budget | Workflow path | Default | Counts |
|--------|--------------|---------|--------|
| Review retries | `review.gate_config.max_rejections` | 2 | `transition_log` rows with `from_state = review` and `rejection = true` |
| Merge-fix retries | `merge_failed.config.retry_budgets.merge_fix` | 1 | `transition_log` rows with `to_state = merge_failed` since the last `review_passed_at` timestamp |

Task-level overrides in `task_state_config.retry_budgets.{review|merge_fix}`
take precedence over the workflow setting for that individual task. Project
general settings are not consulted.

See [Workflows](/docs/concepts/workflows/) for how gate budgets fit into the
broader workflow configuration model.
