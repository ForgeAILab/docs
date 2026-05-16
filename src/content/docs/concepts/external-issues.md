---
title: "External Issues"
description: "Sync GitHub and Gitea issues into Forge tasks, with deduplication and manual sync triggers."
---

# External Issues

Forge can pull issues from GitHub or Gitea and turn each one into a Forge task. The import is one-directional and one-time: Forge reads the issue, creates a task, and records a link. Subsequent changes to the external issue (title edits, label changes, state transitions) are not synced back.

## Per-project integration

Each project may have at most one integration. Creating a second one returns HTTP 409 `integration_exists`.

```bash
POST /api/v1/projects/{id}/integration
```

```json
{
  "platform": "gitea",
  "base_url": "https://gitea.example.com",
  "owner": "myorg",
  "repo": "myrepo",
  "token_secret_ref": "GITEA_TOKEN",
  "poll_interval_secs": 300,
  "sync_filter": { "labels": ["forge"] },
  "default_task_state": null,
  "default_assignee_type": "agent",
  "default_assignee_id": "agent-abc",
  "enabled": true
}
```

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `platform` | yes | — | `"github"` or `"gitea"` |
| `base_url` | yes | — | API base URL for the host |
| `owner` | yes | — | Repo owner or org |
| `repo` | yes | — | Repo name |
| `token_secret_ref` | yes | — | Name of the env var holding the API token |
| `poll_interval_secs` | no | `300` | Background poll interval in seconds |
| `sync_filter` | no | `{}` | Filter object; supports `labels` array |
| `default_task_state` | no | workflow initial state | Status applied to imported tasks |
| `default_assignee_type` | no | — | `"agent"` or `"user"`; must be paired with `default_assignee_id` |
| `default_assignee_id` | no | — | ID of the agent or user to assign as coder role |
| `enabled` | no | `true` | Set to `false` to pause polling without deleting the config |

For GitHub, use `"base_url": "https://api.github.com"`. The token in `token_secret_ref` must be available as an environment variable at sync time.

## Manage an integration

```bash
# Get current config
GET /api/v1/projects/{id}/integration

# Update (patch, any field)
PATCH /api/v1/projects/{id}/integration

# Delete
DELETE /api/v1/projects/{id}/integration
```

`PATCH` accepts any subset of the fields above. To pause syncing without removing the integration, send `{ "enabled": false }`.

## Inbound sync

The background sync service polls each enabled integration at the configured interval. On each cycle it:

1. Fetches open issues from the external API (using `since` for incremental fetches after the first poll).
2. Normalizes each issue to a common struct (`number`, `title`, `body`, `labels`, `html_url`).
3. For GitHub responses, filters out pull requests (objects that contain a `pull_request` field).
4. Applies any `sync_filter.labels` restriction — only issues carrying at least one of the listed labels are imported.
5. Deduplicates (see below).
6. Creates a Forge task for each new issue (title from issue title, description from issue body).
7. Assigns the `coder` role to `default_assignee` if configured.
8. Updates `last_polled_at`.

### Manual trigger

To run one sync cycle immediately:

```bash
POST /api/v1/projects/{id}/integration/sync
```

Returns:

```json
{
  "imported": 3,
  "skipped": 7,
  "errors": 0
}
```

`errors` counts per-issue failures. If the integration is disabled, this endpoint returns HTTP 422.

## Deduplication

Each external issue gets a canonical `global_id` string stored in the `task_external_link` table. If a link with that `global_id` already exists, the issue is skipped regardless of whether it was imported automatically or linked manually.

The format is:

| Host type | Format |
|-----------|--------|
| GitHub (github.com or api.github.com) | `github:{owner}/{repo}#{number}` |
| Self-hosted (Gitea or other) | `{platform}:{host}:{owner}/{repo}#{number}` |

For example:
- `github:myorg/myrepo#42`
- `gitea:gitea.example.com:myorg/myrepo#42`

Two integrations pointing to different Gitea hosts produce distinct `global_id` values and are imported independently.

## External issue fields on tasks

Task responses (`GET /api/v1/tasks/{id}` and `GET /api/v1/projects/{id}/tasks`) include two nullable fields populated from the linked external issue:

| Field | Type | Description |
|-------|------|-------------|
| `external_issue_number` | integer or null | Issue number on the external platform |
| `external_issue_url` | string or null | Direct link to the issue (e.g. `https://github.com/org/repo/issues/42`) |

Tasks created without an external link return `null` for both fields.

The URL is derived at import time:
- GitHub: always `https://github.com/{owner}/{repo}/issues/{number}`
- Gitea: `{base_url}/{owner}/{repo}/issues/{number}`

## Sync events

The SSE stream at `/api/v1/events` carries two events related to sync:

| Event type | When emitted |
|-----------|--------------|
| `ExternalSyncCompleted` | After a successful poll cycle; payload includes `integration_id`, `imported_count`, `skipped_count` |
| `ExternalSyncFailed` | When a poll cycle fails (network error, bad token, etc.); payload includes `integration_id` and `error` details |

When a sync cycle fails, `last_polled_at` is not updated, and the integration stays enabled for the next cycle.

## One-time import semantics

After the initial import, Forge does not update tasks to reflect changes on the external platform. If an issue's title is edited, the task keeps its original title. If the issue is closed, the task's status is unchanged. The `task_external_link` row is an immutable record of the original import event.

## Related pages

- [Tasks](/docs/concepts/tasks/) — task lifecycle and fields
- [Workflows](/docs/concepts/workflows/) — workflow states and how `default_task_state` is resolved
- [Hooks](/docs/concepts/hooks/) — lifecycle hooks that fire when tasks are created
