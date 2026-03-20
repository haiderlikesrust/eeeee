/**
 * Rich presence: "Playing Cursor" with the Cursor logo while this process runs.
 *
 * Default art: official logo (HTTPS). Override:
 *   $env:STOAT_ACTIVITY_IMAGE="https://..."
 *
 *   $env:STOAT_PRESENCE_TOKEN="stp_..."
 *   node examples/presence-playing-cursor.js
 */

const API_BASE = (process.env.STOAT_API_BASE || 'http://localhost:14702').replace(/\/$/, '');
const TOKEN = process.argv[2] || process.env.STOAT_PRESENCE_TOKEN;
const TTL_SECONDS = Math.min(600, Math.max(15, Number(process.env.STOAT_PRESENCE_TTL) || 90));
const HEARTBEAT_MS = Math.min(TTL_SECONDS * 1000 - 5000, Number(process.env.STOAT_PRESENCE_HEARTBEAT_MS) || 30_000);
const IMAGE =
  (process.env.STOAT_ACTIVITY_IMAGE || '').trim() ||
  'https://cursor.com/assets/images/logo.png';

const ACTIVITY = {
  type: 'Playing',
  name: 'Cursor',
  image: IMAGE,
};

async function patch(body) {
  const res = await fetch(`${API_BASE}/public/v1/presence`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(data.error || data.message || res.statusText || String(res.status));
  }
  return data;
}

async function clear() {
  try {
    await patch({ activity: null });
    console.log('Presence cleared.');
  } catch (e) {
    console.error('Failed to clear presence:', e.message);
  }
}

async function main() {
  if (!TOKEN) {
    console.error(
      'Missing token. Set STOAT_PRESENCE_TOKEN or: node examples/presence-playing-cursor.js <token>'
    );
    process.exit(1);
  }

  await patch({
    activity: ACTIVITY,
    presence: 'Online',
    ttl_seconds: TTL_SECONDS,
  });
  console.log(
    `Playing "${ACTIVITY.name}" (${IMAGE}) — lease ${TTL_SECONDS}s, heartbeat every ${HEARTBEAT_MS / 1000}s. Ctrl+C to stop.`
  );

  const timer = setInterval(() => {
    patch({ heartbeat: true, ttl_seconds: TTL_SECONDS }).catch((e) => {
      console.error('Heartbeat failed:', e.message);
    });
  }, HEARTBEAT_MS);

  const stop = async () => {
    clearInterval(timer);
    await clear();
    process.exit(0);
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
