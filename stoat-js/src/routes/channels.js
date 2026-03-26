import { Router } from 'express';
import { ulid } from 'ulid';
import crypto from 'crypto';
import {
  Channel, Message, Member, User, Invite, Webhook, ChannelUnread, Server, Bot, WhiteboardSession, Interaction,
} from '../db/models/index.js';
import { createRoom } from '../whiteboardRooms.js';
import { authMiddleware } from '../middleware/auth.js';
import { toPublicUser } from '../publicUser.js';
import { broadcastToChannel, broadcastToServer, broadcastToUser, GatewayIntents, isUserOnlineDisplay } from '../events.js';
import { notifyPushForNewMessage } from '../pushNotify.js';
import { fetchLinkPreviewsForContent } from '../linkPreview.js';
import {
  Permissions, ALL_PERMISSIONS, computeChannelPermissions, computeServerPermissions, hasPermission,
  sameId, isVoiceMessageAttachment,
} from '../permissions.js';
import { parseSlashContent } from '../slash/parse.js';
import { runBuiltinHandler, listBuiltinCommandsForApi } from '../slash/builtin.js';
import { findBotsWithSlashCommand } from '../slash/resolve.js';
import { postBotInteraction } from '../slash/botInteraction.js';
import { getOfficialClawUserId } from '../officialClaw.js';
import { translateMessageContent } from '../translate.js';
import { recordServerEvent } from '../analytics/service.js';

const router = Router();

function trackChannelMessageSent(userId, ch, extra = {}) {
  void recordServerEvent({
    userId,
    event: 'channel.message_sent',
    props: {
      channel_type: ch.channel_type,
      has_server: !!ch.server,
      ...extra,
    },
  });
}

function isBotUser(user) {
  const owner = user?.bot?.owner;
  return typeof owner === 'string' && owner.trim().length > 0;
}

function canAccessChannel(channel, userId, member) {
  if (channel.channel_type === 'DirectMessage') return (channel.recipients || []).includes(userId);
  if (channel.channel_type === 'TextChannel' || channel.channel_type === 'VoiceChannel' || channel.channel_type === 'Group') return !!member || channel.owner === userId;
  if (channel.channel_type === 'SavedMessages') return channel.user === userId;
  if (channel.channel_type === 'Thread') return !!member || channel.owner === userId;
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

function mentionCountFromContent(content) {
  if (!content) return 0;
  const matches = String(content).match(/<@[!&]?[a-zA-Z0-9]+>|@everyone|@here/g);
  return matches ? matches.length : 0;
}

function hasInviteLink(content) {
  if (!content) return false;
  return /(discord\.gg\/|discord\.com\/invite\/|discordapp\.com\/invite\/|\/invite\/[a-z0-9_-]{4,})/i.test(String(content));
}

const BUTTON_STYLE_MAP = {
  1: 'primary',
  2: 'secondary',
  3: 'success',
  4: 'danger',
  5: 'link',
};

function normalizeButtonStyle(style) {
  if (Number.isFinite(Number(style)) && BUTTON_STYLE_MAP[Number(style)]) return BUTTON_STYLE_MAP[Number(style)];
  const s = String(style || '').trim().toLowerCase();
  if (['primary', 'secondary', 'success', 'danger', 'link'].includes(s)) return s;
  return 'secondary';
}

function normalizeComponents(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const normalizedRows = [];
  const normalizeOne = (componentLike) => {
    if (!componentLike || typeof componentLike !== 'object') return null;
    const typeRaw = String(componentLike.type || '').toLowerCase();
    const isSelectType = typeRaw === 'select'
      || typeRaw === 'string_select'
      || typeRaw === 'select_menu'
      || Number(componentLike.type) === 3
      || Array.isArray(componentLike.options);

    if (isSelectType) {
      const customId = String(componentLike.custom_id || componentLike.customId || '').slice(0, 100);
      if (!customId) return null;
      const optionsIn = Array.isArray(componentLike.options) ? componentLike.options : [];
      const options = optionsIn.slice(0, 25).map((opt) => ({
        label: String(opt?.label || '').slice(0, 100),
        value: String(opt?.value || '').slice(0, 100),
        description: opt?.description != null ? String(opt.description).slice(0, 100) : undefined,
        default: !!opt?.default,
      })).filter((opt) => opt.label && opt.value);
      if (options.length === 0) return null;
      const minValues = Math.max(0, Math.min(options.length, Number(componentLike.min_values ?? componentLike.minValues ?? 1) || 1));
      const maxValues = Math.max(minValues, Math.min(options.length, Number(componentLike.max_values ?? componentLike.maxValues ?? 1) || 1));
      return {
        type: 'select',
        custom_id: customId,
        placeholder: componentLike.placeholder != null ? String(componentLike.placeholder).slice(0, 100) : undefined,
        min_values: minValues,
        max_values: maxValues,
        disabled: !!componentLike.disabled,
        options,
      };
    }

    const style = normalizeButtonStyle(componentLike.style);
    const label = String(componentLike.label || '').slice(0, 80);
    const disabled = !!componentLike.disabled;
    const isLink = style === 'link';
    const customId = !isLink ? String(componentLike.custom_id || componentLike.customId || '').slice(0, 100) : '';
    const url = isLink ? String(componentLike.url || '').trim().slice(0, 512) : '';
    if (isLink && !/^https?:\/\//i.test(url)) return null;
    if (!isLink && !customId) return null;
    return {
      type: 'button',
      style,
      label,
      custom_id: customId || undefined,
      url: url || undefined,
      disabled,
    };
  };

  const pushComponent = (targetRow, componentLike) => {
    if (!targetRow || targetRow.components.length >= 5) return;
    const c = normalizeOne(componentLike);
    if (!c) return;
    targetRow.components.push(c);
  };

  const ensureRow = () => {
    const last = normalizedRows[normalizedRows.length - 1];
    if (last && last.components.length < 5) return last;
    if (normalizedRows.length >= 5) return null;
    const row = { type: 'action_row', components: [] };
    normalizedRows.push(row);
    return row;
  };

  for (const rowLike of raw.slice(0, 25)) {
    if (!rowLike || typeof rowLike !== 'object') continue;
    const rowButtons = Array.isArray(rowLike.components) ? rowLike.components : null;
    if (rowButtons) {
      const row = ensureRow();
      if (!row) break;
      for (const componentLike of rowButtons.slice(0, 5)) pushComponent(row, componentLike);
      continue;
    }
    const row = ensureRow();
    if (!row) break;
    pushComponent(row, rowLike);
  }

  return normalizedRows.filter((r) => Array.isArray(r.components) && r.components.length > 0);
}

function findComponentByCustomId(components, customId) {
  const rows = normalizeComponents(components);
  for (const row of rows) {
    for (const component of row.components) {
      if (component?.custom_id && String(component.custom_id) === String(customId)) return component;
    }
  }
  return null;
}

function normalizeModalPayload(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const customId = String(raw.custom_id || raw.customId || '').slice(0, 100);
  const title = String(raw.title || '').slice(0, 45);
  const rowLikes = Array.isArray(raw.components) ? raw.components : [];
  if (!customId || !title) return null;
  const components = [];
  for (const rowLike of rowLikes.slice(0, 5)) {
    const fields = Array.isArray(rowLike?.components) ? rowLike.components : [];
    const field = fields[0];
    if (!field || typeof field !== 'object') continue;
    const typeRaw = String(field.type || '').toLowerCase();
    if (!(typeRaw === 'text_input' || Number(field.type) === 4)) continue;
    const fieldCustomId = String(field.custom_id || field.customId || '').slice(0, 100);
    if (!fieldCustomId) continue;
    const styleRaw = String(field.style || '').toLowerCase();
    const style = (styleRaw === 'paragraph' || Number(field.style) === 2) ? 'paragraph' : 'short';
    components.push({
      type: 'action_row',
      components: [{
        type: 'text_input',
        custom_id: fieldCustomId,
        label: String(field.label || '').slice(0, 45) || 'Input',
        style,
        min_length: Math.max(0, Math.min(4000, Number(field.min_length ?? field.minLength ?? 0) || 0)),
        max_length: Math.max(1, Math.min(4000, Number(field.max_length ?? field.maxLength ?? 4000) || 4000)),
        required: field.required !== false,
        placeholder: field.placeholder != null ? String(field.placeholder).slice(0, 100) : undefined,
        value: field.value != null ? String(field.value).slice(0, 4000) : undefined,
      }],
    });
  }
  if (components.length === 0) return null;
  return { custom_id: customId, title, components };
}

function isEphemeralFlags(flags) {
  const n = Number(flags) || 0;
  return (n & 64) === 64;
}

export function messageToJson(m, authorMap = {}, replyContext = null) {
  const a = m.author && authorMap[m.author];
  const reactions = m.reactions instanceof Map
    ? Object.fromEntries(m.reactions.entries())
    : (m.reactions && typeof m.reactions.toObject === 'function'
      ? m.reactions.toObject()
      : (m.reactions || {}));
  const obj = {
    _id: m._id,
    channel: m.channel,
    author: a ? toPublicUser(a, { relationship: 'None', online: false }) : m.author,
    webhook: m.webhook,
    content: m.content,
    attachments: m.attachments || [],
    edited: m.edited,
    embeds: m.embeds || [],
    components: m.components || [],
    link_previews: m.link_previews || [],
    mentions: m.mentions || [],
    replies: m.replies || [],
    reactions: reactions,
    pinned: m.pinned || false,
    masquerade: m.masquerade || undefined,
    created_at: m.created_at,
  };
  if (m.thread_id) obj.thread_id = m.thread_id;
  if (replyContext) obj.reply_context = replyContext;
  return obj;
}

export async function fetchReplyContext(replyIds, authorMap) {
  if (!replyIds || replyIds.length === 0) return null;
  const ids = replyIds.map((r) => (typeof r === 'object' ? r.id : r)).filter(Boolean);
  if (ids.length === 0) return null;
  const replyMsgs = await Message.find({ _id: { $in: ids } }).lean();
  const neededAuthors = replyMsgs.map((rm) => rm.author).filter((id) => !authorMap[id]);
  if (neededAuthors.length > 0) {
    const extra = await User.find({ _id: { $in: neededAuthors } })
      .select('_id username discriminator display_name avatar badges system_badges status profile flags privileged bot relations')
      .lean();
    for (const u of extra) authorMap[u._id] = u;
  }
  return replyMsgs.map((rm) => {
    const ra = rm.author && authorMap[rm.author];
    return {
      _id: rm._id,
      channel: rm.channel,
      author: ra ? toPublicUser(ra, { relationship: 'None', online: false }) : rm.author,
      content: rm.content ? rm.content.slice(0, 200) : '',
      attachments: (rm.attachments || []).length > 0 ? [{ type: 'file' }] : [],
    };
  });
}

async function sendInteractionEphemeral(userId, channelId, botId, data = {}) {
  const content = String(data?.content || '').slice(0, 2000);
  const embeds = Array.isArray(data?.embeds) ? data.embeds : [];
  const components = normalizeComponents(data?.components || []);
  const payload = {
    id: ulid(),
    channel_id: channelId,
    bot_id: botId,
    content,
    embeds,
    components,
    created_at: new Date().toISOString(),
  };
  broadcastToUser(userId, { type: 'INTERACTION_EPHEMERAL_CREATE', d: payload });
  return payload;
}

async function createBotMessageInChannel(ch, botId, data = {}) {
  const channelId = ch?._id || ch;
  const msgId = ulid();
  const msg = await Message.create({
    _id: msgId,
    channel: channelId,
    author: botId,
    content: String(data?.content || '').slice(0, 2000),
    embeds: Array.isArray(data?.embeds) ? data.embeds : [],
    components: normalizeComponents(data?.components || []),
    mentions: [],
    replies: [],
  });
  await Channel.updateOne({ _id: channelId }, { $set: { last_message_id: msgId } });
  const author = await User.findById(botId)
    .select('_id username discriminator display_name avatar badges system_badges status profile flags privileged bot relations')
    .lean();
  const payload = messageToJson(msg, { [botId]: author });
  await broadcastToChannel(channelId, { type: 'MESSAGE_CREATE', d: payload }, {
    eventIntent: GatewayIntents.GUILD_MESSAGES,
  });
  notifyPushForNewMessage(ch, botId, payload);
  return { message: msg, payload };
}

async function updateBotMessageInChannel(ch, botId, messageId, data = {}) {
  const channelId = ch?._id || ch;
  const msg = await Message.findOne({ _id: messageId, channel: channelId, author: botId });
  if (!msg) return null;
  if (data.content != null) msg.content = String(data.content).slice(0, 2000);
  if (data.embeds != null) msg.embeds = Array.isArray(data.embeds) ? data.embeds : [];
  if (data.components != null) msg.components = normalizeComponents(data.components);
  msg.edited = new Date();
  await msg.save();
  const author = await User.findById(botId)
    .select('_id username discriminator display_name avatar badges system_badges status profile flags privileged bot relations')
    .lean();
  const payload = messageToJson(msg, { [botId]: author });
  await broadcastToChannel(channelId, { type: 'MESSAGE_UPDATE', d: payload }, {
    eventIntent: GatewayIntents.GUILD_MESSAGES,
  });
  return { message: msg, payload };
}

async function applyInteractionCallback({ interaction, ch, bot, callback }) {
  if (!callback || typeof callback !== 'object') {
    return { ok: false, error: 'Invalid callback payload' };
  }
  const type = Number(callback.type);
  const data = callback.data && typeof callback.data === 'object' ? callback.data : {};

  if (![4, 5, 6, 7, 9].includes(type)) {
    return { ok: false, error: 'Unsupported callback type' };
  }

  interaction.acknowledged = true;

  if (type === 5) {
    interaction.deferred = true;
    interaction.deferred_ephemeral = isEphemeralFlags(data.flags);
    await interaction.save();
    return { ok: true, deferred: true };
  }

  if (type === 6) {
    await interaction.save();
    return { ok: true, deferred: true };
  }

  if (type === 9) {
    const modal = normalizeModalPayload(data);
    if (!modal) return { ok: false, error: 'Invalid modal payload' };
    interaction.pending_modal = modal;
    await interaction.save();
    return { ok: true, modal };
  }

  if (type === 7) {
    const targetId = interaction.message_id || interaction.original_response_message_id;
    if (!targetId) return { ok: false, error: 'No message to update for type 7' };
    const updated = await updateBotMessageInChannel(ch, bot._id, targetId, data);
    if (!updated) return { ok: false, error: 'Target message not found' };
    await interaction.save();
    return { ok: true, updated_message_id: targetId };
  }

  if (type === 4) {
    if (isEphemeralFlags(data.flags)) {
      const ephemeral = await sendInteractionEphemeral(interaction.user, interaction.channel, bot._id, data);
      await interaction.save();
      return { ok: true, ephemeral };
    }
    const created = await createBotMessageInChannel(ch, bot._id, data);
    interaction.original_response_message_id = created.message._id;
    await interaction.save();
    return { ok: true, message: created.payload };
  }

  return { ok: false, error: 'Unhandled callback type' };
}

async function resolveContextBotCommand(serverId, commandName, commandType) {
  if (!serverId) return { error: 'Context commands are server-only' };
  const name = String(commandName || '').trim().toLowerCase();
  if (!name) return { error: 'Command name required' };
  const kind = String(commandType || 'MESSAGE').toUpperCase();
  const members = await Member.find({ server: serverId }).lean();
  const userIds = members.map((m) => m.user);
  const bots = await Bot.find({ _id: { $in: userIds } }).lean();
  const matches = [];
  for (const b of bots) {
    const command = (b.slash_commands || []).find((c) => String(c.name || '').toLowerCase() === name && String(c.type || 'CHAT_INPUT') === kind);
    if (command) matches.push({ bot: b, command });
  }
  if (matches.length === 0) return { error: `No bot ${kind.toLowerCase()} context command named "${name}" found` };
  if (matches.length > 1) return { error: `Multiple bots define "${name}" ${kind.toLowerCase()} context command` };
  return matches[0];
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
  const out = { ...ch };
  if (ch.channel_type === 'DirectMessage' && Array.isArray(ch.recipients)) {
    const otherId = ch.recipients.find((r) => r !== req.userId);
    if (otherId) {
      const otherUser = await User.findById(otherId).lean();
      if (otherUser) {
        out.other_user = toPublicUser(otherUser, { relationship: 'None', online: isUserOnlineDisplay(otherId, otherUser) });
      }
    }
  }
  res.json(out);
});

// GET /channels/:target/permissions - computed channel permissions for current user (respects overrides)
router.get('/:target/permissions', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.target).lean();
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  if (!ch.server) return res.json({ permissions: ALL_PERMISSIONS });
  const server = await Server.findById(ch.server).lean();
  if (!server) return res.json({ permissions: 0 });
  /** Server owner always has full channel permissions (matches computeChannelPermissions owner branch). */
  if (sameId(server.owner, req.userId)) {
    return res.json({ permissions: ALL_PERMISSIONS });
  }
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });
  const perms = computeChannelPermissions(server, member, ch);
  res.json({ permissions: perms });
});

// GET /channels/:target/commands — built-in + bot slash commands for this server (discovery / autocomplete)
router.get('/:target/commands', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.target).lean();
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });
  const builtin = listBuiltinCommandsForApi();
  const bots = [];
  if (ch.server) {
    const members = await Member.find({ server: ch.server }).lean();
    const userIds = members.map((m) => m.user);
    const botDocs = await Bot.find({ _id: { $in: userIds } }).lean();
    const users = await User.find({ _id: { $in: botDocs.map((b) => b._id) } })
      .select('_id username discriminator display_name avatar badges system_badges status profile flags privileged bot relations')
      .lean();
    const byUser = Object.fromEntries(users.map((u) => [u._id, u]));
    for (const b of botDocs) {
      const allCmds = (b.slash_commands || []).filter((c) => c.name);
      if (allCmds.length === 0) continue;
      const chatInput = allCmds.filter((c) => String(c.type || 'CHAT_INPUT') === 'CHAT_INPUT');
      const messageContext = allCmds.filter((c) => String(c.type || 'CHAT_INPUT') === 'MESSAGE');
      const userContext = allCmds.filter((c) => String(c.type || 'CHAT_INPUT') === 'USER');
      const u = byUser[b._id];
      bots.push({
        bot_id: b._id,
        username: u?.username ?? b._id,
        display_name: u?.display_name || null,
        discriminator: u?.discriminator ?? null,
        commands: chatInput.map((c) => ({ name: c.name, description: c.description || '' })),
        context_commands: {
          message: messageContext.map((c) => ({ name: c.name, description: c.description || '' })),
          user: userContext.map((c) => ({ name: c.name, description: c.description || '' })),
        },
      });
    }
  }
  res.json({ builtin, bots });
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
  const { name, description, icon, default_permissions, role_permissions, slowmode } = req.body || {};
  if (name != null) ch.name = String(name).slice(0, 32);
  if (description != null) ch.description = description;
  if (icon != null) ch.icon = icon;
  if (slowmode !== undefined) ch.slowmode = Math.max(0, Math.min(Number(slowmode) || 0, 21600));
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
  // Batch-fetch reply context for all messages that have replies
  const allReplyIds = [...new Set(messages.flatMap((m) => (m.replies || []).map((r) => (typeof r === 'object' ? r.id : r))).filter(Boolean))];
  let replyMsgMap = {};
  if (allReplyIds.length > 0) {
    const replyMsgs = await Message.find({ _id: { $in: allReplyIds } }).lean();
    const replyAuthorIds = [...new Set(replyMsgs.map((rm) => rm.author).filter((id) => !authorMap[id]))];
    if (replyAuthorIds.length > 0) {
      const extraAuthors = await User.find({ _id: { $in: replyAuthorIds } })
        .select('_id username discriminator display_name avatar badges system_badges status profile flags privileged bot relations')
        .lean();
      for (const u of extraAuthors) authorMap[u._id] = u;
    }
    for (const rm of replyMsgs) {
      const ra = rm.author && authorMap[rm.author];
      replyMsgMap[rm._id] = {
        _id: rm._id, channel: rm.channel,
        author: ra ? toPublicUser(ra, { relationship: 'None', online: false }) : rm.author,
        content: rm.content ? rm.content.slice(0, 200) : '',
        attachments: (rm.attachments || []).length > 0 ? [{ type: 'file' }] : [],
      };
    }
  }
  res.json(messages.map((m) => {
    const rIds = (m.replies || []).map((r) => (typeof r === 'object' ? r.id : r)).filter(Boolean);
    const ctx = rIds.length > 0 ? rIds.map((id) => replyMsgMap[id]).filter(Boolean) : null;
    return messageToJson(m, authorMap, ctx);
  }));
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

// GET /channels/:target/messages/:msg/translate?lang=es
router.get('/:target/messages/:msg/translate', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });

  const msg = await Message.findOne({ _id: req.params.msg, channel: ch._id });
  if (!msg) return res.status(404).json({ type: 'NotFound', error: 'Message not found' });

  const lang = String(req.query.lang || req.query.target || 'en')
    .trim()
    .toLowerCase()
    .replace(/[^a-z-]/g, '')
    .split('-')[0]
    .slice(0, 8) || 'en';

  const existing = (msg.translations && typeof msg.translations === 'object') ? msg.translations[lang] : null;
  if (existing?.translated_content) {
    return res.json({
      message_id: msg._id,
      channel_id: ch._id,
      source_language: existing.source_language || 'unknown',
      target_language: lang,
      translated_content: existing.translated_content,
      provider: existing.provider || 'cache',
      cached: true,
    });
  }

  const result = await translateMessageContent({
    text: msg.content || '',
    targetLanguage: lang,
    sourceLanguage: 'auto',
  });

  const nextTranslations = (msg.translations && typeof msg.translations === 'object')
    ? { ...msg.translations }
    : {};
  nextTranslations[lang] = {
    translated_content: result.translated_text,
    source_language: result.source_language,
    provider: result.provider,
    translated_at: new Date().toISOString(),
  };
  msg.translations = nextTranslations;
  msg.markModified('translations');
  await msg.save();

  res.json({
    message_id: msg._id,
    channel_id: ch._id,
    source_language: result.source_language,
    target_language: result.target_language,
    translated_content: result.translated_text,
    provider: result.provider,
    cached: false,
  });
});

// POST /channels/:target/messages
router.post('/:target/messages', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  let member = await getMember(ch, req.userId);
  // Threads: if no server member (e.g. thread has no server), check parent channel access
  if (ch.channel_type === 'Thread' && !member && ch.parent_channel) {
    const parent = await Channel.findById(ch.parent_channel);
    if (parent) {
      const parentMember = await getMember(parent, req.userId);
      if (!canAccessChannel(parent, req.userId, parentMember)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });
    }
  } else if (!canAccessChannel(ch, req.userId, member)) {
    return res.status(403).json({ type: 'Forbidden', error: 'No access' });
  }
  if (ch.server) {
    const ctx = await getChannelPerms(ch, req.userId);
    if (ctx && !hasPermission(ctx.perms, Permissions.SEND_MESSAGES)) {
      return res.status(403).json({ type: 'Forbidden', error: 'Missing SEND_MESSAGES permission' });
    }
    if (ctx) {
      const rawAtt = req.body?.attachments;
      const attachments = Array.isArray(rawAtt) ? rawAtt : [];
      const hasVoice = attachments.some((a) => isVoiceMessageAttachment(a));
      const hasNonVoiceFile = attachments.some((a) => !isVoiceMessageAttachment(a));
      if (hasVoice && !hasPermission(ctx.perms, Permissions.SEND_VOICE_MESSAGE)) {
        return res.status(403).json({ type: 'Forbidden', error: 'Missing SEND_VOICE_MESSAGE permission' });
      }
      if (hasNonVoiceFile && !hasPermission(ctx.perms, Permissions.ATTACH_FILES)) {
        return res.status(403).json({ type: 'Forbidden', error: 'Missing ATTACH_FILES permission' });
      }
    }
  }
  // Slowmode enforcement
  if (ch.slowmode > 0) {
    const lastMsg = await Message.findOne({ channel: ch._id, author: req.userId }).sort({ _id: -1 }).select('created_at').lean();
    if (lastMsg?.created_at) {
      const elapsed = (Date.now() - new Date(lastMsg.created_at).getTime()) / 1000;
      if (elapsed < ch.slowmode) {
        const remaining = Math.ceil(ch.slowmode - elapsed);
        return res.status(429).json({ type: 'RateLimited', error: `Slowmode: wait ${remaining}s`, retry_after: remaining });
      }
    }
  }
  const content = req.body?.content ?? '';
  // Normalize replies: accept both string[] and {id, mention}[]
  const rawReplies = req.body?.replies || [];
  const replyIds = rawReplies.map((r) => (typeof r === 'object' ? r.id : r)).filter(Boolean);
  const contentStr = String(content).slice(0, 2000);

  // Word filter + automod enforcement
  if (ch.server && contentStr) {
    const server = await Server.findById(ch.server).select('word_filter automod').lean();
    const blockedWords = Array.isArray(server?.automod?.blocked_words) && server?.automod?.blocked_words.length > 0
      ? server.automod.blocked_words
      : (server?.word_filter || []);
    if (blockedWords.length > 0) {
      const lower = contentStr.toLowerCase();
      const blocked = blockedWords.find((w) => lower.includes(String(w).toLowerCase()));
      if (blocked) {
        return res.status(403).json({ type: 'Blocked', error: 'Message contains a blocked word' });
      }
    }
    const automodEnabled = !!server?.automod?.enabled;
    if (automodEnabled) {
      if (server?.automod?.block_invites && hasInviteLink(contentStr)) {
        return res.status(403).json({ type: 'Blocked', error: 'Invite links are blocked by automod' });
      }
      const maxMentions = Math.max(0, Number(server?.automod?.max_mentions || 0));
      if (maxMentions > 0 && mentionCountFromContent(contentStr) > maxMentions) {
        return res.status(403).json({ type: 'Blocked', error: `Automod limit: max ${maxMentions} mentions` });
      }
    }
  }

  const attachments = req.body?.attachments || [];
  const embedsIn = req.body?.embeds || [];
  const componentsIn = normalizeComponents(req.body?.components || []);
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
  const hasEmbedIn = Array.isArray(embedsIn) && embedsIn.length > 0;
  const hasComponentsIn = Array.isArray(componentsIn) && componentsIn.length > 0;
  const parsedSlash = parseSlashContent(contentStr);
  const slashOnly = parsedSlash && !hasAttachments && !hasEmbedIn && !hasComponentsIn && !req.body?.masquerade;

  if (slashOnly && parsedSlash.name === 'whiteboard') {
    const clawId = getOfficialClawUserId();
    if (!ch.server) {
      const msgId = ulid();
      const userMsg = await Message.create({
        _id: msgId,
        channel: ch._id,
        author: req.userId,
        content: contentStr,
        attachments: [],
        embeds: [],
        mentions: req.body?.mentions || [],
        replies: replyIds,
        masquerade: req.body?.masquerade || undefined,
        nonce: req.body?.nonce,
      });
      ch.last_message_id = msgId;
      await ch.save();
      const clawMsgId = ulid();
      const clawMsg = await Message.create({
        _id: clawMsgId,
        channel: ch._id,
        author: clawId,
        content: 'Use `/whiteboard` in a server text channel.',
        embeds: [],
        mentions: [],
        replies: [],
      });
      ch.last_message_id = clawMsgId;
      await ch.save();
      const author = await User.findById(req.userId)
        .select('_id username discriminator display_name avatar badges system_badges status profile flags privileged bot relations')
        .lean();
      const authorMap = { [req.userId]: author };
      const replyContext = await fetchReplyContext(replyIds, authorMap);
      const payload = messageToJson(userMsg, authorMap, replyContext);
      res.status(201).json(payload);
      void broadcastToChannel(ch._id, { type: 'MESSAGE_CREATE', d: payload }, {
        eventIntent: GatewayIntents.GUILD_MESSAGES,
      }).catch(() => {});
      notifyPushForNewMessage(ch, req.userId, payload);
      const clawUser = await User.findById(clawId)
        .select('_id username discriminator display_name avatar badges system_badges status profile flags privileged bot relations')
        .lean();
      const clawPayload = messageToJson(clawMsg, { [clawId]: clawUser }, null);
      void broadcastToChannel(ch._id, { type: 'MESSAGE_CREATE', d: clawPayload }, {
        eventIntent: GatewayIntents.GUILD_MESSAGES,
      }).catch(() => {});
      notifyPushForNewMessage(ch, clawId, clawPayload);
      return;
    }
    const sessionId = ulid();
    await WhiteboardSession.create({
      _id: sessionId,
      channel: ch._id,
      server: ch.server,
      owner: req.userId,
      status: 'open',
    });
    createRoom(sessionId, { ownerId: req.userId, channelId: ch._id, serverId: ch.server });
    const msgId = ulid();
    const userMsg = await Message.create({
      _id: msgId,
      channel: ch._id,
      author: req.userId,
      content: contentStr,
      attachments: [],
      embeds: [],
      mentions: req.body?.mentions || [],
      replies: replyIds,
      masquerade: req.body?.masquerade || undefined,
      nonce: req.body?.nonce,
    });
    ch.last_message_id = msgId;
    await ch.save();
    const ownerDoc = await User.findById(req.userId).select('display_name username').lean();
    const ownerName = ownerDoc?.display_name || ownerDoc?.username || 'Someone';
    const clawMsgId = ulid();
    const clawMsg = await Message.create({
      _id: clawMsgId,
      channel: ch._id,
      author: clawId,
      content: `**${ownerName}** started a whiteboard — Click **Join** below to draw together in real time. When finished, the person who started the session can export a snapshot.`,
      embeds: [{
        type: 'whiteboard_invite',
        session_id: sessionId,
        channel_id: ch._id,
        server_id: ch.server,
        owner_id: req.userId,
        owner_display_name: ownerName,
        session_status: 'open',
      }],
      mentions: [],
      replies: [],
    });
    await WhiteboardSession.updateOne({ _id: sessionId }, { $set: { invite_message_id: clawMsgId } });
    ch.last_message_id = clawMsgId;
    await ch.save();
    void broadcastToChannel(ch._id, {
      type: 'WhiteboardSessionOpen',
      d: {
        session_id: sessionId,
        channel_id: ch._id,
        server_id: ch.server,
        owner_id: req.userId,
      },
    }).catch(() => {});
    const author = await User.findById(req.userId)
      .select('_id username discriminator display_name avatar badges system_badges status profile flags privileged bot relations')
      .lean();
    const authorMap = { [req.userId]: author };
    const replyContext = await fetchReplyContext(replyIds, authorMap);
    const payload = messageToJson(userMsg, authorMap, replyContext);
    payload.whiteboard_session = {
      session_id: sessionId,
      owner_id: req.userId,
      channel_id: ch._id,
    };
    trackChannelMessageSent(req.userId, ch, { flow: 'whiteboard_slash' });
    res.status(201).json(payload);
    void broadcastToChannel(ch._id, { type: 'MESSAGE_CREATE', d: payload }, {
      eventIntent: GatewayIntents.GUILD_MESSAGES,
    }).catch(() => {});
    notifyPushForNewMessage(ch, req.userId, payload);
    const clawUser = await User.findById(clawId)
      .select('_id username discriminator display_name avatar badges system_badges status profile flags privileged bot relations')
      .lean();
    const clawPayload = messageToJson(clawMsg, { [clawId]: clawUser }, null);
    void broadcastToChannel(ch._id, { type: 'MESSAGE_CREATE', d: clawPayload }, {
      eventIntent: GatewayIntents.GUILD_MESSAGES,
    }).catch(() => {});
    notifyPushForNewMessage(ch, clawId, clawPayload);
    if (contentStr && /https?:\/\//i.test(contentStr)) {
      fetchLinkPreviewsForContent(contentStr, 2)
        .then((linkPreviews) => {
          if (linkPreviews.length > 0) {
            return Message.updateOne({ _id: msgId }, { $set: { link_previews: linkPreviews } });
          }
        })
        .catch(() => {});
    }
    return;
  }

  if (slashOnly) {
    const builtinRes = await runBuiltinHandler(parsedSlash.name, {
      args: parsedSlash.args,
      userId: req.userId,
      channelId: ch._id,
      serverId: ch.server || undefined,
    });
    if (builtinRes) {
      const msgId = ulid();
      const msg = await Message.create({
        _id: msgId,
        channel: ch._id,
        author: req.userId,
        content: contentStr,
        attachments: [],
        embeds: [],
        mentions: req.body?.mentions || [],
        replies: replyIds,
        masquerade: req.body?.masquerade || undefined,
        nonce: req.body?.nonce,
      });
      ch.last_message_id = msgId;
      await ch.save();
      const clawId = getOfficialClawUserId();
      const clawMsgId = ulid();
      const clawContent = String(builtinRes.content ?? '').slice(0, 2000);
      const clawMsg = await Message.create({
        _id: clawMsgId,
        channel: ch._id,
        author: clawId,
        content: clawContent,
        embeds: Array.isArray(builtinRes.embeds) ? builtinRes.embeds : [],
        mentions: [],
        replies: [],
      });
      ch.last_message_id = clawMsgId;
      await ch.save();

      const author = await User.findById(req.userId)
        .select('_id username discriminator display_name avatar badges system_badges status profile flags privileged bot relations')
        .lean();
      const authorMap = { [req.userId]: author };
      const replyContext = await fetchReplyContext(replyIds, authorMap);
      const payload = messageToJson(msg, authorMap, replyContext);
      trackChannelMessageSent(req.userId, ch, { flow: 'builtin_slash' });
      res.status(201).json(payload);
      void broadcastToChannel(ch._id, { type: 'MESSAGE_CREATE', d: payload }, {
        eventIntent: GatewayIntents.GUILD_MESSAGES,
      }).catch(() => {});
      notifyPushForNewMessage(ch, req.userId, payload);

      const clawUser = await User.findById(clawId)
        .select('_id username discriminator display_name avatar badges system_badges status profile flags privileged bot relations')
        .lean();
      const clawPayload = messageToJson(clawMsg, { [clawId]: clawUser }, null);
      void broadcastToChannel(ch._id, { type: 'MESSAGE_CREATE', d: clawPayload }, {
        eventIntent: GatewayIntents.GUILD_MESSAGES,
      }).catch(() => {});
      notifyPushForNewMessage(ch, clawId, clawPayload);

      if (contentStr && /https?:\/\//i.test(contentStr)) {
        fetchLinkPreviewsForContent(contentStr, 2)
          .then((linkPreviews) => {
            if (linkPreviews.length > 0) {
              return Message.updateOne({ _id: msgId }, { $set: { link_previews: linkPreviews } });
            }
          })
          .catch(() => {});
      }
      return;
    }
    if (ch.server) {
      const botMatches = await findBotsWithSlashCommand(ch.server, parsedSlash.name);
      if (botMatches.length > 1) {
        return res.status(400).json({
          type: 'AmbiguousSlashCommand',
          error: 'Multiple bots define this command; use a unique name per server.',
        });
      }
      if (botMatches.length === 1) {
        const bot = botMatches[0];
        const msgId = ulid();
        const msg = await Message.create({
          _id: msgId,
          channel: ch._id,
          author: req.userId,
          content: contentStr,
          attachments: [],
          embeds: [],
          mentions: req.body?.mentions || [],
          replies: replyIds,
          masquerade: req.body?.masquerade || undefined,
          nonce: req.body?.nonce,
        });
        ch.last_message_id = msgId;
        await ch.save();

        const author = await User.findById(req.userId)
          .select('_id username discriminator display_name avatar badges system_badges status profile flags privileged bot relations')
          .lean();
        const authorMap = { [req.userId]: author };
        const replyContext = await fetchReplyContext(replyIds, authorMap);
        const payload = messageToJson(msg, authorMap, replyContext);

        const interactionId = ulid();
        const interactionToken = crypto.randomBytes(24).toString('hex');
        const interactionPayload = {
          version: 1,
          type: 'application_command',
          id: interactionId,
          token: interactionToken,
          channel_id: ch._id,
          guild_id: ch.server,
          user: { id: req.userId, username: author?.username },
          command: { name: parsedSlash.name, args: parsedSlash.args },
          message_id: msgId,
        };
        const interaction = await Interaction.create({
          _id: interactionId,
          token: interactionToken,
          bot: bot._id,
          user: req.userId,
          channel: ch._id,
          server: ch.server || null,
          kind: 'application_command',
          command: { name: parsedSlash.name, args: parsedSlash.args },
          message_id: msgId,
        });

        // Gateway-connected bots receive interactions regardless of interactions_url.
        broadcastToUser(bot._id, { type: 'INTERACTION_CREATE', d: interactionPayload });

        const url = String(bot.interactions_url || '').trim();
        if (url) {
          const botHttp = await postBotInteraction(url, bot.token, interactionPayload);
          if (!botHttp.ok) {
            void broadcastToChannel(ch._id, { type: 'MESSAGE_CREATE', d: payload }, {
              eventIntent: GatewayIntents.GUILD_MESSAGES,
            }).catch(() => {});
            notifyPushForNewMessage(ch, req.userId, payload);
            return res.status(502).json({
              type: 'FailedDependency',
              error: botHttp.error,
              user_message: payload,
            });
          }
          const applied = await applyInteractionCallback({
            interaction,
            ch,
            bot,
            callback: { type: botHttp.type, data: botHttp.data || {} },
          });
          if (!applied.ok) {
            void broadcastToChannel(ch._id, { type: 'MESSAGE_CREATE', d: payload }, {
              eventIntent: GatewayIntents.GUILD_MESSAGES,
            }).catch(() => {});
            notifyPushForNewMessage(ch, req.userId, payload);
            return res.status(502).json({
              type: 'FailedDependency',
              error: applied.error || 'Invalid interaction callback',
              user_message: payload,
            });
          }
          if (applied.modal) {
            broadcastToUser(req.userId, {
              type: 'INTERACTION_MODAL_CREATE',
              d: {
                channel_id: ch._id,
                interaction_id: interaction._id,
                interaction_token: interaction.token,
                modal: applied.modal,
              },
            });
          }
        }

        trackChannelMessageSent(req.userId, ch, { flow: 'bot_slash' });
        res.status(201).json(payload);
        void broadcastToChannel(ch._id, { type: 'MESSAGE_CREATE', d: payload }, {
          eventIntent: GatewayIntents.GUILD_MESSAGES,
        }).catch(() => {});
        notifyPushForNewMessage(ch, req.userId, payload);

        if (contentStr && /https?:\/\//i.test(contentStr)) {
          fetchLinkPreviewsForContent(contentStr, 2)
            .then((linkPreviews) => {
              if (linkPreviews.length > 0) {
                return Message.updateOne({ _id: msgId }, { $set: { link_previews: linkPreviews } });
              }
            })
            .catch(() => {});
        }
        return;
      }
    }
  }

  const msgId = ulid();
  const msg = await Message.create({
    _id: msgId,
    channel: ch._id,
    author: req.userId,
    content: contentStr,
    attachments,
    embeds: embedsIn,
    components: componentsIn,
    mentions: req.body?.mentions || [],
    replies: replyIds,
    masquerade: req.body?.masquerade || undefined,
    nonce: req.body?.nonce,
  });
  ch.last_message_id = msgId;
  await ch.save();
  // HTTP response before WS fan-out so clients are not blocked on Member.find + delivery
  const author = await User.findById(req.userId)
    .select('_id username discriminator display_name avatar badges system_badges status profile flags privileged bot relations')
    .lean();
  const authorMap = { [req.userId]: author };
  const replyContext = await fetchReplyContext(replyIds, authorMap);
  const payload = messageToJson(msg, authorMap, replyContext);
  trackChannelMessageSent(req.userId, ch, { flow: 'default' });
  res.status(201).json(payload);
  void broadcastToChannel(ch._id, { type: 'MESSAGE_CREATE', d: payload }, {
    eventIntent: GatewayIntents.GUILD_MESSAGES,
  }).catch(() => {});
  notifyPushForNewMessage(ch, req.userId, payload);

  // Fetch link previews after response; avoids blocking the request (up to ~3.5s per URL)
  if (contentStr && /https?:\/\//i.test(contentStr)) {
    fetchLinkPreviewsForContent(contentStr, 2)
      .then((linkPreviews) => {
        if (linkPreviews.length > 0) {
          return Message.updateOne({ _id: msgId }, { $set: { link_previews: linkPreviews } });
        }
      })
      .catch(() => {});
  }
});

// POST /channels/:target/threads - create a thread from a message
router.post('/:target/threads', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });

  const { message_id, name } = req.body || {};
  if (!message_id) return res.status(400).json({ type: 'InvalidPayload', error: 'message_id required' });

  const msg = await Message.findOne({ _id: message_id, channel: ch._id });
  if (!msg) return res.status(404).json({ type: 'NotFound', error: 'Message not found' });

  // Check if thread already exists for this message
  if (msg.thread_id) {
    const existing = await Channel.findById(msg.thread_id);
    if (existing) return res.json(existing.toObject());
  }

  const threadId = ulid();
  const threadName = name ? String(name).slice(0, 100) : (msg.content ? msg.content.slice(0, 50) : 'Thread');

  const thread = await Channel.create({
    _id: threadId,
    channel_type: 'Thread',
    server: ch.server || undefined,
    name: threadName,
    parent_channel: ch._id,
    parent_message: message_id,
    thread_name: threadName,
  });

  // Link message to thread
  msg.thread_id = threadId;
  await msg.save();

  // Do not add threads to the server's channel list — they are nested under a message, not sidebar channels.

  // Broadcast thread creation
  if (ch.server) {
    await broadcastToServer(ch.server, {
      type: 'ThreadCreate',
      data: { thread: thread.toObject(), parent_channel: ch._id, parent_message: message_id },
    });
  }

  res.status(201).json(thread.toObject());
});

// GET /channels/:target/threads - list threads in a channel
router.get('/:target/threads', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });

  const threads = await Channel.find({ parent_channel: ch._id, channel_type: 'Thread' }).lean();
  res.json(threads);
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

// POST /channels/:target/messages/:msg/components/:customId
// Dispatch a component interaction (button/select) for bot-authored messages.
router.post('/:target/messages/:msg/components/:customId', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });

  const msg = await Message.findOne({ _id: req.params.msg, channel: ch._id });
  if (!msg) return res.status(404).json({ type: 'NotFound', error: 'Message not found' });

  const customId = String(req.params.customId || '').slice(0, 100);
  if (!customId) return res.status(400).json({ type: 'InvalidPayload', error: 'custom_id required' });

  const clickedComponent = findComponentByCustomId(msg.components || [], customId);
  if (!clickedComponent) {
    return res.status(404).json({ type: 'NotFound', error: 'Component not found on message' });
  }
  if (clickedComponent.disabled) {
    return res.status(400).json({ type: 'InvalidOperation', error: 'Component is disabled' });
  }
  if (clickedComponent.type === 'button' && clickedComponent.style === 'link') {
    return res.status(400).json({ type: 'InvalidOperation', error: 'Link buttons are not interactive' });
  }
  const values = Array.isArray(req.body?.values) ? req.body.values.map((v) => String(v).slice(0, 100)) : [];

  const botUser = await User.findById(msg.author).select('_id username bot').lean();
  if (!botUser?.bot?.owner) {
    return res.status(400).json({ type: 'InvalidOperation', error: 'Message author is not a bot' });
  }
  const bot = await Bot.findById(botUser._id).lean();
  if (!bot) {
    return res.status(404).json({ type: 'NotFound', error: 'Bot not found' });
  }

  const clickUser = await User.findById(req.userId).select('_id username display_name discriminator').lean();
  const interactionId = ulid();
  const interactionToken = crypto.randomBytes(24).toString('hex');
  const interactionPayload = {
    version: 1,
    type: 'message_component',
    id: interactionId,
    token: interactionToken,
    channel_id: ch._id,
    guild_id: ch.server || null,
    user: {
      id: req.userId,
      username: clickUser?.username || null,
      display_name: clickUser?.display_name || null,
      discriminator: clickUser?.discriminator || null,
    },
    message: {
      id: msg._id,
      channel_id: msg.channel,
      content: msg.content || '',
      embeds: msg.embeds || [],
      components: msg.components || [],
    },
    message_id: msg._id,
    component: {
      type: clickedComponent.type || 'button',
      custom_id: customId,
      label: clickedComponent.label || null,
      style: clickedComponent.style || null,
      values,
    },
  };
  const interaction = await Interaction.create({
    _id: interactionId,
    token: interactionToken,
    bot: bot._id,
    user: req.userId,
    channel: ch._id,
    server: ch.server || null,
    kind: 'message_component',
    component: interactionPayload.component,
    values,
    message_id: msg._id,
  });

  // SDK-connected bots can consume interactions directly over gateway.
  broadcastToUser(bot._id, { type: 'INTERACTION_CREATE', d: interactionPayload });

  // Also support webhook interaction handlers when interactions_url is configured.
  let modalForClient = null;
  const interactionsUrl = String(bot.interactions_url || '').trim();
  if (interactionsUrl) {
    const botHttp = await postBotInteraction(interactionsUrl, bot.token, interactionPayload);
    if (botHttp.ok) {
      const applied = await applyInteractionCallback({
        interaction,
        ch,
        bot,
        callback: { type: botHttp.type, data: botHttp.data || {} },
      });
      if (applied.ok && applied.modal) {
        modalForClient = {
          interaction_id: interaction._id,
          interaction_token: interaction.token,
          modal: applied.modal,
        };
      }
    }
  }

  res.status(202).json({ accepted: true, modal: modalForClient });
});

// POST /channels/:target/interactions/:id/:token/modal-submit
router.post('/:target/interactions/:id/:token/modal-submit', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });

  const interaction = await Interaction.findOne({
    _id: req.params.id,
    token: req.params.token,
    user: req.userId,
    channel: ch._id,
  });
  if (!interaction) return res.status(404).json({ type: 'NotFound', error: 'Interaction not found' });
  if (!interaction.pending_modal) return res.status(400).json({ type: 'InvalidOperation', error: 'No pending modal for interaction' });

  const submittedCustomId = String(req.body?.custom_id || '').slice(0, 100);
  const modalCustomId = String(interaction.pending_modal?.custom_id || '');
  if (!submittedCustomId || submittedCustomId !== modalCustomId) {
    return res.status(400).json({ type: 'InvalidPayload', error: 'Modal custom_id mismatch' });
  }

  const valuesIn = Array.isArray(req.body?.values) ? req.body.values : [];
  const values = valuesIn
    .map((row) => ({
      custom_id: String(row?.custom_id || '').slice(0, 100),
      value: String(row?.value || '').slice(0, 4000),
    }))
    .filter((row) => row.custom_id);

  const bot = await Bot.findById(interaction.bot).lean();
  if (!bot) return res.status(404).json({ type: 'NotFound', error: 'Bot not found' });
  const clickUser = await User.findById(req.userId).select('_id username display_name discriminator').lean();
  const modalInteractionId = ulid();
  const modalInteractionToken = crypto.randomBytes(24).toString('hex');
  const payload = {
    version: 1,
    type: 'modal_submit',
    id: modalInteractionId,
    token: modalInteractionToken,
    channel_id: ch._id,
    guild_id: ch.server || null,
    user: {
      id: req.userId,
      username: clickUser?.username || null,
      display_name: clickUser?.display_name || null,
      discriminator: clickUser?.discriminator || null,
    },
    message_id: interaction.message_id || null,
    modal: {
      custom_id: submittedCustomId,
      values,
    },
    parent_interaction_id: interaction._id,
  };

  const modalInteraction = await Interaction.create({
    _id: modalInteractionId,
    token: modalInteractionToken,
    bot: interaction.bot,
    user: req.userId,
    channel: ch._id,
    server: ch.server || null,
    kind: 'modal_submit',
    values: values.map((v) => `${v.custom_id}:${v.value}`.slice(0, 4200)),
    message_id: interaction.message_id || null,
    parent_interaction_id: interaction._id,
  });

  interaction.pending_modal = null;
  interaction.markModified('pending_modal');
  await interaction.save();

  broadcastToUser(bot._id, { type: 'INTERACTION_CREATE', d: payload });

  const interactionsUrl = String(bot.interactions_url || '').trim();
  if (interactionsUrl) {
    const botHttp = await postBotInteraction(interactionsUrl, bot.token, payload);
    if (botHttp.ok) {
      const applied = await applyInteractionCallback({
        interaction: modalInteraction,
        ch,
        bot,
        callback: { type: botHttp.type, data: botHttp.data || {} },
      });
      if (applied.ok && applied.modal) {
        broadcastToUser(req.userId, {
          type: 'INTERACTION_MODAL_CREATE',
          d: {
            channel_id: ch._id,
            interaction_id: modalInteraction._id,
            interaction_token: modalInteraction.token,
            modal: applied.modal,
          },
        });
      }
    }
  }

  res.status(202).json({ accepted: true });
});

// POST /channels/:target/messages/:msg/context/:command
router.post('/:target/messages/:msg/context/:command', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });
  if (!ch.server) return res.status(400).json({ type: 'InvalidOperation', error: 'Context commands require a server channel' });

  const targetMsg = await Message.findOne({ _id: req.params.msg, channel: ch._id }).lean();
  if (!targetMsg) return res.status(404).json({ type: 'NotFound', error: 'Message not found' });

  const resolved = await resolveContextBotCommand(ch.server, req.params.command, 'MESSAGE');
  if (resolved.error) return res.status(400).json({ type: 'InvalidOperation', error: resolved.error });
  const { bot, command } = resolved;

  const interactionId = ulid();
  const interactionToken = crypto.randomBytes(24).toString('hex');
  const actor = await User.findById(req.userId).select('_id username display_name discriminator').lean();
  const payload = {
    version: 1,
    type: 'application_command',
    id: interactionId,
    token: interactionToken,
    channel_id: ch._id,
    guild_id: ch.server,
    user: {
      id: req.userId,
      username: actor?.username || null,
      display_name: actor?.display_name || null,
      discriminator: actor?.discriminator || null,
    },
    command: {
      type: 'MESSAGE',
      name: command.name,
      target_message_id: targetMsg._id,
      target_author_id: targetMsg.author,
    },
    message_id: targetMsg._id,
  };
  const interaction = await Interaction.create({
    _id: interactionId,
    token: interactionToken,
    bot: bot._id,
    user: req.userId,
    channel: ch._id,
    server: ch.server,
    kind: 'context_message',
    command: payload.command,
    message_id: targetMsg._id,
  });

  broadcastToUser(bot._id, { type: 'INTERACTION_CREATE', d: payload });

  let modal = null;
  const url = String(bot.interactions_url || '').trim();
  if (url) {
    const botHttp = await postBotInteraction(url, bot.token, payload);
    if (botHttp.ok) {
      const applied = await applyInteractionCallback({
        interaction,
        ch,
        bot,
        callback: { type: botHttp.type, data: botHttp.data || {} },
      });
      if (applied.ok && applied.modal) {
        modal = {
          interaction_id: interaction._id,
          interaction_token: interaction.token,
          modal: applied.modal,
        };
      }
    }
  }

  res.status(202).json({ accepted: true, modal });
});

// POST /channels/:target/users/:user/context/:command
router.post('/:target/users/:user/context/:command', authMiddleware(), async (req, res) => {
  const ch = await Channel.findById(req.params.target);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });
  if (!ch.server) return res.status(400).json({ type: 'InvalidOperation', error: 'Context commands require a server channel' });

  const targetUser = await User.findById(req.params.user).select('_id username display_name discriminator').lean();
  if (!targetUser) return res.status(404).json({ type: 'NotFound', error: 'User not found' });

  const resolved = await resolveContextBotCommand(ch.server, req.params.command, 'USER');
  if (resolved.error) return res.status(400).json({ type: 'InvalidOperation', error: resolved.error });
  const { bot, command } = resolved;

  const interactionId = ulid();
  const interactionToken = crypto.randomBytes(24).toString('hex');
  const actor = await User.findById(req.userId).select('_id username display_name discriminator').lean();
  const payload = {
    version: 1,
    type: 'application_command',
    id: interactionId,
    token: interactionToken,
    channel_id: ch._id,
    guild_id: ch.server,
    user: {
      id: req.userId,
      username: actor?.username || null,
      display_name: actor?.display_name || null,
      discriminator: actor?.discriminator || null,
    },
    command: {
      type: 'USER',
      name: command.name,
      target_user: {
        id: targetUser._id,
        username: targetUser.username,
        display_name: targetUser.display_name || null,
        discriminator: targetUser.discriminator || null,
      },
    },
    message_id: null,
  };
  const interaction = await Interaction.create({
    _id: interactionId,
    token: interactionToken,
    bot: bot._id,
    user: req.userId,
    channel: ch._id,
    server: ch.server,
    kind: 'context_user',
    command: payload.command,
    message_id: null,
  });

  broadcastToUser(bot._id, { type: 'INTERACTION_CREATE', d: payload });

  let modal = null;
  const url = String(bot.interactions_url || '').trim();
  if (url) {
    const botHttp = await postBotInteraction(url, bot.token, payload);
    if (botHttp.ok) {
      const applied = await applyInteractionCallback({
        interaction,
        ch,
        bot,
        callback: { type: botHttp.type, data: botHttp.data || {} },
      });
      if (applied.ok && applied.modal) {
        modal = {
          interaction_id: interaction._id,
          interaction_token: interaction.token,
          modal: applied.modal,
        };
      }
    }
  }

  res.status(202).json({ accepted: true, modal });
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
