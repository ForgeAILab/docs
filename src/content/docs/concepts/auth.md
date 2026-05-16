---
title: "Auth & users"
description: "How Forge authenticates users and agents: bootstrap, token types, PATs, project membership, and admin access."
---

# Auth & users

Forge ships a real auth system. Every endpoint except `POST /api/v1/auth/register`,
`POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, and `POST /api/v1/auth/logout`
requires a bearer token. See [API reference](/docs/api/#authentication) for the full
endpoint list.

## Bootstrap — first thing to do after install

A fresh Forge install is unowned. The **first user to register becomes admin** and
inherits all orphaned resources atomically:

- all agents with no owner get assigned to that user
- all daemons with no owner get assigned to that user
- all projects with no owner get assigned, and a project membership row with role `owner` is created for each

After bootstrap the flag is set and no subsequent registration triggers it. Subsequent
users are ordinary members until an admin promotes them.

```bash
# Register the admin account (do this before anything else)
curl -s -X POST http://127.0.0.1:8080/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"s3cret123","display_name":"You"}'
```

The response includes an `access_token` and `refresh_token` immediately — you are
logged in after registration.

## Token types

All three types are passed as `Authorization: Bearer <token>`. The MCP endpoint
additionally accepts a `?token=` query parameter.

| Token | Prefix | Lifetime | Issued by | Use for |
|-------|--------|----------|-----------|---------|
| JWT access token | `eyJ…` | 15 minutes | `POST /api/v1/auth/login` | Web UI, short-lived scripts |
| Personal Access Token | `fg_…` | Long-lived, revocable | `POST /api/v1/auth/tokens` | `forge-ctl`, MCP clients, CI scripts |
| Daemon registration token | opaque | Until revoked | daemon registration flow | `POST /api/v1/daemons/{id}/report` only |

### JWT access token

Issued on login. Signed with HS256, contains `sub` (user UUID), `email`, `is_admin`,
`iat`, and `exp` (15 minutes out). Tokens with any other `alg` — including `none` —
are rejected.

Refresh before expiry by calling `POST /api/v1/auth/refresh` with the current refresh
token. Refresh tokens are opaque UUIDs, stored server-side as SHA-256 hashes, and
expire after 7 days. **Each refresh rotates the token**: the old refresh token is
deleted atomically and a new pair is issued. Reusing a rotated token triggers family
revocation — all tokens in that chain are invalidated.

Logout deletes the refresh token server-side, preventing future refreshes:

```bash
curl -s -X POST http://127.0.0.1:8080/api/v1/auth/logout \
  -H 'Content-Type: application/json' \
  -d '{"refresh_token":"<your-refresh-token>"}'
```

### Personal Access Token (PAT)

PATs are the right choice for anything that runs unattended: `forge-ctl`, MCP clients,
CI pipelines, and scripts. They are long-lived and revocable without affecting other
sessions.

**Create a PAT:**

```bash
curl -s -X POST http://127.0.0.1:8080/api/v1/auth/tokens \
  -H 'Authorization: Bearer <your-jwt>' \
  -H 'Content-Type: application/json' \
  -d '{"name":"ci-bot"}'
```

Response:

```json
{
  "token": "fg_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "id": "pat-uuid",
  "name": "ci-bot",
  "created_at": "2026-01-01T00:00:00Z"
}
```

Copy the `token` value — it is shown only once.

**Use the PAT with `forge-ctl`:**

```bash
export FORGE_TOKEN=fg_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export FORGE_URL=http://127.0.0.1:8080
forge-ctl tasks list
```

Or pass it inline:

```bash
forge-ctl --token fg_xxx --url http://127.0.0.1:8080 tasks list
```

**Use the PAT with an MCP client** — see [MCP for agents](/docs/concepts/mcp/) for
client-specific config snippets.

**Revoke a PAT:**

```bash
curl -s -X DELETE http://127.0.0.1:8080/api/v1/auth/tokens/<pat-id> \
  -H 'Authorization: Bearer <your-jwt>'
```

List current PATs with `GET /api/v1/auth/tokens`.

### Daemon registration token

Returned once when a daemon registers. Used only on
`POST /api/v1/daemons/{id}/report` (the heartbeat/inventory endpoint). This token is
not usable on any other route.

## Current user and admin flag

```bash
curl -s http://127.0.0.1:8080/api/v1/auth/me \
  -H 'Authorization: Bearer <token>'
```

```json
{
  "id": "usr_...",
  "email": "you@example.com",
  "display_name": "You",
  "is_admin": true,
  "created_at": "2026-01-01T00:00:00Z"
}
```

`is_admin: true` appears only for the bootstrap user (or anyone an admin has promoted).
Admin-only routes sit under `/api/v1/admin/*` — for example,
`GET /api/v1/admin/users` to list all registered users. Non-admin authenticated requests
to those routes receive HTTP 403 `admin_required`.

## Project membership

Agents and users are scoped to the projects they are members of. Trying to act on a
project you are not a member of is rejected. System projects (created before bootstrap,
`owner_id = NULL`) are accessible to all authenticated users.

Membership endpoints:

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/v1/projects/{id}/members` | List members |
| POST   | `/api/v1/projects/{id}/members` | Add a member |
| DELETE | `/api/v1/projects/{id}/members/{user_id}` | Remove a member |

## Password storage

Passwords are hashed with **bcrypt** (cost factor 12 by default, configurable via
`FORGE_BCRYPT_COST` for test environments). Plaintext passwords are never stored or
logged. Login timing is equalized for non-existent accounts to prevent enumeration.

## Web UI auth flow

The web UI (at `http://127.0.0.1:8080`) stores the JWT and refresh token in memory.
An auth context wraps the application; a route guard redirects unauthenticated users
to the login page. The register page is accessible without a token. When the JWT
expires the UI refreshes it automatically; when the refresh token expires the user is
sent back to login. Logout calls `POST /api/v1/auth/logout` to revoke the token
server-side, then clears local state.
