import { Member } from './db/models/index.js';
import { normalizeStatusForOutput } from './publicUser.js';
import { broadcastToServer } from './events.js';

export async function broadcastPresenceToServers(userId, statusDoc) {
  const memberships = await Member.find({ user: userId }).select('server').lean();
  const payload = {
    type: 'PresenceUpdate',
    d: { user_id: userId, status: normalizeStatusForOutput(statusDoc) },
  };
  // Do not exclude the updating user — they must receive the event so the client refetches members / merges status live.
  for (const { server } of memberships) {
    broadcastToServer(server, payload, null).catch(() => {});
  }
}
