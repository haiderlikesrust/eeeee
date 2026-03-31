/**
 * Configuration - no Docker, no Redis by default.
 * Uses MongoDB only. Rate limiting is in-memory.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __configDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__configDir, '.env') });

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

  /**
   * Optional translation provider (LibreTranslate-compatible endpoint).
   * Example: https://translate.argosopentech.com/translate
   */
  translateProviderUrl: process.env.TRANSLATE_PROVIDER_URL || '',
  translateProviderApiKey: process.env.TRANSLATE_PROVIDER_API_KEY || '',
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',

  /** First-party product analytics (MongoDB + POST /analytics/batch). Set ANALYTICS_ENABLED=false to no-op ingest. */
  analyticsEnabled: process.env.ANALYTICS_ENABLED !== 'false',
  /** TTL for analytics documents (MongoDB expireAfterSeconds on received_at). Default 90 days. */
  analyticsTtlSeconds: Math.max(
    86400,
    parseInt(process.env.ANALYTICS_TTL_SECONDS || String(90 * 24 * 60 * 60), 10) || 90 * 24 * 60 * 60,
  ),
  analyticsMaxBatch: Math.min(
    100,
    Math.max(1, parseInt(process.env.ANALYTICS_MAX_BATCH || '50', 10) || 50),
  ),
  analyticsMaxPropsBytes: Math.min(
    16384,
    Math.max(512, parseInt(process.env.ANALYTICS_MAX_PROPS_BYTES || '8192', 10) || 8192),
  ),

  /** Opic Cloud: per-user storage quota in bytes. Default 500 MB. Override with OPIC_CLOUD_QUOTA_BYTES. */
  opicCloudDefaultQuotaBytes: parseInt(process.env.OPIC_CLOUD_QUOTA_BYTES || String(500 * 1024 * 1024), 10) || 500 * 1024 * 1024,
};
