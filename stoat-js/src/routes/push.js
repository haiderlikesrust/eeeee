import { Router } from 'express';
import { ulid } from 'ulid';
import { PushSubscription } from '../db/models/index.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// POST /push/subscribe
router.post('/subscribe', authMiddleware(), async (req, res) => {
  const { endpoint, p256dh, auth, session_id } = req.body || {};
  if (!endpoint) return res.status(400).json({ type: 'InvalidPayload', error: 'endpoint required' });
  const id = ulid();
  await PushSubscription.create({
    _id: id,
    user_id: req.userId,
    session_id: session_id || undefined,
    endpoint,
    p256dh: p256dh || undefined,
    auth: auth || undefined,
  });
  res.status(204).send();
});

// POST /push/unsubscribe
router.post('/unsubscribe', authMiddleware(), async (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) {
    await PushSubscription.deleteOne({ user_id: req.userId, endpoint });
  } else {
    await PushSubscription.deleteMany({ user_id: req.userId });
  }
  res.status(204).send();
});

export default router;
