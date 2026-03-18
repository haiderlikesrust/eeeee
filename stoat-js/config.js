/**
 * Configuration - no Docker, no Redis.
 * Uses MongoDB only. Rate limiting is in-memory.
 */
export default {
  port: process.env.PORT || 14702,
  wsPort: process.env.WS_PORT || 14703,
  mongodb: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/stoat',
};
