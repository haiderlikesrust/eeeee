import { Router } from 'express';
import { ulid } from 'ulid';
import { Bot, User, Member, Channel, Server } from '../db/models/index.js';
import { authMiddleware } from '../middleware/auth.js';
import { normalizeSlashCommandsInput } from '../slash/parse.js';
import { slashCommandNamesConflictWithPeers } from '../slash/conflicts.js';

const router = Router();

function isBotUser(user) {
  const owner = user?.bot?.owner;
  return typeof owner === 'string' && owner.trim().length > 0;
}

function randomToken(len = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function pickDiscriminator() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

function cleanSearchQuery(value) {
  return String(value || '').trim().toLowerCase();
}

// POST /bots/create
router.post('/create', authMiddleware(), async (req, res) => {
  const name = (req.body?.name || 'bot').slice(0, 32);
  const owner = await User.findById(req.userId);
  if (!owner) return res.status(404).json({ type: 'NotFound', error: 'User not found' });
  if (isBotUser(owner)) return res.status(400).json({ type: 'IsBot', error: 'Is bot' });
  const count = await Bot.countDocuments({ owner: req.userId });
  if (count >= 10) return res.status(400).json({ type: 'ReachedMaximumBots', error: 'Max bots' });
  const botId = ulid();
  let disc = pickDiscriminator();
  while (await User.findOne({ username: name, discriminator: disc })) disc = pickDiscriminator();
  const botUser = await User.create({
    _id: botId,
    username: name,
    discriminator: disc,
    bot: { owner: req.userId },
    last_acknowledged_policy_change: new Date(0),
  });
  const bot = await Bot.create({
    _id: botId,
    owner: req.userId,
    token: randomToken(),
    public: !!req.body?.public,
    analytics: !!req.body?.analytics,
    discoverable: !!req.body?.discoverable,
    intents: Number(req.body?.intents) || 0,
    interactions_url: req.body?.interactions_url || '',
    terms_of_service_url: req.body?.terms_of_service_url || '',
    privacy_policy_url: req.body?.privacy_policy_url || '',
  });
  const botObj = bot.toObject();
  const userObj = botUser.toObject();
  res.status(201).json({
    bot: { ...botObj, token: undefined },
    user: { ...userObj, relationship: 'None', online: false },
  });
});

// GET /bots/marketplace - list public discoverable bots
router.get('/marketplace', authMiddleware(true), async (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 24, 60));
  const q = cleanSearchQuery(req.query.q);
  const sort = String(req.query.sort || 'popular').toLowerCase();

  const bots = await Bot.find({ public: true, discoverable: true })
    .sort({ _id: -1 })
    .limit(Math.max(120, limit * 4))
    .lean();

  if (!bots.length) return res.json({ bots: [] });

  const botIds = bots.map((b) => b._id);
  const users = await User.find({ _id: { $in: botIds } })
    .select('_id username display_name discriminator avatar profile flags')
    .lean();
  const userById = Object.fromEntries(users.map((u) => [u._id, u]));

  const installCountsRaw = await Member.aggregate([
    { $match: { user: { $in: botIds } } },
    { $group: { _id: '$user', count: { $sum: 1 } } },
  ]);
  const installCountByBot = Object.fromEntries(installCountsRaw.map((d) => [d._id, d.count]));

  let out = bots
    .map((bot) => {
      const user = userById[bot._id];
      if (!user) return null;
      return {
        _id: bot._id,
        public: !!bot.public,
        discoverable: !!bot.discoverable,
        analytics: !!bot.analytics,
        intents: Number(bot.intents || 0),
        interactions_url: bot.interactions_url || '',
        terms_of_service_url: bot.terms_of_service_url || '',
        privacy_policy_url: bot.privacy_policy_url || '',
        slash_command_count: Array.isArray(bot.slash_commands) ? bot.slash_commands.length : 0,
        installed_count: Number(installCountByBot[bot._id] || 0),
        user: {
          _id: user._id,
          username: user.username,
          display_name: user.display_name || null,
          discriminator: user.discriminator || null,
          avatar: user.avatar || null,
          profile: user.profile || null,
          flags: user.flags || 0,
        },
      };
    })
    .filter(Boolean);

  if (q) {
    out = out.filter((entry) => {
      const username = String(entry.user?.username || '').toLowerCase();
      const displayName = String(entry.user?.display_name || '').toLowerCase();
      const bio = String(entry.user?.profile?.content || entry.user?.profile?.bio || '').toLowerCase();
      return username.includes(q) || displayName.includes(q) || bio.includes(q);
    });
  }

  if (sort === 'new') {
    out.sort((a, b) => String(b._id).localeCompare(String(a._id)));
  } else {
    out.sort((a, b) => {
      if (b.installed_count !== a.installed_count) return b.installed_count - a.installed_count;
      return String(b._id).localeCompare(String(a._id));
    });
  }

  res.json({ bots: out.slice(0, limit) });
});

// GET /bots/:target/token
router.get('/:target/token', authMiddleware(), async (req, res) => {
  const bot = await Bot.findById(req.params.target).lean();
  if (!bot) return res.status(404).json({ type: 'NotFound', error: 'Bot not found' });
  if (bot.owner !== req.userId) return res.status(403).json({ type: 'Forbidden', error: 'Not owner' });
  res.json({ token: bot.token });
});

// GET /bots/@me
router.get('/@me', authMiddleware(), async (req, res) => {
  const bots = await Bot.find({ owner: req.userId }).lean();
  const users = await User.find({ _id: { $in: bots.map((b) => b._id) } }).lean();
  const byId = Object.fromEntries(users.map((u) => [u._id, u]));
  res.json(bots.map((b) => ({ ...b, token: undefined, user: byId[b._id] })));
});

// GET /bots/:bot
router.get('/:bot', authMiddleware(true), async (req, res) => {
  const bot = await Bot.findById(req.params.bot).lean();
  if (!bot) return res.status(404).json({ type: 'NotFound', error: 'Bot not found' });
  const user = await User.findById(bot._id).lean();
  if (!user) return res.status(404).json({ type: 'NotFound', error: 'User not found' });
  res.json({
    ...bot,
    token: undefined,
    user: { ...user, relationship: 'None', online: false },
  });
});

// GET /bots/:target/invite - Public bot invite info
router.get('/:target/invite', authMiddleware(true), async (req, res) => {
  const bot = await Bot.findById(req.params.target).lean();
  if (!bot) return res.status(404).json({ type: 'NotFound', error: 'Bot not found' });
  const user = await User.findById(bot._id).lean();
  if (!user) return res.status(404).json({ type: 'NotFound', error: 'User not found' });
  res.json({
    bot: { ...bot, token: undefined },
    user: { ...user, relationship: 'None', online: false },
  });
});

// POST /bots/:target/invite
router.post('/:target/invite', authMiddleware(), async (req, res) => {
  if (isBotUser(req.user)) return res.status(400).json({ type: 'IsBot', error: 'Is bot' });
  const bot = await Bot.findById(req.params.target);
  if (!bot) return res.status(404).json({ type: 'NotFound', error: 'Bot not found' });
  if (!bot.public && bot.owner !== req.userId) {
    return res.status(400).json({ type: 'BotIsPrivate', error: 'Bot is private' });
  }
  const botUser = await User.findById(bot._id);
  if (!botUser) return res.status(404).json({ type: 'NotFound', error: 'Bot user not found' });
  const dest = req.body;
  if (dest?.server) {
    const server = await Server.findById(dest.server);
    if (!server) return res.status(404).json({ type: 'NotFound', error: 'Server not found' });
    if (server.owner !== req.userId) {
      return res.status(403).json({ type: 'Forbidden', error: 'Not server owner' });
    }
    const exists = await Member.findOne({ server: server._id, user: bot._id });
    if (exists) return res.status(400).json({ type: 'AlreadyInServer', error: 'Already in server' });
    await Member.create({
      _id: ulid(),
      server: server._id,
      user: bot._id,
      roles: [],
    });
  } else if (dest?.group) {
    const ch = await Channel.findById(dest.group);
    if (!ch) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
    if (ch.channel_type !== 'Group') return res.status(400).json({ type: 'InvalidChannel', error: 'Not a group' });
    if (ch.owner !== req.userId) return res.status(403).json({ type: 'Forbidden', error: 'Not group owner' });
    if ((ch.recipients || []).includes(bot._id)) {
      return res.status(400).json({ type: 'AlreadyInGroup', error: 'Already in group' });
    }
    ch.recipients = ch.recipients || [];
    ch.recipients.push(bot._id);
    await ch.save();
  } else {
    return res.status(400).json({ type: 'InvalidPayload', error: 'server or group required' });
  }
  res.status(204).send();
});

// PATCH /bots/:target
router.patch('/:target', authMiddleware(), async (req, res) => {
  const bot = await Bot.findById(req.params.target);
  if (!bot) return res.status(404).json({ type: 'NotFound', error: 'Bot not found' });
  if (bot.owner !== req.userId) return res.status(403).json({ type: 'Forbidden', error: 'Not owner' });
  const {
    name, public: pub, analytics, discoverable, intents, interactions_url,
    terms_of_service_url, privacy_policy_url, avatar, profile, slash_commands,
  } = req.body || {};
  let botUser = await User.findById(bot._id);
  if (botUser) {
    if (name != null) {
      botUser.username = String(name).slice(0, 32);
    }
    if (avatar != null) {
      botUser.avatar = avatar;
    }
    if (profile != null && typeof profile === 'object') {
      if (!botUser.profile || typeof botUser.profile !== 'object') botUser.profile = {};
      if (profile.banner !== undefined) botUser.profile.banner = profile.banner;
      botUser.markModified('profile');
    }
    await botUser.save();
  } else if (name != null) {
    botUser = await User.findById(bot._id);
    if (botUser) {
      botUser.username = String(name).slice(0, 32);
      await botUser.save();
    }
  }
  if (pub != null) bot.public = !!pub;
  if (analytics != null) bot.analytics = !!analytics;
  if (discoverable != null) bot.discoverable = !!discoverable;
  if (intents != null) bot.intents = Number(intents) || 0;
  if (interactions_url != null) bot.interactions_url = String(interactions_url);
  if (terms_of_service_url != null) bot.terms_of_service_url = String(terms_of_service_url);
  if (privacy_policy_url != null) bot.privacy_policy_url = String(privacy_policy_url);
  if (slash_commands != null) {
    const norm = normalizeSlashCommandsInput(slash_commands);
    if (norm.error) {
      return res.status(400).json({ type: 'FailedValidation', error: norm.error });
    }
    const peerErr = await slashCommandNamesConflictWithPeers(
      bot._id,
      new Set(norm.commands.map((c) => `${String(c.type || 'CHAT_INPUT')}:${c.name}`)),
    );
    if (peerErr) {
      return res.status(400).json({ type: 'SlashCommandConflict', error: peerErr });
    }
    bot.slash_commands = norm.commands;
  }
  if (req.body?.remove === 'Token') bot.token = randomToken();
  await bot.save();
  const out = bot.toObject();
  delete out.token;
  const userDoc = await User.findById(bot._id).lean();
  res.json({ ...out, user: userDoc ? { ...userDoc, relationship: 'None', online: false } : undefined });
});

// DELETE /bots/:target
router.delete('/:target', authMiddleware(), async (req, res) => {
  const bot = await Bot.findById(req.params.target);
  if (!bot) return res.status(404).json({ type: 'NotFound', error: 'Bot not found' });
  if (bot.owner !== req.userId) return res.status(403).json({ type: 'Forbidden', error: 'Not owner' });
  await User.findByIdAndDelete(bot._id);
  await bot.deleteOne();
  res.status(204).send();
});

export default router;
