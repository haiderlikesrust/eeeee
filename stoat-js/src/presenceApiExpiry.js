import { User } from './db/models/index.js';
import { broadcastPresenceToServers } from './presenceBroadcast.js';
import logger from './logger.js';

const TICK_MS = 10_000;

/**
 * Clears API-sourced activity when the client stops heartbeating (script exited).
 */
export function startPresenceApiExpiry() {
  setInterval(async () => {
    try {
      const now = new Date();
      const users = await User.find({
        presence_api_expires_at: { $lte: now, $ne: null },
        'status.activity.source': 'api',
      }).limit(500);

      for (const user of users) {
        if (user.status?.activity?.source !== 'api') continue;
        if (!user.presence_api_expires_at || user.presence_api_expires_at > now) continue;

        user.status = { ...(user.status || {}) };
        user.status.activity = null;
        user.presence_api_expires_at = null;
        await user.save();
        await broadcastPresenceToServers(user._id.toString(), user.status);
      }
    } catch (err) {
      logger.error({ err, msg: 'Presence API expiry tick failed' });
    }
  }, TICK_MS);
}
