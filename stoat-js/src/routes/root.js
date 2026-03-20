import { Router } from 'express';
import mongoose from 'mongoose';
import config from '../../config.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    revolt: 'Stoat API (JavaScript port)',
    features: {
      captcha: { enabled: false },
      email: { enabled: false },
      invite_only: false,
    },
    ws: process.env.WS_URL || `ws://localhost:${process.env.PORT || 14702}`,
    app: process.env.APP_URL || 'http://localhost:5173',
    vapid: config.vapidPublicKey || '',
  });
});

/** GET /health - liveness: process is running. Used by load balancers and k8s livenessProbe. */
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'stoat-api' });
});

/** GET /ready - readiness: app can accept traffic (e.g. DB connected). k8s readinessProbe. */
router.get('/ready', async (req, res) => {
  const dbState = mongoose.connection.readyState;
  const ready = dbState === 1; // 1 = connected
  if (!ready) {
    res.status(503).json({
      status: 'not ready',
      service: 'stoat-api',
      mongodb: dbState === 0 ? 'connecting' : dbState === 2 ? 'disconnecting' : 'disconnected',
    });
    return;
  }
  res.status(200).json({ status: 'ready', service: 'stoat-api', mongodb: 'connected' });
});

export default router;
