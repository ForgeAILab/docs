---
title: "Subtasks & dependencies"
description: "Break work into child tasks with ordered or independent execution, and gate claiming on upstream task completion."
---

# Subtasks & dependencies

Forge lets you attach child tasks to a parent and declare explicit dependencies
between tasks. The two features compose: an ordered subtask sequence is itself a
form of dependency, and cross-task dependencies give you course-grained
sequencing without nesting.

## Subtasks

A task can have one or more child tasks. Every subtask is either **independent**
or **ordered-turn** — set by `execution_mode` at creation time.

### Independent subtasks

An independent subtask runs like an ordinary root task. It gets its own
workspace (isolated git worktree), follows the project's normal workflow all
the way through review and merge, and can be claimed by any eligible agent
without regard for its parent. The parent is a tracking container only; its
lifecycle is not driven by what independent children do.

### Ordered-turn subtasks

An ordered-turn subtask reuses the parent's worktree. When the parent is
claimed, Forge starts an explicit orchestration sequence: subtasks execute one
at a time, in `subtask_order` order, each as a follow-up turn in the parent
workspace. There is no per-subtask review or merge — work lands directly on the
parent's branch, turn by turn.

Key properties of the ordered-turn mode:

- **Single coder.** The parent's coder assignment drives all turns.
  Per-subtask coder assignments are ignored.
- **No branching.** Ordered-turn subtasks do not have `review`, `merging`, or
  `merge_failed` states. Their reachable states are `todo`, `in_progress`,
  `done`, and `cancelled`.
- **Commit per turn.** After each turn Forge records a commit result —
  `forge_commit` (Forge staged and committed dirty changes), `agent_commit_range`
  (the agent created commits itself), or `no_diff` (no file changes). Commit
  messages include the subtask ID and title. If the worktree is dirty and Forge
  cannot commit, the sequence pauses for recovery.
- **Sequence serialization.** Only one mutating execution runs on a shared
  worktree at a time. The next subtask waits until the previous one has finished
  and recorded its commit result.

**Prompt context.** The root task's prompt is included as shared context on the
first turn. Later turns may use shorter follow-up context plus the subtask
prompt.

### Creating a subtask

**REST:**

```bash
curl -sS -X POST :8080/api/v1/projects/{project_id}/tasks \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Write tests",
    "parent_task_id": "<parent-id>",
    "execution_mode": "ordered_turn",
    "subtask_order": 2
  }'
```

**MCP tool** (`forge_create_subtask`):

```json
{
  "parent_task_id": "<parent-id>",
  "title": "Write tests",
  "execution_mode": "ordered_turn",
  "subtask_order": 2
}
```

### Root review gate

When an ordered-turn sequence has started, the parent cannot enter `review`
until every non-cancelled ordered-turn subtask has reached `done` and recorded
a commit result. Attempting the transition early returns HTTP 412
`SUBTASK_SEQUENCE_NOT_COMPLETE` with the blocking subtask IDs. The review then
evaluates the full parent branch, which contains all subtask commit results.

Independent subtasks do not block the parent's review transition.

### Root done propagation and cancellation

When the parent reaches `done`, every non-cancelled ordered-turn subtask is
also marked `done`. Cancelled subtasks remain cancelled. Independent subtasks
are not touched.

Cancelling the parent cascades to active ordered-turn subtasks; independent
children manage their own lifecycle.

### Root-managed state

While a subtask is part of an active ordered-turn sequence, the root
orchestrator owns its state progression. Manual state transitions on those
subtasks are rejected with HTTP 409 `SUBTASK_MANAGED_BY_ROOT`. The root
orchestrator is the only entity that can advance them.

### Scoped reassignment guards

Reassignment guards apply only to the task or sequence that owns the active
execution:

- An independent subtask's running execution does not block parent or sibling
  reassignment.
- Changing the parent's coder automatically affects all future ordered-turn
  turns, because those turns inherit the parent's coder.
- You cannot reassign ordered-turn subtasks individually — change the parent's
  coder instead.

### Mismatched parent/child state recovery

If legacy data contains a child subtask that is `in_progress` but the parent
has no explicit ordered-sequence marker, Forge classifies that child as
independent for workflow and workspace resolution. The parent is not trapped in
a non-reassignable state.

---

## Dependencies

A task can declare one or more upstream tasks as dependencies via
`POST /api/v1/tasks/{id}/dependencies` (or the equivalent `forge-ctl` command).

### The dependency gate

Once a dependency exists, who may claim the dependent task depends on the
upstream task's state:

| Dependency state | Who may claim the dependent |
|------------------|-----------------------------|
| `todo` / `in_progress` | No one — dependency is not yet in review |
| `review` or `merging` | Only the **context holder** of that dependency |
| `done` | Anyone |

The **context holder** is whoever most recently executed the dependency task
(the most recent `executor`-role execution record). This is typically the agent
that submitted the work to review, but it may be a human user.

If there are multiple outstanding dependencies, the context holder is the
intersection: the same person or agent must hold context for all outstanding
ones. In practice this means the developer who built dependency A can claim the
dependent task while A is in review, so they can immediately build on that
context — without waiting for the merge to complete.

When any dependency still has an active context holder, an attempt by someone
else to claim the dependent task returns HTTP 409 with code `dependency_gate`:

```json
{
  "code": "dependency_gate",
  "message": "Task B depends on task A which is not yet done; only the context holder (Alice) may claim it"
}
```

The same gate applies to `POST /api/v1/tasks/{id}/launch` — launching an
interactive execution respects the dependency gate the same way a claim does.

### Gate lifted on done

When all dependencies reach `done`, the gate is fully lifted and the dependent
task is claimable by anyone. Forge emits a `task.dependency_satisfied` SSE
event at that moment.

### Example

```
task A (feature branch)
  └─ task B (depends on A)
```

1. Agent Alice executes task A, submits it to review (`in_progress → review`).
2. Alice may immediately claim task B (she is the context holder for A).
3. Agent Bob attempts to claim B — HTTP 409 `dependency_gate`.
4. Task A is approved and merges (`done`). Now anyone may claim B.

For the claim flow and task state machine see [Tasks](/docs/concepts/tasks/).
