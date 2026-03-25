import { Bot, Member } from '../db/models/index.js';

/**
 * Ensures no other bot in a server shared with `botId` has any of `commandKeys`.
 * @param {string} botId
 * @param {Set<string>|string[]} commandKeys format: TYPE:name
 * @returns {Promise<string|null>} error message or null if ok
 */
export async function slashCommandNamesConflictWithPeers(botId, commandKeys) {
  const set = commandKeys instanceof Set ? commandKeys : new Set(commandKeys);
  if (set.size === 0) return null;
  const myServers = await Member.find({ user: botId }).distinct('server');
  if (myServers.length === 0) return null;
  const peerMembers = await Member.find({ server: { $in: myServers }, user: { $ne: botId } }).lean();
  const peerIds = [...new Set(peerMembers.map((m) => m.user))];
  if (peerIds.length === 0) return null;
  const peerBots = await Bot.find({ _id: { $in: peerIds } }).lean();
  for (const pb of peerBots) {
    for (const c of (pb.slash_commands || [])) {
      const key = `${String(c.type || 'CHAT_INPUT')}:${c.name}`;
      if (set.has(key)) {
        return `Command "${c.name}" (${String(c.type || 'CHAT_INPUT')}) is already registered by another bot in a shared server`;
      }
    }
  }
  return null;
}
