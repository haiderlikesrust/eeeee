import { Router } from 'express';
import { ulid } from 'ulid';
import {
  Bot, User, Channel, Message, Member, Server, ServerBan, Interaction,
} from '../db/models/index.js';
import { toPublicUser } from '../publicUser.js';
import {
  Permissions, computeChannelPermissions, computeServerPermissions, hasPermission, outranks, sameId, canManageRole,
  isVoiceMessageAttachment,
} from '../permissions.js';
import { broadcastToChannel, broadcastToServer, broadcastToUser, GatewayIntents, isUserOnlineDisplay } from '../events.js';
import { notifyPushForNewMessage } from '../pushNotify.js';

const router = Router();

/** When the command invoker is the server owner, bot moderation may skip bot-role kick/ban checks. */
function readOwnerInvokerId(req) {
  const raw = req.body?.invoker_user_id ?? req.headers['x-invoker-user-id'];
  if (raw == null || raw === '') return null;
  return String(raw);
}

function ownerDelegated(req, server) {
  const invoker = readOwnerInvokerId(req);
  return !!invoker && sameId(server.owner, invoker);
}

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

async function getBotServerContext(req, res, serverId) {
  const server = await Server.findById(serverId);
  if (!server) {
    res.status(404).json({ type: 'NotFound', error: 'Server not found' });
    return null;
  }
  const member = await Member.findOne({ server: server._id, user: req.userId });
  if (!member) {
    res.status(403).json({ type: 'Forbidden', error: 'Bot is not a member of this server' });
    return null;
  }
  const perms = computeServerPermissions(server, member);
  return { server, member, perms };
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
    components: m.components || [],
    mentions: m.mentions || [],
    replies: m.replies || [],
    reactions,
    pinned: m.pinned || false,
    created_at: m.created_at,
  };
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

async function applyInteractionCallback({ interaction, ch, botId, callback }) {
  if (!callback || typeof callback !== 'object') return { ok: false, error: 'Invalid callback payload' };
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
    broadcastToUser(interaction.user, {
      type: 'INTERACTION_MODAL_CREATE',
      d: {
        channel_id: interaction.channel,
        interaction_id: interaction._id,
        interaction_token: interaction.token,
        modal,
      },
    });
    return { ok: true, modal };
  }

  if (type === 7) {
    const targetId = interaction.message_id || interaction.original_response_message_id;
    if (!targetId) return { ok: false, error: 'No message to update for type 7' };
    const updated = await updateBotMessageInChannel(ch, botId, targetId, data);
    if (!updated) return { ok: false, error: 'Target message not found' };
    await interaction.save();
    return { ok: true, updated_message_id: targetId };
  }

  if (type === 4) {
    if (isEphemeralFlags(data.flags)) {
      const ephemeral = await sendInteractionEphemeral(interaction.user, interaction.channel, botId, data);
      await interaction.save();
      return { ok: true, ephemeral };
    }
    const created = await createBotMessageInChannel(ch, botId, data);
    interaction.original_response_message_id = created.message._id;
    await interaction.save();
    return { ok: true, message: created.payload };
  }

  return { ok: false, error: 'Unhandled callback type' };
}

function roleEntries(server) {
  const raw = server?.roles && typeof server.roles.toObject === 'function'
    ? server.roles.toObject()
    : (server?.roles || {});
  return Object.entries(typeof raw === 'object' && raw ? raw : {}).map(([id, role]) => ({
    id,
    ...role,
    rank: role?.rank ?? 0,
  }));
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
      slash_commands: req.bot.slash_commands || [],
      terms_of_service_url: req.bot.terms_of_service_url || '',
      privacy_policy_url: req.bot.privacy_policy_url || '',
    },
    user: toPublicUser(req.botUser, { relationship: 'None', online: false }),
  });
});

// PATCH /bot/@me - update bot's profile (avatar, banner)
router.patch('/@me', botAuth, async (req, res) => {
  const { avatar, profile } = req.body || {};
  const botUser = await User.findById(req.bot._id);
  if (!botUser) return res.status(404).json({ type: 'NotFound', error: 'Bot user not found' });
  if (avatar != null) {
    botUser.avatar = avatar;
  }
  if (profile != null && typeof profile === 'object' && profile.banner !== undefined) {
    if (!botUser.profile || typeof botUser.profile !== 'object') botUser.profile = {};
    botUser.profile.banner = profile.banner;
    botUser.markModified('profile');
  }
  await botUser.save();
  const updated = await User.findById(req.bot._id).lean();
  res.json(toPublicUser(updated, { relationship: 'None', online: false }));
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

const PRESENCE_VALUES = new Set(['Online', 'Idle', 'Busy', 'Invisible']);

// PATCH /bot/@me/status - set bot presence and/or custom status text
router.patch('/@me/status', botAuth, async (req, res) => {
  const { presence, text } = req.body || {};
  const botUser = await User.findById(req.bot._id);
  if (!botUser) return res.status(404).json({ type: 'NotFound', error: 'Bot user not found' });

  if (!botUser.status || typeof botUser.status !== 'object') {
    botUser.status = { presence: 'Online', text: null };
  }
  if (presence !== undefined) {
    if (PRESENCE_VALUES.has(presence)) {
      botUser.status.presence = presence;
    }
  }
  if (text !== undefined) {
    botUser.status.text = text == null || String(text).trim() === '' ? null : String(text).slice(0, 128);
  }
  botUser.markModified('status');
  await botUser.save();

  const memberships = await Member.find({ user: req.bot._id }).select('server').lean();
  const serverIds = [...new Set(memberships.map((m) => m.server))];
  for (const serverId of serverIds) {
    await broadcastToServer(serverId, { type: 'PresenceUpdate', d: { user_id: req.bot._id, status: botUser.status } });
  }

  res.json({ status: botUser.status });
});

// GET /bot/channels/:target - channel info (e.g. server id for guild channels)
router.get('/channels/:target', botAuth, async (req, res) => {
  const ch = await Channel.findById(req.params.target).lean();
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const member = await getMember(ch, req.userId);
  if (!canAccessChannel(ch, req.userId, member)) return res.status(403).json({ type: 'Forbidden', error: 'No access' });
  res.json({
    _id: ch._id,
    server: ch.server || null,
    channel_type: ch.channel_type,
    name: ch.name || null,
    description: ch.description || null,
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

  const content = req.body?.content ?? '';
  const msgId = ulid();
  const msg = await Message.create({
    _id: msgId,
    channel: ch._id,
    author: req.userId,
    content: String(content).slice(0, 2000),
    attachments: req.body?.attachments || [],
    embeds: req.body?.embeds || [],
    components: normalizeComponents(req.body?.components || []),
    mentions: req.body?.mentions || [],
    replies: req.body?.replies || [],
  });
  ch.last_message_id = msgId;
  await ch.save();

  const author = await User.findById(req.userId)
    .select('_id username discriminator display_name avatar badges system_badges status profile flags privileged bot relations')
    .lean();
  const payload = messageToJson(msg, { [req.userId]: author });

  res.status(201).json(payload);
  void broadcastToChannel(ch._id, { type: 'MESSAGE_CREATE', d: payload }, {
    eventIntent: GatewayIntents.GUILD_MESSAGES,
  }).catch(() => {});
  notifyPushForNewMessage(ch, req.userId, payload);
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
  const { content, embeds, components } = req.body || {};
  if (content != null) msg.content = String(content).slice(0, 2000);
  if (embeds != null) msg.embeds = Array.isArray(embeds) ? embeds : [];
  if (components != null) msg.components = normalizeComponents(components);
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

// POST /bot/interactions/:id/:token/callback
router.post('/interactions/:id/:token/callback', botAuth, async (req, res) => {
  const interaction = await Interaction.findOne({
    _id: req.params.id,
    token: req.params.token,
    bot: req.userId,
  });
  if (!interaction) return res.status(404).json({ type: 'NotFound', error: 'Interaction not found' });
  const ch = await Channel.findById(interaction.channel);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });

  const callback = {
    type: req.body?.type,
    data: req.body?.data || {},
  };
  const out = await applyInteractionCallback({
    interaction,
    ch,
    botId: req.userId,
    callback,
  });
  if (!out.ok) return res.status(400).json({ type: 'FailedValidation', error: out.error || 'Failed to apply interaction callback' });
  res.json(out);
});

// POST /bot/interactions/:id/:token/followups
router.post('/interactions/:id/:token/followups', botAuth, async (req, res) => {
  const interaction = await Interaction.findOne({
    _id: req.params.id,
    token: req.params.token,
    bot: req.userId,
  });
  if (!interaction) return res.status(404).json({ type: 'NotFound', error: 'Interaction not found' });
  const ch = await Channel.findById(interaction.channel);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });

  const data = req.body?.data && typeof req.body.data === 'object' ? req.body.data : (req.body || {});
  if (isEphemeralFlags(data.flags)) {
    const payload = await sendInteractionEphemeral(interaction.user, interaction.channel, req.userId, data);
    return res.status(201).json({ ephemeral: payload });
  }
  const created = await createBotMessageInChannel(ch, req.userId, data);
  res.status(201).json(created.payload);
});

// PATCH /bot/interactions/:id/:token/original
router.patch('/interactions/:id/:token/original', botAuth, async (req, res) => {
  const interaction = await Interaction.findOne({
    _id: req.params.id,
    token: req.params.token,
    bot: req.userId,
  });
  if (!interaction) return res.status(404).json({ type: 'NotFound', error: 'Interaction not found' });
  const ch = await Channel.findById(interaction.channel);
  if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });

  const data = req.body?.data && typeof req.body.data === 'object' ? req.body.data : (req.body || {});
  const originalId = interaction.original_response_message_id;
  if (originalId) {
    const updated = await updateBotMessageInChannel(ch, req.userId, originalId, data);
    if (!updated) return res.status(404).json({ type: 'NotFound', error: 'Original response message not found' });
    return res.json(updated.payload);
  }

  if (!interaction.deferred) {
    return res.status(400).json({ type: 'InvalidOperation', error: 'Interaction has no original response to edit' });
  }

  if (isEphemeralFlags(data.flags) || interaction.deferred_ephemeral) {
    const payload = await sendInteractionEphemeral(interaction.user, interaction.channel, req.userId, data);
    return res.json({ ephemeral: payload });
  }

  const created = await createBotMessageInChannel(ch, req.userId, data);
  interaction.original_response_message_id = created.message._id;
  await interaction.save();
  res.json(created.payload);
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

// --- Server moderation (same permission rules as /servers/* for user sessions) ---

// GET /bot/users/:target
router.get('/users/:target', botAuth, async (req, res) => {
  const user = await User.findById(req.params.target).lean();
  if (!user) return res.status(404).json({ type: 'NotFound', error: 'User not found' });
  res.json(toPublicUser(user, { relationship: 'None', online: isUserOnlineDisplay(user._id, user) }));
});

// GET /bot/servers/:target
router.get('/servers/:target', botAuth, async (req, res) => {
  const ctx = await getBotServerContext(req, res, req.params.target);
  if (!ctx) return;
  const channels = await Channel.find({ _id: { $in: ctx.server.channels } }).lean();
  const roles = roleEntries(ctx.server).sort((a, b) => b.rank - a.rank);
  res.json({
    ...ctx.server.toObject(),
    channels: ctx.server.channels.map((id) => channels.find((c) => c._id === id) || id),
    roles,
  });
});

// GET /bot/servers/:target/channels
router.get('/servers/:target/channels', botAuth, async (req, res) => {
  const ctx = await getBotServerContext(req, res, req.params.target);
  if (!ctx) return;
  const channels = await Channel.find({ _id: { $in: ctx.server.channels } }).lean();
  res.json(channels);
});

// GET /bot/servers/:target/roles
router.get('/servers/:target/roles', botAuth, async (req, res) => {
  const ctx = await getBotServerContext(req, res, req.params.target);
  if (!ctx) return;
  const roles = roleEntries(ctx.server).sort((a, b) => b.rank - a.rank);
  res.json(roles);
});

// GET /bot/servers/:target/permissions
router.get('/servers/:target/permissions', botAuth, async (req, res) => {
  const ctx = await getBotServerContext(req, res, req.params.target);
  if (!ctx) return;
  res.json({ permissions: ctx.perms });
});

// GET /bot/servers/:target/members
router.get('/servers/:target/members', botAuth, async (req, res) => {
  const ctx = await getBotServerContext(req, res, req.params.target);
  if (!ctx) return;
  const members = await Member.find({ server: ctx.server._id }).lean();
  const userIds = members.map((m) => m.user).filter(Boolean);
  const users = await User.find({ _id: { $in: userIds } }).lean();
  const byId = Object.fromEntries(users.map((u) => [u._id, u]));
  res.json(
    members.map((m) => ({
      _id: m._id,
      server: m.server,
      user: byId[m.user] ? toPublicUser(byId[m.user], { relationship: 'None', online: false }) : m.user,
      nickname: m.nickname,
      avatar: m.avatar,
      roles: m.roles,
      joined_at: m.joined_at,
    })),
  );
});

// GET /bot/servers/:target/members/:member
router.get('/servers/:target/members/:member', botAuth, async (req, res) => {
  const ctx = await getBotServerContext(req, res, req.params.target);
  if (!ctx) return;
  const member = await Member.findOne({ _id: req.params.member, server: ctx.server._id }).lean();
  if (!member) return res.status(404).json({ type: 'NotFound', error: 'Member not found' });
  const user = await User.findById(member.user).lean();
  res.json({
    ...member,
    user: user ? toPublicUser(user, { relationship: 'None', online: isUserOnlineDisplay(member.user, user) }) : member.user,
  });
});

// PATCH /bot/servers/:target/members/:member
router.patch('/servers/:target/members/:member', botAuth, async (req, res) => {
  const ctx = await getBotServerContext(req, res, req.params.target);
  if (!ctx) return;
  const targetMember = await Member.findOne({ server: ctx.server._id, _id: req.params.member });
  if (!targetMember) return res.status(404).json({ type: 'NotFound', error: 'Member not found' });

  const delegated = ownerDelegated(req, ctx.server);
  const isSelf = sameId(targetMember.user, req.userId);
  const { nickname, roles } = req.body || {};

  if (nickname !== undefined) {
    if (!isSelf && !delegated && !hasPermission(ctx.perms, Permissions.MANAGE_NICKNAMES)) {
      return res.status(403).json({ type: 'Forbidden', error: 'Missing MANAGE_NICKNAMES permission' });
    }
    if (!isSelf && !delegated && !outranks(ctx.server, ctx.member, targetMember)) {
      return res.status(403).json({ type: 'Forbidden', error: 'Cannot manage higher-ranked member' });
    }
    targetMember.nickname = nickname;
  }

  if (roles !== undefined) {
    if (!delegated && !hasPermission(ctx.perms, Permissions.MANAGE_ROLES)) {
      return res.status(403).json({ type: 'Forbidden', error: 'Missing MANAGE_ROLES permission' });
    }
    if (!delegated && !isSelf && !outranks(ctx.server, ctx.member, targetMember)) {
      return res.status(403).json({ type: 'Forbidden', error: 'Cannot manage higher-ranked member' });
    }
    const newRoles = Array.isArray(roles) ? roles : [];
    if (!delegated) {
      for (const roleId of newRoles) {
        if (!canManageRole(ctx.server, ctx.member, roleId)) {
          return res.status(403).json({ type: 'Forbidden', error: 'Cannot assign role above your rank' });
        }
      }
    }
    targetMember.roles = newRoles;
  }

  await targetMember.save();
  res.json(targetMember.toObject());
});

// GET /bot/servers/:target/bans
router.get('/servers/:target/bans', botAuth, async (req, res) => {
  const ctx = await getBotServerContext(req, res, req.params.target);
  if (!ctx) return;
  const delegated = ownerDelegated(req, ctx.server);
  if (!delegated && !hasPermission(ctx.perms, Permissions.BAN_MEMBERS)) {
    return res.status(403).json({
      type: 'Forbidden',
      error: 'You need the Ban Members permission (or Administrator) to view bans.',
      code: 'MISSING_BAN_MEMBERS',
    });
  }
  const bans = await ServerBan.find({ server: ctx.server._id }).populate('user', '_id username discriminator').lean();
  res.json({ bans: bans.map((b) => ({ ...b, user: b.user })) });
});

// DELETE /bot/servers/:target/members/:member
router.delete('/servers/:target/members/:member', botAuth, async (req, res) => {
  const ctx = await getBotServerContext(req, res, req.params.target);
  if (!ctx) return;
  const targetMember = await Member.findOne({ _id: req.params.member, server: ctx.server._id });
  if (!targetMember) return res.status(404).json({ type: 'NotFound', error: 'Member not found' });

  const isSelf = sameId(targetMember.user, req.userId);
  if (sameId(targetMember.user, ctx.server.owner)) {
    return res.status(400).json({ type: 'InvalidOperation', error: 'Cannot remove owner' });
  }

  const delegated = ownerDelegated(req, ctx.server);
  if (!isSelf) {
    if (!delegated && !hasPermission(ctx.perms, Permissions.KICK_MEMBERS)) {
      return res.status(403).json({
        type: 'Forbidden',
        error: 'You need the Kick Members permission (or Administrator) to remove other members.',
        code: 'MISSING_KICK_MEMBERS',
      });
    }
    if (!delegated && !outranks(ctx.server, ctx.member, targetMember)) {
      return res.status(403).json({
        type: 'Forbidden',
        error: 'You cannot kick a member whose highest role is above or equal to yours.',
        code: 'ROLE_HIERARCHY',
      });
    }
  }

  const removedUserId = targetMember.user;
  await targetMember.deleteOne();
  const leavePayload = {
    type: 'ServerMemberLeave',
    data: { serverId: ctx.server._id, userId: removedUserId },
  };
  broadcastToServer(ctx.server._id, leavePayload);
  broadcastToUser(removedUserId, leavePayload);
  res.status(204).send();
});

// PUT /bot/servers/:target/bans/:user
router.put('/servers/:target/bans/:user', botAuth, async (req, res) => {
  const ctx = await getBotServerContext(req, res, req.params.target);
  if (!ctx) return;
  const delegated = ownerDelegated(req, ctx.server);
  if (!delegated && !hasPermission(ctx.perms, Permissions.BAN_MEMBERS)) {
    return res.status(403).json({
      type: 'Forbidden',
      error: 'You need the Ban Members permission (or Administrator) to ban members.',
      code: 'MISSING_BAN_MEMBERS',
    });
  }
  const targetMember = await Member.findOne({ server: ctx.server._id, user: req.params.user });
  if (targetMember) {
    if (sameId(targetMember.user, ctx.server.owner)) {
      return res.status(400).json({ type: 'InvalidOperation', error: 'Cannot ban owner' });
    }
    if (!delegated && !outranks(ctx.server, ctx.member, targetMember) && !sameId(ctx.server.owner, req.userId)) {
      return res.status(403).json({
        type: 'Forbidden',
        error: 'You cannot ban a member whose highest role is above or equal to yours.',
        code: 'ROLE_HIERARCHY',
      });
    }
  }
  const reason = (req.body && req.body.reason) || undefined;
  const banId = ulid();
  await ServerBan.create({ _id: banId, server: ctx.server._id, user: req.params.user, reason: reason || undefined });
  await Member.deleteOne({ server: ctx.server._id, user: req.params.user });
  const leavePayload = {
    type: 'ServerMemberLeave',
    data: { serverId: ctx.server._id, userId: req.params.user },
  };
  broadcastToServer(ctx.server._id, leavePayload);
  broadcastToUser(req.params.user, leavePayload);
  const ban = await ServerBan.findById(banId).populate('user').lean();
  res.json(ban);
});

// DELETE /bot/servers/:target/bans/:user
router.delete('/servers/:target/bans/:user', botAuth, async (req, res) => {
  const ctx = await getBotServerContext(req, res, req.params.target);
  if (!ctx) return;
  const delegated = ownerDelegated(req, ctx.server);
  if (!delegated && !hasPermission(ctx.perms, Permissions.BAN_MEMBERS)) {
    return res.status(403).json({
      type: 'Forbidden',
      error: 'You need the Ban Members permission (or Administrator) to unban members.',
      code: 'MISSING_BAN_MEMBERS',
    });
  }
  await ServerBan.deleteOne({ server: ctx.server._id, user: req.params.user });
  res.status(204).send();
});

export default router;
