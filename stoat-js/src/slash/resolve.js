import { Bot, Member } from '../db/models/index.js';

/**
 * @param {string} serverId
 * @param {string} commandName lowercase
 */
export async function findBotsWithSlashCommand(serverId, commandName) {
  const members = await Member.find({ server: serverId }).lean();
  const userIds = members.map((m) => m.user);
  if (userIds.length === 0) return [];
  const bots = await Bot.find({ _id: { $in: userIds } }).lean();
  const lc = String(commandName).toLowerCase();
  return bots.filter((b) => (b.slash_commands || []).some((c) => c.name === lc));
}
