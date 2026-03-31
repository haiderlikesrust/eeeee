import http from 'http';
import mongoose from 'mongoose';
import config from '../config.js';
import { connectDb } from './db/index.js';
import User from './db/models/User.js';
import app from './app.js';
import { createEventServer } from './events.js';
import { startPresenceApiExpiry } from './presenceApiExpiry.js';
import { startRoomCleanup } from './roomCleanup.js';
import { ensureOfficialClawUser } from './officialClaw.js';
import { ensureOpicStaffBadge } from './opicStaffBadge.js';
import logger from './logger.js';

async function main() {
  await connectDb();
  await ensureOfficialClawUser().catch((err) => {
    logger.error({ err, msg: 'Failed to ensure official Claw user' });
  });
  await ensureOpicStaffBadge().catch((err) => {
    logger.error({ err, msg: 'Failed to ensure Opic Staff badge' });
  });
  startPresenceApiExpiry();
  startRoomCleanup();

  // Remove old unique index on username alone (we use username+discriminator now)
  await mongoose.connection.db.collection('users').dropIndex('username_1').catch(() => {});

  // presence_api_token: unique+sparse still indexed explicit null → only one user could register.
  // Drop old index, strip null tokens, recreate partial unique index from User model.
  await mongoose.connection.db.collection('users').dropIndex('presence_api_token_1').catch(() => {});
  await User.updateMany(
    { presence_api_token: { $exists: true, $eq: null } },
    { $unset: { presence_api_token: 1 } },
  ).catch((err) => logger.warn({ err, msg: 'Unset null presence_api_token migration' }));
  await User.syncIndexes().catch((err) => logger.warn({ err, msg: 'User.syncIndexes' }));

  const server = http.createServer(app);
  createEventServer(server);

  server.listen(config.port, () => {
    logger.info({
      msg: 'Stoat API (JS) listening',
      port: config.port,
      http: `http://localhost:${config.port}`,
      ws: `ws://localhost:${config.port}`,
    });
  });
}

main().catch((err) => {
  logger.fatal({ err, msg: 'Startup failed' });
  process.exit(1);
});
