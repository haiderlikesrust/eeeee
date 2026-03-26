# Stoat API reference (Android / mobile clients)

This document describes the **HTTP REST API** and **WebSocket gateway** implemented by [`stoat-js`](stoat-js/) (Express). Use it to implement a native Android app or to prompt an AI coding assistant.

**Source of truth:** route handlers live under [`stoat-js/src/routes/`](stoat-js/src/routes/). If this doc drifts, grep `router.(get|post|put|patch|delete)` in that folder.

---

## 1. Base URL and versioning

- **Production / device:** set `API_BASE` to **`https://opic.fun`** (no trailing slash), unless your API is on a subdomain such as `https://api.opic.fun`.
- **Web app dev:** the Vite frontend proxies `/api` → backend; a **native app should call the API host directly**, not `/api` on the web origin, unless you add the same proxy.

**Optional API version prefix:** every route is also mounted under `/0.8/…` (duplicate of the same routers). Examples:

- `GET https://opic.fun/` or `GET https://opic.fun/0.8/`
- `POST https://opic.fun/auth/session/login` or `POST https://opic.fun/0.8/auth/session/login`

Use **one** style consistently.

---

## 2. Global behavior

| Topic | Detail |
|--------|--------|
| **JSON** | `Content-Type: application/json` for JSON bodies. Body size limit **1 MB** (except multipart uploads). |
| **Text/plain JSON** | Server accepts `text/plain` bodies on POST/PUT/PATCH and parses them as JSON (compatibility). |
| **Compression** | Responses may be gzip/brotli-compressed (`compression` middleware). |
| **CORS** | Configurable; mobile apps are not browsers—CORS does not apply to OkHttp. |
| **Rate limits** | Global soft limit **120** req/min per IP (`app.js`). Stricter limits on `/auth`, `/public/v1`, `/admin`, `/bot`, `/ofeed`. |
| **Errors (JSON)** | Typically `{ "type": "ErrorType", "error": "human message" }`. HTTP status 4xx/5xx. |
| **Success empty** | Some endpoints return **204 No Content** with an empty body. |
| **500** | `{ "type": "InternalError", "error": "<message>" }` |

---

## 3. Authentication (user sessions)

After login/register, store the **`token`** string and send it on every authenticated request using **any one** of:

1. Header: `x-session-token: <token>`
2. Header: `Authorization: Bearer <token>`
3. Query (discouraged on mobile except for WebSocket URL): `?token=<token>`

**Failure responses**

- `401` `{ "type": "Unauthorized", "error": "Invalid session" }` — missing/invalid token.
- `403` `{ "type": "AccountDisabled", "error": "…" }` — user disabled; session may be deleted server-side.

**Optional auth:** some routes use optional middleware: without a token you get a subset of data (e.g. public user profile).

---

## 4. WebSocket gateway (realtime)

- **URL:** same host as HTTP, path **`/`** (root WebSocket path). Production: **`wss://opic.fun/`** (TLS). `GET /` JSON may also return a `ws` hint from server config (`WS_URL`).
- **Query params (user client):**
  - `token=<session_token>` **or** header `x-session-token` on the WS upgrade (implementation reads `url.searchParams.get('token')` or `x-session-token`).
- **Bot client:** `bot_token=<bot_secret>` or `botToken=…` or header `x-bot-token`.
- **Optional:** `intents=<number>` (bitmask; used for bot/event filtering—see `GatewayIntents` in [`stoat-js/src/events.js`](stoat-js/src/events.js)).

**On connect**, server sends a single message:

```json
{
  "type": "Ready",
  "data": {
    "users": [ /* current user object */ ],
    "servers": [ /* server documents */ ],
    "channels": [ /* channel documents */ ],
    "voiceStates": { "channelId": ["userId", "..."] }
  }
}
```

**Client → server examples**

```json
{ "type": "Ping", "data": {} }
```

Server replies:

```json
{ "type": "Pong", "data": {} }
```

**Discovery and public join (logged-in user clients)** — when the app already has an open gateway connection, prefer these over HTTP for the same behavior (see [`publicServer.js`](stoat-js/src/publicServer.js) helpers used by both paths):

| Client → server | Server → client | Notes |
|-----------------|-----------------|--------|
| `{ "type": "DiscoverServersRequest", "d": { "limit": 24, "before": "optional_server_id" } }` | `{ "type": "DiscoverServers", "d": { "servers": [ … ] } }` | Same payload shape as `GET /servers/discover`. |
| (same) | `{ "type": "DiscoverServersError", "d": { "code": "rate_limited" } }` | Per-user WS rate limit. |
| `{ "type": "JoinPublicServerRequest", "d": { "slug": "vanity_slug" } }` | `{ "type": "JoinPublicServer", "d": { "serverId": "…", "channelId": "…" } }` | Same membership rules as `POST /invites/:code` for an approved public slug. |
| (same) | `{ "type": "JoinPublicServerError", "d": { "code": "…", "error": "…" } }` | e.g. `not_found`, `ServerLocked`, `AlreadyInServer`, `rate_limited`. |

For **cold start**, **scripts**, or **unauthenticated** flows, use **`GET /servers/discover`** and **`GET|POST /invites/...`** instead.

Other inbound types include voice/whiteboard flows—see [`stoat-js/src/events.js`](stoat-js/src/events.js) `switch (msg.type)`.

**Close codes (examples):** `4001` invalid session/token, `4003` account disabled.

---

## 5. REST endpoints by area

Below, `:id` / `:target` are string IDs (ULID-style strings in this codebase).

### 5.1 Root & health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | No | API info: `revolt`, `features`, `ws`, `app`, `vapid` (Web Push public key). |
| GET | `/health` | No | Liveness: `{ "status": "ok", "service": "stoat-api" }`. |
| GET | `/ready` | No | Readiness: `{ "status": "ready", "service": "stoat-api", "mongodb": "connected" }` or `503` with details. |

**Example `GET /`**

```json
{
  "revolt": "Stoat API (JavaScript port)",
  "features": { "captcha": { "enabled": false }, "email": { "enabled": false }, "invite_only": false },
  "ws": "wss://opic.fun",
  "app": "https://opic.fun",
  "vapid": ""
}
```

---

### 5.2 Auth (`/auth`)

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/auth/account/register` | No | See below | `201` session + user |
| POST | `/auth/account/create` | No | Same as register | Alias |
| POST | `/auth/account/verify/:token` | No | — | `{}` (no-op) |
| POST | `/auth/session/login` | No | `{ "email", "password", "friendly_name"? }` | `200` session + user |
| GET | `/auth/session` | Yes | — | Array of sessions (no token in list) |
| DELETE | `/auth/session/:id` | Yes | — | `204` |
| PATCH | `/auth/account` | Yes | `{ "password", "current_password"? }` | `204` |

**Register / login success shape (representative)**

```json
{
  "_id": "<session_id>",
  "user_id": "<user_id>",
  "session_id": "<session_id>",
  "token": "<store_this_on_device>",
  "name": "Session",
  "user": {
    "_id": "<user_id>",
    "username": "user",
    "discriminator": "1234",
    "relationship": "None",
    "online": false
  }
}
```

Store **`token`** for `x-session-token` / `Authorization: Bearer`; keep **`user._id`** and **`session_id`** as needed for logout (`DELETE /auth/session/:id`).

**Register body**

```json
{
  "email": "you@example.com",
  "password": "secret",
  "username": "optional_name",
  "invite": "optional_invite_code"
}
```

**Login body**

```json
{
  "email": "you@example.com",
  "password": "secret",
  "friendly_name": "Pixel 9"
}
```

**Errors:** `400` `{ "type": "InvalidCredentials" | "EmailInUse", "error": "…" }`, `403` `AccountDisabled`.

---

### 5.3 MFA (`/auth/mfa`) — stubs

All routes require user session. Responses are **compatibility stubs** (empty TOTP/WebAuthn, etc.). See [`stoat-js/src/routes/mfa.js`](stoat-js/src/routes/mfa.js).

---

### 5.4 Users (`/users`)

| Method | Path | Auth | Notes |
|--------|------|------|--------|
| GET | `/users/@me` | Yes | Current user (public shape + online). |
| PATCH | `/users/@me` | Yes | `{ username?, display_name?, avatar?, status?, profile? }` |
| POST | `/users/@me/presence-token` | Yes | Creates `stp_…` token for `/public/v1/presence`. |
| DELETE | `/users/@me/presence-token` | Yes | Revokes token. |
| PATCH | `/users/@me/username` | Yes | `{ "username", "password"? }` |
| GET | `/users/servers` | Yes | List `Server` docs for member servers. |
| GET | `/users/dms` | Yes | DM channels with `other_user` populated. |
| POST | `/users/friend` | Yes | `{ "username" }` or `{ "user_id" }` — send request or accept if incoming. |
| GET | `/users/:target` | Optional | Public user by id. |
| GET | `/users/:target/dm` | Yes | Get/create DM or SavedMessages channel object. |
| GET | `/users/:target/profile` | Yes | Normalized profile object. |
| PATCH | `/users/:target/system-badges` | Yes | Staff only (`privileged`). |
| GET | `/users/:target/flags` | Yes | `{ "flags": number }` |
| GET | `/users/:target/mutual` | Yes | `{ users, servers, channels }` ids |
| GET | `/users/:target/default_avatar` | No | `302` redirect |
| PUT | `/users/:target/friend` | Yes | Accept incoming request |
| DELETE | `/users/:target/friend` | Yes | Remove friend / cancel request |
| PUT | `/users/:target/block` | Yes | Block |
| DELETE | `/users/:target/block` | Yes | Unblock |
| PATCH | `/users/:target` | Yes | Only `:target` = self; same fields as `@me` subset |

**Example `PATCH /users/@me`**

```json
{
  "display_name": "Ada",
  "status": { "presence": "Online", "text": "Coding" },
  "profile": { "bio": "Hello", "accent_color": "#10b981" }
}
```

---

### 5.5 Onboarding (`/onboard`)

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/onboard/hello` | Optional | — | `{ "onboarding": boolean, "build": { … } }` |
| POST | `/onboard/complete` | Yes | `{ "username" }` | User object with discriminator assigned |

---

### 5.6 Policy (`/policy`)

| Method | Path | Auth | Response |
|--------|------|------|----------|
| POST | `/policy/acknowledge` | Yes | `204` |

---

### 5.7 Sync & settings (`/sync`)

| Method | Path | Auth | Body / response |
|--------|------|------|------------------|
| POST | `/sync/settings/fetch` | Yes | `{ "keys": ["key1", …] }` or `{}` for all → `{ "key": "stored_string_or_json_string" }` |
| POST | `/sync/settings/set` | Yes | `{ "key": "value" }` map; values stringified if not string → `204` |
| GET | `/sync/unreads` | Yes | Array of `{ channel_id, last_id, last_message_id, mentions, server_id? }` |

---

### 5.8 Push notifications (`/push`) — Web Push

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/push/subscribe` | Yes | `{ "endpoint", "p256dh"?, "auth"?, "session_id"? }` | `204` |
| POST | `/push/unsubscribe` | Yes | `{ "endpoint"? }` — omit endpoint to remove all | `204` |

---

### 5.9 Attachments / uploads (`/attachments`)

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/attachments` | Yes | **multipart/form-data**, field name **`file`** | JSON metadata + `url` |
| GET | `/attachments/:filename` | No | — | File stream or `302` to S3 if configured |

**Example success (local storage)**

```json
{
  "_id": "<id>",
  "tag": "attachments",
  "filename": "photo.png",
  "content_type": "image/png",
  "size": 12345,
  "metadata": { "type": "Image", "width": 0, "height": 0 },
  "url": "/attachments/<id>.png"
}
```

Resolve relative `url` values against **`https://opic.fun`** (or absolute S3 URL when enabled).

Max upload size **20 MB** (multer limit).

---

### 5.10 Servers (`/servers`)

High surface area: create server, fetch/patch/delete, members, roles, bans, invites list, emojis, channels, permissions, audit log, events (calendar), automod, webhooks, ownership transfer.

**Representative routes** (all require session unless noted):

- `POST /servers/create` — body includes `name`, optional `nonce`, etc. (see [`servers.js`](stoat-js/src/routes/servers.js)).
- `GET /servers/:target`, `PATCH /servers/:target`, `DELETE /servers/:target`
- `GET|PATCH /servers/:target/automod`
- `GET|POST|PATCH|DELETE /servers/:target/events`, `PUT …/events/:event_id/rsvp`
- `PUT /servers/:target/ack`
- `GET /servers/:target/members`, `GET|PATCH|DELETE …/members/:member`
- `GET /servers/:target/roles/:role_id`, `POST …/roles`, `PATCH …/roles/:role_id`, `DELETE …/roles/:role_id`, `PATCH …/roles/ranks`
- `PUT …/permissions/default`, `PUT|DELETE …/permissions/:role_id`
- `GET …/bans`, `PUT|DELETE …/bans/:user`
- `GET …/invites`, `GET …/emojis`, `POST|PATCH|DELETE …/emojis/:emojiId`
- `POST …/channels`, `GET …/permissions`, `GET …/audit-log`
- `POST …/webhook/:channelId`
- `POST …/transfer-ownership`
- **`GET /servers/discover`** — **No auth.** Public directory (approved servers with discovery enabled, not locked). Query: `limit` (default 24, max 50), `before` (server id cursor). Response: `{ "servers": [ { "id", "name", "description", "icon", "banner", "slug", "member_count" } ] }`. Rate-limited per IP. **In the official web app**, connected clients should prefer the WebSocket **`DiscoverServersRequest`** / **`DiscoverServers`** pair when possible; HTTP remains the fallback and for non-WS clients.
- **`POST /servers/:target/public-request`** — **Session auth, server owner only.** Body `{ "slug": "desired_vanity" }`. Submits or updates a pending public listing request (admin must approve). Validates slug and reserves it while pending or approved (see server code).
- **`PATCH /servers/:target`** — Owner may set **`public_discovery`** (boolean) **only when** `public_status` is **`approved`**; toggles visibility on the discover list without removing the vanity invite slug.

**Exact request bodies** vary by route—inspect the handler in [`stoat-js/src/routes/servers.js`](stoat-js/src/routes/servers.js).

---

### 5.11 Channels (`/channels`)

Critical for chat UX:

- `POST /channels/create` — create channel / group (body depends on type).
- `GET /channels/:target` — channel object + permissions summary.
- `GET /channels/:target/permissions`
- `GET /channels/:target/commands` — slash commands for autocomplete: `{ "builtin": [...], "bots": [...] }`
- `PATCH /channels/:target`, `DELETE /channels/:target`
- `PUT /channels/:target/ack`, `PUT /channels/:target/ack/:message`
- `GET /channels/:target/messages` — query: `limit` (max 100), `before`, `after`, `sort` (`Latest`|`Oldest`), `pinned` (`true`|`false`)
- `GET /channels/:target/messages/:msg`
- `GET /channels/:target/messages/:msg/translate?lang=es`
- `POST /channels/:target/messages` — send message (see below)
- `POST|GET /channels/:target/threads`, `PATCH …/messages/:msg`, `DELETE …`
- Reactions: `PUT|DELETE …/messages/:msg/reactions/:emoji`, `DELETE …/reactions`
- `POST …/search`, `POST …/invites`, `GET …/members`
- Group DMs: `PUT /channels/:group/recipients/:member`, `DELETE …/recipients/:member`
- Permissions overrides: `PUT …/permissions/default`, `PUT|DELETE …/permissions/:role_id`
- Webhooks: `POST|GET …/webhooks`
- Voice: `POST …/join_call`, `PUT …/end_ring/:user`
- Interactions/components: several `POST …/interactions/…`, `…/components/:customId`, context menus, modal submit (see file).

**`POST /channels/:target/messages` body (common fields)**

```json
{
  "content": "Hello **world**",
  "replies": ["message_id"],
  "attachments": [ { "_id": "…", "tag": "attachments", "filename": "…", "content_type": "…", "size": 1, "metadata": {}, "url": "…" } ],
  "embeds": [],
  "components": [],
  "mentions": [],
  "nonce": "client-generated-id",
  "masquerade": {}
}
```

- `content` max length **2000** after server processing.
- Slash-only commands may trigger bot/system flows (e.g. `/whiteboard`)—see server code.

**Errors:** `403` Forbidden (no access / missing permission), `404` NotFound, `429` RateLimited for slowmode `{ "retry_after": seconds }`.

---

### 5.12 Invites (`/invites`)

`:code` is normally an **invite id** (short string). It may also be an **approved public server vanity slug** (lowercase `public_slug`): resolution tries **`Invite.findById(code)`** first, then **`Server`** with `public_slug` + `public_status: "approved"`.

| Method | Path | Auth | Notes |
|--------|------|------|--------|
| GET | `/invites/:code/preview` | No | Server preview for deep link; for public slugs, `server` may include **`icon`** and **`banner`** for landing UI |
| GET | `/invites/:code` | Yes | Full invite |
| POST | `/invites/:code` | Yes | Join → returns `channel` object (first **TextChannel** in server order, else first channel, for public slug joins—see backend) |
| DELETE | `/invites/:target` | Yes | Creator deletes invite |
| POST | `/invites` | Yes | `{ "channel_id" }` → `201` `{ "_id", "channel", "creator", "type" }` |

---

### 5.13 Bots — user management (`/bots`)

| Method | Path | Auth | Notes |
|--------|------|------|--------|
| POST | `/bots/create` | Yes | `{ name?, public?, analytics?, discoverable?, intents?, interactions_url?, … }` |
| GET | `/bots/marketplace` | Optional | `?limit=&q=&sort=popular|new` |
| GET | `/bots/@me` | Yes | Your bots |
| GET | `/bots/:target/token` | Yes | Owner only `{ "token" }` |
| GET | `/bots/:bot` | Optional | Bot profile |
| GET | `/bots/:target/invite` | Optional | |
| POST | `/bots/:target/invite` | Yes | `{ "server": "id" }` or `{ "group": "channel_id" }` → `204` |
| PATCH | `/bots/:target` | Yes | Owner; can set `slash_commands`, `remove: "Token"` to rotate |
| DELETE | `/bots/:target` | Yes | |

---

### 5.14 Bot HTTP API (`/bot`) — `Authorization: Bot <token>`

Used by bot backends, not normal users. Auth: header **`Authorization: Bot <bot_secret>`** or **`x-bot-token`** or `?token=`.

Endpoints include: `@me`, `gateway` info, `channels/:target`, messages CRUD, reactions, interactions callbacks, `users/:target`, `servers/:target` and sub-resources (channels, roles, permissions, members, bans). Full list in [`stoat-js/src/routes/botPublic.js`](stoat-js/src/routes/botPublic.js).

Optional header for delegated owner actions: `x-invoker-user-id` (see file).

---

### 5.15 Whiteboard (`/whiteboard`)

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/whiteboard/:sessionId/close` | Yes | `{ "attachment": { … } }` or `{ "attachments": [ … ] }` — use uploaded file object | `200` `{ "ok": true, "message": { … } }` |

Realtime drawing uses **WebSocket** messages (`WhiteboardJoin`, ops, etc.) in [`events.js`](stoat-js/src/events.js).

---

### 5.16 Custom emoji (`/custom`)

| Method | Path | Auth | Notes |
|--------|------|------|--------|
| PUT | `/custom/emoji/:id` | Yes | Create `{ name?, parent?, animated?, nsfw?, media? }` |
| GET | `/custom/emoji/:emoji_id` | Yes | |
| DELETE | `/custom/emoji/:emoji_id` | Yes | Owner only |

---

### 5.17 Safety (`/safety`)

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/safety/report` | Yes | `{ "content": {}, "reason"?: string }` | `204` |

---

### 5.18 Ofeed (`/ofeed`) — social feed

| Method | Path | Auth | Notes |
|--------|------|------|--------|
| GET | `/ofeed/posts` | Optional | `?limit=&before=` → `{ "posts": [ … ] }` |
| GET | `/ofeed/posts/:id` | Optional | `{ "post": … }` |
| POST | `/ofeed/posts` | Yes | New post `{ "content" }` or repost `{ "repost_of", "content"? }` (max 280 chars) |
| POST | `/ofeed/posts/:id/like` | Yes | Toggle like → `{ like_count, liked }` |
| DELETE | `/ofeed/posts/:id` | Yes | Author only |

---

### 5.19 Public presence API (`/public/v1`)

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| PATCH | `/public/v1/presence` | **Presence token** | See below | `{ "ok": true, "status": { … }, "expires_at"?: … }` |

Auth: `Authorization: Bearer <presence_token>`, or `X-Presence-Token`, or `?token=` (see [`presenceUtils.js`](stoat-js/src/utils/presenceUtils.js)). Token from `POST /users/@me/presence-token`.

Body supports `activity`, `presence`, `ttl_seconds`, `heartbeat: true` for lease refresh—see [`publicPresence.js`](stoat-js/src/routes/publicPresence.js).

---

### 5.20 Webhooks (`/webhooks`)

Mix of user-auth and token-in-path routes for GitHub integrations, etc. See [`stoat-js/src/routes/webhooks.js`](stoat-js/src/routes/webhooks.js).

---

### 5.21 Admin (`/admin`)

Separate **admin** login/session (not user `x-session-token`). Used for moderation dashboard: stats, reports, badges, users, official Claw bot messaging, **public server listing approvals**, etc. See [`stoat-js/src/routes/admin.js`](stoat-js/src/routes/admin.js). **Do not embed admin credentials in a consumer Android app.**

**Public listing queue (admin token):**

| Method | Path | Notes |
|--------|------|--------|
| GET | `/admin/public-servers/pending` | `{ "servers": [ … ] }` with `public_slug_requested`, `owner`, `owner_user`, etc. |
| POST | `/admin/public-servers/:serverId/approve` | Optional body `{ "slug": "override" }` (else uses owner’s requested slug). Sets approved slug and `public_discovery` (default true). |
| POST | `/admin/public-servers/:serverId/reject` | `204` — marks request rejected. |

---

## 6. IDs and usernames

- **User IDs**, **channel IDs**, **server IDs**, **message IDs** are string identifiers (often ULIDs).
- Display: **`username` + `#` + `discriminator`** (4 digits) is unique.
- Friend search accepts `username#1234` or plain `username` (see `/users/friend`).

---

## 7. Android implementation checklist

1. **Persist** `token` securely (EncryptedSharedPreferences / DataStore).
2. Attach **`x-session-token`** (or `Authorization: Bearer`) on OkHttp interceptor.
3. **WebSocket** on background thread; reconnect with backoff; send **Ping** periodically.
4. After **Ready**, merge `servers` + `channels` into local DB; subscribe to **MESSAGE_CREATE**, **MESSAGE_UPDATE**, **MESSAGE_DELETE**, **PresenceUpdate**, etc. (inspect `broadcastToChannel` / `broadcastToUser` payloads in `events.js` and channel routes). For **home / discovery**, when the socket is up send **`DiscoverServersRequest`** and handle **`DiscoverServers`**; use **`GET /servers/discover`** on cold start or if the socket is down. Optional: **`JoinPublicServerRequest`** for in-app join by slug when connected.
5. **Upload files** with `multipart/form-data` field **`file`**, then pass returned attachment object in `POST …/messages`.
6. Use **`GET /sync/unreads`** for badge counts.
7. Point **`GET /attachments/...`** or absolute URLs from attachment metadata for media display.

---

## 8. Config reference

Server config: [`stoat-js/config.js`](stoat-js/config.js) (env vars for MongoDB, S3 uploads, VAPID, CORS, etc.).

---

*Generated from the Stoat `stoat-js` codebase. Regenerate or diff against routes when upgrading the API.*
