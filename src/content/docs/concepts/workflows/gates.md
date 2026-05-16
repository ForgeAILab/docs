---
title: "Gates and retries"
description: "Gate states approve, reject, and track retry budgets. Here's how that works in practice."
---

# Gates and retries

A `gate` state is a checkpoint. Tasks pause there until something — automated
CI, an AI reviewer, or a human — decides whether to let them through. Forge
attaches retry budget tracking to every gate automatically: if the gate is
rejected too many times, the task moves to `blocked` and waits for a human.

The default workflow has three gates: `planning`, `review`, and `merging`.
Custom workflows can declare as many as they want.

## What happens at a gate

When a task enters a gate:

1. The gate's `on_enter` hooks run — these typically dispatch the role agent
   (e.g. the reviewer) and may run inline checks like CI steps.
2. If a hook returns a pass result, the task advances along the gate's success
   transition.
3. If a hook returns a fail result, the gate is rejected, the budget is
   decremented, and the task either re-dispatches the coder (if budget remains)
   or moves to `blocked` (if exhausted).

The `review` gate in particular runs CI steps inline and returns
`{task, review}` in one response to the caller. See
[Review and merge](/docs/concepts/review-and-merge/) for the full review flow.

## Approving or rejecting a gate manually

Any gate can be approved or rejected via the API:

```
POST /api/v1/tasks/{id}/gates/{state}/approve
POST /api/v1/tasks/{id}/gates/{state}/reject
```

For the review gate specifically, there are shortcuts:

```
POST /api/v1/tasks/{id}/review/approve
POST /api/v1/tasks/{id}/review/reject
```

**Approve** triggers the gate's outbound success transition.
**Reject** transitions the task back to the gate's configured `reject_target`
and, if retries remain, dispatches a follow-up coder execution. Both actions
are blocked if the role agent has a running execution on the task — wait for
it to finish first.

The web UI surfaces Approve / Reject buttons on tasks parked at a gate when the
viewer has permission to act.

## Retry budgets

Each gate can be configured with `gate_config.max_rejections`, which caps how
many times Forge will automatically re-dispatch the coder after a gate
failure. The default review gate allows two rejections
(`max_rejections = 2`).

The counter increments on every **automated** rejection — a failed CI step, an
auditor verdict of `reject`, a coder bounced back by a guard. Generic
user-triggered bounces (a human clicking Reject) are logged separately and do
not consume budget by default; this is configurable per-gate.

When the budget is exhausted:

- The task moves to `blocked`.
- No further automatic dispatch happens.
- A human must clear the block (typically by transitioning the task back to
  the gate's working state with a manual advance) before the cycle can resume.
- Doing so resets the budget counter.

Retry budgets are stored in the workflow definition and can be edited
per-project without touching the default workflow. A task-level override in
`task_state_config.retry_budgets` takes precedence over the workflow value —
useful for one-off tasks that should get extra patience or, conversely, be
held tightly.

## Where this fits

Gates are most visible in the review cycle:

- A failed CI step rejects the review gate, which triggers a coder follow-up.
- An auditor's `reject` verdict rejects the review gate the same way.
- A merge conflict moves the task to `merge_failed`, which is treated as a
  rejection of the `merging` gate and can also re-dispatch the coder.

See [Review and merge](/docs/concepts/review-and-merge/) for the end-to-end
retry behavior at the review and merging gates, and
[Defining a workflow](/docs/concepts/workflows/defining/) for the JSON shape
of `gate_config`.
