/**
 * WebSocket events server (Bonfire equivalent).
 * No Redis - in-memory pub/sub for connected clients.
 * Includes voice signaling for WebRTC.
 */
import { WebSocketServer } from 'ws';
import { Session, User, Member, Server, Channel, Bot, WhiteboardSession } from './db/models/index.js';
import {
  createRoom,
  getRoom,
  addSubscriber,
  removeSubscriber,
  appendOp,
  getOps,
  isSubscriber,
  removeUserFromAllRooms,
  clearRoomOps,
} from './whiteboardRooms.js';

/** Per user per session: max WhiteboardOp relayed per 1s window (strokes etc.). */
const WB_OP_RATE_WINDOW_MS = 1000;
const WB_OP_RATE_MAX = 45;
const wbOpTimestamps = new Map();

function allowWhiteboardOpRate(sessionId, userId) {
  const key = `${String(sessionId)}:${String(userId)}`;
  const now = Date.now();
  let arr = wbOpTimestamps.get(key);
  if (!arr) {
    arr = [];
    wbOpTimestamps.set(key, arr);
  }
  const win = WB_OP_RATE_WINDOW_MS;
  const filtered = arr.filter((t) => now - t < win);
  if (filtered.length >= WB_OP_RATE_MAX) return false;
  filtered.push(now);
  wbOpTimestamps.set(key, filtered);
  return true;
}

/** Pointer broadcasts: max per 1s per user per session (lighter than ops). */
const WB_PTR_RATE_MAX = 35;
const wbPtrTimestamps = new Map();

function allowWhiteboardPointerRate(sessionId, userId) {
  const key = `${String(sessionId)}:${String(userId)}`;
  const now = Date.now();
  let arr = wbPtrTimestamps.get(key);
  if (!arr) {
    arr = [];
    wbPtrTimestamps.set(key, arr);
  }
  const filtered = arr.filter((t) => now - t < WB_OP_RATE_WINDOW_MS);
  if (filtered.length >= WB_PTR_RATE_MAX) return false;
  filtered.push(now);
  wbPtrTimestamps.set(key, filtered);
  return true;
}

/** In-progress stroke chunks (not persisted); higher cap than final ops. */
const WB_DRAWING_RATE_MAX = 90;
const wbDrawingTimestamps = new Map();

function allowWhiteboardDrawingRate(sessionId, userId) {
  const key = `${String(sessionId)}:${String(userId)}`;
  const now = Date.now();
  let arr = wbDrawingTimestamps.get(key);
  if (!arr) {
    arr = [];
    wbDrawingTimestamps.set(key, arr);
  }
  const filtered = arr.filter((t) => now - t < WB_OP_RATE_WINDOW_MS);
  if (filtered.length >= WB_DRAWING_RATE_MAX) return false;
  filtered.push(now);
  wbDrawingTimestamps.set(key, filtered);
  return true;
}

const clients = new Map(); // key -> { ws, kind, userId, lastPing, intents }

export function isUserOnline(userId) {
  if (!userId) return false;
  const id = String(userId);
  for (const [, entry] of clients.entries()) {
    if (String(entry.userId) === id && entry.ws.readyState === 1) return true;
  }
  return false;
}

/** True while presence API lease is active (script heartbeating) even if browser tab is closed. */
export function isPresenceApiLeaseActive(userDoc) {
  if (!userDoc || typeof userDoc !== 'object') return false;
  const exp = userDoc.presence_api_expires_at;
  if (!exp) return false;
  const t = exp instanceof Date ? exp.getTime() : new Date(exp).getTime();
  if (!Number.isFinite(t) || t <= Date.now()) return false;
  const act = userDoc.status?.activity;
  return Boolean(act && typeof act === 'object' && act.source === 'api');
}

/** Member lists / DMs: show online if WS connected or presence script is active. */
export function isUserOnlineDisplay(userId, userDoc) {
  if (isUserOnline(userId)) return true;
  if (userDoc && isPresenceApiLeaseActive(userDoc)) return true;
  return false;
}

export const GatewayIntents = {
  GUILDS: 1 << 0,
  GUILD_MEMBERS: 1 << 1,
  GUILD_MESSAGES: 1 << 9,
  MESSAGE_CONTENT: 1 << 15,
};

// Voice state: channelId -> Map<userId, { clientKey }>
const voiceStates = new Map();

function getVoiceMembers(channelId) {
  const state = voiceStates.get(channelId);
  if (!state) return [];
  return [...state.keys()];
}

function broadcastToVoiceChannel(channelId, event, excludeUserId) {
  const state = voiceStates.get(channelId);
  if (!state) return;
  const payload = JSON.stringify(event);
  for (const [userId, info] of state.entries()) {
    if (userId === excludeUserId) continue;
    const entry = clients.get(info.clientKey);
    if (entry && entry.ws.readyState === 1) {
      entry.ws.send(payload);
    }
  }
}

export function createEventServer(server) {
  const wss = new WebSocketServer({ server, path: '/' });

  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const sessionToken = url.searchParams.get('token') || req.headers['x-session-token'];
    const botToken = url.searchParams.get('bot_token')
      || url.searchParams.get('botToken')
      || req.headers['x-bot-token'];
    const intents = Number(url.searchParams.get('intents') || req.headers['x-bot-intents'] || 0);

    let userId = null;
    let kind = null;
    let key = null;
    let sessionDoc = null;

    if (sessionToken) {
      sessionDoc = await Session.findOne({ token: sessionToken }).lean();
      if (!sessionDoc) {
        ws.close(4001, 'Invalid session');
        return;
      }
      userId = sessionDoc.user_id;
      kind = 'user';
      key = `user:${sessionToken}`;
    } else if (botToken) {
      const bot = await Bot.findOne({ token: botToken }).lean();
      if (!bot) {
        ws.close(4001, 'Invalid bot token');
        return;
      }
      userId = bot._id;
      kind = 'bot';
      key = `bot:${botToken}`;
    } else {
      ws.close(4001, 'Missing token');
      return;
    }

    const user = await User.findById(userId).lean();
    if (!user) {
      ws.close(4001, 'User not found');
      return;
    }
    if (kind === 'user' && user.disabled) {
      if (sessionDoc?._id) {
        await Session.deleteOne({ _id: sessionDoc._id }).catch(() => {});
      }
      ws.close(4003, 'Account disabled');
      return;
    }
    const memberships = await Member.find({ user: userId }).lean();
    const serverIds = memberships.map((m) => m.server);
    clients.set(key, { ws, kind, userId, lastPing: Date.now(), intents: Number.isFinite(intents) ? intents : 0, serverIds });

    const servers = await Server.find({ _id: { $in: serverIds } }).lean();
    const channelIds = servers.flatMap((s) => s.channels || []);
    const channels = await Channel.find({ _id: { $in: channelIds } }).lean();

    // Build voice states for the user's servers
    const voiceStatesData = {};
    for (const ch of channels) {
      const members = getVoiceMembers(ch._id);
      if (members.length > 0) voiceStatesData[ch._id] = members;
    }

    ws.send(JSON.stringify({ type: 'Ready', data: { users: [user], servers, channels, voiceStates: voiceStatesData } }));

    // Notify all servers this user/bot is in so member lists show online immediately
    for (const sid of serverIds) {
      broadcastToServer(sid, {
        type: 'PresenceUpdate',
        d: { user_id: String(userId), server_id: String(sid) },
      }).catch(() => {});
    }

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        const entry = clients.get(key);
        if (entry) entry.lastPing = Date.now();

        switch (msg.type) {
          case 'Ping':
            ws.send(JSON.stringify({ type: 'Pong', data: msg.data }));
            break;

          case 'VoiceJoin': {
            const channelId = msg.channelId;
            if (!channelId) break;

            // Only allow joining voice channels the user has access to (same server membership)
            const channel = await Channel.findById(channelId).lean();
            if (!channel || channel.channel_type !== 'VoiceChannel') break;
            const serverId = channel.server;
            if (!serverId || !entry.serverIds || !entry.serverIds.some((sid) => String(sid) === String(serverId))) break;

            // Leave any current voice channel first
            leaveAllVoice(userId, key);

            // Join the new channel
            if (!voiceStates.has(channelId)) voiceStates.set(channelId, new Map());
            voiceStates.get(channelId).set(userId, { clientKey: key });

            const members = getVoiceMembers(channelId);
            const voiceStateEvt = {
              type: 'VoiceStateUpdate',
              data: { channelId, userId, action: 'join', members },
            };
            // Notify all server members (so sidebar stays in sync for everyone, including rejoiner)
            broadcastToChannel(channelId, voiceStateEvt).catch(() => {});

            const existingMembers = members.filter((id) => id !== userId);
            ws.send(JSON.stringify({
              type: 'VoiceReady',
              data: { channelId, members: existingMembers, userId },
            }));
            break;
          }

          case 'VoiceLeave': {
            leaveAllVoice(userId, key);
            break;
          }

          case 'VoiceSignal': {
            // Relay WebRTC signaling only between users in the same voice channel
            const { targetUserId, signal, channelId } = msg;
            if (!targetUserId || !signal || !channelId) break;
            const vcState = voiceStates.get(channelId);
            if (!vcState || !vcState.has(userId) || !vcState.has(targetUserId)) break;
            broadcastToUser(targetUserId, {
              type: 'VoiceSignal',
              data: { fromUserId: userId, channelId, signal },
            });
            break;
          }

          case 'TypingStart': {
            if (kind !== 'user') break;
            const tcId = msg.channelId;
            if (!tcId) break;
            broadcastToChannel(tcId, { type: 'TypingStart', d: { channel_id: tcId, user_id: userId } }, { excludeUserId: userId });
            break;
          }

          case 'TypingStop': {
            if (kind !== 'user') break;
            const tcId = msg.channelId;
            if (!tcId) break;
            broadcastToChannel(tcId, { type: 'TypingStop', d: { channel_id: tcId, user_id: userId } }, { excludeUserId: userId });
            break;
          }

          case 'WhiteboardJoin': {
            if (kind !== 'user') break;
            const sessionId = msg.sessionId || msg.session_id;
            if (!sessionId) break;
            const session = await WhiteboardSession.findById(sessionId).lean();
            if (!session || session.status !== 'open') {
              ws.send(JSON.stringify({ type: 'WhiteboardError', d: { code: 'session_not_found', session_id: sessionId } }));
              break;
            }
            const wbMember = await Member.findOne({ server: session.server, user: userId }).lean();
            if (!wbMember) break;
            let room = getRoom(sessionId);
            if (!room) {
              createRoom(sessionId, {
                ownerId: session.owner,
                channelId: session.channel,
                serverId: session.server,
              });
              room = getRoom(sessionId);
            }
            if (!room) break;
            addSubscriber(sessionId, userId);
            ws.send(JSON.stringify({
              type: 'WhiteboardState',
              d: { session_id: sessionId, ops: getOps(sessionId) },
            }));
            broadcastToWhiteboardSession(sessionId, {
              type: 'WhiteboardParticipantJoin',
              d: { session_id: sessionId, user_id: userId },
            }, { excludeUserId: userId });
            break;
          }

          case 'WhiteboardOp': {
            if (kind !== 'user') break;
            const sessionId = msg.sessionId || msg.session_id;
            const op = msg.op;
            if (!sessionId || op == null || typeof op !== 'object') break;
            const session = await WhiteboardSession.findById(sessionId).lean();
            if (!session || session.status !== 'open') break;
            if (!isSubscriber(sessionId, userId)) break;

            if (op.kind === 'clear_board') {
              const room = getRoom(sessionId);
              if (!room || String(room.ownerId) !== String(userId)) break;
              clearRoomOps(sessionId);
              const opWithUser = { kind: 'clear_board', user_id: String(userId) };
              broadcastToWhiteboardSession(sessionId, {
                type: 'WhiteboardOp',
                d: { session_id: sessionId, op: opWithUser },
              });
              break;
            }

            if (!allowWhiteboardOpRate(sessionId, userId)) {
              ws.send(JSON.stringify({
                type: 'WhiteboardError',
                d: { code: 'rate_limited', session_id: sessionId },
              }));
              break;
            }

            const opWithUser = { ...op, user_id: String(userId) };
            if (!appendOp(sessionId, opWithUser)) break;
            broadcastToWhiteboardSession(sessionId, {
              type: 'WhiteboardOp',
              d: { session_id: sessionId, op: opWithUser },
            }, { excludeUserId: userId });
            break;
          }

          case 'WhiteboardPointer': {
            if (kind !== 'user') break;
            const sessionId = msg.sessionId || msg.session_id;
            if (!sessionId) break;
            const { x, y } = msg;
            if (typeof x !== 'number' || typeof y !== 'number') break;
            if (x < 0 || x > 1 || y < 0 || y > 1) break;
            const session = await WhiteboardSession.findById(sessionId).lean();
            if (!session || session.status !== 'open') break;
            if (!isSubscriber(sessionId, userId)) break;
            if (!allowWhiteboardPointerRate(sessionId, userId)) break;
            broadcastToWhiteboardSession(sessionId, {
              type: 'WhiteboardPointer',
              d: { session_id: sessionId, user_id: userId, x, y },
            }, { excludeUserId: userId });
            break;
          }

          case 'WhiteboardDrawing': {
            if (kind !== 'user') break;
            const sessionId = msg.sessionId || msg.session_id;
            const strokeId = msg.strokeId || msg.stroke_id;
            const pointsDelta = msg.points_delta;
            if (!sessionId || !strokeId || !Array.isArray(pointsDelta) || pointsDelta.length === 0) break;
            if (pointsDelta.length > 400) break;
            let pointsOk = true;
            for (const p of pointsDelta) {
              if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') {
                pointsOk = false;
                break;
              }
              if (p.x < -0.01 || p.x > 1.01 || p.y < -0.01 || p.y > 1.01) {
                pointsOk = false;
                break;
              }
            }
            if (!pointsOk) break;
            const session = await WhiteboardSession.findById(sessionId).lean();
            if (!session || session.status !== 'open') break;
            if (!isSubscriber(sessionId, userId)) break;
            const payload = {
              session_id: sessionId,
              stroke_id: String(strokeId),
              user_id: userId,
              points_delta: pointsDelta,
              color: msg.color,
              width: msg.width,
              tool: msg.tool,
            };
            if (JSON.stringify(payload).length > 48000) break;
            if (!allowWhiteboardDrawingRate(sessionId, userId)) break;
            broadcastToWhiteboardSession(sessionId, {
              type: 'WhiteboardDrawing',
              d: payload,
            }, { excludeUserId: userId });
            break;
          }

          case 'WhiteboardLeave': {
            const sessionId = msg.sessionId || msg.session_id;
            if (!sessionId) break;
            removeSubscriber(sessionId, userId);
            broadcastToWhiteboardSession(sessionId, {
              type: 'WhiteboardParticipantLeave',
              d: { session_id: sessionId, user_id: userId },
            }, { excludeUserId: userId });
            break;
          }
        }
      } catch {}
    });

    ws.on('close', async () => {
      const entry = clients.get(key);
      await removeClientAndNotifyServers(key, userId, entry?.serverIds, entry?.userId ?? userId);
    });
  });

  // Heartbeat: treat clients that haven't pinged in 35s as dead (tab close without proper close event)
  const HEARTBEAT_MS = 35000;
  const interval = setInterval(() => {
    const now = Date.now();
    const toRemove = [];
    for (const [k, entry] of clients.entries()) {
      if (entry.ws.readyState !== 1) toRemove.push(k);
      else if (now - (entry.lastPing || 0) > HEARTBEAT_MS) toRemove.push(k);
    }
    for (const k of toRemove) {
      const entry = clients.get(k);
      if (!entry) continue;
      removeClientAndNotifyServers(k, entry.userId, entry.serverIds, entry.userId).catch(() => {});
    }
  }, 15000);
  wss.on('close', () => clearInterval(interval));

  return wss;
}

function leaveAllVoice(userId, key) {
  for (const [channelId, state] of voiceStates.entries()) {
    if (state.has(userId)) {
      state.delete(userId);
      const members = getVoiceMembers(channelId);
      const evt = {
        type: 'VoiceStateUpdate',
        data: { channelId, userId, action: 'leave', members },
      };
      // Notify all server members so sidebar stays in sync (including the user who left)
      broadcastToChannel(channelId, evt).catch(() => {});
      const entry = clients.get(key);
      if (entry && entry.ws.readyState === 1) {
        entry.ws.send(JSON.stringify(evt));
      }
      if (state.size === 0) voiceStates.delete(channelId);
    }
  }
}

/** Remove client and broadcast PresenceUpdate to their servers (used by close and heartbeat). */
async function removeClientAndNotifyServers(key, userId, serverIds, uid) {
  leaveAllVoice(userId, key);
  removeUserFromAllRooms(uid ?? userId);
  clients.delete(key);
  const serverIdsToNotify = Array.isArray(serverIds) ? [...serverIds] : [];
  const idToNotify = uid != null ? String(uid) : (userId != null ? String(userId) : null);
  if (!idToNotify || serverIdsToNotify.length === 0) return;
  await Promise.all(
    serverIdsToNotify.map((sid) =>
      broadcastToServer(
        sid,
        { type: 'PresenceUpdate', d: { user_id: idToNotify, server_id: String(sid) } },
        idToNotify
      )
    )
  ).catch(() => {});
}

export function broadcastToUser(userId, event) {
  const payload = typeof event === 'string' ? event : JSON.stringify(event);
  const target = userId != null ? String(userId) : null;
  if (!target) return;
  for (const [, entry] of clients.entries()) {
    if (String(entry.userId) === target && entry.ws.readyState === 1) {
      entry.ws.send(payload);
    }
  }
}

function canReceiveIntent(entry, eventIntent) {
  if (!eventIntent) return true;
  if (entry.kind !== 'bot') return true;
  if (!entry.intents) return true; // fallback to all if not specified
  return (entry.intents & eventIntent) === eventIntent;
}

export async function broadcastToServer(serverId, event, excludeUserId, options = {}) {
  const payload = typeof event === 'string' ? event : JSON.stringify(event);
  const memberDocs = await Member.find({ server: serverId }).lean();
  const memberUserIds = new Set(memberDocs.map((m) => String(m.user)));
  const exclude = excludeUserId != null ? String(excludeUserId) : null;
  for (const [, entry] of clients.entries()) {
    if (entry.ws.readyState !== 1) continue;
    if (!memberUserIds.has(String(entry.userId))) continue;
    if (exclude && String(entry.userId) === exclude) continue;
    if (!canReceiveIntent(entry, options.eventIntent)) continue;
    entry.ws.send(payload);
  }
}

export function broadcastToWhiteboardSession(sessionId, event, options = {}) {
  const room = getRoom(sessionId);
  if (!room) return;
  const payload = typeof event === 'string' ? event : JSON.stringify(event);
  const exclude = options.excludeUserId != null ? String(options.excludeUserId) : null;
  for (const [, entry] of clients.entries()) {
    if (entry.ws.readyState !== 1) continue;
    if (!room.subscribers.has(String(entry.userId))) continue;
    if (exclude && String(entry.userId) === exclude) continue;
    entry.ws.send(payload);
  }
}

export async function broadcastToChannel(channelId, event, options = {}) {
  const channel = await Channel.findById(channelId).lean();
  if (!channel) return;
  const payload = typeof event === 'string' ? event : JSON.stringify(event);

  let allowedUsers = [];
  if (channel.server) {
    const members = await Member.find({ server: channel.server }).select('user').lean();
    allowedUsers = members.map((m) => m.user);
  } else if (channel.channel_type === 'SavedMessages') {
    if (channel.user) allowedUsers = [channel.user];
  } else if (channel.channel_type === 'DirectMessage' || channel.channel_type === 'Group') {
    allowedUsers = channel.recipients || [];
  }
  const allowSet = new Set(allowedUsers.map((id) => String(id)));

  for (const [, entry] of clients.entries()) {
    if (entry.ws.readyState !== 1) continue;
    if (!allowSet.has(String(entry.userId))) continue;
    if (options.excludeUserId != null && String(entry.userId) === String(options.excludeUserId)) continue;
    if (!canReceiveIntent(entry, options.eventIntent)) continue;
    entry.ws.send(payload);
  }
}
