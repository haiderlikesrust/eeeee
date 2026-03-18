import { Router } from 'express';
import { User } from '../db/models/index.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// POST /policy/acknowledge
router.post('/acknowledge', authMiddleware(), async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) return res.status(401).json({ type: 'Unauthorized', error: 'Invalid session' });
  user.last_acknowledged_policy_change = new Date();
  await user.save();
  res.status(204).send();
});

export default router;
