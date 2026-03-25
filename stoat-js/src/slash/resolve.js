import { Bot, Member } from '../db/models/index.js';

/**
 * @param {string} serverId
 * @param {string} commandName lowercase
 * @param {'CHAT_INPUT'|'USER'|'MESSAGE'} [commandType]
 */
export async function findBotsWithSlashCommand(serverId, commandName, commandType = 'CHAT_INPUT') {
  const members = await Member.find({ server: serverId }).lean();
  const userIds = members.map((m) => m.user);
  if (userIds.length === 0) return [];
  const bots = await Bot.find({ _id: { $in: userIds } }).lean();
  const lc = String(commandName).toLowerCase();
  const t = String(commandType || 'CHAT_INPUT').toUpperCase();
  return bots.filter((b) => (b.slash_commands || []).some((c) => c.name === lc && String(c.type || 'CHAT_INPUT') === t));
}
