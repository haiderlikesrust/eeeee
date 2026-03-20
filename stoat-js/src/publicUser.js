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

const ACTIVITY_TYPES = new Set(['Playing', 'Listening', 'Watching', 'Streaming', 'Competing']);

function activityImageForOutput(img) {
  if (img == null) return null;
  if (typeof img === 'string') return img.trim().slice(0, 512) || null;
  if (typeof img === 'object' && (img.url || img._id)) return img;
  return null;
}

function activityStartedAtForOutput(d) {
  if (!d) return null;
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

export function normalizeStatusForOutput(status) {
  if (!status || typeof status !== 'object') {
    return { text: null, presence: 'Invisible', activity: null };
  }
  const presence = PRESENCE_VALUES.has(status.presence) ? status.presence : 'Invisible';
  let activity = null;
  const a = status.activity;
  if (a && typeof a === 'object' && ACTIVITY_TYPES.has(a.type) && typeof a.name === 'string' && a.name.trim()) {
    const started = activityStartedAtForOutput(a.started_at);
    const image = activityImageForOutput(a.image);
    activity = {
      type: a.type,
      name: String(a.name).trim().slice(0, 128),
      details: a.details != null ? String(a.details).trim().slice(0, 128) || null : null,
      state: a.state != null ? String(a.state).trim().slice(0, 128) || null : null,
      ...(a.source === 'spotify' ? { source: 'spotify' } : {}),
      ...(a.source === 'api' ? { source: 'api' } : {}),
      ...(started ? { started_at: started } : {}),
      ...(image ? { image } : {}),
    };
  }
  return {
    text: status.text ?? null,
    presence,
    activity,
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
    presence_api_token_configured: Boolean(u.presence_api_token),
  };
}
