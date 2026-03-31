/**
 * Parse leading slash commands from message content (MVP).
 * Returns null if not a slash command line.
 */
export function parseSlashContent(content) {
  if (content == null || typeof content !== 'string') return null;
  const t = content.trim();
  if (!t.startsWith('/') || t.startsWith('//')) return null;
  const rest = t.slice(1);
  if (!rest.length) return null;
  const firstSpace = rest.search(/\s/);
  const nameRaw = firstSpace === -1 ? rest : rest.slice(0, firstSpace);
  if (!nameRaw.length) return null;
  const name = nameRaw.toLowerCase();
  const args = firstSpace === -1 ? '' : rest.slice(firstSpace + 1).trim();
  return { name, args, raw: t };
}

/** Names reserved for platform builtins; bot registration must not use these. */
export const RESERVED_BUILTIN_NAMES = new Set(['help', 'ping', 'shrug', 'tableflip', 'whiteboard', 'minigame']);

export const SLASH_NAME_RE = /^[a-z0-9_-]{1,32}$/;
export const MAX_SLASH_COMMANDS_PER_BOT = 100;
export const COMMAND_TYPES = new Set(['CHAT_INPUT', 'USER', 'MESSAGE']);

export function normalizeSlashCommandsInput(raw) {
  if (!Array.isArray(raw)) return { error: 'slash_commands must be an array' };
  if (raw.length > MAX_SLASH_COMMANDS_PER_BOT) {
    return { error: `At most ${MAX_SLASH_COMMANDS_PER_BOT} slash commands` };
  }
  const seen = new Set();
  const out = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') return { error: 'Invalid slash command entry' };
    const name = String(row.name || '').trim().toLowerCase();
    const description = String(row.description ?? '').slice(0, 100);
    const type = String(row.type || 'CHAT_INPUT').toUpperCase();
    if (!COMMAND_TYPES.has(type)) {
      return { error: `Invalid command type for "${name || '(empty)'}": ${type}` };
    }
    if (!SLASH_NAME_RE.test(name)) {
      return { error: `Invalid command name: ${name || '(empty)'}` };
    }
    if (type === 'CHAT_INPUT' && RESERVED_BUILTIN_NAMES.has(name)) {
      return { error: `Command name "${name}" is reserved for built-in commands` };
    }
    const key = `${type}:${name}`;
    if (seen.has(key)) return { error: `Duplicate command: ${type} ${name}` };
    seen.add(key);
    out.push({ name, description, type });
  }
  return { commands: out };
}
