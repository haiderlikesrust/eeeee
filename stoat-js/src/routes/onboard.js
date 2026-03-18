import { Router } from 'express';
import { User } from '../db/models/index.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

function pickDiscriminator() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

// GET /onboard/hello
router.get('/hello', authMiddleware(true), (req, res) => {
  res.json({
    onboarding: !req.user,
    build: { commit_sha: 'dev', commit_timestamp: new Date().toISOString(), version: '0.1.0' },
  });
});

// POST /onboard/complete
router.post('/complete', authMiddleware(), async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) return res.status(401).json({ type: 'Unauthorized', error: 'Invalid session' });
  if (user.username && user.username !== 'user') {
    return res.status(400).json({ type: 'AlreadyOnboarded', error: 'Already onboarded' });
  }
  const { username } = req.body || {};
  if (!username || username.length < 2 || username.length > 32) {
    return res.status(400).json({ type: 'FailedValidation', error: 'Invalid username' });
  }
  const un = String(username).toLowerCase().replace(/\s/g, '_').slice(0, 32);
  let disc = pickDiscriminator();
  while (await User.findOne({ username: un, discriminator: disc, _id: { $ne: req.userId } })) {
    disc = pickDiscriminator();
  }
  user.username = un;
  user.discriminator = disc;
  await user.save();
  const u = user.toObject();
  res.json({
    ...u,
    relationship: 'User',
    online: false,
  });
});

export default router;
