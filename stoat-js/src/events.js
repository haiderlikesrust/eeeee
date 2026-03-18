/**
 * WebSocket events server (Bonfire equivalent).
 * No Redis - in-memory pub/sub for connected clients.
 * Includes voice signaling for WebRTC.
 */
import { WebSocketServer } from 'ws';
import { Session, User, Member, Server, Channel, Bot } from './db/models/index.js';

const clients = new Map(); // key -> { ws, kind, userId, lastPing, intents }

export function isUserOnline(userId) {
  if (!userId) return false;
  for (const [, entry] of clients.entries()) {
    if (entry.userId === userId && entry.ws.readyState === 1) return true;
  }
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

    if (sessionToken) {
      const session = await Session.findOne({ token: sessionToken }).lean();
      if (!session) {
        ws.close(4001, 'Invalid session');
        return;
      }
      userId = session.user_id;
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
    clients.set(key, { ws, kind, userId, lastPing: Date.now(), intents: Number.isFinite(intents) ? intents : 0 });

    const user = await User.findById(userId).lean();

    const memberships = await Member.find({ user: userId }).lean();
    const serverIds = memberships.map((m) => m.server);
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

            // Leave any current voice channel first
            leaveAllVoice(userId, key);

            // Join the new channel
            if (!voiceStates.has(channelId)) voiceStates.set(channelId, new Map());
            voiceStates.get(channelId).set(userId, { clientKey: key });

            const members = getVoiceMembers(channelId);

            broadcastToVoiceChannel(channelId, {
              type: 'VoiceStateUpdate',
              data: { channelId, userId, action: 'join', members },
            });

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
            // Relay WebRTC signaling (offer/answer/ice) to target user
            const { targetUserId, signal, channelId } = msg;
            if (!targetUserId || !signal) break;
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
        }
      } catch {}
    });

    ws.on('close', () => {
      leaveAllVoice(userId, key);
      clients.delete(key);
    });
  });

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
      broadcastToVoiceChannel(channelId, evt);
      const entry = clients.get(key);
      if (entry && entry.ws.readyState === 1) {
        entry.ws.send(JSON.stringify(evt));
      }
      if (state.size === 0) voiceStates.delete(channelId);
    }
  }
}

export function broadcastToUser(userId, event) {
  const payload = typeof event === 'string' ? event : JSON.stringify(event);
  for (const [, entry] of clients.entries()) {
    if (entry.userId === userId && entry.ws.readyState === 1) {
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
  const memberUserIds = new Set(memberDocs.map(m => m.user));
  for (const [, entry] of clients.entries()) {
    if (memberUserIds.has(entry.userId) && entry.ws.readyState === 1) {
      if (excludeUserId && entry.userId === excludeUserId) continue;
      if (!canReceiveIntent(entry, options.eventIntent)) continue;
      entry.ws.send(payload);
    }
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
  const allowSet = new Set(allowedUsers);

  for (const [, entry] of clients.entries()) {
    if (entry.ws.readyState !== 1) continue;
    if (!allowSet.has(entry.userId)) continue;
    if (options.excludeUserId && entry.userId === options.excludeUserId) continue;
    if (!canReceiveIntent(entry, options.eventIntent)) continue;
    entry.ws.send(payload);
  }
}
