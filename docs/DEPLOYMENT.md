# Deployment and operations

## CORS

Set `CORS_ORIGINS` to a comma-separated list of allowed browser origins (no spaces, or trim them in config). Example:

```bash
CORS_ORIGINS=https://app.example.com,https://www.example.com
```

If unset, the API uses permissive `origin: true` (suitable for local development only).

## Horizontal scaling

- **Rate limits** ([`stoat-js/src/middleware/ratelimit.js`](../stoat-js/src/middleware/ratelimit.js)) are **in-memory per process**. Multiple API replicas each maintain their own counters. For strict global limits, use a shared store (e.g. Redis) or a gateway.

- **WebSockets** ([`stoat-js/src/events.js`](../stoat-js/src/events.js)) keep connection state in one Node process. Users on different instances do not receive each other’s real-time events unless you add a **shared pub/sub** (Redis, NATS, etc.) and broadcast across nodes, or you run **one** API instance and scale only stateless layers in front of it.

- **Sticky sessions**: If you use multiple instances without shared WS state, put users on the same instance for HTTP and WebSocket (e.g. load balancer affinity).

## Attachments

- **Local (default)** — Files under `UPLOADS_DIR` (default `./uploads` relative to the process cwd). Back up this directory with your DB.

- **S3-compatible** — Set:

  - `UPLOADS_STORAGE=s3`
  - `AWS_REGION`, `S3_BUCKET`
  - `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (or use instance/credential chain on AWS)
  - `S3_PUBLIC_BASE_URL` — public base URL for objects (no trailing slash), e.g. `https://my-bucket.s3.amazonaws.com` or your CDN origin

Uploaded keys are `attachments/<ulid>.<ext>`. `GET /attachments/:name` redirects to `S3_PUBLIC_BASE_URL/attachments/:name` when S3 mode is enabled.

## Web Push

1. Generate VAPID keys: `npx web-push generate-vapid-keys`
2. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (e.g. `mailto:you@example.com`).
3. `GET /` exposes `vapid` (public key) for clients that subscribe via `POST /push/subscribe`.

When VAPID is not set, subscriptions are still stored but **no push notifications are sent** for new messages.

## Email, MFA, and password reset

The API reports `email: { enabled: false }` on `GET /`. There is **no** outbound mailer in this repo: no verification email, no password reset mail, and [`mfa` routes](../stoat-js/src/routes/mfa.js) are **stubs** for client compatibility. Adding those requires an SMTP/transactional provider and new routes plus token storage.

## Health checks

- `GET /health` — process is up (liveness).
- `GET /ready` — MongoDB connection is ready (readiness).

Use these behind reverse proxies and orchestrators (Kubernetes, etc.).
