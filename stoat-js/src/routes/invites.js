import { Router } from 'express';
import { ulid } from 'ulid';
import { Invite, Channel, Server, Member, User } from '../db/models/index.js';
import { authMiddleware } from '../middleware/auth.js';
import { broadcastToServer, isUserOnline } from '../events.js';
import { toPublicUser } from '../publicUser.js';

const router = Router();

// GET /invites/:code - Get invite (join info)
router.get('/:code', authMiddleware(), async (req, res) => {
  const invite = await Invite.findById(req.params.code)
    .populate('channel')
    .populate('server')
    .lean();
  if (!invite) return res.status(404).json({ type: 'NotFound', error: 'Invite not found' });
  res.json({
    type: invite.type,
    channel: invite.channel,
    server: invite.server ? { id: invite.server._id, name: invite.server.name } : undefined,
  });
});

// POST /invites/:code - Join invite
router.post('/:code', authMiddleware(), async (req, res) => {
  const invite = await Invite.findById(req.params.code).lean();
  if (!invite) return res.status(404).json({ type: 'NotFound', error: 'Invite not found' });
  if (invite.type === 'Server' && invite.server) {
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
        member: { ...newMember.toObject(), user: toPublicUser(joinedUser, { relationship: 'None', online: isUserOnline(req.userId) }) },
      },
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
