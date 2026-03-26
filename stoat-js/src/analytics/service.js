import config from '../../config.js';
import logger from '../logger.js';
import { AnalyticsEvent, UserSettings } from '../db/models/index.js';

const EVENT_NAME_RE = /^[a-z][a-z0-9_.]{0,127}$/;
const ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;
const MAX_PROP_DEPTH = 5;
const MAX_PROP_KEYS = 40;
const MAX_STRING_LEN = 500;

/**
 * @param {unknown} v
 * @returns {boolean}
 */
export function isAnalyticsOptOutValue(v) {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

/**
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export async function userHasAnalyticsOptOut(userId) {
  if (!userId) return false;
  const row = await UserSettings.findOne({ user_id: userId, key: 'analytics_opt_out' }).lean();
  return isAnalyticsOptOutValue(row?.value);
}

/**
 * @param {unknown} val
 * @param {number} depth
 * @returns {unknown}
 */
function sanitizeValue(val, depth) {
  if (depth > MAX_PROP_DEPTH) return undefined;
  if (val === null) return null;
  const t = typeof val;
  if (t === 'boolean' || t === 'number') {
    if (t === 'number' && !Number.isFinite(val)) return undefined;
    return val;
  }
  if (t === 'string') {
    const s = val.slice(0, MAX_STRING_LEN);
    return s;
  }
  if (Array.isArray(val)) {
    const out = [];
    for (let i = 0; i < Math.min(val.length, 20); i++) {
      const x = sanitizeValue(val[i], depth + 1);
      if (x !== undefined) out.push(x);
    }
    return out;
  }
  if (t === 'object') {
    const out = {};
    let n = 0;
    for (const [k, v] of Object.entries(val)) {
      if (n >= MAX_PROP_KEYS) break;
      if (typeof k !== 'string' || k.length > 64) continue;
      if (!/^[a-zA-Z0-9_]+$/.test(k)) continue;
      const x = sanitizeValue(v, depth + 1);
      if (x !== undefined) {
        out[k] = x;
        n++;
      }
    }
    return out;
  }
  return undefined;
}

/**
 * @param {unknown} props
 * @param {number} maxBytes
 * @returns {Record<string, unknown>|undefined}
 */
export function sanitizeProps(props, maxBytes) {
  if (props == null || typeof props !== 'object' || Array.isArray(props)) return undefined;
  const cleaned = sanitizeValue(props, 0);
  if (cleaned == null || typeof cleaned !== 'object' || Array.isArray(cleaned)) return undefined;
  const json = JSON.stringify(cleaned);
  if (json.length > maxBytes) return undefined;
  return cleaned;
}

/**
 * @param {string} s
 * @returns {boolean}
 */
function validId(s) {
  return typeof s === 'string' && ID_RE.test(s);
}

/**
 * @param {unknown} raw
 * @param {string | null} batchAnon
 * @param {string | null} userId
 * @param {string | null} batchSession
 * @param {string} platform
 * @param {string | null} appVersion
 * @returns {{ ok: true, doc: object } | { ok: false, reason: string }}
 */
export function normalizeClientEvent(raw, batchAnon, userId, batchSession, platform, appVersion) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'invalid_event' };
  const name = raw.event;
  if (typeof name !== 'string' || !EVENT_NAME_RE.test(name)) return { ok: false, reason: 'invalid_event_name' };

  const client_event_id = typeof raw.client_event_id === 'string' ? raw.client_event_id : null;
  if (client_event_id != null && (client_event_id.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(client_event_id))) {
    return { ok: false, reason: 'invalid_client_event_id' };
  }

  let anonymous_id = batchAnon || (typeof raw.anonymous_id === 'string' ? raw.anonymous_id : null);
  if (!validId(anonymous_id) && userId) {
    const stub = `uid_${userId}`;
    if (stub.length <= 64) anonymous_id = stub;
  }
  if (!validId(anonymous_id)) return { ok: false, reason: 'invalid_anonymous_id' };

  const props = sanitizeProps(raw.props, config.analyticsMaxPropsBytes);
  if (raw.props != null && props === undefined) return { ok: false, reason: 'invalid_props' };

  const client_ts =
    typeof raw.client_ts === 'number' && Number.isFinite(raw.client_ts) ? Math.floor(raw.client_ts) : null;
  const session_id =
    batchSession && validId(batchSession)
      ? batchSession
      : typeof raw.session_id === 'string' && validId(raw.session_id)
        ? raw.session_id
        : null;

  const doc = {
    received_at: new Date(),
    client_ts,
    source: 'client',
    anonymous_id,
    user_id: userId || null,
    session_id,
    platform: typeof platform === 'string' && platform.length <= 32 ? platform.slice(0, 32) : 'unknown',
    app_version: appVersion && typeof appVersion === 'string' ? appVersion.slice(0, 64) : null,
    event: name,
    props: props && Object.keys(props).length ? props : undefined,
    client_event_id: client_event_id || null,
  };
  return { ok: true, doc };
}

/**
 * @param {unknown} body
 * @param {string | null} userId
 * @returns {{ docs: object[], rejected: number }}
 */
export function buildClientBatchDocs(body, userId) {
  const max = config.analyticsMaxBatch;
  if (!body || typeof body !== 'object') return { docs: [], rejected: 0 };

  const events = body.events;
  if (!Array.isArray(events)) return { docs: [], rejected: 0 };

  const batchAnon = typeof body.anonymous_id === 'string' ? body.anonymous_id : null;
  const batchSession = typeof body.session_id === 'string' ? body.session_id : null;
  const platform = typeof body.platform === 'string' ? body.platform : 'unknown';
  const appVersion = typeof body.app_version === 'string' ? body.app_version : null;

  const docs = [];
  let rejected = 0;
  const slice = events.slice(0, max);
  for (const ev of slice) {
    const n = normalizeClientEvent(ev, batchAnon, userId, batchSession, platform, appVersion);
    if (!n.ok) {
      rejected++;
      continue;
    }
    docs.push(n.doc);
  }
  if (events.length > max) rejected += events.length - max;
  return { docs, rejected };
}

/**
 * @param {object} opts
 * @param {string|null} [opts.userId]
 * @param {string|null} [opts.anonymousId]
 * @param {string} opts.event
 * @param {Record<string, unknown>} [opts.props]
 * @param {string} [opts.platform]
 * @returns {Promise<void>}
 */
export async function recordServerEvent(opts) {
  if (!config.analyticsEnabled) return;
  const { userId = null, anonymousId = null, event, props = {}, platform = 'server' } = opts;
  if (typeof event !== 'string' || !EVENT_NAME_RE.test(event)) return;
  const clean = sanitizeProps(props, config.analyticsMaxPropsBytes) || {};
  const doc = {
    received_at: new Date(),
    client_ts: null,
    source: 'server',
    anonymous_id: anonymousId && validId(anonymousId) ? anonymousId : null,
    user_id: userId || null,
    session_id: null,
    platform: typeof platform === 'string' ? platform.slice(0, 32) : 'server',
    app_version: null,
    event,
    props: Object.keys(clean).length ? clean : undefined,
    client_event_id: null,
  };
  try {
    await AnalyticsEvent.create(doc);
  } catch (err) {
    logger.warn({ err, msg: 'recordServerEvent failed' });
  }
}

/**
 * @param {object[]} docs
 * @returns {Promise<{ inserted: number, dupes: number }>}
 */
export async function insertClientEvents(docs) {
  if (!docs.length) return { inserted: 0, dupes: 0 };
  const settled = await Promise.allSettled(docs.map((d) => AnalyticsEvent.create(d)));
  let inserted = 0;
  let dupes = 0;
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      inserted++;
      continue;
    }
    const code = r.reason?.code;
    if (code === 11000) dupes++;
    else logger.warn({ err: r.reason, msg: 'insertClientEvents create failed' });
  }
  return { inserted, dupes };
}
