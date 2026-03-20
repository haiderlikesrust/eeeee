import http from 'http';
import mongoose from 'mongoose';
import config from '../config.js';
import { connectDb } from './db/index.js';
import app from './app.js';
import { createEventServer } from './events.js';
import { startPresenceApiExpiry } from './presenceApiExpiry.js';
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

  // Remove old unique index on username alone (we use username+discriminator now)
  await mongoose.connection.db.collection('users').dropIndex('username_1').catch(() => {});

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
