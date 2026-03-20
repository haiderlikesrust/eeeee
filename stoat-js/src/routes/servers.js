import { Router } from 'express';
import { ulid } from 'ulid';
import { Server, Channel, Member, User, Invite, ServerBan, Emoji, AuditLog, Message } from '../db/models/index.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  Permissions, DEFAULT_EVERYONE_PERMS, ALL_PERMISSIONS,
  computeServerPermissions, hasPermission, outranks, canManageRole, sameId,
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

// PATCH /servers/:target
router.patch('/:target', authMiddleware(), async (req, res) => {
  const ctx = await getServerAndMember(req, res);
  if (!ctx) return;
  if (!hasPermission(ctx.perms, Permissions.MANAGE_SERVER)) {
    return res.status(403).json({ type: 'Forbidden', error: 'Missing MANAGE_SERVER permission' });
  }
  const { name, description, icon, banner, default_permissions, locked, word_filter } = req.body || {};
  if (name != null) ctx.server.name = String(name).slice(0, 32);
  if (description != null) ctx.server.description = description;
  if (icon != null) ctx.server.icon = icon;
  if (banner != null) ctx.server.banner = banner;
  if (default_permissions != null && sameId(ctx.server.owner, req.userId)) {
    ctx.server.default_permissions = default_permissions;
  }
  if (locked != null && sameId(ctx.server.owner, req.userId)) {
    ctx.server.locked = !!locked;
  }
  if (word_filter !== undefined) {
    ctx.server.word_filter = Array.isArray(word_filter) ? word_filter.map((w) => String(w).slice(0, 50)).slice(0, 100) : [];
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
    permissions: typeof permissions === 'number' ? permissions : 0,
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
  if (permissions != null) ctx.server.roles[roleId].permissions = permissions;
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
  if (permissions != null) server.default_permissions = permissions;
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
  if (req.body?.permissions != null) role.permissions = req.body.permissions;
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
