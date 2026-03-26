import { getToken, apiUrl } from '../api';
const LS_ANON = 'stoat_analytics_anon_id';
const LS_OPT_OUT = 'stoat_analytics_opt_out';
const SS_SESSION = 'stoat_analytics_session';

const APP_VERSION = import.meta.env.VITE_APP_VERSION || '0.0.0';
const ENABLED = import.meta.env.VITE_ANALYTICS_ENABLED !== 'false';

const MAX_QUEUE = 100;
const FLUSH_INTERVAL_MS = 10000;
const MAX_BATCH = 50;

let queue = [];
let flushTimer = null;
let started = false;
let serverOptOut = false;

function randomHex(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

function newClientEventId() {
  return randomHex(12);
}

function getOrCreateAnonymousId() {
  try {
    let id = localStorage.getItem(LS_ANON);
    if (id && /^[a-zA-Z0-9_-]{8,64}$/.test(id)) return id;
    id = `w${randomHex(16)}`;
    localStorage.setItem(LS_ANON, id);
    return id;
  } catch {
    return `w${randomHex(16)}`;
  }
}

function getOrCreateSessionId() {
  try {
    let id = sessionStorage.getItem(SS_SESSION);
    if (id && /^[a-zA-Z0-9_-]{8,64}$/.test(id)) return id;
    id = `s${randomHex(12)}`;
    sessionStorage.setItem(SS_SESSION, id);
    return id;
  } catch {
    return `s${randomHex(12)}`;
  }
}

function readLocalOptOut() {
  try {
    const v = localStorage.getItem(LS_OPT_OUT);
    return v === '1' || v === 'true';
  } catch {
    return false;
  }
}

export function isAnalyticsOptedOut() {
  return serverOptOut || readLocalOptOut();
}

/** Sync preference from server (UserSettings key analytics_opt_out). */
export function setServerAnalyticsOptOut(optOut) {
  serverOptOut = !!optOut;
}

/** User toggle: persist locally and should be paired with POST /sync/settings/set. */
export function setLocalAnalyticsOptOut(optOut) {
  try {
    if (optOut) localStorage.setItem(LS_OPT_OUT, '1');
    else localStorage.removeItem(LS_OPT_OUT);
  } catch {}
  if (optOut) queue = [];
}

export function rotateAnonymousIdentity() {
  try {
    localStorage.removeItem(LS_ANON);
  } catch {}
  try {
    sessionStorage.removeItem(SS_SESSION);
  } catch {}
  queue = [];
}

function buildPayload(eventsSlice) {
  return {
    anonymous_id: getOrCreateAnonymousId(),
    session_id: getOrCreateSessionId(),
    platform: 'web',
    app_version: APP_VERSION,
    events: eventsSlice,
  };
}

async function sendWithFetch(body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['x-session-token'] = token;
  const res = await fetch(apiUrl('/analytics/batch'), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    keepalive: true,
  });
  return res.ok || res.status === 204;
}

function sendWithBeacon(body) {
  if (typeof navigator === 'undefined' || !navigator.sendBeacon) return false;
  try {
    const blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
    return navigator.sendBeacon(apiUrl('/analytics/batch'), blob);
  } catch {
    return false;
  }
}

export function flushAnalytics(useBeacon = false) {
  if (!ENABLED || isAnalyticsOptedOut() || queue.length === 0) return;
  const batch = queue.splice(0, MAX_BATCH);
  const body = buildPayload(batch);
  if (useBeacon) {
    const token = getToken();
    if (token) {
      void sendWithFetch(body);
      return;
    }
    sendWithBeacon(body);
    return;
  }
  void sendWithFetch(body).then((ok) => {
    if (!ok) queue.unshift(...batch);
  });
}

export function track(event, props = {}) {
  if (!ENABLED || isAnalyticsOptedOut()) return;
  if (typeof event !== 'string' || !/^[a-z][a-z0-9_.]{0,127}$/.test(event)) return;
  const row = {
    event,
    props: props && typeof props === 'object' && !Array.isArray(props) ? props : {},
    client_ts: Date.now(),
    client_event_id: newClientEventId(),
  };
  queue.push(row);
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  if (queue.length >= MAX_BATCH) flushAnalytics(false);
}

export function initAnalytics() {
  if (!ENABLED || started) return;
  started = true;
  track('app.session_start', { path: typeof window !== 'undefined' ? window.location.pathname : '' });

  flushTimer = setInterval(() => flushAnalytics(false), FLUSH_INTERVAL_MS);

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushAnalytics(true);
    });
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => flushAnalytics(true));
  }
}

export function trackPageView(pathname) {
  if (!pathname) return;
  track('navigation.page_view', { path: pathname });
}
