/** Commands that return a Claw text reply (see channels.js for /whiteboard session flow). */
const BUILTIN_TEXT_COMMANDS = new Set(['help', 'ping', 'shrug', 'tableflip']);

/** @typedef {{ content?: string, embeds?: unknown[] }} SlashBuiltinResult */

/**
 * Metadata + handlers for built-in slash commands (Claw replies).
 */
export const BUILTIN_SLASH_LIST = [
  { name: 'help', description: 'List built-in slash commands' },
  { name: 'ping', description: 'Check latency' },
  { name: 'shrug', description: 'Shrug' },
  { name: 'tableflip', description: 'Flip a table' },
  { name: 'whiteboard', description: 'Start a collaborative whiteboard in this channel' },
];

export function listBuiltinCommandsForApi() {
  return BUILTIN_SLASH_LIST.map(({ name, description }) => ({ name, description }));
}

function isBuiltinTextCommand(name) {
  return BUILTIN_TEXT_COMMANDS.has(name);
}

/**
 * @param {string} name
 * @param {{ args: string, userId: string, channelId: string, serverId?: string }} ctx
 * @returns {Promise<SlashBuiltinResult|null>}
 */
export async function runBuiltinHandler(name, ctx) {
  if (!isBuiltinTextCommand(name)) return null;
  switch (name) {
    case 'help': {
      const lines = [
        '**Built-in commands**',
        ...BUILTIN_SLASH_LIST.map((c) => `• \`/${c.name}\` — ${c.description}`),
      ];
      if (ctx.serverId) {
        lines.push('', 'Bots in this server may add more commands via the developer portal.');
      }
      return { content: lines.join('\n') };
    }
    case 'ping':
      return { content: 'Pong!' };
    case 'shrug':
      return { content: '¯\\_(ツ)_/¯' };
    case 'tableflip':
      return { content: '(╯°□°）╯︵ ┻━┻' };
    default:
      return null;
  }
}
