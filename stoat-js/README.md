# Stoat Backend (JavaScript)

A JavaScript/Node.js port of the [Stoat](https://github.com/stoatchat/stoatchat) backend. Same REST API and WebSocket events, **without Docker or Redis**.

**Feature parity:** All delta REST API features from the Rust backend are implemented. See **[FEATURES.md](FEATURES.md)** for the full list.

- **REST API** (delta): Express on port `14702`
- **WebSocket events** (bonfire): same server, path `/`
- **Database**: MongoDB only
- **Rate limiting**: in-memory (no Redis)
- **Auth**: session tokens stored in MongoDB (no authifier)

## Requirements

- Node.js 18+
- MongoDB running locally or `MONGODB_URI`

No Docker, no Redis, no RabbitMQ.

## Setup

```bash
cd stoat-js
npm install
```

## Configuration

Environment variables (optional):

| Variable       | Default                        | Description        |
|----------------|--------------------------------|--------------------|
| `PORT`         | `14702`                        | HTTP API port      |
| `WS_PORT`      | `14703`                        | Unused (WS on PORT)|
| `MONGODB_URI`  | `mongodb://127.0.0.1:27017/stoat` | MongoDB URL     |
| `JWT_SECRET`   | (dev default)                  | Not used (sessions in DB) |

## Run

```bash
npm start
```

Or with auto-reload:

```bash
npm run dev
```

Ensure MongoDB is running (e.g. install [MongoDB Community](https://www.mongodb.com/try/download/community) and start the service, or use a cloud URI).

## Run with the web client

To use the official [Stoat for Web](https://github.com/stoatchat/for-web) frontend locally with this backend, see **[../stoat-web/LOCAL.md](../stoat-web/LOCAL.md)**. In short: start this API (`npm start`), then in `stoat-web` run `pnpm install`, `pnpm run build:deps`, then `pnpm start`. Open http://localhost:5173.

## API Overview

Compatible with Stoat/Revolt client expectations:

- `GET /` — API info
- `POST /auth/account/register` — Register (body: `email`, `password`, optional `username`)
- `POST /auth/session/login` — Login (body: `email`, `password`)
- `GET /auth/session` — List sessions (header: `x-session-token`)
- `DELETE /auth/session/:id` — Logout session
- `GET /users/@me` — Current user
- `PATCH /users/@me` — Edit profile
- `GET /users/dms` — List DMs
- `GET /users/:id` — Get user (optional auth)
- `POST /servers/create` — Create server
- `GET /servers/:id` — Get server
- `DELETE /servers/:id` — Delete server (owner only)
- `GET /servers/:id/members` — List members
- `POST /servers/:id/channels` — Create channel
- `GET /channels/:id` — Get channel
- `GET /channels/:id/messages` — List messages (`?limit=50&before=msgId`)
- `POST /channels/:id/messages` — Send message (body: `content`, optional `attachments`, `embeds`)
- `GET /invites/:code` — Get invite
- `POST /invites/:code` — Join invite
- `POST /invites` — Create invite (body: `channel_id`)

All authenticated routes use header: **`x-session-token: <token>`** (returned from login/register).

WebSocket URL: `ws://localhost:14702/?token=<session_token>`. Sends `Ready` on connect and echoes `Pong` for `Ping`.

## License

Same as Stoat: AGPL-3.0-or-later. See [Stoat repository](https://github.com/stoatchat/stoatchat).
