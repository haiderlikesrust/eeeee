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
 * POST to bot interactions_url; expects sync JSON reply.
 * @returns {Promise<{ ok: true, data: { content?: string, embeds?: unknown[] } } | { ok: false, error: string }>}
 */
export async function postSlashInteraction(interactionsUrl, botToken, payload, timeoutMs = DEFAULT_TIMEOUT_MS) {
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
      const content = json.data.content != null ? String(json.data.content).slice(0, 2000) : '';
      const embeds = Array.isArray(json.data.embeds) ? json.data.embeds : [];
      return { ok: true, data: { content, embeds } };
    }
    return { ok: false, error: 'Expected { type: 4, data: { content?, embeds? } }' };
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { ok: false, error: 'Interaction timed out' };
    }
    return { ok: false, error: err?.message || 'Request failed' };
  } finally {
    clearTimeout(t);
  }
}
