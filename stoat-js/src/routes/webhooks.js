import { Router } from 'express';
import { ulid } from 'ulid';
import { Webhook, Message, Channel } from '../db/models/index.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// GET /webhooks/:id - Fetch webhook (auth)
router.get('/:id', authMiddleware(), async (req, res) => {
  const w = await Webhook.findById(req.params.id).select('-token').lean();
  if (!w) return res.status(404).json({ type: 'NotFound', error: 'Webhook not found' });
  if (w.creator_id !== req.userId) return res.status(403).json({ type: 'Forbidden', error: 'Not owner' });
  res.json(w);
});

// GET /webhooks/:id/:token
router.get('/:id/:token', async (req, res) => {
  const w = await Webhook.findOne({ _id: req.params.id, token: req.params.token }).lean();
  if (!w) return res.status(404).json({ type: 'NotFound', error: 'Webhook not found' });
  res.json({ ...w, token: w.token });
});

// POST /webhooks/:id/:token - Execute webhook (send message)
router.post('/:id/:token', async (req, res) => {
  const w = await Webhook.findOne({ _id: req.params.id, token: req.params.token });
  if (!w) return res.status(404).json({ type: 'NotFound', error: 'Webhook not found' });
  const channel = await Channel.findById(w.channel_id);
  if (!channel) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const content = req.body?.content ?? '';
  const msgId = ulid();
  await Message.create({
    _id: msgId,
    channel: channel._id,
    author: w.creator_id,
    webhook: { name: w.name, avatar: w.avatar },
    content: String(content).slice(0, 2000),
    attachments: req.body?.attachments || [],
    embeds: req.body?.embeds || [],
  });
  channel.last_message_id = msgId;
  await channel.save();
  const msg = await Message.findById(msgId).lean();
  res.status(201).json(msg);
});

// POST /webhooks/:id/:token/github - GitHub webhook (stub)
router.post('/:id/:token/github', async (req, res) => {
  const w = await Webhook.findOne({ _id: req.params.id, token: req.params.token });
  if (!w) return res.status(404).json({ type: 'NotFound', error: 'Webhook not found' });
  const channel = await Channel.findById(w.channel_id);
  if (!channel) return res.status(404).json({ type: 'NotFound', error: 'Channel not found' });
  const event = req.body;
  const text = event?.head_commit?.message || event?.action || 'GitHub event';
  const msgId = ulid();
  await Message.create({
    _id: msgId,
    channel: channel._id,
    author: w.creator_id,
    webhook: { name: w.name, avatar: w.avatar },
    content: `[GitHub] ${text}`,
    embeds: [],
  });
  channel.last_message_id = msgId;
  await channel.save();
  res.status(204).send();
});

// PATCH /webhooks/:id (auth)
router.patch('/:id', authMiddleware(), async (req, res) => {
  const w = await Webhook.findById(req.params.id);
  if (!w) return res.status(404).json({ type: 'NotFound', error: 'Webhook not found' });
  if (w.creator_id !== req.userId) return res.status(403).json({ type: 'Forbidden', error: 'Not owner' });
  const { name, avatar } = req.body || {};
  if (name != null) w.name = String(name).slice(0, 32);
  if (avatar !== undefined) w.avatar = avatar;
  await w.save();
  const out = w.toObject();
  delete out.token;
  res.json(out);
});

// PATCH /webhooks/:id/:token
router.patch('/:id/:token', async (req, res) => {
  const w = await Webhook.findOne({ _id: req.params.id, token: req.params.token });
  if (!w) return res.status(404).json({ type: 'NotFound', error: 'Webhook not found' });
  const { name, avatar } = req.body || {};
  if (name != null) w.name = String(name).slice(0, 32);
  if (avatar !== undefined) w.avatar = avatar;
  await w.save();
  const out = w.toObject();
  delete out.token;
  res.json(out);
});

// DELETE /webhooks/:id (auth)
router.delete('/:id', authMiddleware(), async (req, res) => {
  const w = await Webhook.findById(req.params.id);
  if (!w) return res.status(404).json({ type: 'NotFound', error: 'Webhook not found' });
  if (w.creator_id !== req.userId) return res.status(403).json({ type: 'Forbidden', error: 'Not owner' });
  await w.deleteOne();
  res.status(204).send();
});

// DELETE /webhooks/:id/:token
router.delete('/:id/:token', async (req, res) => {
  const w = await Webhook.findOne({ _id: req.params.id, token: req.params.token });
  if (!w) return res.status(404).json({ type: 'NotFound', error: 'Webhook not found' });
  await w.deleteOne();
  res.status(204).send();
});

export default router;
