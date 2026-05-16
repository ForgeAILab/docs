---
title: "Notifications"
description: "Persistent notification records, REST API, SSE delivery, and the in-app notification center."
---

# Notifications

Forge generates a notification whenever a task reaches a significant milestone. Notifications are stored in SQLite so they persist across browser reloads. The frontend surfaces them through a bell icon in the header, in-app toasts, and native browser notifications when the tab is backgrounded.

## When notifications are created

| Event type | Trigger |
|-----------|---------|
| `task.done` | Task transitions to `done` |
| `task.blocked` | Task transitions to `blocked` |
| `review.passed` | CI and auditor review completes successfully |
| `review.failed` | CI or auditor review fails |
| `merge.failed` | Merge produces a conflict |

Each notification row records the `event_type`, a human-readable `title`, an optional `body` (blocking reason or review failure detail), the `project_id` and `task_id`, a `read` flag, and a `created_at` timestamp. Notifications are cascade-deleted when their parent task or project is deleted.

## REST API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/notifications` | List notifications |
| `GET` | `/api/v1/notifications/unread-count` | Get unread count |
| `POST` | `/api/v1/notifications/mark-all-read` | Mark all as read |
| `PATCH` | `/api/v1/notifications/{id}/read` | Mark one as read |
| `DELETE` | `/api/v1/notifications/{id}` | Delete a notification |

### List notifications

```bash
GET /api/v1/notifications?project_id=<id>&read=false&limit=20
```

Returns a paginated response (keyset cursor, `items` array, `has_more`). Results are ordered by `created_at` descending. Omit `project_id` to query across all projects.

### Unread count

```bash
GET /api/v1/notifications/unread-count?project_id=<id>
```

Response:

```json
{ "count": 5 }
```

Omit `project_id` to count across all projects.

### Mark read

```bash
# Single notification
PATCH /api/v1/notifications/{id}/read

# All notifications (optional project scope)
POST /api/v1/notifications/mark-all-read?project_id=<id>
```

`mark-all-read` returns HTTP 204 with no body. `mark-read` returns the updated notification object.

## Real-time delivery

The SSE stream at `GET /api/v1/events` emits a `notification.created` event each time a notification row is inserted. The event payload includes:

- `notification_id`
- `project_id`
- `task_id`
- `event_type` (e.g. `task.done`)
- `title`

The frontend dispatches this as a `forge:notification-created` DOM custom event, which the notification center listens to for real-time badge updates and toasts.

## Notification center

The header contains a bell icon that opens a dropdown listing recent notifications. The unread badge shows the count and updates in real time as `notification.created` events arrive.

Each item in the dropdown shows:
- The notification title
- The optional body text
- A relative timestamp
- A visual distinction between read and unread items

Clicking an item navigates to the associated task's detail page and marks the notification as read. A "Mark all read" button in the dropdown header resets the unread count.

## In-app toasts

When a `notification.created` event arrives, a Sonner toast appears with the notification title and a short summary. The toast style reflects severity:

- Success (green): `task.done`, `review.passed`
- Warning (yellow): `task.blocked`, `review.failed`, `merge.failed`

Clicking the toast navigates to the task. Toasts are suppressed when the event was triggered by the current user's own action within a short debounce window (the notification row is still created).

## Browser notifications

When the document is hidden (tab is in the background), Forge sends a native browser notification if the user has granted permission. Clicking the browser notification focuses the Forge tab and navigates to the task.

If permission has not been granted or was denied, browser notifications do not fire. In-app toasts and the notification inbox are unaffected.

## Preferences

Notification preferences are stored in `localStorage` and accessible from a settings panel inside the notification center dropdown (gear icon).

| Preference | Default | Description |
|-----------|---------|-------------|
| Browser notifications | off | Enabling triggers a browser permission request; reverts to off if denied |
| Sound | off | A short audio ping on each notification event |
| Mute project | off | Suppresses toasts, browser notifications, and sound for a specific project; the notification row is still created |

Muting a project only affects the real-time delivery layer. Existing notifications for that project remain visible in the inbox.

## Related pages

- [Tasks](/docs/concepts/tasks/) — task lifecycle and status transitions
- [Review and merge](/docs/concepts/review-and-merge/) — when `review.passed` and `review.failed` fire
- [API reference](/docs/api/) — full endpoint list
