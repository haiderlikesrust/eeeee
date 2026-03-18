import { Router } from 'express';
import { ulid } from 'ulid';
import crypto from 'crypto';
import {
  Channel, Message, Member, User, Invite, Webhook, ChannelUnread, Server,
} from '../db/models/index.js';
import { authMiddleware } from '../middleware/auth.js';
import { toPublicUser } from '../publicUser.js';
import { broadcastToChannel, GatewayIntents } from '../events.js';
import { fetchLinkPreviewsForContent } from '../linkPreview.js';
import {
  Permissions, computeChannelPermissions, computeServerPermissions, hasPermission,
} from '../permissions.js';

const router = Router();

function isBotUser(user) {
  const owner = user?.bot?.owner;
  return typeof owner === 'string' && owner.trim().length > 0;
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
    link_previews: m.link_previews || [],
    mentions: m.mentions || [],
    replies: m.replies || [],
    reactions: reactions,
    pinned: m.pinned || false,
    created_at: m.created_at,
  };
}

// POST /channels/create - Create group
router.post('/create', authMiddleware(), async (req, res) => {
  const { name, description } = req.body || {};
  if (!name) return res.status(400).json({ type: 'InvalidPayload', error: 'Name required' });
  const ch = await Channel.create({
    _id: ulid(),
    channel_type: 'Group',
    name: String(name).slice(0, 32),
    owner: req.userId,
    description: description || undefined,
    recipients: [req.userId],
  });
  res.status(201).json(ch.toObject());
});

// GET /channels/:target
router.get('/:target', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.target).lean();
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });
  res.json(ch);
});

// PATCH /channels/:target
router.patch('/:target', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });
  if (ch.server) {
    const ctx = await getChannelPerms(ch, req.userId);
    if (!ctx || !hasPermission(ctx.perms, Permissions.MANAGE_CHANNELS)) {
      return res.status(403).json({ type: 'Forbidden', error: 'Missing MANAGE_CHANNELS permission' });
    }
  } else if (ch.owner !== req.userId) {
    return res.status(403).json({ type: 'Forbidden', error: 'Not owner' });
  }
  const { name, description, icon, default_permissions, role_permissions } = req.body || {};
  if (name != null) ch.name = String(name).slice(0, 32);
  if (description != null) ch.description = description;
  if (icon != null) ch.icon = icon;
  if (default_permissions !== undefined) ch.default_permissions = default_permissions;
  if (role_permissions !== undefined) {
    ch.role_permissions = role_permissions;
    ch.markModified('role_permissions');
  }
  await ch.save();
  res.json(ch.toObject());
});

// DELETE /channels/:target
router.delete('/:target', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const server = ch.server ? await Server.findById(ch.server) : null;
  if (ch.server) {
    const ctx = await getChannelPerms(ch, req.userId);
    if (!ctx || !hasPermission(ctx.perms, Permissions.MANAGE_CHANNELS)) {
      return res.status(403).json({ type: 'Forbidden', error: 'Missing MANAGE_CHANNELS permission' });
    }
  } else if (ch.owner !== req.userId) {
    return res.status(403).json({ type: 'Forbidden', error: 'Not owner' });
  }
  await Message.deleteMany({ channel: ch._id });
  await ChannelUnread.deleteMany({ channel: ch._id });
  await Webhook.deleteMany({ channel_id: ch._id });
  if (server) {
    server.channels = (server.channels || []).filter((id) => id !== ch._id);
    await server.save();
  }
  await ch.deleteOne();
  res.status(204).send();
});

// PUT /channels/:target/ack - mark channel read up to latest message
router.put('/:target/ack', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });
  const lastId = ch.last_message_id || null;
  const id = `${ch._id}-${req.userId}`;
  await ChannelUnread.findOneAndUpdate(
    { _id: id },
    { $set: { channel: ch._id, user: req.userId, last_id: lastId } },
    { upsert: true }
  );
  res.status(204).send();
});

// PUT /channels/:target/ack/:message - mark channel read up to specific message
router.put('/:target/ack/:message', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });
  const id = `${ch._id}-${req.userId}`;
  await ChannelUnread.findOneAndUpdate(
    { _id: id },
    { $set: { channel: ch._id, user: req.userId, last_id: req.params.message } },
    { upsert: true }
  );
  res.status(204).send();
});

// GET /channels/:target/messages
router.get('/:target/messages', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.target).lean();
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const before = req.query.before;
  const after = req.query.after;
  const sort = req.query.sort || 'Latest';
  const q = { channel: ch._id };
  const pinned = req.query.pinned;
  if (before) q._id = { $lt: before };
  if (after) q._id = { $gt: after };
  if (pinned === 'true') q.pinned = true;
  if (pinned === 'false') q.pinned = { $ne: true };
  const order = sort === 'Oldest' ? 1 : -1;
  const messages = await Message.find(q).sort({ _id: order }).limit(limit).lean();
  if (order === -1) messages.reverse();
  const authorIds = [...new Set(messages.map((m) => m.author))];
  const authors = await User.find({ _id: { $in: authorIds } })
    .select('_id username discriminator display_name avatar badges system_badges status profile flags privileged bot relations')
    .lean();
  const authorMap = Object.fromEntries(authors.map((a) => [a._id, a]));
  res.json(messages.map((m) => messageToJson(m, authorMap)));
});

// GET /channels/:target/messages/:msg
router.get('/:target/messages/:msg', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });
  const msg = await Message.findOne({ _id: req.params.msg, channel: ch._id });
  if (!msg) return res.status(404).json({ type: 'NotFound', error: 'Message not found' });
  const author = await User.findById(msg.author)
    .select('_id username discriminator display_name avatar badges system_badges status profile flags privileged bot relations')
    .lean();
  res.json(messageToJson(msg, { [msg.author]: author }));
});

// POST /channels/:target/messages
router.post('/:target/messages', authMiddleware(), async (req, res) => {
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
  let msg = await Message.create({
    _id: msgId,
    channel: ch._id,
    author: req.userId,
    content: String(content).slice(0, 2000),
    attachments: req.body?.attachments || [],
    embeds: req.body?.embeds || [],
    mentions: req.body?.mentions || [],
    replies: req.body?.replies || [],
    nonce: req.body?.nonce,
  });
  try {
    const linkPreviews = await fetchLinkPreviewsForContent(content, 2);
    if (linkPreviews.length > 0) {
      msg.link_previews = linkPreviews;
      await msg.save();
    }
  } catch {
    // ignore preview failures; message is already created
  }
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

// PATCH /channels/:target/messages/:msg
router.patch('/:target/messages/:msg', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });
  const msg = await Message.findOne({ _id: req.params.msg, channel: ch._id });
  if (!msg) return res.status(404).json({ type: 'NotFound', error: 'Message not found' });
  if (msg.author !== req.userId) return res.status(403).json({ type: 'Forbidden', error: 'Not author' });
  const { content } = req.body || {};
  if (content != null) msg.content = String(content).slice(0, 2000);
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

// DELETE /channels/:target/messages/:msg
router.delete('/:target/messages/:msg', authMiddleware(), async (req, res) => {
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

// DELETE /channels/:target/messages/bulk
router.delete('/:target/messages/bulk', authMiddleware(), async (req, res) => {
  const ids = req.body?.ids || [];
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ type: 'InvalidPayload', error: 'ids required' });
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });
  await Message.deleteMany({ _id: { $in: ids }, channel: ch._id, author: req.userId });
  res.status(204).send();
});

// POST /channels/:target/messages/:msg/pin
router.post('/:target/messages/:msg/pin', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });
  const msg = await Message.findOneAndUpdate(
    { _id: req.params.msg, channel: ch._id },
    { $set: { pinned: true } },
    { new: true }
  );
  if (!msg) return res.status(404).json({ type: 'NotFound', error: 'Message not found' });
  res.status(204).send();
});

// DELETE /channels/:target/messages/:msg/pin
router.delete('/:target/messages/:msg/pin', authMiddleware(), async (req, res) => {
  const msg = await Message.findOneAndUpdate(
    { _id: req.params.msg, channel: req.params.target },
    { $set: { pinned: false } }
  );
  if (!msg) return res.status(404).json({ type: 'NotFound', error: 'Message not found' });
  res.status(204).send();
});

// PUT /channels/:target/messages/:msg/reactions/:emoji
router.put('/:target/messages/:msg/reactions/:emoji', authMiddleware(), async (req, res) => {
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

// DELETE /channels/:target/messages/:msg/reactions/:emoji
router.delete('/:target/messages/:msg/reactions/:emoji', authMiddleware(), async (req, res) => {
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

// DELETE /channels/:target/messages/:msg/reactions
router.delete('/:target/messages/:msg/reactions', authMiddleware(), async (req, res) => {
  const msg = await Message.findOneAndUpdate(
    { _id: req.params.msg, channel: req.params.target },
    { $set: { reactions: {} } }
  );
  if (!msg) return res.status(404).json({ type: 'NotFound', error: 'Message not found' });
  res.status(204).send();
});

// POST /channels/:target/search
router.post('/:target/search', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });
  const query = req.body?.query || '';
  const limit = Math.min(Number(req.body?.limit) || 50, 100);
  const q = { channel: ch._id };
  if (query) q.content = new RegExp(escapeRegex(query), 'i');
  const messages = await Message.find(q).sort({ created_at: -1 }).limit(limit).lean();
  const authorIds = [...new Set(messages.map((m) => m.author))];
  const authors = await User.find({ _id: { $in: authorIds } })
    .select('_id username discriminator display_name avatar badges system_badges status profile flags privileged bot relations')
    .lean();
  const authorMap = Object.fromEntries(authors.map((a) => [a._id, a]));
  res.json(messages.map((m) => messageToJson(m, authorMap)));
});

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// POST /channels/:target/invites
router.post('/:target/invites', authMiddleware(), async (req, res) => {
  if (isBotUser(req.user)) return res.status(400).json({ type: 'IsBot', error: 'Is bot' });
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });
  const code = ulid().toLowerCase().slice(0, 8);
  await Invite.create({
    _id: code,
    channel: ch._id,
    creator: req.userId,
    server: ch.server || undefined,
    type: ch.server ? 'Server' : 'Group',
  });
  res.status(201).json({
    _id: code,
    channel: ch._id,
    creator: req.userId,
    type: ch.server ? 'Server' : 'Group',
  });
});

// GET /channels/:target/members
router.get('/:target/members', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  if (ch.channel_type !== 'Group') return res.status(400).json({ type: 'InvalidChannel', error: 'Not a group' });
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });
  const userIds = ch.recipients || [];
  const users = await User.find({ _id: { $in: userIds } })
    .select('_id username discriminator display_name avatar badges system_badges status profile flags privileged bot relations')
    .lean();
  res.json(users.map((u) => toPublicUser(u, { relationship: 'None', online: false })));
});

// PUT /channels/:group/recipients/:member
router.put('/:group/recipients/:member', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.group);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  if (ch.channel_type !== 'Group') return res.status(400).json({ type: 'InvalidChannel', error: 'Not a group' });
  if (ch.owner !== req.userId) return res.status(403).json({ type: 'Forbidden', error: 'Not owner' });
  ch.recipients = ch.recipients || [];
  if (!ch.recipients.includes(req.params.member)) ch.recipients.push(req.params.member);
  await ch.save();
  res.status(204).send();
});

// DELETE /channels/:target/recipients/:member
router.delete('/:target/recipients/:member', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  if (ch.channel_type !== 'Group') return res.status(400).json({ type: 'InvalidChannel', error: 'Not a group' });
  const isSelf = req.params.member === req.userId;
  const isOwner = ch.owner === req.userId;
  if (!isSelf && !isOwner) return res.status(403).json({ type: 'Forbidden', error: 'No permission' });
  ch.recipients = (ch.recipients || []).filter((id) => id !== req.params.member);
  await ch.save();
  res.status(204).send();
});

// PUT /channels/:target/permissions/default - set @everyone override for channel
router.put('/:target/permissions/default', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  if (ch.server) {
    const ctx = await getChannelPerms(ch, req.userId);
    if (!ctx || !hasPermission(ctx.perms, Permissions.MANAGE_ROLES)) {
      return res.status(403).json({ type: 'Forbidden', error: 'Missing MANAGE_ROLES permission' });
    }
  } else {
    return res.status(400).json({ type: 'InvalidChannel', error: 'Not a server channel' });
  }
  const { allow, deny } = req.body || {};
  ch.default_permissions = { allow: allow || 0, deny: deny || 0 };
  ch.markModified('default_permissions');
  await ch.save();
  res.status(204).send();
});

// PUT /channels/:target/permissions/:role_id - set role override for channel
router.put('/:target/permissions/:role_id', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  if (ch.server) {
    const ctx = await getChannelPerms(ch, req.userId);
    if (!ctx || !hasPermission(ctx.perms, Permissions.MANAGE_ROLES)) {
      return res.status(403).json({ type: 'Forbidden', error: 'Missing MANAGE_ROLES permission' });
    }
  } else {
    return res.status(400).json({ type: 'InvalidChannel', error: 'Not a server channel' });
  }
  const { allow, deny } = req.body || {};
  const overrides = ch.role_permissions instanceof Map
    ? Object.fromEntries(ch.role_permissions)
    : (ch.role_permissions || {});
  overrides[req.params.role_id] = { allow: allow || 0, deny: deny || 0 };
  ch.role_permissions = overrides;
  ch.markModified('role_permissions');
  await ch.save();
  res.status(204).send();
});

// DELETE /channels/:target/permissions/:role_id - remove role override for channel
router.delete('/:target/permissions/:role_id', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  if (ch.server) {
    const ctx = await getChannelPerms(ch, req.userId);
    if (!ctx || !hasPermission(ctx.perms, Permissions.MANAGE_ROLES)) {
      return res.status(403).json({ type: 'Forbidden', error: 'Missing MANAGE_ROLES permission' });
    }
  } else {
    return res.status(400).json({ type: 'InvalidChannel', error: 'Not a server channel' });
  }
  const overrides = ch.role_permissions instanceof Map
    ? Object.fromEntries(ch.role_permissions)
    : (ch.role_permissions || {});
  delete overrides[req.params.role_id];
  ch.role_permissions = overrides;
  ch.markModified('role_permissions');
  await ch.save();
  res.status(204).send();
});

// POST /channels/:target/webhooks
router.post('/:target/webhooks', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });
  const { name } = req.body || {};
  const webhookId = ulid();
  const token = crypto.randomBytes(32).toString('hex');
  await Webhook.create({
    _id: webhookId,
    name: (name || 'Webhook').slice(0, 32),
    channel_id: ch._id,
    creator_id: req.userId,
    permissions: req.body?.permissions ?? 0,
    token,
  });
  const w = await Webhook.findById(webhookId).lean();
  res.status(201).json({ ...w, token: w.token });
});

// GET /channels/:target/webhooks
router.get('/:target/webhooks', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });
  const list = await Webhook.find({ channel_id: ch._id }).select('-token').lean();
  res.json(list);
});

// POST /channels/:target/join_call (stub)
router.post('/:target/join_call', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  res.status(200).json({ token: '' });
});

// PUT /channels/:target/end_ring/:user (stub)
router.put('/:target/end_ring/:user', authMiddleware(), async (req, res) => {
  res.status(204).send();
});

export default router;
