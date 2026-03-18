import { Router } from 'express';
import { ulid } from 'ulid';
import {
  Bot, User, Channel, Message, Member, Server,
} from '../db/models/index.js';
import { toPublicUser } from '../publicUser.js';
import {
  Permissions, computeChannelPermissions, hasPermission,
} from '../permissions.js';
import { broadcastToChannel, GatewayIntents } from '../events.js';

const router = Router();

function botTokenFrom(req) {
  const auth = req.headers['authorization'] || '';
  const authBot = auth.match(/^Bot\s+(.+)$/i)?.[1];
  return req.headers['x-bot-token'] || authBot || req.query?.token || null;
}

async function botAuth(req, res, next) {
  const token = botTokenFrom(req);
  if (!token) return res.status(401).json({ type: 'Unauthorized', error: 'Missing bot token' });
  const bot = await Bot.findOne({ token }).lean();
  if (!bot) return res.status(401).json({ type: 'Unauthorized', error: 'Invalid bot token' });
  const user = await User.findById(bot._id).lean();
  if (!user) return res.status(401).json({ type: 'Unauthorized', error: 'Bot user not found' });
  req.bot = bot;
  req.botUser = user;
  req.botToken = token;
  req.userId = bot._id;
  next();
}

function canAccessChannel(channel, userId, member) {
  if (channel.channel_type === 'DirectMessage') return (channel.recipients || []).includes(userId);
  if (channel.channel_type === 'TextChannel' || channel.channel_type === 'VoiceChannel' || channel.channel_type === 'Group') return !!member || channel.owner === userId;
  if (channel.channel_type === 'SavedMessages') return channel.user === userId;
  return false;
}

async function getMember(ch, userId) {
  if (ch.server) return Member.findOne({ server: ch.server, user: userId });
  return null;
}

async function getChannelPerms(ch, userId) {
  if (!ch.server) return null;
  const server = await Server.findById(ch.server);
  if (!server) return null;
  const member = await Member.findOne({ server: ch.server, user: userId });
  if (!member) return null;
  return { perms: computeChannelPermissions(server, member, ch), server, member };
}

function messageToJson(m, authorMap = {}) {
  const a = m.author && authorMap[m.author];
  const reactions = m.reactions instanceof Map
    ? Object.fromEntries(m.reactions.entries())
    : (m.reactions && typeof m.reactions.toObject === 'function'
      ? m.reactions.toObject()
      : (m.reactions || {}));
  return {
    _id: m._id,
    channel: m.channel,
    author: a ? toPublicUser(a, { relationship: 'None', online: false }) : m.author,
    webhook: m.webhook,
    content: m.content,
    attachments: m.attachments || [],
    edited: m.edited,
    embeds: m.embeds || [],
    mentions: m.mentions || [],
    replies: m.replies || [],
    reactions,
    pinned: m.pinned || false,
    created_at: m.created_at,
  };
}

// GET /bot/@me
router.get('/@me', botAuth, async (req, res) => {
  res.json({
    bot: {
      _id: req.bot._id,
      owner: req.bot.owner,
      public: !!req.bot.public,
      discoverable: !!req.bot.discoverable,
      analytics: !!req.bot.analytics,
      interactions_url: req.bot.interactions_url || '',
      terms_of_service_url: req.bot.terms_of_service_url || '',
      privacy_policy_url: req.bot.privacy_policy_url || '',
    },
    user: toPublicUser(req.botUser, { relationship: 'None', online: false }),
  });
});

// GET /bot/gateway
router.get('/gateway', botAuth, async (req, res) => {
  const host = req.headers.host || 'localhost:14702';
  const proto = (req.headers['x-forwarded-proto'] || 'http').toString().includes('https') ? 'wss' : 'ws';
  res.json({
    url: `${proto}://${host}/`,
    connect: `?bot_token=YOUR_BOT_TOKEN&intents=${GatewayIntents.GUILDS | GatewayIntents.GUILD_MESSAGES | GatewayIntents.MESSAGE_CONTENT}`,
    intents: GatewayIntents,
  });
});

// GET /bot/channels/:target/messages
router.get('/channels/:target/messages', botAuth, async (req, res) => {
  const ch = await Channel.findById(req.params.target).lean();
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const messages = await Message.find({ channel: ch._id }).sort({ _id: -1 }).limit(limit).lean();
  messages.reverse();
  const authorIds = [...new Set(messages.map((m) => m.author))];
  const authors = await User.find({ _id: { $in: authorIds } })
    .select('_id username discriminator display_name avatar badges system_badges status profile flags privileged bot relations')
    .lean();
  const authorMap = Object.fromEntries(authors.map((a) => [a._id, a]));
  res.json(messages.map((m) => messageToJson(m, authorMap)));
});

// POST /bot/channels/:target/messages
router.post('/channels/:target/messages', botAuth, async (req, res) => {
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });
  if (ch.server) {
    const ctx = await getChannelPerms(ch, req.userId);
    if (ctx && !hasPermission(ctx.perms, Permissions.SEND_MESSAGES)) {
      return res.status(403).json({ type: 'Forbidden', error: 'Missing SEND_MESSAGES permission' });
    }
  }

  const content = req.body?.content ?? '';
  const msgId = ulid();
  const msg = await Message.create({
    _id: msgId,
    channel: ch._id,
    author: req.userId,
    content: String(content).slice(0, 2000),
    attachments: req.body?.attachments || [],
    embeds: req.body?.embeds || [],
    mentions: req.body?.mentions || [],
    replies: req.body?.replies || [],
  });
  ch.last_message_id = msgId;
  await ch.save();

  const author = await User.findById(req.userId)
    .select('_id username discriminator display_name avatar badges system_badges status profile flags privileged bot relations')
    .lean();
  const payload = messageToJson(msg, { [req.userId]: author });

  await broadcastToChannel(ch._id, { type: 'MESSAGE_CREATE', d: payload }, {
    eventIntent: GatewayIntents.GUILD_MESSAGES,
  });

  res.status(201).json(payload);
});

// PATCH /bot/channels/:target/messages/:msg
router.patch('/channels/:target/messages/:msg', botAuth, async (req, res) => {
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });
  const msg = await Message.findOne({ _id: req.params.msg, channel: ch._id });
  if (!msg) return res.status(404).json({ type: 'NotFound', error: 'Message not found' });
  if (msg.author !== req.userId) return res.status(403).json({ type: 'Forbidden', error: 'Not author' });
  const { content, embeds } = req.body || {};
  if (content != null) msg.content = String(content).slice(0, 2000);
  if (embeds != null) msg.embeds = Array.isArray(embeds) ? embeds : [];
  msg.edited = new Date();
  await msg.save();
  const author = await User.findById(msg.author)
    .select('_id username discriminator display_name avatar badges system_badges status profile flags privileged bot relations')
    .lean();
  const payload = messageToJson(msg, { [msg.author]: author });
  await broadcastToChannel(ch._id, { type: 'MESSAGE_UPDATE', d: payload }, {
    eventIntent: GatewayIntents.GUILD_MESSAGES,
  });
  res.json(payload);
});

// DELETE /bot/channels/:target/messages/:msg
router.delete('/channels/:target/messages/:msg', botAuth, async (req, res) => {
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });
  const msg = await Message.findOne({ _id: req.params.msg, channel: ch._id });
  if (!msg) return res.status(404).json({ type: 'NotFound', error: 'Message not found' });
  if (msg.author !== req.userId) {
    if (ch.server) {
      const ctx = await getChannelPerms(ch, req.userId);
      if (!ctx || !hasPermission(ctx.perms, Permissions.MANAGE_MESSAGES)) {
        return res.status(403).json({ type: 'Forbidden', error: 'Missing MANAGE_MESSAGES permission' });
      }
    } else {
      return res.status(403).json({ type: 'Forbidden', error: 'Not author' });
    }
  }
  const deletedMessageId = msg._id;
  await msg.deleteOne();
  await broadcastToChannel(ch._id, {
    type: 'MESSAGE_DELETE',
    d: { _id: deletedMessageId, channel: ch._id },
  }, {
    eventIntent: GatewayIntents.GUILD_MESSAGES,
  });
  res.status(204).send();
});

// PUT /bot/channels/:target/messages/:msg/reactions/:emoji
router.put('/channels/:target/messages/:msg/reactions/:emoji', botAuth, async (req, res) => {
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });
  const msg = await Message.findOne({ _id: req.params.msg, channel: ch._id });
  if (!msg) return res.status(404).json({ type: 'NotFound', error: 'Message not found' });
  const emoji = decodeURIComponent(req.params.emoji);
  const reactions = msg.reactions instanceof Map
    ? Object.fromEntries(msg.reactions.entries())
    : (msg.reactions && typeof msg.reactions.toObject === 'function'
      ? msg.reactions.toObject()
      : (msg.reactions || {}));
  const arr = reactions[emoji] || [];
  if (!arr.includes(req.userId)) arr.push(req.userId);
  reactions[emoji] = arr;
  msg.reactions = reactions;
  msg.markModified('reactions');
  await msg.save();
  await broadcastToChannel(ch._id, {
    type: 'MESSAGE_REACTION_ADD',
    d: {
      channel: ch._id,
      message: msg._id,
      emoji,
      user_id: req.userId,
    },
  }, {
    eventIntent: GatewayIntents.GUILD_MESSAGES,
  });
  res.status(204).send();
});

// DELETE /bot/channels/:target/messages/:msg/reactions/:emoji
router.delete('/channels/:target/messages/:msg/reactions/:emoji', botAuth, async (req, res) => {
  const msg = await Message.findOne({ _id: req.params.msg, channel: req.params.target });
  if (!msg) return res.status(404).json({ type: 'NotFound', error: 'Message not found' });
  const emoji = decodeURIComponent(req.params.emoji);
  const reactions = msg.reactions instanceof Map
    ? Object.fromEntries(msg.reactions.entries())
    : (msg.reactions && typeof msg.reactions.toObject === 'function'
      ? msg.reactions.toObject()
      : (msg.reactions || {}));
  const arr = (reactions[emoji] || []).filter((id) => id !== req.userId);
  if (arr.length) reactions[emoji] = arr;
  else delete reactions[emoji];
  msg.reactions = reactions;
  msg.markModified('reactions');
  await msg.save();
  await broadcastToChannel(req.params.target, {
    type: 'MESSAGE_REACTION_REMOVE',
    d: {
      channel: req.params.target,
      message: msg._id,
      emoji,
      user_id: req.userId,
    },
  }, {
    eventIntent: GatewayIntents.GUILD_MESSAGES,
  });
  res.status(204).send();
});

export default router;
