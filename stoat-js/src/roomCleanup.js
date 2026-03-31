import { Room } from './db/models/index.js';
import { broadcastToRoom } from './events.js';
import logger from './logger.js';

const CLEANUP_INTERVAL_MS = 30_000;

async function cleanupEmptyRooms() {
  try {
    const rooms = await Room.find({ status: 'active' }).lean();
    const now = Date.now();
    for (const room of rooms) {
      if (room.members.length > 0) continue;
      const elapsed = now - new Date(room.last_active_at).getTime();
      if (elapsed >= (room.empty_timeout_ms || 300_000)) {
        await Room.updateOne(
          { _id: room._id, status: 'active' },
          { $set: { status: 'closed', closed_at: new Date() } },
        );
        broadcastToRoom(room._id, {
          type: 'RoomClosed',
          d: { roomId: room._id, reason: 'empty_timeout' },
        }).catch(() => {});
        logger.info({ msg: 'Room auto-closed (empty timeout)', roomId: room._id });
      }
    }
  } catch (err) {
    logger.error({ msg: 'Room cleanup error', err: err.message });
  }
}

let intervalId = null;

export function startRoomCleanup() {
  if (intervalId) return;
  intervalId = setInterval(cleanupEmptyRooms, CLEANUP_INTERVAL_MS);
  logger.info({ msg: 'Room cleanup timer started', intervalMs: CLEANUP_INTERVAL_MS });
}

export function stopRoomCleanup() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
