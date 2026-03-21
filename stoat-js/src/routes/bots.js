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
      new Set(norm.commands.map((c) => c.name)),
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
