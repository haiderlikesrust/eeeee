import { Router } from 'express';
import { ulid } from 'ulid';
import { Report } from '../db/models/index.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// POST /safety/report
router.post('/report', authMiddleware(), async (req, res) => {
  const { content, reason } = req.body || {};
  await Report.create({
    _id: ulid(),
    author_id: req.userId,
    content: content || {},
    reason: reason || undefined,
  });
  res.status(204).send();
});

export default router;
