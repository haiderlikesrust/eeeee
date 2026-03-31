export const INTENTS = {
  GUILDS: 1 << 0,
  GUILD_MEMBERS: 1 << 1,
  GUILD_MESSAGES: 1 << 9,
  MESSAGE_CONTENT: 1 << 15,
};

export const NODE_PRESENCE_SNIPPET = `// Node: show while running, hide when process exits (no heartbeat)
const TOKEN = process.env.STOAT_PRESENCE_TOKEN;
const base = process.env.STOAT_API || 'http://localhost:14702';
const headers = { Authorization: \`Bearer \${TOKEN}\`, 'Content-Type': 'application/json' };
await fetch(\`\${base}/public/v1/presence\`, {
  method: 'PATCH',
  headers,
  body: JSON.stringify({
    activity: { type: 'Playing', name: 'My App' },
    ttl_seconds: 60,
    presence: 'Online',
  }),
});
const t = setInterval(() => {
  fetch(\`\${base}/public/v1/presence\`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ heartbeat: true, ttl_seconds: 60 }),
  });
}, 30_000);
process.on('SIGINT', async () => {
  clearInterval(t);
  await fetch(\`\${base}/public/v1/presence\`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ activity: null }),
  });
  process.exit(0);
});`;

export function getPresenceCurlSnippet(origin = '') {
  const base = origin || 'http://localhost:14702';
  return `curl -X PATCH "${base}/api/public/v1/presence" \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"activity":{"type":"Playing","name":"My Game"},"ttl_seconds":120}'`;
}
