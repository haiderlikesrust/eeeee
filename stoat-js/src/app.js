import express from 'express';
import cors from 'cors';
import { ratelimit } from './middleware/ratelimit.js';
import root from './routes/root.js';
import auth from './routes/auth.js';
import mfa from './routes/mfa.js';
import users from './routes/users.js';
import bots from './routes/bots.js';
import servers from './routes/servers.js';
import channels from './routes/channels.js';
import invites from './routes/invites.js';
import customisation from './routes/customisation.js';
import safety from './routes/safety.js';
import onboard from './routes/onboard.js';
import policy from './routes/policy.js';
import sync from './routes/sync.js';
import push from './routes/push.js';
import webhooks from './routes/webhooks.js';
import uploads from './routes/uploads.js';
import admin from './routes/admin.js';
import botPublic from './routes/botPublic.js';

const app = express();

app.use(cors({ origin: true, credentials: true }));
// Parse text/plain as JSON (client sometimes sends JSON with this content-type)
app.use((req, res, next) => {
  const ct = req.headers['content-type'] || '';
  if (ct.startsWith('text/plain') && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
    return express.text({ limit: '1mb' })(req, res, () => {
      if (typeof req.body === 'string') {
        try {
          req.body = JSON.parse(req.body);
        } catch (e) {}
      }
      next();
    });
  }
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(ratelimit({ max: 120 }));

app.use('/', root);
app.use('/auth', ratelimit({ max: 15 }), auth);
app.use('/auth/mfa', mfa);
app.use('/users', users);
app.use('/bots', bots);
app.use('/servers', servers);
app.use('/channels', channels);
app.use('/invites', invites);
app.use('/custom', customisation);
app.use('/safety', safety);
app.use('/onboard', onboard);
app.use('/policy', policy);
app.use('/sync', sync);
app.use('/push', push);
app.use('/webhooks', webhooks);
app.use('/attachments', uploads);
app.use('/admin', ratelimit({ max: 60 }), admin);
app.use('/bot', ratelimit({ max: 180 }), botPublic);

// Optional 0.8 prefix (Stoat API version)
app.use('/0.8', root);
app.use('/0.8/auth', ratelimit({ max: 15 }), auth);
app.use('/0.8/auth/mfa', mfa);
app.use('/0.8/users', users);
app.use('/0.8/bots', bots);
app.use('/0.8/servers', servers);
app.use('/0.8/channels', channels);
app.use('/0.8/invites', invites);
app.use('/0.8/custom', customisation);
app.use('/0.8/safety', safety);
app.use('/0.8/onboard', onboard);
app.use('/0.8/policy', policy);
app.use('/0.8/sync', sync);
app.use('/0.8/push', push);
app.use('/0.8/webhooks', webhooks);
app.use('/0.8/admin', ratelimit({ max: 60 }), admin);
app.use('/0.8/bot', ratelimit({ max: 180 }), botPublic);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ type: 'InternalError', error: err.message });
});

export default app;
