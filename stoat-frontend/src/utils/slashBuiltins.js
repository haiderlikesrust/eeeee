/** Mirrors server built-ins — used when GET /channels/:id/commands fails or is empty. */
export const SLASH_BUILTIN_FALLBACK = [
  { name: 'help', description: 'List built-in slash commands' },
  { name: 'ping', description: 'Check latency' },
  { name: 'shrug', description: 'Shrug' },
  { name: 'tableflip', description: 'Flip a table' },
  { name: 'whiteboard', description: 'Start a collaborative whiteboard in this channel' },
];
