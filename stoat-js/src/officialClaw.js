/**
 * Fixed user id for the official in-app bot (Discord-style Clyde → Claw).
 * Override with OFFICIAL_CLAW_USER_ID if migrating an existing deployment.
 */
import { User } from './db/models/index.js';

const DEFAULT_CLAW_ID = 'stoat_official_claw';

export function getOfficialClawUserId() {
  return (process.env.OFFICIAL_CLAW_USER_ID || DEFAULT_CLAW_ID).trim() || DEFAULT_CLAW_ID;
}

export function isOfficialClawUserId(id) {
  return String(id || '') === getOfficialClawUserId();
}

/**
 * Ensure the Claw user exists (no Account — not loginable). Idempotent.
 */
export async function ensureOfficialClawUser() {
  const _id = getOfficialClawUserId();
  let u = await User.findById(_id);
  if (!u) {
    let discriminator = '0000';
    for (let i = 0; i < 50; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const taken = await User.findOne({ username: 'claw', discriminator }).lean();
      if (!taken) break;
      discriminator = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    }
    u = await User.create({
      _id,
      username: 'claw',
      discriminator,
      display_name: 'Claw',
      bot: { owner: 'system', official: true },
      profile: { bio: 'Official Stoat bot.' },
      disabled: false,
    });
    return u;
  }
  if (!u.bot || typeof u.bot !== 'object') {
    u.bot = { owner: 'system', official: true };
  } else {
    u.bot.owner = 'system';
    u.bot.official = true;
  }
  u.disabled = false;
  u.disabled_reason = null;
  await u.save();
  return u;
}
