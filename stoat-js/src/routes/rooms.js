import { Router } from 'express';
import { ulid } from 'ulid';
import crypto from 'crypto';
import { Room, Channel, User } from '../db/models/index.js';
import { authMiddleware } from '../middleware/auth.js';
import { broadcastToRoom } from '../events.js';

const router = Router();
router.use(authMiddleware());

function generateInviteCode() {
  return crypto.randomBytes(4).toString('hex');
}

function sanitizeRoom(room, userId) {
  return {
    _id: room._id,
    name: room.name,
    owner: room.owner,
    members: room.members,
    text_channel: room.text_channel,
    voice_channel: room.voice_channel,
    status: room.status,
    invite_code: room.invite_code,
    empty_timeout_ms: room.empty_timeout_ms,
    last_active_at: room.last_active_at,
    created_at: room.created_at,
    is_owner: String(room.owner) === String(userId),
  };
}

// POST /rooms/create
router.post('/create', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ type: 'InvalidBody', error: 'Room name is required' });
    }

    const roomId = ulid();
    const textChannelId = ulid();
    const voiceChannelId = ulid();

    const textChannel = await Channel.create({
      _id: textChannelId,
      channel_type: 'TextChannel',
      name: 'chat',
      server: roomId,
    });

    const voiceChannel = await Channel.create({
      _id: voiceChannelId,
      channel_type: 'VoiceChannel',
      name: 'voice',
      server: roomId,
    });

    const room = await Room.create({
      _id: roomId,
      name: name.trim().slice(0, 100),
      owner: req.userId,
      members: [req.userId],
      text_channel: textChannelId,
      voice_channel: voiceChannelId,
      invite_code: generateInviteCode(),
      last_active_at: new Date(),
    });

    res.json({ room: sanitizeRoom(room, req.userId) });
  } catch (err) {
    res.status(500).json({ type: 'InternalError', error: err.message });
  }
});

// POST /rooms/:id/join
router.post('/:id/join', async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room || room.status !== 'active') {
      return res.status(404).json({ type: 'NotFound', error: 'Room not found or closed' });
    }
    if (room.members.includes(req.userId)) {
      return res.json({ room: sanitizeRoom(room, req.userId) });
    }
    room.members.push(req.userId);
    room.last_active_at = new Date();
    await room.save();

    const user = await User.findById(req.userId).lean();
    broadcastToRoom(room._id, {
      type: 'RoomMemberJoin',
      d: { roomId: room._id, userId: req.userId, username: user?.display_name || user?.username },
    });

    res.json({ room: sanitizeRoom(room, req.userId) });
  } catch (err) {
    res.status(500).json({ type: 'InternalError', error: err.message });
  }
});

// POST /rooms/join-code/:code
router.post('/join-code/:code', async (req, res) => {
  try {
    const room = await Room.findOne({ invite_code: req.params.code, status: 'active' });
    if (!room) {
      return res.status(404).json({ type: 'NotFound', error: 'Room not found or closed' });
    }
    if (!room.members.includes(req.userId)) {
      room.members.push(req.userId);
      room.last_active_at = new Date();
      await room.save();

      const user = await User.findById(req.userId).lean();
      broadcastToRoom(room._id, {
        type: 'RoomMemberJoin',
        d: { roomId: room._id, userId: req.userId, username: user?.display_name || user?.username },
      });
    }
    res.json({ room: sanitizeRoom(room, req.userId) });
  } catch (err) {
    res.status(500).json({ type: 'InternalError', error: err.message });
  }
});

// POST /rooms/:id/leave
router.post('/:id/leave', async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) {
      return res.status(404).json({ type: 'NotFound', error: 'Room not found' });
    }
    room.members = room.members.filter((m) => String(m) !== String(req.userId));
    room.last_active_at = new Date();
    await room.save();

    broadcastToRoom(room._id, {
      type: 'RoomMemberLeave',
      d: { roomId: room._id, userId: req.userId },
    });

    // If room is now empty, mark the last_active_at for the cleanup timer
    if (room.members.length === 0) {
      room.last_active_at = new Date();
      await room.save();
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ type: 'InternalError', error: err.message });
  }
});

// GET /rooms/:id
router.get('/:id', async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) {
      return res.status(404).json({ type: 'NotFound', error: 'Room not found' });
    }
    if (!room.members.includes(req.userId) && room.status === 'active') {
      return res.status(403).json({ type: 'Forbidden', error: 'Not a member of this room' });
    }
    res.json(sanitizeRoom(room, req.userId));
  } catch (err) {
    res.status(500).json({ type: 'InternalError', error: err.message });
  }
});

// GET /rooms — list active rooms for the current user
router.get('/', async (req, res) => {
  try {
    const rooms = await Room.find({ members: req.userId, status: 'active' })
      .sort({ last_active_at: -1 })
      .limit(50)
      .lean();
    res.json(rooms.map((r) => sanitizeRoom(r, req.userId)));
  } catch (err) {
    res.status(500).json({ type: 'InternalError', error: err.message });
  }
});

// POST /rooms/:id/close — owner closes the room
router.post('/:id/close', async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) {
      return res.status(404).json({ type: 'NotFound', error: 'Room not found' });
    }
    if (String(room.owner) !== String(req.userId)) {
      return res.status(403).json({ type: 'Forbidden', error: 'Only the room owner can close it' });
    }
    room.status = 'closed';
    room.closed_at = new Date();
    await room.save();

    broadcastToRoom(room._id, {
      type: 'RoomClosed',
      d: { roomId: room._id },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ type: 'InternalError', error: err.message });
  }
});

export default router;
