import { Router } from 'express';
import { User } from '../db/models/index.js';
import { normalizeStatusForOutput } from '../publicUser.js';
import { broadcastPresenceToServers } from '../presenceBroadcast.js';
import {
  mergePresenceActivity,
  parsePublicPresenceBody,
  presenceTokenFromRequest,
} from '../presenceUtils.js';

const router = Router();

/**
 * PATCH /public/v1/presence — update rich presence (and optionally presence) using a user token.
 * Auth: Authorization: Bearer <token> or X-Presence-Token or ?token=
 * Set activity + ttl_seconds (lease) or send heartbeat: true periodically; server clears activity when the lease expires (script stopped).
 */
router.patch('/presence', async (req, res) => {
  const token = presenceTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ type: 'Unauthorized', error: 'Missing presence token' });
  }
  const user = await User.findOne({ presence_api_token: token });
  if (!user) {
    return res.status(401).json({ type: 'Unauthorized', error: 'Invalid presence token' });
  }
  const parsed = parsePublicPresenceBody(req.body || {});
  if (parsed.error) {
    return res.status(400).json({ type: 'FailedValidation', error: parsed.error });
  }
  const { value } = parsed;

  if (value.heartbeat) {
    if (user.status?.activity?.source !== 'api') {
      return res.status(400).json({
        type: 'FailedValidation',
        error: 'No API activity to refresh; send activity first, or script already expired.',
      });
    }
    const ttl = value.ttl_seconds;
    user.presence_api_expires_at = new Date(Date.now() + ttl * 1000);
    await user.save();
    return res.json({
      ok: true,
      status: normalizeStatusForOutput(user.status),
      expires_at: user.presence_api_expires_at,
    });
  }

  const prevActivity = user.status?.activity;
  user.status = { ...(user.status || {}) };
  if (value.presence !== undefined) user.status.presence = value.presence;

  const ttl = value.ttl_seconds ?? 120;
  if (value.activity !== undefined) {
    if (value.activity === null) {
      user.status.activity = null;
      user.presence_api_expires_at = null;
    } else {
      if (value.presence === undefined) user.status.presence = 'Online';
      const rawAct = req.body?.activity;
      user.status.activity = mergePresenceActivity(prevActivity, value.activity, rawAct);
      user.presence_api_expires_at = new Date(Date.now() + ttl * 1000);
    }
  }

  user.markModified('status');
  await user.save();
  await broadcastPresenceToServers(user._id.toString(), user.status);
  res.json({
    ok: true,
    status: normalizeStatusForOutput(user.status),
    ...(user.presence_api_expires_at ? { expires_at: user.presence_api_expires_at } : {}),
  });
});

export default router;
