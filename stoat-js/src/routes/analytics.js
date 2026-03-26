import { Router } from 'express';
import config from '../../config.js';
import { authMiddleware } from '../middleware/auth.js';
import { ratelimit } from '../middleware/ratelimit.js';
import {
  buildClientBatchDocs,
  insertClientEvents,
  userHasAnalyticsOptOut,
} from '../analytics/service.js';

const router = Router();

// POST /analytics/batch
router.post(
  '/batch',
  ratelimit({ max: 35 }),
  authMiddleware(true),
  async (req, res) => {
    if (!config.analyticsEnabled) {
      res.status(204).send();
      return;
    }

    const userId = req.userId || null;
    if (userId && (await userHasAnalyticsOptOut(userId))) {
      res.status(204).send();
      return;
    }

    const { docs } = buildClientBatchDocs(req.body, userId);
    if (docs.length) await insertClientEvents(docs);
    res.status(204).send();
  },
);

export default router;
