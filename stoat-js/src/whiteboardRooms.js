/**
 * In-memory whiteboard rooms (ops + subscribers). Lost on process restart.
 */

const rooms = new Map();

const MAX_OPS = 5000;
const MAX_OP_JSON = 48 * 1024;

export function createRoom(sessionId, { ownerId, channelId, serverId }) {
  rooms.set(String(sessionId), {
    ownerId: String(ownerId),
    channelId: String(channelId),
    serverId: String(serverId),
    subscribers: new Set(),
    ops: [],
  });
}

export function getRoom(sessionId) {
  return rooms.get(String(sessionId));
}

export function deleteRoom(sessionId) {
  rooms.delete(String(sessionId));
}

export function addSubscriber(sessionId, userId) {
  const r = rooms.get(String(sessionId));
  if (!r) return false;
  r.subscribers.add(String(userId));
  return true;
}

export function removeSubscriber(sessionId, userId) {
  const r = rooms.get(String(sessionId));
  if (!r) return;
  r.subscribers.delete(String(userId));
}

export function appendOp(sessionId, op) {
  const r = rooms.get(String(sessionId));
  if (!r) return false;
  const raw = JSON.stringify(op);
  if (raw.length > MAX_OP_JSON) return false;
  r.ops.push(op);
  while (r.ops.length > MAX_OPS) r.ops.shift();
  return true;
}

export function getOps(sessionId) {
  return rooms.get(String(sessionId))?.ops ?? [];
}

/** Clear all ops (e.g. owner clear_board). */
export function clearRoomOps(sessionId) {
  const r = rooms.get(String(sessionId));
  if (!r) return false;
  r.ops = [];
  return true;
}

export function isSubscriber(sessionId, userId) {
  const r = rooms.get(String(sessionId));
  return !!(r && r.subscribers.has(String(userId)));
}

export function getMaxOpBytes() {
  return MAX_OP_JSON;
}

/** Call when a WS client disconnects so stale subscriptions do not accumulate. */
export function removeUserFromAllRooms(userId) {
  const id = String(userId);
  for (const [, room] of rooms.entries()) {
    room.subscribers.delete(id);
  }
}
