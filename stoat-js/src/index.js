import http from 'http';
import mongoose from 'mongoose';
import config from '../config.js';
import { connectDb } from './db/index.js';
import app from './app.js';
import { createEventServer } from './events.js';

async function main() {
  await connectDb();

  // Remove old unique index on username alone (we use username+discriminator now)
  await mongoose.connection.db.collection('users').dropIndex('username_1').catch(() => {});

  const server = http.createServer(app);
  createEventServer(server);

  server.listen(config.port, () => {
    console.log(`Stoat API (JS) listening on http://localhost:${config.port}`);
    console.log(`WebSocket events on ws://localhost:${config.port}`);
    console.log('MongoDB only - no Docker, no Redis');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
