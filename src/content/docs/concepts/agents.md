---
title: "Agents"
description: "Registered executors bound to a daemon, with heartbeats, resource limits, and crash recovery."
---

# Agents

In Forge, an "agent" is a named configuration record that pairs an executor type
with a daemon. When a task is claimed by an agent, Forge launches the
corresponding CLI process on the daemon's machine and supervises it through to
completion. The AI binary itself is not an agent; the agent is the Forge record
that describes how and where to run that binary.

## Executor types

Forge ships six executor adapters:

| Type | CLI binary | Notes |
|------|-----------|-------|
| `claude_code` | `claude` | Claude Code; streams JSON output |
| `codex` | `codex` | OpenAI Codex CLI |
| `gemini` | `gemini` | Google Gemini CLI |
| `opencode` | `opencode` | opencode CLI |
| `shell` | `/bin/sh` | Runs the task description as a shell command; always available, useful for scripted tests |
| `null` | — | No-op; completes immediately; used for testing |

The embedded daemon auto-detects which of these are installed and authenticated
on the local machine. Check what's found:

```bash
curl -sS :8080/api/v1/daemons | jq '.items[].cli_inventory'
```

## Registering an agent

**Via the REST API:**

```bash
curl -sS -X POST :8080/api/v1/agents \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "claude-coder",
    "executor_type": "claude_code",
    "daemon_id": "<daemon-id>"
  }'
```

**Via `forge-ctl`:**

```bash
forge-ctl agent register --name "claude-coder" --executor-type claude_code
```

Omit `daemon_id` to let Forge pick any daemon that has the requested executor
authenticated. Pinning to a specific daemon requires admin access.

Key optional fields on registration:

| Field | Default | Description |
|-------|---------|-------------|
| `max_concurrent_tasks` | 1 | How many tasks this agent runs at the same time |
| `heartbeat_interval_seconds` | 30 | How often Forge checks liveness |
| `max_missed_heartbeats` | 3 | Missed checks before the agent is marked `error` |
| `model` | adapter default | Model override passed to the executor |
| `reasoning_effort` | adapter default | Reasoning effort level |
| `permission_policy` | adapter default | Permission policy hint passed to the executor |
| `prompt_template` | — | Custom prompt template injected before the task description |

## Pausing an agent

Setting an agent's `paused` flag to `true` stops it from accepting new work.
Any claim attempt against a paused agent returns HTTP 409 with code
`"agent_paused"`. Pausing is useful when you want to drain an agent without
deleting it.

Pausing a project has a related but different effect: agent claims on tasks in
that project are rejected (code `"project_paused"`), but human claims are still
allowed. Humans can also manually transition tasks in a paused project.

## Effective status

The status shown in the UI is an *effective* status derived at query time from
several inputs:

| Effective status | Meaning |
|-----------------|---------|
| `active` | Ready to take work |
| `busy` | At `max_concurrent_tasks` capacity |
| `paused` | Manually paused |
| `error` | Heartbeat supervisor marked it unresponsive |
| `daemon_offline` | The pinned daemon has not reported in within 3 minutes |
| `daemon_unavailable` | No daemon with the required executor is online |
| `deactivated` | The pinned daemon no longer reports the executor as authenticated |

## Heartbeats and crash recovery

Forge supervises each running executor by checking child-process liveness at
the agent's configured `heartbeat_interval_seconds`. If the process fails to
respond for `max_missed_heartbeats` consecutive checks, Forge marks the agent
`error` and emits an `agent.timeout` SSE event.

When Forge starts up after a crash, it scans for tasks left in active workflow
states with no running executor. For each orphaned task:

- If the last execution was stopped by the user, Forge leaves the task paused
  for manual review and does not auto-dispatch.
- If the last execution has `resume_policy = auto` and no blocking metadata,
  recovery may leave the task in its active state so the dispatcher can
  reassign it on the next scheduling cycle.
- Otherwise, the task is reset to the workflow's initial state (`todo` in the
  default workflow), the agent assignment is cleared, and `error_annotation` is
  set to explain the crash. The worktree is preserved for inspection.

An SSE event `task.recovered` is emitted for each recovered task, and a startup
log entry lists them all.

## Resource limits

Each agent enforces two limits on its executors:

**Wall-clock timeout (`max_execution_seconds`, default 3600)**
When a task runs longer than this limit, the executor process is terminated, the
task resets to `todo`, and `error_annotation` records an `"execution_timeout"`.
The worktree is kept for inspection.

**Output size (`max_output_bytes`, default 10 MB)**
When a running executor's log output exceeds this limit, the JSONL log is
truncated — the final line carries `"truncated": true` — and a warning is
written to the execution log. Execution is not terminated; only logging stops.

## The daemon model

Every agent runs on a daemon. By default, Forge boots an embedded daemon on
startup. This embedded daemon auto-registers itself, detects installed CLI tools,
and reports the local machine as available. No extra setup is needed for
single-machine use.

To run executors on a separate machine, use `forge-ctl daemon link`. This
registers the remote machine with your Forge server, stores daemon credentials
locally, reports CLI availability, and keeps sending periodic reports:

```bash
forge-ctl --server http://127.0.0.1:8080 daemon link \
  --token fg_... \
  --workspace-root "$HOME/.forge/workspaces"
```

Pass `--once` to register and report a single time without running the long-lived
reporting loop. The UI generates the full command under **Daemons → Link daemon**.

Once linked, agents can be pinned to the remote daemon by passing its `daemon_id`
at registration time.

## Listing and inspecting agents

```bash
# List all agents
forge-ctl agent list

# Filter by status
forge-ctl agent list --status active

# Fetch a single agent
forge-ctl agent get <agent-id>

# REST equivalent
curl -sS :8080/api/v1/agents -H 'Authorization: Bearer <token>'
```

For the full REST surface see [API reference](/docs/api/).
