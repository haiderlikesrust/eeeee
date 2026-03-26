import { Router } from 'express';
import { ulid } from 'ulid';
import { Invite, Channel, Server, Member, User } from '../db/models/index.js';
import { authMiddleware } from '../middleware/auth.js';
import { broadcastToServer, isUserOnlineDisplay } from '../events.js';
import { toPublicUser } from '../publicUser.js';
import { recordServerEvent } from '../analytics/service.js';
import { resolveInviteOrPublicSlug, pickDefaultJoinChannelId } from '../publicServer.js';
import { joinUserToServerForPublicInvite } from '../serverJoinPublic.js';

const router = Router();

async function previewPayload(resolved) {
  if (resolved.kind === 'invite') {
    const invite = resolved.invite;
    const srv = invite.server
      ? await Server.findById(typeof invite.server === 'object' ? invite.server._id : invite.server)
        .select('_id name locked icon banner')
        .lean()
      : null;
    return {
      type: invite.type,
      server: srv
        ? { id: srv._id, name: srv.name, locked: !!srv.locked, icon: srv.icon || null, banner: srv.banner || null }
        : undefined,
      channelId: invite.channel,
    };
  }
  const server = resolved.server;
  const channelId = await pickDefaultJoinChannelId(server);
  return {
    type: 'Server',
    server: {
      id: server._id,
      name: server.name,
      locked: !!server.locked,
      icon: server.icon || null,
      banner: server.banner || null,
    },
    channelId,
  };
}

// GET /invites/:code/preview - Public invite info (no auth) for invite link landing page
router.get('/:code/preview', async (req, res) => {
  const resolved = await resolveInviteOrPublicSlug(req.params.code);
  if (!resolved) return res.status(404).json({ type: 'NotFound', error: 'Invite not found' });
  res.json(await previewPayload(resolved));
});

// GET /invites/:code - Get invite (join info), requires auth
router.get('/:code', authMiddleware(), async (req, res) => {
  const resolved = await resolveInviteOrPublicSlug(req.params.code);
  if (!resolved) return res.status(404).json({ type: 'NotFound', error: 'Invite not found' });
  if (resolved.kind === 'invite') {
    const invite = await Invite.findById(resolved.invite._id)
      .populate('channel')
      .populate('server')
      .lean();
    if (!invite) return res.status(404).json({ type: 'NotFound', error: 'Invite not found' });
    return res.json({
      type: invite.type,
      channel: invite.channel,
      server: invite.server ? { id: invite.server._id, name: invite.server.name } : undefined,
    });
  }
  const channelId = await pickDefaultJoinChannelId(resolved.server);
  const channel = channelId ? await Channel.findById(channelId).lean() : null;
  return res.json({
    type: 'Server',
    channel,
    server: { id: resolved.server._id, name: resolved.server.name },
  });
});

// POST /invites/:code - Join invite or public server by vanity slug
router.post('/:code', authMiddleware(), async (req, res) => {
  const resolved = await resolveInviteOrPublicSlug(req.params.code);
  if (!resolved) return res.status(404).json({ type: 'NotFound', error: 'Invite not found' });

  if (resolved.kind === 'public_server') {
    const result = await joinUserToServerForPublicInvite(req.userId, resolved.server);
    if (!result.ok) {
      return res.status(result.status).json({ type: result.type, error: result.error });
    }
    return res.json(result.channel);
  }

  const invite = resolved.invite;
  if (invite.type === 'Server' && invite.server) {
    const server = await Server.findById(invite.server).lean();
    if (server?.locked) return res.status(403).json({ type: 'ServerLocked', error: 'Server is locked; no new members can join' });
    const existing = await Member.findOne({ server: invite.server, user: req.userId });
    if (existing) return res.status(400).json({ type: 'AlreadyInServer', error: 'Already a member' });
    const newMember = await Member.create({
      _id: ulid(),
      server: invite.server,
      user: req.userId,
      roles: [],
    });
    const joinedUser = await User.findById(req.userId).lean();
    broadcastToServer(invite.server, {
      type: 'ServerMemberJoin',
      data: {
        serverId: invite.server,
        member: { ...newMember.toObject(), user: toPublicUser(joinedUser, { relationship: 'None', online: isUserOnlineDisplay(req.userId, joinedUser) }) },
      },
    });
    void recordServerEvent({
      userId: req.userId,
      event: 'invite.accepted',
      props: { server_id: String(invite.server), invite_type: String(invite.type || 'Server') },
    });
  }
  const channel = await Channel.findById(invite.channel).lean();
  res.json(channel);
});

// DELETE /invites/:target
router.delete('/:target', authMiddleware(), async (req, res) => {
  const invite = await Invite.findById(req.params.target);
  if (!invite) return res.status(404).json({ type: 'NotFound', error: 'Invite not found' });
  if (invite.creator !== req.userId) return res.status(403).json({ type: 'Forbidden', error: 'Not creator' });
  await invite.deleteOne();
  res.status(204).send();
});

// POST /invites - Create invite
router.post('/', authMiddleware(), async (req, res) => {
  const { channel_id } = req.body || {};
  if (!channel_id) return res.status(400).json({ type: 'InvalidPayload', error: 'channel_id required' });
  const channel = await Channel.findById(channel_id).lean();
  if (!channel) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const member = channel.server ? await Member.findOne({ server: channel.server, user: req.userId }) : null;
  if (channel.server && !member) return res.status(403).json({ type: 'Forbidden', error: 'Not a member' });
  const code = ulid().toLowerCase().slice(0, 8);
  await Invite.create({
    _id: code,
    channel: channel_id,
    creator: req.userId,
    server: channel.server || undefined,
    type: channel.server ? 'Server' : 'Group',
  });
  res.status(201).json({ _id: code, channel: channel_id, creator: req.userId, type: channel.server ? 'Server' : 'Group' });
});

export default router;
