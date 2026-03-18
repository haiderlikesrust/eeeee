import { Router } from 'express';
import { ulid } from 'ulid';
import { Emoji } from '../db/models/index.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// PUT /custom/emoji/:id - Create emoji
router.put('/emoji/:id', authMiddleware(), async (req, res) => {
  const { name, parent, animated, nsfw, media } = req.body || {};
  const emojiId = req.params.id || ulid();
  await Emoji.create({
    _id: emojiId,
    creator_id: req.userId,
    name: (name || 'emoji').slice(0, 32),
    parent: parent || {},
    animated: !!animated,
    nsfw: !!nsfw,
    media: media || undefined,
  });
  const emoji = await Emoji.findById(emojiId).lean();
  res.status(201).json(emoji);
});

// GET /custom/emoji/:emoji_id
router.get('/emoji/:emoji_id', authMiddleware(), async (req, res) => {
  const emoji = await Emoji.findById(req.params.emoji_id).lean();
  if (!emoji) return res.status(404).json({ type: 'NotFound', error: 'Emoji not found' });
  res.json(emoji);
});

// DELETE /custom/emoji/:emoji_id
router.delete('/emoji/:emoji_id', authMiddleware(), async (req, res) => {
  const emoji = await Emoji.findById(req.params.emoji_id);
  if (!emoji) return res.status(404).json({ type: 'NotFound', error: 'Emoji not found' });
  if (emoji.creator_id !== req.userId) return res.status(403).json({ type: 'Forbidden', error: 'Not owner' });
  await emoji.deleteOne();
  res.status(204).send();
});

export default router;
