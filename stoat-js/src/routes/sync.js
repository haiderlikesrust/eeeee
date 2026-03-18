import { Router } from 'express';
import { UserSettings, ChannelUnread, Channel, Member, Server } from '../db/models/index.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// POST /sync/settings/fetch
router.post('/settings/fetch', authMiddleware(), async (req, res) => {
  const keys = req.body?.keys || [];
  const settings = await UserSettings.find({ user_id: req.userId, key: keys.length ? { $in: keys } : { $exists: true } }).lean();
  const out = {};
  for (const s of settings) out[s.key] = s.value;
  res.json(out);
});

// POST /sync/settings/set — batch updates in one round-trip to reduce latency and DB load
router.post('/settings/set', authMiddleware(), async (req, res) => {
  const data = req.body || {};
  const entries = Object.entries(data);
  if (entries.length === 0) {
    res.status(204).send();
    return;
  }
  const now = new Date();
  const ops = entries.map(([key, value]) => ({
    updateOne: {
      filter: { user_id: req.userId, key },
      update: {
        $set: {
          user_id: req.userId,
          key,
          value: typeof value === 'string' ? value : JSON.stringify(value),
          updated_at: now,
        },
      },
      upsert: true,
    },
  }));
  await UserSettings.bulkWrite(ops);
  res.status(204).send();
});

// GET /sync/unreads - computed: channels where last_message_id > user's ack (or no ack)
router.get('/unreads', authMiddleware(), async (req, res) => {
  const userId = req.userId;
  const [ackMap, dmChannels, serverChannelIds] = await Promise.all([
    ChannelUnread.find({ user: userId }).select('channel last_id mentions').lean(),
    Channel.find({ channel_type: 'DirectMessage', recipients: userId }).select('_id last_message_id').lean(),
    Member.find({ user: userId })
      .then((members) => members.length ? Server.find({ _id: { $in: members.map((m) => m.server) } }).select('channels').lean() : []),
  ]);
  const ackByChannel = Object.fromEntries(ackMap.map((u) => [u.channel.toString(), { last_id: u.last_id, mentions: u.mentions || [] }]));
  const out = [];
  for (const ch of dmChannels) {
    if (!ch.last_message_id) continue;
    const ack = ackByChannel[ch._id];
    const lastRead = ack?.last_id || null;
    if (lastRead === ch.last_message_id) continue;
    out.push({
      channel_id: ch._id,
      last_id: lastRead,
      last_message_id: ch.last_message_id,
      mentions: ack?.mentions || [],
    });
  }
  const serverIds = await Member.find({ user: userId }).distinct('server');
  if (serverIds.length) {
    const servers = await Server.find({ _id: { $in: serverIds } }).select('channels').lean();
    const allChannelIds = [...new Set(servers.flatMap((s) => s.channels || []))];
    if (allChannelIds.length) {
      const serverChannels = await Channel.find({ _id: { $in: allChannelIds } }).select('_id last_message_id server').lean();
      for (const ch of serverChannels) {
        if (!ch.last_message_id) continue;
        const ack = ackByChannel[ch._id];
        const lastRead = ack?.last_id || null;
        if (lastRead === ch.last_message_id) continue;
        out.push({
          channel_id: ch._id,
          last_id: lastRead,
          last_message_id: ch.last_message_id,
          server_id: ch.server,
          mentions: ack?.mentions || [],
        });
      }
    }
  }
  res.json(out);
});

export default router;
