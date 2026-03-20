export const PRESENCE_VALUES = new Set(['Online', 'Idle', 'Busy', 'Invisible']);
export const ACTIVITY_TYPES = new Set(['Playing', 'Listening', 'Watching', 'Streaming', 'Competing']);

export function safeTrimString(value, maxLen) {
  if (value == null) return null;
  return String(value).trim().slice(0, maxLen);
}

function parseActivityImageField(image) {
  if (image === null) return { value: null };
  if (typeof image === 'string') {
    const u = image.trim().slice(0, 512);
    if (!u) return { error: 'activity.image URL is empty' };
    if (!/^https:\/\//i.test(u)) return { error: 'activity.image must be an https:// URL' };
    return { value: u };
  }
  if (typeof image === 'object' && image) {
    if (typeof image.url === 'string' && /^https:\/\//i.test(image.url.trim())) {
      return { value: { url: image.url.trim().slice(0, 512) } };
    }
    if (image._id && (image.tag || image.filename)) {
      return { value: image };
    }
    return { error: 'activity.image must be https URL, { url }, or an attachment object from POST /attachments' };
  }
  return { error: 'activity.image is invalid' };
}

export function activityFingerprint(act) {
  if (!act || typeof act !== 'object') return '';
  return [act.type, act.name || '', act.details ?? '', act.state ?? ''].join('\x1e');
}

/**
 * Preserve started_at + image across heartbeats when the “session” (type/name/details/state) is unchanged.
 */
export function mergePresenceActivity(prev, parsed, rawActivity) {
  const fpNew = activityFingerprint(parsed);
  const fpPrev = prev?.source === 'api' ? activityFingerprint(prev) : null;

  const next = { ...parsed };
  if (fpNew === fpPrev && prev?.started_at) {
    next.started_at = prev.started_at;
  } else {
    next.started_at = new Date();
  }

  if (rawActivity && Object.prototype.hasOwnProperty.call(rawActivity, 'image')) {
    next.image = 'image' in parsed ? parsed.image : null;
  } else if (fpNew === fpPrev && prev) {
    next.image = prev.image ?? null;
  } else {
    next.image = null;
  }

  return next;
}

/** @param {'manual' | 'api'} source */
export function parseActivityUpdate(activity, source = 'manual') {
  if (activity === null) return { value: null };
  if (typeof activity !== 'object') {
    return { error: 'activity must be an object or null' };
  }
  const type = activity.type;
  if (!ACTIVITY_TYPES.has(type)) {
    return { error: 'activity.type is invalid' };
  }
  const name = safeTrimString(activity.name, 128);
  if (!name) return { error: 'activity.name is required' };
  const details = activity.details !== undefined ? safeTrimString(activity.details, 128) : null;
  const state = activity.state !== undefined ? safeTrimString(activity.state, 128) : null;
  const out = {
    type,
    name,
    details: details || null,
    state: state || null,
    source,
  };
  if (Object.prototype.hasOwnProperty.call(activity, 'image')) {
    const img = parseActivityImageField(activity.image);
    if (img.error) return { error: img.error };
    out.image = img.value;
  }
  return { value: out };
}

/**
 * PATCH /users/@me — status.text and status.presence only (no activity).
 */
export function parseStatusPatch(status) {
  if (status == null) return null;
  if (typeof status !== 'object') {
    return { error: 'status must be an object' };
  }
  if (status.activity !== undefined) {
    return {
      error:
        'status.activity cannot be set here. Generate a presence token in User Settings and use PATCH /public/v1/presence.',
    };
  }
  const out = {};
  if (status.text !== undefined) {
    out.text = safeTrimString(status.text, 128);
  }
  if (status.presence !== undefined) {
    if (!PRESENCE_VALUES.has(status.presence)) {
      return { error: 'status.presence is invalid' };
    }
    out.presence = status.presence;
  }
  return { value: out };
}

const DEFAULT_TTL_SECONDS = 120;

function clampTtlSeconds(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(600, Math.max(15, Math.floor(n)));
}

/**
 * Public API body: heartbeat, or at least one of presence / activity (activity: null clears).
 * Optional ttl_seconds (15–600, default 120): lease — activity hides when script stops refreshing.
 */
export function parsePublicPresenceBody(body) {
  if (!body || typeof body !== 'object') {
    return { error: 'body must be a JSON object' };
  }

  let ttl_seconds = DEFAULT_TTL_SECONDS;
  if (body.ttl_seconds !== undefined) {
    const c = clampTtlSeconds(body.ttl_seconds);
    if (c == null) return { error: 'ttl_seconds must be a number between 15 and 600' };
    ttl_seconds = c;
  }

  if (body.heartbeat === true) {
    if ('activity' in body) {
      return { error: 'use either heartbeat or activity, not both' };
    }
    return { value: { heartbeat: true, ttl_seconds } };
  }

  const out = { ttl_seconds };
  if (body.presence !== undefined) {
    if (!PRESENCE_VALUES.has(body.presence)) {
      return { error: 'presence is invalid' };
    }
    out.presence = body.presence;
  }
  if ('activity' in body) {
    const pa = parseActivityUpdate(body.activity, 'api');
    if (pa.error) return { error: pa.error };
    out.activity = pa.value;
  }
  if (body.presence === undefined && !('activity' in body)) {
    return { error: 'include heartbeat, or at least one of presence or activity' };
  }
  return { value: out };
}

export function presenceTokenFromRequest(req) {
  const auth = req.headers.authorization || '';
  const m = /^Bearer\s+(\S+)/i.exec(auth);
  if (m) return m[1].trim();
  const h = req.headers['x-presence-token'];
  if (typeof h === 'string' && h.trim()) return h.trim();
  const q = req.query?.token;
  if (typeof q === 'string' && q.trim()) return q.trim();
  return null;
}
