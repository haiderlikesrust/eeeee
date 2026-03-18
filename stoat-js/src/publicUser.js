const PRESENCE_VALUES = new Set(['Online', 'Idle', 'Busy', 'Invisible']);

export function normalizeProfileForOutput(profile) {
  const p = profile || {};
  const bio = p.bio ?? p.content ?? null;
  const out = {
    bio: bio ?? null,
    content: bio ?? null, // backward compatibility
    background: p.background ?? null,
    banner: p.banner ?? null,
    pronouns: p.pronouns ?? null,
    accent_color: p.accent_color ?? null,
    decoration: p.decoration ?? null,
    effect: p.effect ?? null,
    social_links: Array.isArray(p.social_links) ? p.social_links : [],
    theme_preset: p.theme_preset ?? null,
    badges: Array.isArray(p.badges) ? p.badges : [],
  };
  return out;
}

export function normalizeStatusForOutput(status) {
  if (!status || typeof status !== 'object') {
    return { text: null, presence: 'Invisible' };
  }
  const presence = PRESENCE_VALUES.has(status.presence) ? status.presence : 'Invisible';
  return {
    text: status.text ?? null,
    presence,
  };
}

export function toPublicUser(doc, options = {}) {
  const u = doc?.toObject ? doc.toObject() : (doc || {});
  const systemBadges = Array.isArray(u.system_badges)
    ? u.system_badges.filter((x) => typeof x === 'string' && x.trim())
    : [];
  const bot = (typeof u?.bot?.owner === 'string' && u.bot.owner.trim())
    ? { owner: u.bot.owner }
    : null;
  return {
    _id: u._id,
    username: u.username,
    discriminator: u.discriminator,
    display_name: u.display_name ?? null,
    avatar: u.avatar ?? null,
    relations: u.relations ?? [],
    badges: u.badges ?? 0,
    system_badges: systemBadges,
    status: normalizeStatusForOutput(u.status),
    profile: normalizeProfileForOutput(u.profile),
    flags: u.flags ?? 0,
    privileged: u.privileged ?? false,
    bot,
    relationship: options.relationship ?? 'None',
    online: options.online ?? false,
  };
}
