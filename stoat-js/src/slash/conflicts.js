import { Bot, Member } from '../db/models/index.js';

/**
 * Ensures no other bot in a server shared with `botId` has any of `names`.
 * @param {string} botId
 * @param {Set<string>|string[]} names
 * @returns {Promise<string|null>} error message or null if ok
 */
export async function slashCommandNamesConflictWithPeers(botId, names) {
  const set = names instanceof Set ? names : new Set(names);
  if (set.size === 0) return null;
  const myServers = await Member.find({ user: botId }).distinct('server');
  if (myServers.length === 0) return null;
  const peerMembers = await Member.find({ server: { $in: myServers }, user: { $ne: botId } }).lean();
  const peerIds = [...new Set(peerMembers.map((m) => m.user))];
  if (peerIds.length === 0) return null;
  const peerBots = await Bot.find({ _id: { $in: peerIds } }).lean();
  for (const pb of peerBots) {
    for (const c of (pb.slash_commands || [])) {
      if (set.has(c.name)) {
        return `Command "${c.name}" is already registered by another bot in a shared server`;
      }
    }
  }
  return null;
}
