import { Router } from 'express';
import { ulid } from 'ulid';
import { Server, Channel, Member, User, Invite, ServerBan, Emoji, AuditLog, Message } from '../db/models/index.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  Permissions, DEFAULT_EVERYONE_PERMS, ALL_PERMISSIONS,
  computeServerPermissions, hasPermission, outranks, canManageRole, sameId,
  coerceConsistentServerPermissions,
} from '../permissions.js';
import { broadcastToServer, broadcastToUser, isUserOnlineDisplay } from '../events.js';
import { toPublicUser } from '../publicUser.js';

const router = Router();

function isBotUser(user) {
  const owner = user?.bot?.owner;
  return typeof owner === 'string' && owner.trim().length > 0;
}

async function getServerAndMember(req, res) {
  const server = await Server.findById(req.params.target);
  if (!server) { res.status(404).json({ type: 'NotFound', error: 'Server not found' }); return null; }
  const member = await Member.findOne({ server: server._id, user: req.userId });
  if (!member) { res.status(403).json({ type: 'Forbidden', error: 'Not a member' }); return null; }
  const perms = computeServerPermissions(server, member);
  return { server, member, perms };
}

function sanitizeWordList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((w) => String(w || '').trim().toLowerCase())
    .filter(Boolean)
    .map((w) => w.slice(0, 50)))]
    .slice(0, 120);
}

function normalizeAutomodInput(base = {}, input = {}) {
  const current = typeof base === 'object' && base ? base : {};
  const src = typeof input === 'object' && input ? input : {};
  return {
    enabled: src.enabled != null ? !!src.enabled : !!current.enabled,
    blocked_words: src.blocked_words !== undefined
      ? sanitizeWordList(src.blocked_words)
      : sanitizeWordList(current.blocked_words || []),
    block_invites: src.block_invites != null ? !!src.block_invites : !!current.block_invites,
    max_mentions: Math.max(0, Math.min(30, Number(
      src.max_mentions != null ? src.max_mentions : (current.max_mentions || 0),
    ) || 0)),
  };
}

function eventCounts(event) {
  return {
    yes: Array.isArray(event?.rsvp_yes) ? event.rsvp_yes.length : 0,
    no: Array.isArray(event?.rsvp_no) ? event.rsvp_no.length : 0,
    maybe: Array.isArray(event?.rsvp_maybe) ? event.rsvp_maybe.length : 0,
  };
}

function getUserRsvpStatus(event, userId) {
  if (Array.isArray(event?.rsvp_yes) && event.rsvp_yes.includes(userId)) return 'yes';
  if (Array.isArray(event?.rsvp_no) && event.rsvp_no.includes(userId)) return 'no';
  if (Array.isArray(event?.rsvp_maybe) && event.rsvp_maybe.includes(userId)) return 'maybe';
  return 'none';
}

function normalizeEventDto(event, userId) {
  const counts = eventCounts(event);
  return {
    _id: event._id,
    title: event.title,
    description: event.description || '',
    location: event.location || '',
    channel_id: event.channel_id || null,
    starts_at: event.starts_at,
    ends_at: event.ends_at || null,
    creator: event.creator,
    created_at: event.created_at,
    updated_at: event.updated_at,
    rsvp: {
      counts,
      me: getUserRsvpStatus(event, userId),
    },
  };
}

// POST /servers/create
router.post('/create', authMiddleware(), async (req, res) => {
  const { name, description } = req.body || {};
  if (!name) return res.status(400).json({ type: 'InvalidPayload', error: 'Name required' });
  const serverId = ulid();
  const channelId = ulid();
  await Server.create({
    _id: serverId,
    owner: req.userId,
    name: String(name).slice(0, 32),
    description: description || undefined,
    channels: [channelId],
    default_permissions: DEFAULT_EVERYONE_PERMS,
  });
  await Channel.create({
    _id: channelId,
    channel_type: 'TextChannel',
    server: serverId,
    name: 'general',
  });
  await Member.create({
    _id: ulid(),
    server: serverId,
    user: req.userId,
    roles: [],
  });
  const server = await Server.findById(serverId).lean();
  const channel = await Channel.findById(channelId).lean();
  res.status(201).json({
    server: { ...server, channels: server.channels.map((id) => (id === channelId ? { ...channel } : id)) },
    channels: [channel],
  });
});

// GET /servers/:target
router.get('/:target', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  const channels = await Channel.find({ _id: { $in: ctx.server.channels } }).lean();
  res.json({
    ...ctx.server.toObject(),
    channels: ctx.server.channels.map((id) => channels.find((c) => c._id === id) || id),
  });
});

// GET /servers/:target/automod
router.get('/:target/automod', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  const automod = normalizeAutomodInput(ctx.server.automod, {});
  res.json(automod);
});

// PATCH /servers/:target/automod
router.patch('/:target/automod', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  if (!hasPermission(ctx.perms, Permissions.MANAGE_SERVER)) {
    return res.status(403).json({ type: 'Forbidden', error: 'Missing MANAGE_SERVER permission' });
  }
  const automod = normalizeAutomodInput(ctx.server.automod, req.body || {});
  ctx.server.automod = automod;
  ctx.server.word_filter = automod.blocked_words;
  ctx.server.markModified('automod');
  await ctx.server.save();
  res.json(automod);
});

// GET /servers/:target/events
router.get('/:target/events', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  const mode = String(req.query.mode || 'upcoming').toLowerCase();
  const now = Date.now();
  const allEvents = Array.isArray(ctx.server.events) ? ctx.server.events : [];
  const filtered = allEvents.filter((ev) => {
    if (mode === 'all') return true;
    const startsAt = new Date(ev.starts_at).getTime();
    const endsAt = ev.ends_at ? new Date(ev.ends_at).getTime() : startsAt;
    return endsAt >= now;
  });
  filtered.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  res.json(filtered.map((event) => normalizeEventDto(event, req.userId)));
});

// POST /servers/:target/events
router.post('/:target/events', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  if (!hasPermission(ctx.perms, Permissions.MANAGE_SERVER)) {
    return res.status(403).json({ type: 'Forbidden', error: 'Missing MANAGE_SERVER permission' });
  }
  const title = String(req.body?.title || '').trim().slice(0, 120);
  const startsAtRaw = req.body?.starts_at;
  if (!title) return res.status(400).json({ type: 'InvalidPayload', error: 'title required' });
  if (!startsAtRaw) return res.status(400).json({ type: 'InvalidPayload', error: 'starts_at required' });
  const startsAt = new Date(startsAtRaw);
  if (Number.isNaN(startsAt.getTime())) {
    return res.status(400).json({ type: 'InvalidPayload', error: 'starts_at must be a valid date' });
  }
  const endsAtRaw = req.body?.ends_at;
  const endsAt = endsAtRaw ? new Date(endsAtRaw) : null;
  if (endsAtRaw && Number.isNaN(endsAt.getTime())) {
    return res.status(400).json({ type: 'InvalidPayload', error: 'ends_at must be a valid date' });
  }
  if (endsAt && endsAt.getTime() < startsAt.getTime()) {
    return res.status(400).json({ type: 'InvalidPayload', error: 'ends_at must be >= starts_at' });
  }

  const event = {
    _id: ulid(),
    title,
    description: String(req.body?.description || '').slice(0, 2000),
    location: String(req.body?.location || '').slice(0, 120),
    channel_id: req.body?.channel_id ? String(req.body.channel_id) : null,
    starts_at: startsAt,
    ends_at: endsAt || null,
    creator: req.userId,
    rsvp_yes: [],
    rsvp_no: [],
    rsvp_maybe: [],
    created_at: new Date(),
    updated_at: new Date(),
  };
  ctx.server.events = Array.isArray(ctx.server.events) ? ctx.server.events : [];
  ctx.server.events.push(event);
  ctx.server.markModified('events');
  await ctx.server.save();
  res.status(201).json(normalizeEventDto(event, req.userId));
});

// PATCH /servers/:target/events/:event_id
router.patch('/:target/events/:event_id', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  if (!hasPermission(ctx.perms, Permissions.MANAGE_SERVER)) {
    return res.status(403).json({ type: 'Forbidden', error: 'Missing MANAGE_SERVER permission' });
  }
  const events = Array.isArray(ctx.server.events) ? ctx.server.events : [];
  const idx = events.findIndex((ev) => String(ev._id) === String(req.params.event_id));
  if (idx < 0) return res.status(404).json({ type: 'NotFound', error: 'Event not found' });
  const event = events[idx];

  if (req.body?.title != null) event.title = String(req.body.title).trim().slice(0, 120);
  if (req.body?.description != null) event.description = String(req.body.description).slice(0, 2000);
  if (req.body?.location != null) event.location = String(req.body.location).slice(0, 120);
  if (req.body?.channel_id !== undefined) event.channel_id = req.body.channel_id ? String(req.body.channel_id) : null;
  if (req.body?.starts_at != null) {
    const parsed = new Date(req.body.starts_at);
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({ type: 'InvalidPayload', error: 'starts_at must be a valid date' });
    }
    event.starts_at = parsed;
  }
  if (req.body?.ends_at !== undefined) {
    if (req.body.ends_at == null || req.body.ends_at === '') {
      event.ends_at = null;
    } else {
      const parsedEnd = new Date(req.body.ends_at);
      if (Number.isNaN(parsedEnd.getTime())) {
        return res.status(400).json({ type: 'InvalidPayload', error: 'ends_at must be a valid date' });
      }
      event.ends_at = parsedEnd;
    }
  }
  if (event.ends_at && new Date(event.ends_at).getTime() < new Date(event.starts_at).getTime()) {
    return res.status(400).json({ type: 'InvalidPayload', error: 'ends_at must be >= starts_at' });
  }
  event.updated_at = new Date();
  ctx.server.markModified('events');
  await ctx.server.save();
  res.json(normalizeEventDto(event, req.userId));
});

// DELETE /servers/:target/events/:event_id
router.delete('/:target/events/:event_id', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  if (!hasPermission(ctx.perms, Permissions.MANAGE_SERVER)) {
    return res.status(403).json({ type: 'Forbidden', error: 'Missing MANAGE_SERVER permission' });
  }
  const events = Array.isArray(ctx.server.events) ? ctx.server.events : [];
  const next = events.filter((ev) => String(ev._id) !== String(req.params.event_id));
  if (next.length === events.length) return res.status(404).json({ type: 'NotFound', error: 'Event not found' });
  ctx.server.events = next;
  ctx.server.markModified('events');
  await ctx.server.save();
  res.status(204).send();
});

// PUT /servers/:target/events/:event_id/rsvp
router.put('/:target/events/:event_id/rsvp', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  const events = Array.isArray(ctx.server.events) ? ctx.server.events : [];
  const idx = events.findIndex((ev) => String(ev._id) === String(req.params.event_id));
  if (idx < 0) return res.status(404).json({ type: 'NotFound', error: 'Event not found' });
  const status = String(req.body?.status || '').toLowerCase();
  if (!['yes', 'no', 'maybe', 'none'].includes(status)) {
    return res.status(400).json({ type: 'InvalidPayload', error: 'status must be yes, no, maybe, or none' });
  }
  const event = events[idx];
  const uid = req.userId;
  event.rsvp_yes = (event.rsvp_yes || []).filter((id) => id !== uid);
  event.rsvp_no = (event.rsvp_no || []).filter((id) => id !== uid);
  event.rsvp_maybe = (event.rsvp_maybe || []).filter((id) => id !== uid);
  if (status === 'yes') event.rsvp_yes.push(uid);
  if (status === 'no') event.rsvp_no.push(uid);
  if (status === 'maybe') event.rsvp_maybe.push(uid);
  event.updated_at = new Date();
  ctx.server.markModified('events');
  await ctx.server.save();
  res.json(normalizeEventDto(event, req.userId));
});

// PATCH /servers/:target
router.patch('/:target', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  if (!hasPermission(ctx.perms, Permissions.MANAGE_SERVER)) {
    return res.status(403).json({ type: 'Forbidden', error: 'Missing MANAGE_SERVER permission' });
  }
  const {
    name, description, icon, banner, default_permissions, locked, word_filter, automod,
  } = req.body || {};
  if (name != null) ctx.server.name = String(name).slice(0, 32);
  if (description != null) ctx.server.description = description;
  if (icon != null) ctx.server.icon = icon;
  if (banner != null) ctx.server.banner = banner;
  if (default_permissions != null && sameId(ctx.server.owner, req.userId)) {
    ctx.server.default_permissions = coerceConsistentServerPermissions(default_permissions);
  }
  if (locked != null && sameId(ctx.server.owner, req.userId)) {
    ctx.server.locked = !!locked;
  }
  if (word_filter !== undefined) {
    const cleaned = sanitizeWordList(word_filter);
    ctx.server.word_filter = cleaned;
    ctx.server.automod = normalizeAutomodInput(ctx.server.automod, { blocked_words: cleaned });
    ctx.server.markModified('automod');
  }
  if (automod !== undefined) {
    const next = normalizeAutomodInput(ctx.server.automod, automod);
    ctx.server.automod = next;
    ctx.server.word_filter = next.blocked_words;
    ctx.server.markModified('automod');
  }
  await ctx.server.save();
  res.json(ctx.server.toObject());
});

// POST /servers/:target/transfer-ownership
router.post('/:target/transfer-ownership', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  if (!sameId(ctx.server.owner, req.userId)) {
    return res.status(403).json({ type: 'Forbidden', error: 'Only the server owner can transfer ownership' });
  }
  const newOwnerId = req.body?.user_id;
  if (!newOwnerId || typeof newOwnerId !== 'string') {
    return res.status(400).json({ type: 'InvalidPayload', error: 'user_id required' });
  }
  if (sameId(newOwnerId, req.userId)) {
    return res.status(400).json({ type: 'InvalidOperation', error: 'Pick another member to receive ownership' });
  }
  const targetMember = await Member.findOne({ server: ctx.server._id, user: newOwnerId });
  if (!targetMember) {
    return res.status(400).json({ type: 'InvalidOperation', error: 'New owner must be a member of this server' });
  }
  const newOwnerUser = await User.findById(newOwnerId).lean();
  if (!newOwnerUser) {
    return res.status(404).json({ type: 'NotFound', error: 'User not found' });
  }
  if (isBotUser(newOwnerUser)) {
    return res.status(400).json({ type: 'InvalidOperation', error: 'Cannot transfer ownership to a bot account' });
  }
  ctx.server.owner = newOwnerId;
  await ctx.server.save();
  broadcastToServer(ctx.server._id, {
    type: 'ServerOwnerChange',
    data: { serverId: ctx.server._id, owner_id: newOwnerId },
  });
  const channels = await Channel.find({ _id: { $in: ctx.server.channels } }).lean();
  res.json({
    ...ctx.server.toObject(),
    channels: ctx.server.channels.map((id) => channels.find((c) => c._id === id) || id),
  });
});

// DELETE /servers/:target
router.delete('/:target', authMiddleware(), async (req, res) => {
  const server = await Server.findById(req.params.target);
  if (!server) return res.status(404).json({ type: 'NotFound', error: 'Server not found' });
  if (!sameId(server.owner, req.userId)) return res.status(403).json({ type: 'Forbidden', error: 'Only owner can delete' });
  await Channel.deleteMany({ server: server._id });
  await Member.deleteMany({ server: server._id });
  await ServerBan.deleteMany({ server: server._id });
  await server.deleteOne();
  res.status(204).send();
});

// PUT /servers/:target/ack
router.put('/:target/ack', authMiddleware(), async (req, res) => {
  const member = await Member.findOne({ server: req.params.target, user: req.userId });
  if (!member) return res.status(404).json({ type: 'NotFound', error: 'Not a member' });
  res.status(204).send();
});

// GET /servers/:target/members
router.get('/:target/members', authMiddleware(), async (req, res) => {
  const members = await Member.find({ server: req.params.target }).lean();
  const userIds = members.map((m) => m.user).filter(Boolean);
  const users = await User.find({ _id: { $in: userIds } }).lean();
  const byId = Object.fromEntries(users.map((u) => [u._id, u]));
  res.json(
    members.map((m) => ({
      _id: m._id,
      server: m.server,
      user: byId[m.user] ? toPublicUser(byId[m.user], { relationship: 'None', online: isUserOnlineDisplay(m.user, byId[m.user]) }) : m.user,
      nickname: m.nickname,
      avatar: m.avatar,
      roles: m.roles,
      joined_at: m.joined_at,
    }))
  );
});

// GET /servers/:target/members/:member
router.get('/:target/members/:member', authMiddleware(), async (req, res) => {
  const m = await Member.findOne({ server: req.params.target, _id: req.params.member }).lean();
  if (!m) return res.status(404).json({ type: 'NotFound', error: 'Member not found' });
  const user = await User.findById(m.user).lean();
  res.json({ ...m, user: user ? toPublicUser(user, { relationship: 'None', online: isUserOnlineDisplay(m.user, user) }) : m.user });
});

// PATCH /servers/:server/members/:member
router.patch('/:target/members/:member', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  const targetMember = await Member.findOne({ server: ctx.server._id, _id: req.params.member });
  if (!targetMember) return res.status(404).json({ type: 'NotFound', error: 'Member not found' });

  const isSelf = sameId(targetMember.user, req.userId);
  const isOwner = sameId(ctx.server.owner, req.userId);
  const { nickname, roles } = req.body || {};

  // Nickname: self can always change own, MANAGE_NICKNAMES for others
  if (nickname !== undefined) {
    if (isSelf) {
      if (!hasPermission(ctx.perms, Permissions.CHANGE_NICKNAME) && !isOwner) {
        return res.status(403).json({ type: 'Forbidden', error: 'Missing CHANGE_NICKNAME permission' });
      }
      targetMember.nickname = nickname;
    } else {
      if (!hasPermission(ctx.perms, Permissions.MANAGE_NICKNAMES)) {
        return res.status(403).json({ type: 'Forbidden', error: 'Missing MANAGE_NICKNAMES permission' });
      }
      if (!outranks(ctx.server, ctx.member, targetMember) && !isOwner) {
        return res.status(403).json({ type: 'Forbidden', error: 'Cannot manage higher-ranked member' });
      }
      targetMember.nickname = nickname;
    }
  }

  // Roles: need MANAGE_ROLES, can only assign roles below own highest
  if (roles !== undefined) {
    if (!hasPermission(ctx.perms, Permissions.MANAGE_ROLES) && !isOwner) {
      return res.status(403).json({ type: 'Forbidden', error: 'Missing MANAGE_ROLES permission' });
    }
    if (!isOwner && !isSelf) {
      if (!outranks(ctx.server, ctx.member, targetMember)) {
        return res.status(403).json({ type: 'Forbidden', error: 'Cannot manage higher-ranked member' });
      }
    }
    const newRoles = Array.isArray(roles) ? roles : [];
    // Non-owners can only assign roles they can manage (below their own rank)
    if (!isOwner) {
      for (const rId of newRoles) {
        if (!canManageRole(ctx.server, ctx.member, rId)) {
          return res.status(403).json({ type: 'Forbidden', error: `Cannot assign role above your rank` });
        }
      }
    }
    targetMember.roles = newRoles;
  }

  await targetMember.save();
  res.json(targetMember.toObject());
});

// DELETE /servers/:target/members/:member
router.delete('/:target/members/:member', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  const targetMember = await Member.findOne({ _id: req.params.member, server: ctx.server._id });
  if (!targetMember) return res.status(404).json({ type: 'NotFound', error: 'Member not found' });

  const isSelf = sameId(targetMember.user, req.userId);
  if (sameId(targetMember.user, ctx.server.owner)) {
    return res.status(400).json({ type: 'InvalidOperation', error: 'Cannot remove owner' });
  }

  const actorIsOwner = sameId(ctx.server.owner, req.userId);
  if (!isSelf) {
    if (!actorIsOwner && !hasPermission(ctx.perms, Permissions.KICK_MEMBERS)) {
      return res.status(403).json({
        type: 'Forbidden',
        error: 'You need the Kick Members permission (or Administrator) to remove other members.',
        code: 'MISSING_KICK_MEMBERS',
      });
    }
    if (!actorIsOwner && !outranks(ctx.server, ctx.member, targetMember)) {
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

// GET /servers/:target/members_experimental_query
router.get('/:target/members_experimental_query', authMiddleware(), async (req, res) => {
  const members = await Member.find({ server: req.params.target }).lean();
  const userIds = members.map((m) => m.user);
  const users = await User.find({ _id: { $in: userIds } }).lean();
  const byId = Object.fromEntries(users.map((u) => [u._id, u]));
  res.json({
    members: members.map((m) => ({
      ...m,
      user: byId[m.user] ? toPublicUser(byId[m.user], { relationship: 'None', online: isUserOnlineDisplay(m.user, byId[m.user]) }) : m.user,
    })),
    users: Object.values(byId).map((u) => toPublicUser(u, { relationship: 'None', online: isUserOnlineDisplay(u._id, u) })),
  });
});

// GET /servers/:target/roles/:role_id
router.get('/:target/roles/:role_id', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  const roles = ctx.server.roles && typeof ctx.server.roles.toObject === 'function'
    ? ctx.server.roles.toObject() : (ctx.server.roles || {});
  const role = roles[req.params.role_id];
  if (!role) return res.status(404).json({ type: 'NotFound', error: 'Role not found' });
  res.json(role);
});

// POST /servers/:target/roles
router.post('/:target/roles', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  if (!hasPermission(ctx.perms, Permissions.MANAGE_ROLES)) {
    return res.status(403).json({ type: 'Forbidden', error: 'Missing MANAGE_ROLES permission' });
  }
  const { name, colour, hoist, rank, permissions } = req.body || {};
  const roleId = ulid();
  ctx.server.roles = ctx.server.roles || {};
  ctx.server.roles[roleId] = {
    _id: roleId,
    name: (name || 'role').slice(0, 32),
    colour: colour || null,
    hoist: !!hoist,
    rank: rank ?? 0,
    permissions: coerceConsistentServerPermissions(typeof permissions === 'number' ? permissions : 0),
  };
  ctx.server.markModified('roles');
  await ctx.server.save();
  res.status(201).json(ctx.server.roles[roleId]);
});

// PATCH /servers/:target/roles/:role_id
router.patch('/:target/roles/:role_id', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  if (!hasPermission(ctx.perms, Permissions.MANAGE_ROLES)) {
    return res.status(403).json({ type: 'Forbidden', error: 'Missing MANAGE_ROLES permission' });
  }

  // Handle /roles/ranks even if this param route is matched first.
  if (req.params.role_id === 'ranks') {
    const roleRanks = req.body?.roles || {};
    ctx.server.roles = ctx.server.roles || {};
    for (const [id, rank] of Object.entries(roleRanks)) {
      if (ctx.server.roles[id]) ctx.server.roles[id].rank = rank;
    }
    ctx.server.markModified('roles');
    await ctx.server.save();
    return res.status(204).send();
  }

  const roleId = req.params.role_id;
  ctx.server.roles = ctx.server.roles || {};
  if (!ctx.server.roles[roleId]) return res.status(404).json({ type: 'NotFound', error: 'Role not found' });

  // Hierarchy: can only edit roles below your rank (owner bypasses)
  if (ctx.server.owner !== req.userId && !canManageRole(ctx.server, ctx.member, roleId)) {
    return res.status(403).json({ type: 'Forbidden', error: 'Cannot manage role above your rank' });
  }

  const { name, colour, hoist, rank, permissions } = req.body || {};
  if (name != null) ctx.server.roles[roleId].name = String(name).slice(0, 32);
  if (colour != null) ctx.server.roles[roleId].colour = colour;
  if (hoist != null) ctx.server.roles[roleId].hoist = !!hoist;
  if (rank != null) ctx.server.roles[roleId].rank = rank;
  if (permissions != null) ctx.server.roles[roleId].permissions = coerceConsistentServerPermissions(permissions);
  ctx.server.markModified('roles');
  await ctx.server.save();
  res.json(ctx.server.roles[roleId]);
});

// DELETE /servers/:target/roles/:role_id
router.delete('/:target/roles/:role_id', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  if (!hasPermission(ctx.perms, Permissions.MANAGE_ROLES)) {
    return res.status(403).json({ type: 'Forbidden', error: 'Missing MANAGE_ROLES permission' });
  }
  if (ctx.server.owner !== req.userId && !canManageRole(ctx.server, ctx.member, req.params.role_id)) {
    return res.status(403).json({ type: 'Forbidden', error: 'Cannot delete role above your rank' });
  }
  ctx.server.roles = ctx.server.roles || {};
  delete ctx.server.roles[req.params.role_id];
  ctx.server.markModified('roles');
  await ctx.server.save();
  res.status(204).send();
});

// PATCH /servers/:target/roles/ranks
router.patch('/:target/roles/ranks', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  if (!hasPermission(ctx.perms, Permissions.MANAGE_ROLES)) {
    return res.status(403).json({ type: 'Forbidden', error: 'Missing MANAGE_ROLES permission' });
  }
  const roles = req.body?.roles || {};
  ctx.server.roles = ctx.server.roles || {};
  for (const [id, rank] of Object.entries(roles)) {
    if (ctx.server.roles[id]) ctx.server.roles[id].rank = rank;
  }
  ctx.server.markModified('roles');
  await ctx.server.save();
  res.status(204).send();
});

// PUT /servers/:target/permissions/default
router.put('/:target/permissions/default', authMiddleware(), async (req, res) => {
  const server = await Server.findById(req.params.target);
  if (!server) return res.status(404).json({ type: 'NotFound', error: 'Server not found' });
  if (server.owner !== req.userId) return res.status(403).json({ type: 'Forbidden', error: 'Only owner' });
  const { permissions } = req.body || {};
  if (permissions != null) server.default_permissions = coerceConsistentServerPermissions(permissions);
  await server.save();
  res.status(204).send();
});

// PUT /servers/:target/permissions/:role_id
router.put('/:target/permissions/:role_id', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  if (!hasPermission(ctx.perms, Permissions.MANAGE_ROLES)) {
    return res.status(403).json({ type: 'Forbidden', error: 'Missing MANAGE_ROLES permission' });
  }
  ctx.server.roles = ctx.server.roles || {};
  const role = ctx.server.roles[req.params.role_id];
  if (!role) return res.status(404).json({ type: 'NotFound', error: 'Role not found' });
  if (req.body?.permissions != null) role.permissions = coerceConsistentServerPermissions(req.body.permissions);
  ctx.server.markModified('roles');
  await ctx.server.save();
  res.status(204).send();
});

// GET /servers/:target/bans
router.get('/:target/bans', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  if (!sameId(ctx.server.owner, req.userId) && !hasPermission(ctx.perms, Permissions.BAN_MEMBERS)) {
    return res.status(403).json({
      type: 'Forbidden',
      error: 'You need the Ban Members permission (or Administrator) to view bans.',
      code: 'MISSING_BAN_MEMBERS',
    });
  }
  const bans = await ServerBan.find({ server: ctx.server._id }).populate('user', '_id username discriminator').lean();
  res.json({ bans: bans.map((b) => ({ ...b, user: b.user })) });
});

// PUT /servers/:server/bans/:target
router.put('/:target/bans/:user', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  const actorIsOwner = sameId(ctx.server.owner, req.userId);
  if (!actorIsOwner && !hasPermission(ctx.perms, Permissions.BAN_MEMBERS)) {
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
    if (!actorIsOwner && !outranks(ctx.server, ctx.member, targetMember)) {
      return res.status(403).json({
        type: 'Forbidden',
        error: 'You cannot ban a member whose highest role is above or equal to yours.',
        code: 'ROLE_HIERARCHY',
      });
    }
  }
  const { reason } = req.body || {};
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

// DELETE /servers/:server/bans/:target
router.delete('/:target/bans/:user', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  const actorIsOwner = sameId(ctx.server.owner, req.userId);
  if (!actorIsOwner && !hasPermission(ctx.perms, Permissions.BAN_MEMBERS)) {
    return res.status(403).json({
      type: 'Forbidden',
      error: 'You need the Ban Members permission (or Administrator) to unban members.',
      code: 'MISSING_BAN_MEMBERS',
    });
  }
  await ServerBan.deleteOne({ server: ctx.server._id, user: req.params.user });
  res.status(204).send();
});

// GET /servers/:target/invites
router.get('/:target/invites', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  const invites = await Invite.find({ server: ctx.server._id }).populate('creator', '_id username').lean();
  res.json(invites);
});

// GET /servers/:target/emojis
router.get('/:target/emojis', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  const emojis = await Emoji.find({ 'parent.id': ctx.server._id }).lean();
  res.json(emojis);
});

// POST /servers/:target/emojis - upload custom emoji
router.post('/:target/emojis', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  if (!hasPermission(ctx.perms, Permissions.MANAGE_SERVER)) {
    return res.status(403).json({ type: 'Forbidden', error: 'Missing MANAGE_SERVER permission' });
  }
  const existingCount = await Emoji.countDocuments({ 'parent.id': ctx.server._id });
  if (existingCount >= 250) {
    return res.status(400).json({ type: 'MaxEmojis', error: 'Server has reached the emoji limit (250)' });
  }
  const { name, file_id, url, animated } = req.body || {};
  if (!name) return res.status(400).json({ type: 'InvalidPayload', error: 'Name required' });
  if (!url && !file_id) return res.status(400).json({ type: 'InvalidPayload', error: 'File required' });
  const emojiId = ulid();
  const emoji = await Emoji.create({
    _id: emojiId,
    creator_id: req.userId,
    name: String(name).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32) || 'emoji',
    parent: { type: 'Server', id: ctx.server._id },
    animated: !!animated,
    url: url || `/attachments/${file_id}`,
  });
  res.status(201).json(emoji.toObject());
});

// PATCH /servers/:target/emojis/:emojiId
router.patch('/:target/emojis/:emojiId', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  if (!hasPermission(ctx.perms, Permissions.MANAGE_SERVER)) {
    return res.status(403).json({ type: 'Forbidden', error: 'Missing MANAGE_SERVER permission' });
  }
  const emoji = await Emoji.findOne({ _id: req.params.emojiId, 'parent.id': ctx.server._id });
  if (!emoji) return res.status(404).json({ type: 'NotFound', error: 'Emoji not found' });
  const { name } = req.body || {};
  if (name) emoji.name = String(name).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32) || emoji.name;
  await emoji.save();
  res.json(emoji.toObject());
});

// DELETE /servers/:target/emojis/:emojiId
router.delete('/:target/emojis/:emojiId', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  if (!hasPermission(ctx.perms, Permissions.MANAGE_SERVER)) {
    return res.status(403).json({ type: 'Forbidden', error: 'Missing MANAGE_SERVER permission' });
  }
  const emoji = await Emoji.findOneAndDelete({ _id: req.params.emojiId, 'parent.id': ctx.server._id });
  if (!emoji) return res.status(404).json({ type: 'NotFound', error: 'Emoji not found' });
  res.status(204).send();
});

// POST /servers/:target/channels
router.post('/:target/channels', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  if (!hasPermission(ctx.perms, Permissions.MANAGE_CHANNELS)) {
    return res.status(403).json({ type: 'Forbidden', error: 'Missing MANAGE_CHANNELS permission' });
  }
  const { name, description, type } = req.body || {};
  if (!name) return res.status(400).json({ type: 'InvalidPayload', error: 'Name required' });
  const channelType = type === 'voice' ? 'VoiceChannel' : 'TextChannel';
  const channelId = ulid();
  await Channel.create({
    _id: channelId,
    channel_type: channelType,
    server: ctx.server._id,
    name: String(name).slice(0, 32),
    description: description || undefined,
  });
  ctx.server.channels = ctx.server.channels || [];
  ctx.server.channels.push(channelId);
  await ctx.server.save();
  const channel = await Channel.findById(channelId).lean();
  res.status(201).json(channel);
});

// GET /servers/:target/permissions - computed permissions for current user
router.get('/:target/permissions', authMiddleware(), async (req, res) => {
  const server = await Server.findById(req.params.target);
  if (!server) return res.status(404).json({ type: 'NotFound', error: 'Server not found' });
  const member = await Member.findOne({ server: server._id, user: req.userId });
  if (!member) return res.status(403).json({ type: 'Forbidden', error: 'Not a member' });
  const perms = computeServerPermissions(server, member);
  res.json({ permissions: perms });
});

// GET /servers/:target/audit-log
router.get('/:target/audit-log', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  if (!hasPermission(ctx.perms, Permissions.MANAGE_SERVER)) {
    return res.status(403).json({ type: 'Forbidden', error: 'Missing MANAGE_SERVER permission' });
  }
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const before = req.query.before;
  const q = { server: ctx.server._id };
  if (before) q.created_at = { $lt: new Date(before) };
  const logs = await AuditLog.find(q).sort({ created_at: -1 }).limit(limit).lean();
  // Populate user data
  const userIds = [...new Set(logs.map((l) => l.user))];
  const users = await User.find({ _id: { $in: userIds } }).select('_id username display_name avatar').lean();
  const userMap = Object.fromEntries(users.map((u) => [u._id, u]));
  res.json(logs.map((l) => ({ ...l, user: userMap[l.user] || { _id: l.user, username: 'Unknown' } })));
});

// POST /servers/:target/webhook - Bot webhook for sending messages
router.post('/:target/webhook/:channelId', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  const ch = await Channel.findById(req.params.channelId);
  if (!ch || ch.server !== ctx.server._id) {
    return res.status(404).json({ type: 'NotFound', error: 'Channel not found in this server' });
  }
  const { content, embeds, username, avatar_url } = req.body || {};
  if (!content && !embeds) {
    return res.status(400).json({ type: 'InvalidPayload', error: 'Content or embeds required' });
  }
  const msgId = ulid();
  const msg = await Message.create({
    _id: msgId,
    channel: ch._id,
    author: req.userId,
    content: content || '',
    embeds: embeds || [],
    masquerade: (username || avatar_url) ? { name: username, avatar: avatar_url } : undefined,
    created_at: new Date(),
  });
  broadcastToServer(ctx.server._id, {
    type: 'Message',
    data: msg.toObject(),
  });
  res.status(201).json(msg.toObject());
});

export default router;
