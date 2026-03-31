import { Server, Channel, Member, Invite } from './db/models/index.js';

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{2,31}$/;
const RESERVED = new Set([
  'admin', 'api', 'invite', 'invites', 'servers', 'channels', 'users', 'auth', 'bot', 'bots',
  'discover', 'public', 'static', 'assets', 'ws', 'wss', 'health', 'ready', 'me', 'login', 'register',
  'developers', 'changelog', 'ofeed', 'sync', 'push', 'webhooks', 'attachments', 'preview', 'cloud',
]);

/** @param {unknown} raw */
export function normalizePublicSlug(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  return s;
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, slug: string } | { ok: false, error: string }}
 */
export function validatePublicSlug(raw) {
  const slug = normalizePublicSlug(raw);
  if (!slug) return { ok: false, error: 'Invalid slug' };
  if (!SLUG_RE.test(slug)) {
    return { ok: false, error: 'Slug must be 3–32 characters: letters, numbers, hyphen, underscore; start with letter or number' };
  }
  if (RESERVED.has(slug)) return { ok: false, error: 'This slug is reserved' };
  return { ok: true, slug };
}

/**
 * @param {string} slug normalized
 * @param {string | null} excludeServerId
 */
export async function isPublicSlugTaken(slug, excludeServerId = null) {
  const or = [
    { public_slug: slug, public_status: 'approved' },
    { public_slug_requested: slug, public_status: 'pending' },
  ];
  const q = excludeServerId
    ? { $and: [{ $or: or }, { _id: { $ne: excludeServerId } }] }
    : { $or: or };
  const found = await Server.findOne(q).select('_id').lean();
  return !!found;
}

/**
 * @param {string} code
 * @returns {Promise<{ kind: 'invite', invite: object } | { kind: 'public_server', server: object } | null>}
 */
export async function resolveInviteOrPublicSlug(code) {
  const normalized = String(code || '').trim().toLowerCase();
  if (!normalized) return null;
  const invite = await Invite.findById(normalized).lean();
  if (invite) return { kind: 'invite', invite };
  const server = await Server.findOne({
    public_slug: normalized,
    public_status: 'approved',
  }).lean();
  if (server) return { kind: 'public_server', server };
  return null;
}

/** @param {object} serverDoc */
export async function pickDefaultJoinChannelId(serverDoc) {
  const ids = serverDoc?.channels;
  if (!Array.isArray(ids) || !ids.length) return null;
  const channels = await Channel.find({ _id: { $in: ids } }).lean();
  const byId = new Map(channels.map((c) => [String(c._id), c]));
  for (const id of ids) {
    const ch = byId.get(String(id));
    if (ch?.channel_type === 'TextChannel') return String(id);
  }
  return String(ids[0]);
}

/**
 * @param {{ limit?: number, before?: string }} opts
 */
export async function queryDiscoverServers(opts = {}) {
  const limit = Math.min(50, Math.max(1, Number(opts.limit) || 24));
  const q = {
    public_status: 'approved',
    public_discovery: { $ne: false },
    locked: { $ne: true },
  };
  if (opts.before) {
    q._id = { $lt: String(opts.before) };
  }
  const servers = await Server.find(q).sort({ _id: -1 }).limit(limit).lean();
  const out = [];
  for (const s of servers) {
    const member_count = await Member.countDocuments({ server: s._id });
    out.push({
      id: s._id,
      name: s.name,
      description: s.description || '',
      icon: s.icon || null,
      banner: s.banner || null,
      slug: s.public_slug,
      member_count,
    });
  }
  return { servers: out };
}

const WS_DISCOVER_WINDOW_MS = 60_000;
const WS_DISCOVER_MAX = 30;
const WS_JOIN_WINDOW_MS = 60_000;
const WS_JOIN_MAX = 20;

const wsDiscoverHits = new Map();
const wsJoinHits = new Map();

function allowWsRate(map, key, windowMs, max) {
  const now = Date.now();
  let e = map.get(key);
  if (!e || now > e.resetAt) {
    e = { count: 0, resetAt: now + windowMs };
    map.set(key, e);
  }
  e.count += 1;
  if (e.count > max) return false;
  return true;
}

export function allowDiscoverWsRate(userId) {
  return allowWsRate(wsDiscoverHits, String(userId), WS_DISCOVER_WINDOW_MS, WS_DISCOVER_MAX);
}

export function allowJoinPublicWsRate(userId) {
  return allowWsRate(wsJoinHits, String(userId), WS_JOIN_WINDOW_MS, WS_JOIN_MAX);
}
