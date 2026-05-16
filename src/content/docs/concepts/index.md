---
title: "Concepts"
description: "Key ideas behind how Forge works, from agents and tasks to hooks and auth."
---

# Concepts

These pages explain the building blocks of Forge. Read them in any order, or start with [Agents](/docs/concepts/agents/) and [Tasks](/docs/concepts/tasks/) if you're new.

| Page | What it covers |
|------|---------------|
| [Agents](/docs/concepts/agents/) | Registered executors and the daemons they run on; adapters, heartbeats, and resource limits |
| [Tasks](/docs/concepts/tasks/) | The task record, status lifecycle, and how work moves from `todo` to `done` |
| [Workspaces](/docs/concepts/workspaces/) | Per-task git worktrees, filesystem locks, and cleanup |
| [Workflows](/docs/concepts/workflows/) | Default workflow, custom workflows, state kinds, and role assignments |
| [Review and merge](/docs/concepts/review-and-merge/) | CI gate steps, the auditor role, retry budgets, and merge strategy |
| [Subtasks and dependencies](/docs/concepts/subtasks-and-dependencies/) | Ordered vs independent subtasks and the dependency claim gate |
| [Hooks](/docs/concepts/hooks/) | Lifecycle hooks, blocking guards, and plugins |
| [Chat and follow-ups](/docs/concepts/chat-and-follow-ups/) | Built-in chat UI, conversation threads, and follow-up turns |
| [Knowledge](/docs/concepts/knowledge/) | Knowledge plugin and automatic capture |
| [External issues](/docs/concepts/external-issues/) | GitHub and Gitea issue sync |
| [Notifications](/docs/concepts/notifications/) | Notification center, SSE event stream, and browser notifications |
| [Auth](/docs/concepts/auth/) | Users, JWTs, Personal Access Tokens, and daemon tokens |
| [MCP](/docs/concepts/mcp/) | Using Forge from Claude Code, Codex, or Cursor via MCP |
