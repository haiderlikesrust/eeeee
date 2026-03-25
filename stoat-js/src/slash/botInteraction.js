import crypto from 'crypto';

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * @param {string} botToken
 * @param {string} bodyStr JSON string
 * @returns {{ headers: Record<string, string> }}
 */
export function stoatInteractionHeaders(botToken, bodyStr) {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac('sha256', botToken).update(`${ts}.${bodyStr}`).digest('hex');
  return {
    headers: {
      'Content-Type': 'application/json',
      'X-Stoat-Timestamp': ts,
      'X-Stoat-Signature': sig,
    },
  };
}

/**
 * Normalize interaction callback payload fields for message-creating/updating callbacks.
 * @param {any} data
 * @returns {{ content: string, embeds: unknown[], components: unknown[], flags?: number }}
 */
function normalizeMessageCallbackData(data) {
  const content = data?.content != null ? String(data.content).slice(0, 2000) : '';
  const embeds = Array.isArray(data?.embeds) ? data.embeds : [];
  const components = Array.isArray(data?.components) ? data.components : [];
  const out = { content, embeds, components };
  if (data?.flags != null) out.flags = Number(data.flags) || 0;
  return out;
}

/**
 * Normalize deferred callback payload fields.
 * @param {any} data
 * @returns {{ flags?: number }}
 */
function normalizeDeferredCallbackData(data) {
  const out = {};
  if (data?.flags != null) out.flags = Number(data.flags) || 0;
  return out;
}

/**
 * Normalize modal callback payload fields.
 * @param {any} data
 * @returns {{ custom_id?: string, title?: string, components: unknown[] }}
 */
function normalizeModalCallbackData(data) {
  return {
    custom_id: data?.custom_id != null ? String(data.custom_id).slice(0, 100) : undefined,
    title: data?.title != null ? String(data.title).slice(0, 45) : undefined,
    components: Array.isArray(data?.components) ? data.components : [],
  };
}

/**
 * POST to bot interactions_url; expects sync JSON reply.
 * @returns {Promise<{ ok: true, type: number, data: any } | { ok: false, error: string }>}
 */
export async function postBotInteraction(interactionsUrl, botToken, payload, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const url = String(interactionsUrl || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'Invalid interactions_url' };
  }
  let bodyStr;
  try {
    bodyStr = JSON.stringify(payload);
  } catch {
    return { ok: false, error: 'Invalid payload' };
  }
  const { headers } = stoatInteractionHeaders(botToken, bodyStr);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers, body: bodyStr, signal: ac.signal });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      return { ok: false, error: 'Bot response was not JSON' };
    }
    if (!res.ok) {
      return { ok: false, error: json?.error || `HTTP ${res.status}` };
    }
    if (json.type === 4 && json.data && typeof json.data === 'object') {
      return { ok: true, type: 4, data: normalizeMessageCallbackData(json.data) };
    }
    if (json.type === 7 && json.data && typeof json.data === 'object') {
      return { ok: true, type: 7, data: normalizeMessageCallbackData(json.data) };
    }
    if (json.type === 5) {
      return { ok: true, type: 5, data: normalizeDeferredCallbackData(json.data || {}) };
    }
    if (json.type === 6) {
      return { ok: true, type: 6, data: {} };
    }
    if (json.type === 9 && json.data && typeof json.data === 'object') {
      return { ok: true, type: 9, data: normalizeModalCallbackData(json.data) };
    }
    return { ok: false, error: 'Expected interaction callback type 4, 5, 6, 7, or 9' };
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { ok: false, error: 'Interaction timed out' };
    }
    return { ok: false, error: err?.message || 'Request failed' };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Backward-compatible slash helper: expects a type 4 callback.
 * @returns {Promise<{ ok: true, data: { content?: string, embeds?: unknown[], components?: unknown[] } } | { ok: false, error: string }>}
 */
export async function postSlashInteraction(interactionsUrl, botToken, payload, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const out = await postBotInteraction(interactionsUrl, botToken, payload, timeoutMs);
  if (!out.ok) return out;
  if (out.type !== 4) return { ok: false, error: 'Expected { type: 4, data: { content?, embeds?, components? } }' };
  return { ok: true, data: out.data };
}
