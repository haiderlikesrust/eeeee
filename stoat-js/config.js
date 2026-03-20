/**
 * Configuration - no Docker, no Redis by default.
 * Uses MongoDB only. Rate limiting is in-memory.
 */
import path from 'path';

const corsRaw = process.env.CORS_ORIGINS;
const corsOrigins = corsRaw
  ? corsRaw.split(',').map((s) => s.trim()).filter(Boolean)
  : [];

export default {
  port: process.env.PORT || 14702,
  wsPort: process.env.WS_PORT || 14703,
  mongodb: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/stoat',

  /** When non-empty, only these origins get CORS (with credentials). Otherwise `origin: true` (dev-friendly). */
  corsOrigins,

  uploadStorage: (process.env.UPLOADS_STORAGE || 'local').toLowerCase(),
  uploadDir: process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.join(process.cwd(), 'uploads'),

  s3: {
    region: process.env.AWS_REGION || '',
    bucket: process.env.S3_BUCKET || '',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    publicBaseUrl: (process.env.S3_PUBLIC_BASE_URL || '').replace(/\/$/, ''),
  },

  vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || '',
  vapidSubject: process.env.VAPID_SUBJECT || '',
};
