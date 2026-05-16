---
title: "Workflows"
description: "State machines that govern how tasks move from creation to done, with customizable states, roles, and dispatch behavior."
---

# Workflows

A workflow is the state machine that governs every task in a project. It defines
which states exist, what transitions are valid, who is responsible at each step,
and how Forge dispatches work automatically. Every project uses either the
built-in default workflow or a custom one defined in JSON.

If you're new to Forge, you don't need to read these pages to use it — the
default workflow is a sensible end-to-end pipeline. Come back here when you want
to know exactly what's happening at each step, customize the flow for your team,
or build a workflow from scratch.

## In this section

- **[How workflows work](/docs/concepts/workflows/how-it-works/)** — State
  kinds, roles, dispatch, board columns, manual advance.
- **[Gates and retries](/docs/concepts/workflows/gates/)** — How gate states
  approve, reject, and apply retry budgets.
- **[Defining a workflow](/docs/concepts/workflows/defining/)** — The JSON
  schema, validation rules, and how to apply a custom workflow or template
  to a project.

## The default workflow at a glance

Out of the box, every project uses this workflow:

| State | Kind | What it means |
|-------|------|---------------|
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

The happy path is `backlog → todo → planning → in_progress → review → merging → done`.
Tasks that don't need a plan skip straight from `todo` to `in_progress` when no
`planner` role is assigned. `blocked`, `merge_failed`, and `cancelled` are
auxiliary states that handle error recovery and cancellation.

The default workflow defines three roles — `planner`, `coder`, `reviewer` —
plus the engine-reserved `assignee` identity. See
[How workflows work](/docs/concepts/workflows/how-it-works/#roles) for details.

## When to customize

Stick with the default workflow if:

- A pipeline of plan → code → review → merge fits your work.
- You're happy with the built-in retry budgets and gate behavior.
- You want all projects on this server to look the same on the board.

Define a custom workflow if:

- You want extra gates (e.g. design review before coding, QA after merge).
- You want a different terminal state (e.g. `released` vs `done`).
- You're modeling something other than code — a research pipeline, a writing
  pipeline, a triage queue. The engine doesn't assume the work is code.

Start with [Defining a workflow](/docs/concepts/workflows/defining/) when you're
ready.
