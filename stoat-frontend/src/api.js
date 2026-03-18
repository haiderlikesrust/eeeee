const API_BASE = '/api';

export function getToken() {
  return localStorage.getItem('token');
}

export function setToken(token) {
  if (token) localStorage.setItem('token', token);
  else localStorage.removeItem('token');
}

export function getSession() {
  const raw = localStorage.getItem('session');
  return raw ? JSON.parse(raw) : null;
}

export function setSession(session) {
  if (session) localStorage.setItem('session', JSON.stringify(session));
  else localStorage.removeItem('session');
}

export async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['x-session-token'] = token;
  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export const get = (path) => api('GET', path);
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
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}
