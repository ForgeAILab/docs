---
title: "Chat and follow-ups"
description: "How conversations, task chat, and follow-up executions work in Forge."
---
# Chat and follow-ups

Forge has two overlapping chat surfaces: a project-level **Chat page** for open-ended conversations with an agent, and an **execution viewer** on every task detail page that renders agent output as a chat thread. Both are backed by the same log infrastructure and the same SSE event stream.

## The Chat page

The Chat page lives under each project in the sidebar. It gives you a persistent, project-scoped conversation list on the left and an active conversation thread on the right.

### What a conversation is

A conversation is a persistent thread tied to a project and an agent. It holds:

- A sequence of messages with roles (`user`, `assistant`, `system`)
- An optional title and system prompt set at creation time
- An `agent_session_id` that Forge uses to route follow-up turns back to the same native agent session

Conversations are project-scoped — they are not attached to any specific task, though an agent can create or reference tasks while chatting.

### Starting a conversation

Click **New Chat** at the top of the conversation list. Choose an agent (Shell agents are not available since they do not support conversation mode), supply an optional title and system prompt, and submit. The conversation is created and selected immediately.

Conversations are sorted by most-recent activity. Search filters by case-insensitive title match, client-side.

### Conversation view and agent configuration

The main panel shows the message thread. User messages appear on the right; assistant messages on the left with full Markdown rendering.

The conversation header shows the agent name and status dot. Clicking the agent name opens a popover where you can:

- See the executor type and model in use.
- **Change Agent** — swaps the agent for the rest of the conversation. Forge records the change as a system message.

You can also override the model and reasoning effort per message using the settings icon next to the message input. Overrides reset after each send.

While a response is streaming the input is disabled and a **Stop** button appears. Clicking it calls `POST /api/v1/conversations/{id}/cancel` and marks the partial message as stopped.

### SSE events for chat

The chat page subscribes to `GET /api/v1/events` and listens for:

| Event | Effect |
|-------|--------|
| `conversation.message_delta` | Appends streaming content to the in-flight assistant message |
| `conversation.message_completed` | Finalises the message; re-enables the input |
| `conversation.message_created` | Invalidates the conversation list (re-sorts by recency) |

## Task chat — executions as messages

Every task execution is also presented as a chat thread, on the execution detail page under the task. The underlying data is the same JSONL log stored by Forge — no agent-private transcript database is involved.

Each `LogEntry` is mapped to a chat component:

| `LogKind` | Chat presentation |
|-----------|-------------------|
| `user` | User message bubble |
| `assistant` / `assistant_delta` | Assistant message bubble (deltas are streamed and coalesced) |
| `system` | Muted, collapsed card |
| `tool_call` / `tool_result` | Collapsible tool card, paired by `call_id` |
| `shell_command` + `stdout`/`stderr` | Shell output card with grouped lines |
| `file_change` | Inline unified diff card |
| `approval_question` | Highlighted card showing the question and logged decision |
| `session_info` | Compact one-liner with session id and timestamps |
| Heartbeat entries | Hidden by default |

The prompt Forge sent to the executor is stored on `execution.prompt` and rendered as the first user message. Any matching native `user` event in the log stream is deduplicated. See [execution logs](/docs/execution-logs/) for the full `LogEntry` schema and adapter-specific details.

### Live streaming

While an execution is running, `task.execution_log_appended` events arrive over the SSE stream and are mapped into the chat thread in real time. New entries are buffered and flushed once per animation frame to limit render frequency. The view auto-scrolls to the bottom on new entries but pauses auto-scroll when you scroll up.

## Follow-up executions

After an execution reaches `completed` or `failed` status, a **Follow Up** button appears on its row in the Executions tab — provided `agent_session_id` is non-null. Executions without a session ID show no button (the session is not resumable).

Clicking **Follow Up** opens an inline composer directly below the execution entry. The composer includes:

- A text input for your message (required; validation fires client-side before any request).
- An agent picker filtered to agents of the same `executor_type` as the parent execution. Defaults to the parent's agent.
- Optional model and reasoning effort overrides. Default values come from the parent execution's agent profile.

### What happens when you send

1. `POST /api/v1/executions/{parent_id}/follow-up` is called with the message, optional `agent_id`, and any overrides.
2. Forge creates a new execution with `parent_execution_id` pointing at the parent and `prompt` set to your message.
3. Forge resolves the parent's `agent_session_id` and injects the adapter-specific resume key into the new execution's config.
4. The adapter resumes or forks the native session and sends the follow-up prompt.
5. The composer closes; the new execution appears in the list and streams in real time.

### How resume works under the hood

Each adapter resumes differently:

| Adapter | Resume mechanism |
|---------|-----------------|
| Codex | Uses `resume_thread_id`. Forks the existing thread and starts a new turn. |
| Claude Code | Uses `resume_session_id`. Starts Claude Code in resume mode; sends the follow-up prompt over stdin JSON. |

Forge stores the adapter's session handle on `execution.agent_session_id`. The follow-up execution inherits this reference so subsequent follow-ups can chain further.

For the full resume identifier schema and test checklist, see [execution logs](/docs/execution-logs/).

## Cancelled or failed executions

On executions in `cancelled` or `failed` status, Forge also shows a recovery button in the execution detail header:

- **Resume** — shown when `agent_session_id` is non-null. Calls `POST /api/v1/executions/{id}/follow-up` with message `"Resume"`.
- **Re-execute** — shown when `agent_session_id` is null. Calls `POST /api/v1/executions/{id}/re-execute` to start a fresh execution without session context.

After a successful dispatch the page navigates to the new execution.

## API reference

| Method | Path | Description |
|--------|------|-------------|
| `GET/POST` | `/api/v1/projects/{id}/conversations` | List or create conversations |
| `PATCH/DELETE` | `/api/v1/conversations/{id}` | Update title/agent or archive |
| `POST` | `/api/v1/conversations/{id}/messages` | Send a chat message |
| `POST` | `/api/v1/conversations/{id}/cancel` | Stop a streaming response |
| `POST` | `/api/v1/executions/{id}/follow-up` | Create a follow-up execution |
| `GET` | `/api/v1/events` | SSE stream (`conversation.message_delta`, `conversation.message_completed`, `task.execution_log_appended`, …) |

## Related pages

- [Execution logs](/docs/execution-logs/) — `LogEntry` JSONL schema, log-to-chat mapping, resume identifiers
- [Agents](/docs/concepts/agents/) — executor types, profiles, and session capabilities
- [Tasks](/docs/concepts/tasks/) — task lifecycle and execution model
