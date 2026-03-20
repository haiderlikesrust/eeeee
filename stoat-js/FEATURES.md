# Feature parity: Rust backend vs stoat-js

This JavaScript port implements **all** REST API features from the [Rust Stoat backend](https://github.com/stoatchat/stoatchat) (delta). No Docker or Redis.

---

## Implemented

### Root
- `GET /` – API info

### Auth
- `POST /auth/account/register` – Register
- `POST /auth/session/login` – Login
- `GET /auth/session` – List sessions
- `DELETE /auth/session/:id` – Logout
- `PATCH /auth/account` – Change password
- `POST /auth/mfa/*` – MFA stubs (ticket, recovery, webauthn, totp) for API compatibility

### Users
- `GET /users/@me`, `PATCH /users/@me`
- `PATCH /users/@me/username` – Change username (with password)
- `GET /users/dms` – List DMs
- `POST /users/friend` – Send/accept friend request
- `GET /users/:target`, `PATCH /users/:target`
- `GET /users/:target/dm` – Open DM (or saved messages for self)
- `GET /users/:target/profile` – Profile
- `GET /users/:target/flags` – User flags
- `GET /users/:target/mutual` – Mutual friends/servers/channels
- `GET /users/:target/default_avatar` – Redirect to default avatar
- `PUT /users/:target/friend` – Accept friend request
- `DELETE /users/:target/friend` – Remove friend
- `PUT /users/:target/block` – Block user
- `DELETE /users/:target/block` – Unblock user

### Bots
- `POST /bots/create` – Create bot
- `GET /bots/@me` – List own bots
- `GET /bots/:bot` – Fetch bot
- `GET /bots/:target/invite` – Public bot invite info
- `POST /bots/:target/invite` – Invite bot to server or group
- `PATCH /bots/:target` – Edit bot
- `DELETE /bots/:target` – Delete bot

### Channels
- `POST /channels/create` – Create group
- `GET /channels/:target`, `PATCH /channels/:target`, `DELETE /channels/:target`
- `PUT /channels/:target/ack/:message` – Ack (read) message
- `GET /channels/:target/messages` – List messages (query: limit, before, after, sort)
- `GET /channels/:target/messages/:msg` – Fetch one message
- `POST /channels/:target/messages` – Send message
- `PATCH /channels/:target/messages/:msg` – Edit message
- `DELETE /channels/:target/messages/:msg` – Delete message
- `DELETE /channels/:target/messages/bulk` – Bulk delete (body: ids)
- `POST /channels/:target/messages/:msg/pin` – Pin message
- `DELETE /channels/:target/messages/:msg/pin` – Unpin
- `PUT /channels/:target/messages/:msg/reactions/:emoji` – React
- `DELETE /channels/:target/messages/:msg/reactions/:emoji` – Unreact
- `DELETE /channels/:target/messages/:msg/reactions` – Clear reactions
- `POST /channels/:target/search` – Message search (body: query, limit)
- `POST /channels/:target/invites` – Create invite
- `GET /channels/:target/members` – Group members
- `PUT /channels/:group/recipients/:member` – Add to group
- `DELETE /channels/:target/recipients/:member` – Remove from group
- `PUT /channels/:target/permissions/default`, `PUT /channels/:target/permissions/:role_id`
- `POST /channels/:target/webhooks`, `GET /channels/:target/webhooks`
- `POST /channels/:target/join_call`, `PUT /channels/:target/end_ring/:user` – Voice stubs

### Servers
- `POST /servers/create` – Create server
- `GET /servers/:target`, `PATCH /servers/:target`, `DELETE /servers/:target`
- `PUT /servers/:target/ack` – Ack server
- `GET /servers/:target/members`, `GET /servers/:target/members/:member`
- `PATCH /servers/:target/members/:member` – Edit member (nickname, roles)
- `DELETE /servers/:target/members/:member` – Remove member
- `GET /servers/:target/members_experimental_query`
- `GET /servers/:target/roles/:role_id`, `POST /servers/:target/roles`, `PATCH /servers/:target/roles/:role_id`, `DELETE /servers/:target/roles/:role_id`, `PATCH /servers/:target/roles/ranks`
- `PUT /servers/:target/permissions/default`, `PUT /servers/:target/permissions/:role_id`
- `GET /servers/:target/bans`, `PUT /servers/:target/bans/:user`, `DELETE /servers/:target/bans/:user`
- `GET /servers/:target/invites` – List server invites
- `GET /servers/:target/emojis`
- `POST /servers/:target/channels` – Create channel

### Invites
- `GET /invites/:code` – Get invite
- `POST /invites/:code` – Join invite
- `DELETE /invites/:target` – Revoke invite
- `POST /invites` – Create invite (body: channel_id)

### Customisation
- `PUT /custom/emoji/:id` – Create emoji
- `GET /custom/emoji/:emoji_id` – Fetch emoji
- `DELETE /custom/emoji/:emoji_id` – Delete emoji

### Safety
- `POST /safety/report` – Report content

### Onboard
- `GET /onboard/hello` – Onboarding hello
- `POST /onboard/complete` – Complete onboarding (username)

### Policy
- `POST /policy/acknowledge` – Acknowledge policy changes

### Sync
- `POST /sync/settings/fetch` – Fetch settings (body: keys)
- `POST /sync/settings/set` – Set settings (body: key-value)
- `GET /sync/unreads` – Unread state

### Push
- `POST /push/subscribe` – Web push subscribe
- `POST /push/unsubscribe` – Unsubscribe

### Ofeed (global social feed — Opic extension)
- `GET /ofeed/posts` – List posts (newest first; query: `limit`, `before`). Public; optional session for `liked` on posts.
- `GET /ofeed/posts/:id` – Single post (share / deep link). Public; optional session.
- `POST /ofeed/posts` – Create post (`content` max 280) or **repost** (`repost_of` id, optional `content` for quote). Auth required. One repost per user per original (`409` if duplicate).
- `POST /ofeed/posts/:id/like` – Toggle like. Auth required.
- `DELETE /ofeed/posts/:id` – Delete own post (decrements original `repost_count` if repost). Auth required.

### Webhooks (channel webhooks)
- `GET /webhooks/:id` – Fetch (auth)
- `GET /webhooks/:id/:token` – Fetch with token
- `POST /webhooks/:id/:token` – Execute (send message)
- `POST /webhooks/:id/:token/github` – GitHub webhook
- `PATCH /webhooks/:id`, `PATCH /webhooks/:id/:token` – Edit
- `DELETE /webhooks/:id`, `DELETE /webhooks/:id/:token` – Delete

### WebSocket (Bonfire-style gateway)

Same HTTP server as REST: `ws://host/?token=<session_token>` (or `x-session-token` header). Bots: `?bot_token=` / `x-bot-token`, optional `intents`.

**Client → server**

- `Ping` → `Pong`
- `VoiceJoin` / `VoiceLeave` / `VoiceSignal` – WebRTC voice signaling
- `TypingStart` / `TypingStop` – typing indicators

**Server → client (non-exhaustive)**

- `Ready` – `users`, `servers`, `channels`, `voiceStates`
- `MESSAGE_CREATE`, `MESSAGE_UPDATE`, `MESSAGE_DELETE` – fan-out from REST/bot routes (see `routes/channels.js`, `routes/botPublic.js`)
- `PresenceUpdate` – member online/offline per server
- `TypingStart` / `TypingStop`
- `VoiceStateUpdate`, `VoiceReady`, `VoiceSignal`

REST handlers call `broadcastToChannel` / `broadcastToServer` / `broadcastToUser` in `src/events.js`. Multi-instance deployments need sticky sessions or a shared pub/sub layer so every user receives events (see repo `docs/DEPLOYMENT.md`).

---

## Not in this port (Rust-only services)

- **Autumn** – Dedicated media service. This repo has `POST /attachments` (local disk or optional S3) instead.
- **January** – Proxy service
- **Gifbox** – Tenor proxy
- **Crond** – Scheduled tasks (no in-repo scheduler)
- **Full Stoat/Rust Bonfire parity** – Event shapes aim to match client expectations; edge cases may differ.

**Push:** `POST /push/subscribe` stores Web Push subscriptions; delivery uses VAPID when configured (`web-push`). Without `VAPID_*` keys, subscriptions are stored but notifications are not sent.

All delta REST routes from the Rust backend are implemented. MFA is stubbed for compatibility.
