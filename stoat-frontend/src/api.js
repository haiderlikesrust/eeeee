const API_BASE = '/api';

const GET_CACHE_TTL_MS = 3000; // 3 seconds
const getCache = new Map(); // path -> { data, expires }

function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key, value) {
  try {
    if (value != null) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {}
}

export function getToken() {
  return safeGetItem('token');
}

export function setToken(token) {
  if (token) safeSetItem('token', token);
  else safeSetItem('token', null);
}

export function getSession() {
  const raw = safeGetItem('session');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setSession(session) {
  if (session) safeSetItem('session', JSON.stringify(session));
  else safeSetItem('session', null);
}

export async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['x-session-token'] = token;
  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (res.status === 204) return null;
  const raw = await res.text();
  if (!raw.length) {
    if (!res.ok) throw { type: 'UnknownError', error: `HTTP ${res.status}`, status: res.status };
    return null;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw { type: 'InvalidResponse', error: 'Server returned non-JSON response', status: res.status };
  }
  if (!res.ok) throw data;
  return data;
}

export async function get(path) {
  // Message lists change constantly; caching caused stale polls to wipe optimistic / new sends.
  // Member lists are updated live via PresenceUpdate + refetch — caching returned stale rows for minutes until refresh.
  const skipCache =
    path.includes('/messages')
    || path.includes('/ofeed')
    || path.includes('/members')
    || path.includes('/commands')
    || path.includes('/cloud');
  if (!skipCache) {
    const cached = getCache.get(path);
    if (cached && Date.now() < cached.expires) return cached.data;
  }
  const data = await api('GET', path);
  if (!skipCache) {
    getCache.set(path, { data, expires: Date.now() + GET_CACHE_TTL_MS });
  }
  return data;
}
export const post = (path, body) => api('POST', path, body);
export const patch = (path, body) => api('PATCH', path, body);
export const put = (path, body) => api('PUT', path, body);
export const del = (path, body) => api('DELETE', path, body);

export async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  const headers = {};
  const token = getToken();
  if (token) headers['x-session-token'] = token;
  const res = await fetch('/api/attachments', { method: 'POST', headers, body: formData });
  const raw = await res.text();
  if (!raw.length) {
    if (!res.ok) throw { type: 'UnknownError', error: `HTTP ${res.status}`, status: res.status };
    throw { type: 'InvalidResponse', error: 'Empty response from upload' };
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw { type: 'InvalidResponse', error: 'Server returned non-JSON from upload', status: res.status };
  }
  if (!res.ok) throw data;
  return data;
}
