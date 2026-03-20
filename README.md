# Opic (Stoat stack)

Monorepo with three packages:

| Package | Description |
|---------|-------------|
| [**stoat-js**](stoat-js/) | REST API (Express) + WebSocket gateway, MongoDB |
| [**stoat-frontend**](stoat-frontend/) | Web client (Vite + React) |
| [**stoat-bot-sdk**](stoat-bot-sdk/) | Bot SDK + examples |

## Prerequisites

- Node.js 18+
- MongoDB (local or cloud URI)

## Quick start (development)

**1. Backend**

```bash
cd stoat-js
cp .env.example .env   # optional; defaults work for local MongoDB
npm install
npm start
```

API listens on `http://localhost:14702` (see [`stoat-js/config.js`](stoat-js/config.js)). WebSocket uses the **same** HTTP port at path `/`.

**2. Frontend**

```bash
cd stoat-frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The Vite dev server proxies `/api` and `/ws` to the backend (see [`stoat-frontend/vite.config.js`](stoat-frontend/vite.config.js)).

**3. Bots (optional)**

```bash
cd stoat-bot-sdk
npm install
node examples/ping-bot.js
```

Set `BOT_TOKEN` from the developer portal / bot creation flow.

## Environment variables

See [`stoat-js/.env.example`](stoat-js/.env.example) for the API. Optional frontend overrides:

| Variable | Purpose |
|----------|---------|
| `VITE_WS_URL` | Direct WebSocket URL (bypass Vite proxy), e.g. `ws://localhost:14702` |

## Production and scaling

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for CORS, horizontal scaling, uploads, and rate limits.

## Documentation

- API features: [`stoat-js/FEATURES.md`](stoat-js/FEATURES.md)
- Backend README: [`stoat-js/README.md`](stoat-js/README.md)
- Bot SDK: [`stoat-bot-sdk/README.md`](stoat-bot-sdk/README.md)

## License

See individual packages; Stoat-related code is AGPL-3.0-or-later where applicable.
