import { Router } from 'express';

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
    vapid: '',
  });
});

export default router;
