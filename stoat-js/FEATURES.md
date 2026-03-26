# Stoat API Features and Route Map

This file is a detailed feature inventory with route-level coverage from `stoat-js/src/routes`.

## Base and Versioning

- Base API: `/`
- Version alias: every major route group is also mounted at `/0.8/*`
- Example: `/channels/:id/messages` is available at both:
  - `/channels/:id/messages`
  - `/0.8/channels/:id/messages`

## Root and Health

- `GET /` - API info and build metadata
- `GET /health` - liveness
- `GET /ready` - readiness

## Public Presence API (`/public/v1`)

- `PATCH /public/v1/presence` - update presence via token (external/presence API)

## Auth and Sessions (`/auth`)

- `POST /auth/account/register` - register account
- `POST /auth/account/create` - register alias
- `POST /auth/account/verify/:token` - verify account stub
- `POST /auth/session/login` - login
- `GET /auth/session` - current/list sessions
- `DELETE /auth/session/:id` - revoke session
- `PATCH /auth/account` - account update (password/profile auth path)

## MFA (`/auth/mfa`)

- `GET /auth/mfa/ticket`
- `POST /auth/mfa/ticket`
- `GET /auth/mfa/recovery`
- `PUT /auth/mfa/recovery`
- `POST /auth/mfa/recovery`
- `GET /auth/mfa/webauthn`
- `PUT /auth/mfa/webauthn`
- `DELETE /auth/mfa/webauthn/:credential_id`
- `GET /auth/mfa/totp`
- `POST /auth/mfa/totp`
- `DELETE /auth/mfa/totp`

## Users and Relationships (`/users`)

- `GET /users/@me` - current user
- `PATCH /users/@me` - update current user
- `POST /users/@me/presence-token` - create presence API token
- `DELETE /users/@me/presence-token` - revoke presence API token
- `PATCH /users/@me/username` - change username
- `GET /users/servers` - list joined servers
- `GET /users/dms` - list DM channels
- `POST /users/friend` - send/accept friend request flow
- `GET /users/:target` - user public payload
- `GET /users/:target/dm` - open/create DM
- `GET /users/:target/profile` - profile payload
- `PATCH /users/:target/system-badges` - staff/admin badge editing path
- `GET /users/:target/flags` - user flags
- `GET /users/:target/mutual` - mutuals
- `GET /users/:target/default_avatar` - default avatar redirect
- `PUT /users/:target/friend` - accept friend
- `DELETE /users/:target/friend` - remove friend
- `PUT /users/:target/block` - block user
- `DELETE /users/:target/block` - unblock user
- `PATCH /users/:target` - privileged user patch route

## Bot Owner API (`/bots`)

- `POST /bots/create` - create bot app/user
- `GET /bots/marketplace` - discoverable marketplace bots
- `GET /bots/:target/token` - fetch bot token (owner)
- `GET /bots/@me` - list owned bots
- `GET /bots/:bot` - bot details (public/owner rules)
- `GET /bots/:target/invite` - invite metadata
- `POST /bots/:target/invite` - invite bot into server/group
- `PATCH /bots/:target` - edit bot config, slash/context commands, interactions URL, visibility
- `DELETE /bots/:target` - delete bot

## Bot Runtime Public API (`/bot`)

### Bot identity and gateway
- `GET /bot/@me`
- `PATCH /bot/@me`
- `PATCH /bot/@me/status`
- `GET /bot/gateway`

### Channel/message operations
- `GET /bot/channels/:target`
- `GET /bot/channels/:target/messages`
- `POST /bot/channels/:target/messages`
- `PATCH /bot/channels/:target/messages/:msg`
- `DELETE /bot/channels/:target/messages/:msg`
- `PUT /bot/channels/:target/messages/:msg/reactions/:emoji`
- `DELETE /bot/channels/:target/messages/:msg/reactions/:emoji`

### Interaction 2.0
- `POST /bot/interactions/:id/:token/callback` - callback types `4,5,6,7,9`
- `POST /bot/interactions/:id/:token/followups` - follow-up message
- `PATCH /bot/interactions/:id/:token/original` - edit/create deferred original response

### User/server/moderation helpers for bots
- `GET /bot/users/:target`
- `GET /bot/servers/:target`
- `GET /bot/servers/:target/channels`
- `GET /bot/servers/:target/roles`
- `GET /bot/servers/:target/permissions`
- `GET /bot/servers/:target/members`
- `GET /bot/servers/:target/members/:member`
- `PATCH /bot/servers/:target/members/:member`
- `DELETE /bot/servers/:target/members/:member`
- `GET /bot/servers/:target/bans`
- `PUT /bot/servers/:target/bans/:user`
- `DELETE /bot/servers/:target/bans/:user`

## Servers (`/servers`)

### Core server settings
- `POST /servers/create`
- `GET /servers/:target`
- `PATCH /servers/:target`
- `DELETE /servers/:target`
- `PUT /servers/:target/ack`
- `POST /servers/:target/transfer-ownership`

### Automod + calendar/events
- `GET /servers/:target/automod`
- `PATCH /servers/:target/automod`
- `GET /servers/:target/events`
- `POST /servers/:target/events`
- `PATCH /servers/:target/events/:event_id`
- `DELETE /servers/:target/events/:event_id`
- `PUT /servers/:target/events/:event_id/rsvp`

### Members and roles
- `GET /servers/:target/members`
- `GET /servers/:target/members/:member`
- `PATCH /servers/:target/members/:member`
- `DELETE /servers/:target/members/:member`
- `GET /servers/:target/members_experimental_query`
- `GET /servers/:target/roles/:role_id`
- `POST /servers/:target/roles`
- `PATCH /servers/:target/roles/:role_id`
- `DELETE /servers/:target/roles/:role_id`
- `PATCH /servers/:target/roles/ranks`

### Permissions, bans, invites, emoji, channels, audit
- `PUT /servers/:target/permissions/default`
- `PUT /servers/:target/permissions/:role_id`
- `GET /servers/:target/bans`
- `PUT /servers/:target/bans/:user`
- `DELETE /servers/:target/bans/:user`
- `GET /servers/:target/invites`
- `GET /servers/:target/emojis`
- `POST /servers/:target/emojis`
- `PATCH /servers/:target/emojis/:emojiId`
- `DELETE /servers/:target/emojis/:emojiId`
- `POST /servers/:target/channels`
- `GET /servers/:target/permissions`
- `GET /servers/:target/audit-log`
- `POST /servers/:target/webhook/:channelId`

## Channels (`/channels`)

### Channel management
- `POST /channels/create` - create group
- `GET /channels/:target`
- `PATCH /channels/:target`
- `DELETE /channels/:target`
- `GET /channels/:target/permissions`
- `GET /channels/:target/commands` - builtin + bot slash/context command discovery

### Read state and messages
- `PUT /channels/:target/ack`
- `PUT /channels/:target/ack/:message`
- `GET /channels/:target/messages`
- `GET /channels/:target/messages/:msg`
- `GET /channels/:target/messages/:msg/translate`
- `POST /channels/:target/messages`
- `PATCH /channels/:target/messages/:msg`
- `DELETE /channels/:target/messages/:msg`
- `DELETE /channels/:target/messages/bulk`

### Interaction 2.0 on channel messages
- `POST /channels/:target/messages/:msg/components/:customId` - button/select interactions
- `POST /channels/:target/interactions/:id/:token/modal-submit` - modal submit callback
- `POST /channels/:target/messages/:msg/context/:command` - message context command trigger
- `POST /channels/:target/users/:user/context/:command` - user context command trigger

### Threads, pins, reactions, search
- `POST /channels/:target/threads`
- `GET /channels/:target/threads`
- `POST /channels/:target/messages/:msg/pin`
- `DELETE /channels/:target/messages/:msg/pin`
- `PUT /channels/:target/messages/:msg/reactions/:emoji`
- `DELETE /channels/:target/messages/:msg/reactions/:emoji`
- `DELETE /channels/:target/messages/:msg/reactions`
- `POST /channels/:target/search`

### Invites, members, recipients, channel perms, webhooks, voice
- `POST /channels/:target/invites`
- `GET /channels/:target/members`
- `PUT /channels/:group/recipients/:member`
- `DELETE /channels/:target/recipients/:member`
- `PUT /channels/:target/permissions/default`
- `PUT /channels/:target/permissions/:role_id`
- `DELETE /channels/:target/permissions/:role_id`
- `POST /channels/:target/webhooks`
- `GET /channels/:target/webhooks`
- `POST /channels/:target/join_call`
- `PUT /channels/:target/end_ring/:user`

## Whiteboard (`/whiteboard`)

- `POST /whiteboard/:sessionId/close` - close active whiteboard session

## Invites (`/invites`)

- `GET /invites/:code/preview`
- `GET /invites/:code`
- `POST /invites/:code`
- `DELETE /invites/:target`
- `POST /invites/`

## Customisation (`/custom`)

- `PUT /custom/emoji/:id`
- `GET /custom/emoji/:emoji_id`
- `DELETE /custom/emoji/:emoji_id`

## Safety, Onboarding, Policy

- `POST /safety/report`
- `GET /onboard/hello`
- `POST /onboard/complete`
- `POST /policy/acknowledge`

## Sync and Push

- `POST /sync/settings/fetch`
- `POST /sync/settings/set`
- `GET /sync/unreads`
- `POST /push/subscribe`
- `POST /push/unsubscribe`

## Ofeed (`/ofeed`)

- `GET /ofeed/posts`
- `GET /ofeed/posts/:id`
- `POST /ofeed/posts`
- `POST /ofeed/posts/:id/like`
- `DELETE /ofeed/posts/:id`

## Channel Webhooks (`/webhooks`)

- `GET /webhooks/:id`
- `GET /webhooks/:id/:token`
- `POST /webhooks/:id/:token`
- `POST /webhooks/:id/:token/github`
- `PATCH /webhooks/:id`
- `PATCH /webhooks/:id/:token`
- `DELETE /webhooks/:id`
- `DELETE /webhooks/:id/:token`

## Attachments (`/attachments`)

- `POST /attachments/` - upload attachment
- `GET /attachments/:filename` - serve attachment

## Admin (`/admin`)

- `GET /admin/stats`
- `POST /admin/login`
- `POST /admin/logout`
- `GET /admin/me`
- `GET /admin/reports`
- `GET /admin/reports/:id`
- `DELETE /admin/reports/:id`
- `GET /admin/badges/public`
- `GET /admin/badges`
- `POST /admin/upload`
- `POST /admin/badges`
- `PATCH /admin/badges/:id`
- `DELETE /admin/badges/:id`
- `GET /admin/users`
- `GET /admin/claw`
- `PATCH /admin/claw`
- `POST /admin/claw/messages`
- `PATCH /admin/users/:id`
- `PATCH /admin/users/:id/badges`

## Gateway (WebSocket)

- Connection (user): `ws://host/?token=<session_token>`
- Connection (bot): `ws://host/?bot_token=<bot_token>&intents=<bitfield>`
- Typical events:
  - `Ready`
  - `MESSAGE_CREATE`, `MESSAGE_UPDATE`, `MESSAGE_DELETE`
  - `MESSAGE_REACTION_ADD`, `MESSAGE_REACTION_REMOVE`
  - `INTERACTION_CREATE`
  - `TypingStart`, `TypingStop`
  - `VoiceStateUpdate`, `VoiceReady`, `VoiceSignal`
  - `PresenceUpdate`

## Notes

- Authentication/authorization requirements vary by route (`authMiddleware`, `botAuth`, `adminAuth`).
- Most route groups are available under both unversioned and `/0.8/*` prefixes.
- This inventory was generated from current route definitions in `stoat-js/src/routes`.
