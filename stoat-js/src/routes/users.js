import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { ulid } from 'ulid';
import { User, Channel, Account, Member, Server, GlobalBadge } from '../db/models/index.js';
import { authMiddleware } from '../middleware/auth.js';
import { toPublicUser, normalizeProfileForOutput } from '../publicUser.js';
import { broadcastToUser, broadcastToServer, isUserOnline } from '../events.js';

const router = Router();
const PRESENCE_VALUES = new Set(['Online', 'Idle', 'Busy', 'Invisible']);

function isBotUser(user) {
  const owner = user?.bot?.owner;
  return typeof owner === 'string' && owner.trim().length > 0;
}

function relationshipWith(relations, targetId) {
  if (!relations || !relations.length) return 'None';
  const r = relations.find((x) => x._id === targetId);
  return r ? r.status : 'None';
}

async function setRelationship(userId, targetId, myStatus, theirStatus) {
  const pullNone = (arr) => (arr || []).filter((x) => x._id !== targetId);
  const setOrAdd = (arr, id, status) => {
    const out = pullNone(arr || []);
    if (status !== 'None') out.push({ _id: id, status });
    return out;
  };
  const [me, them] = await Promise.all([User.findById(userId), User.findById(targetId)]);
  if (!me || !them) return;
  me.relations = setOrAdd(me.relations, targetId, myStatus);
  them.relations = setOrAdd(them.relations, userId, theirStatus);
  await Promise.all([me.save(), them.save()]);
}

function normalizeUsername(username) {
  return String(username).toLowerCase().replace(/\s/g, '_').slice(0, 32);
}

function safeTrimString(value, maxLen) {
  if (value == null) return null;
  return String(value).trim().slice(0, maxLen);
}

function parseStatusUpdate(status) {
  if (status == null) return null;
  if (typeof status !== 'object') {
    return { error: 'status must be an object' };
  }
  const out = {};
  if (status.text !== undefined) {
    out.text = safeTrimString(status.text, 128);
  }
  if (status.presence !== undefined) {
    if (!PRESENCE_VALUES.has(status.presence)) {
      return { error: 'status.presence is invalid' };
    }
    out.presence = status.presence;
  }
  return { value: out };
}

function isValidHexColor(v) {
  return /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v);
}

function parseProfileUpdate(profile) {
  if (profile == null) return null;
  if (typeof profile !== 'object') {
    return { error: 'profile must be an object' };
  }
  const out = {};

  if (profile.content !== undefined || profile.bio !== undefined) {
    const bioVal = profile.bio !== undefined ? profile.bio : profile.content;
    out.bio = safeTrimString(bioVal, 300);
    out.content = out.bio; // keep old clients working
  }
  if (profile.background !== undefined) out.background = profile.background ?? null;
  if (profile.banner !== undefined) out.banner = profile.banner ?? null;
  if (profile.pronouns !== undefined) out.pronouns = safeTrimString(profile.pronouns, 40);
  if (profile.accent_color !== undefined) {
    const color = safeTrimString(profile.accent_color, 9);
    if (color && !isValidHexColor(color)) return { error: 'profile.accent_color must be #RRGGBB or #RRGGBBAA' };
    out.accent_color = color;
  }
  if (profile.decoration !== undefined) out.decoration = safeTrimString(profile.decoration, 50);
  if (profile.effect !== undefined) out.effect = safeTrimString(profile.effect, 50);
  if (profile.theme_preset !== undefined) out.theme_preset = safeTrimString(profile.theme_preset, 50);
  if (profile.badges !== undefined) {
    return { error: 'profile.badges are global and cannot be edited here' };
  }
  if (profile.social_links !== undefined) {
    if (!Array.isArray(profile.social_links)) return { error: 'profile.social_links must be an array' };
    const links = profile.social_links.slice(0, 8).map((l) => {
      if (!l || typeof l !== 'object') return null;
      const label = safeTrimString(l.label, 24);
      const url = safeTrimString(l.url, 200);
      if (!url || !/^https?:\/\//i.test(url)) return null;
      return { label: label || 'Link', url };
    }).filter(Boolean);
    out.social_links = links;
  }
  return { value: out };
}

// GET /users/@me
router.get('/@me', authMiddleware(), async (req, res) => {
  res.json(toPublicUser(req.user, { relationship: 'User', online: false }));
});

// PATCH /users/@me
router.patch('/@me', authMiddleware(), async (req, res) => {
  const { username, display_name, avatar, status, profile } = req.body || {};
  const user = await User.findById(req.userId);
  if (!user) return res.status(404).json({ type: 'NotFound', error: 'User not found' });
  if (username != null) user.username = normalizeUsername(username);
  if (display_name != null) user.display_name = safeTrimString(display_name, 48);
  if (avatar != null) user.avatar = avatar;
  let statusUpdated = false;
  if (status != null) {
    const parsedStatus = parseStatusUpdate(status);
    if (parsedStatus?.error) return res.status(400).json({ type: 'FailedValidation', error: parsedStatus.error });
    user.status = { ...(user.status || {}), ...(parsedStatus?.value || {}) };
    statusUpdated = true;
  }
  if (profile != null) {
    const parsedProfile = parseProfileUpdate(profile);
    if (parsedProfile?.error) return res.status(400).json({ type: 'FailedValidation', error: parsedProfile.error });
    user.profile = { ...(user.profile || {}), ...(parsedProfile?.value || {}) };
  }
  await user.save();
  if (statusUpdated) {
    const memberships = await Member.find({ user: req.userId }).select('server').lean();
    const payload = { type: 'PresenceUpdate', d: { user_id: req.userId, status: user.status } };
    for (const { server } of memberships) {
      broadcastToServer(server, payload, req.userId).catch(() => {});
    }
  }
  res.json(toPublicUser(user, { relationship: 'User', online: false }));
});

// PATCH /users/@me/username
router.patch('/@me/username', authMiddleware(), async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || username.length < 2 || username.length > 32) {
    return res.status(400).json({ type: 'FailedValidation', error: 'Invalid username' });
  }
  const account = await Account.findOne({ user_id: req.userId });
  if (!account) return res.status(500).json({ type: 'InternalError', error: 'Account not found' });
  if (password && !(await bcrypt.compare(password, account.password))) {
    return res.status(400).json({ type: 'InvalidCredentials', error: 'Invalid password' });
  }
  const user = await User.findById(req.userId);
  const un = normalizeUsername(username);
  const exists = await User.findOne({ username: un, discriminator: user.discriminator, _id: { $ne: req.userId } });
  if (exists) return res.status(400).json({ type: 'UsernameTaken', error: 'Username taken' });
  user.username = un;
  await user.save();
  res.json(toPublicUser(user, { relationship: 'User', online: false }));
});

// GET /users/servers
router.get('/servers', authMiddleware(), async (req, res) => {
  const memberships = await Member.find({ user: req.userId }).lean();
  const serverIds = memberships.map(m => m.server);
  const servers = await Server.find({ _id: { $in: serverIds } }).lean();
  res.json(servers);
});

// GET /users/dms - include other_user for each DM so the client can show the name
router.get('/dms', authMiddleware(), async (req, res) => {
  const channels = await Channel.find({
    channel_type: 'DirectMessage',
    recipients: req.userId,
  }).lean();
  const out = [];
  for (const ch of channels) {
    const otherId = (ch.recipients || []).find((r) => r !== req.userId);
    let other_user = null;
    if (otherId) {
      const other = await User.findById(otherId).lean();
      if (other) other_user = toPublicUser(other, { relationship: 'None', online: isUserOnline(otherId) });
    }
    out.push({ ...ch, other_user });
  }
  res.json(out);
});

// POST /users/friend - Send friend request
router.post('/friend', authMiddleware(), async (req, res) => {
  const { username } = req.body || {};
  let target = null;
  if (req.body.user_id) {
    target = await User.findById(req.body.user_id);
  } else if (username) {
    const raw = String(username).trim();
    const hashIdx = raw.lastIndexOf('#');
    if (hashIdx >= 0 && /^\d{4}$/.test(raw.slice(hashIdx + 1))) {
      const namePart = raw.slice(0, hashIdx).trim();
      const discPart = raw.slice(hashIdx + 1);
      target = await User.findOne({
        username: namePart.toLowerCase(),
        discriminator: discPart,
      });
    }
    if (!target) {
      target = await User.findOne({ username: raw.toLowerCase() });
    }
  }
  if (!target) return res.status(404).json({ type: 'NotFound', error: 'User not found' });
  const targetId = target._id.toString();
  if (targetId === req.userId) return res.status(400).json({ type: 'NoEffect', error: 'No effect' });
  const me = await User.findById(req.userId);
  const rel = relationshipWith(me.relations, targetId);
  if (isBotUser(me) || isBotUser(target)) return res.status(400).json({ type: 'IsBot', error: 'Is bot' });
  if (rel === 'Friend') return res.status(400).json({ type: 'AlreadyFriends', error: 'Already friends' });
  if (rel === 'Outgoing') return res.status(400).json({ type: 'AlreadySentRequest', error: 'Already sent' });
  if (rel === 'Blocked' || rel === 'BlockedOther') return res.status(400).json({ type: 'Blocked', error: 'Blocked' });
  if (rel === 'Incoming') {
    await setRelationship(req.userId, targetId, 'Friend', 'Friend');
    const updated = await User.findById(targetId).lean();
    return res.json(toPublicUser(updated, { relationship: 'Friend', online: false }));
  }
  await setRelationship(req.userId, targetId, 'Outgoing', 'Incoming');
  const updated = await User.findById(targetId).lean();
  const fromUser = await User.findById(req.userId).select('_id username discriminator display_name avatar badges system_badges status profile bot').lean();
  broadcastToUser(targetId, {
    type: 'FriendRequest',
    d: { from_user: toPublicUser(fromUser, { relationship: 'Outgoing', online: false }) },
  });
  res.json(toPublicUser(updated, { relationship: 'Incoming', online: false }));
});

// GET /users/:target
router.get('/:target', authMiddleware(true), async (req, res) => {
  const user = await User.findById(req.params.target).lean();
  if (!user) return res.status(404).json({ type: 'NotFound', error: 'User not found' });
  const rel = req.user ? relationshipWith(req.user.relations, req.params.target) : 'None';
  res.json(toPublicUser(user, { relationship: rel, online: false }));
});

// GET /users/:target/dm
router.get('/:target/dm', authMiddleware(), async (req, res) => {
  const target = await User.findById(req.params.target);
  if (!target) return res.status(404).json({ type: 'NotFound', error: 'User not found' });
  if (target._id.toString() === req.userId) {
    let saved = await Channel.findOne({ channel_type: 'SavedMessages', user: req.userId });
    if (!saved) {
      saved = await Channel.create({
        _id: ulid(),
        channel_type: 'SavedMessages',
        user: req.userId,
      });
    }
    return res.json(saved.toObject());
  }
  let dm = await Channel.findOne({
    channel_type: 'DirectMessage',
    recipients: { $all: [req.userId, req.params.target].sort() },
  });
  if (!dm) {
    dm = await Channel.create({
      _id: ulid(),
      channel_type: 'DirectMessage',
      active: true,
      recipients: [req.userId, req.params.target].sort(),
    });
  }
  res.json(dm.toObject());
});

// GET /users/:target/profile
router.get('/:target/profile', authMiddleware(), async (req, res) => {
  const target = await User.findById(req.params.target).lean();
  if (!target) return res.status(404).json({ type: 'NotFound', error: 'User not found' });
  if (req.params.target === req.userId) {
    return res.json(normalizeProfileForOutput(target.profile));
  }
  res.json(normalizeProfileForOutput(target.profile));
});

// PATCH /users/:target/system-badges
// Global badges are staff-managed only (not server-scoped, not self-editable).
router.patch('/:target/system-badges', authMiddleware(), async (req, res) => {
  if (!req.user?.privileged) {
    return res.status(403).json({ type: 'Forbidden', error: 'Only app staff can manage global badges' });
  }
  const { badges } = req.body || {};
  if (!Array.isArray(badges)) {
    return res.status(400).json({ type: 'FailedValidation', error: 'badges must be an array' });
  }

  const normalized = [...new Set(
    badges
      .map((b) => safeTrimString(String(b).toLowerCase(), 40))
      .filter(Boolean)
  )];
  const existing = await GlobalBadge.find({ _id: { $in: normalized } }).select('_id').lean();
  const existingIds = new Set((existing || []).map((b) => b._id));
  const invalid = normalized.filter((b) => !existingIds.has(b));
  if (invalid.length > 0) {
    return res.status(400).json({
      type: 'FailedValidation',
      error: `Unsupported badge(s): ${invalid.join(', ')}`,
    });
  }

  const target = await User.findById(req.params.target);
  if (!target) return res.status(404).json({ type: 'NotFound', error: 'User not found' });
  target.system_badges = normalized;
  await target.save();

  const relationship = relationshipWith(req.user?.relations, req.params.target);
  res.json(toPublicUser(target, { relationship, online: false }));
});

// GET /users/:target/flags
router.get('/:target/flags', authMiddleware(), async (req, res) => {
  const user = await User.findById(req.params.target).lean();
  if (!user) return res.status(404).json({ type: 'NotFound', error: 'User not found' });
  res.json({ flags: user.flags ?? 0 });
});

// GET /users/:target/mutual
router.get('/:target/mutual', authMiddleware(), async (req, res) => {
  if (req.params.target === req.userId) {
    return res.status(400).json({ type: 'InvalidOperation', error: 'Invalid operation' });
  }
  const target = await User.findById(req.params.target);
  if (!target) return res.status(404).json({ type: 'NotFound', error: 'User not found' });
  const myFriends = (req.user.relations || []).filter((r) => r.status === 'Friend').map((r) => r._id);
  const theirFriends = (target.relations || []).filter((r) => r.status === 'Friend').map((r) => r._id);
  const users = [...new Set(myFriends.filter((id) => theirFriends.includes(id)))];
  const myServers = await Member.find({ user: req.userId }).distinct('server');
  const theirServers = await Member.find({ user: req.params.target }).distinct('server');
  const servers = [...new Set(myServers.filter((s) => theirServers.includes(s)))];
  const myChannels = await Channel.find({
    channel_type: 'Group',
    recipients: req.userId,
  }).distinct('_id');
  const theirChannels = await Channel.find({
    channel_type: 'Group',
    recipients: req.params.target,
  }).distinct('_id');
  const channels = [...new Set(myChannels.filter((c) => theirChannels.includes(c.toString())))];
  res.json({ users, servers, channels });
});

// GET /users/:target/default_avatar
router.get('/:target/default_avatar', (req, res) => {
  const id = req.params.target;
  res.redirect(302, `https://api.revolt.chat/users/${id}/default_avatar`);
});

// PUT /users/:target/friend - Accept friend request
router.put('/:target/friend', authMiddleware(), async (req, res) => {
  const target = await User.findById(req.params.target);
  if (!target) return res.status(404).json({ type: 'NotFound', error: 'User not found' });
  const targetId = target._id.toString();
  if (targetId === req.userId) return res.status(400).json({ type: 'NoEffect', error: 'No effect' });
  const me = await User.findById(req.userId);
  const rel = relationshipWith(me.relations, targetId);
  if (isBotUser(me) || isBotUser(target)) return res.status(400).json({ type: 'IsBot', error: 'Is bot' });
  if (rel !== 'Incoming') {
    return res.status(400).json({ type: 'NoEffect', error: 'No effect' });
  }
  await setRelationship(req.userId, targetId, 'Friend', 'Friend');
  const updated = await User.findById(targetId).lean();
  res.json(toPublicUser(updated, { relationship: 'Friend', online: false }));
});

// DELETE /users/:target/friend
router.delete('/:target/friend', authMiddleware(), async (req, res) => {
  const target = await User.findById(req.params.target);
  if (!target) return res.status(404).json({ type: 'NotFound', error: 'User not found' });
  const targetId = target._id.toString();
  const me = await User.findById(req.userId);
  const rel = relationshipWith(me.relations, targetId);
  if (rel !== 'Friend' && rel !== 'Outgoing' && rel !== 'Incoming') {
    return res.status(400).json({ type: 'NoEffect', error: 'No effect' });
  }
  await setRelationship(req.userId, targetId, 'None', 'None');
  res.status(204).send();
});

// PUT /users/:target/block
router.put('/:target/block', authMiddleware(), async (req, res) => {
  const target = await User.findById(req.params.target);
  if (!target) return res.status(404).json({ type: 'NotFound', error: 'User not found' });
  const targetId = target._id.toString();
  if (targetId === req.userId) return res.status(400).json({ type: 'NoEffect', error: 'No effect' });
  const me = await User.findById(req.userId);
  const rel = relationshipWith(me.relations, targetId);
  if (rel === 'Blocked') return res.status(400).json({ type: 'NoEffect', error: 'No effect' });
  if (rel === 'BlockedOther') return res.status(400).json({ type: 'BlockedByOther', error: 'Blocked by other' });
  await setRelationship(req.userId, targetId, 'Blocked', 'BlockedOther');
  res.status(204).send();
});

// DELETE /users/:target/block
router.delete('/:target/block', authMiddleware(), async (req, res) => {
  const target = await User.findById(req.params.target);
  if (!target) return res.status(404).json({ type: 'NotFound', error: 'User not found' });
  const targetId = target._id.toString();
  const me = await User.findById(req.userId);
  const rel = relationshipWith(me.relations, targetId);
  if (rel !== 'Blocked' && rel !== 'BlockedOther') return res.status(400).json({ type: 'NoEffect', error: 'No effect' });
  const theirRel = relationshipWith(target.relations, req.userId);
  if (rel === 'Blocked' && theirRel === 'Blocked') {
    await setRelationship(req.userId, targetId, 'BlockedOther', 'Blocked');
  } else {
    await setRelationship(req.userId, targetId, 'None', 'None');
  }
  res.status(204).send();
});

// PATCH /users/:target - Edit user (only self for now)
router.patch('/:target', authMiddleware(), async (req, res) => {
  if (req.params.target !== req.userId) {
    return res.status(403).json({ type: 'Forbidden', error: 'Can only edit self' });
  }
  const { display_name, avatar, status, profile } = req.body || {};
  const user = await User.findById(req.userId);
  if (!user) return res.status(404).json({ type: 'NotFound', error: 'User not found' });
  if (display_name != null) user.display_name = safeTrimString(display_name, 48);
  if (avatar != null) user.avatar = avatar;
  if (status != null) {
    const parsedStatus = parseStatusUpdate(status);
    if (parsedStatus?.error) return res.status(400).json({ type: 'FailedValidation', error: parsedStatus.error });
    user.status = { ...(user.status || {}), ...(parsedStatus?.value || {}) };
  }
  if (profile != null) {
    const parsedProfile = parseProfileUpdate(profile);
    if (parsedProfile?.error) return res.status(400).json({ type: 'FailedValidation', error: parsedProfile.error });
    user.profile = { ...(user.profile || {}), ...(parsedProfile?.value || {}) };
  }
  await user.save();
  res.json(toPublicUser(user, { relationship: 'User', online: false }));
});

export default router;
