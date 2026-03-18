/**
 * In-memory rate limiting (no Redis).
 * Simple map: key -> { count, resetAt }
 */
const store = new Map();
const WINDOW_MS = 60 * 1000;
const DEFAULT_MAX = 60;

function getKey(req) {
  const token = req.headers['x-session-token'] || req.ip || 'anon';
  const path = (req.baseUrl || '') + (req.path || '');
  return `${token}:${path}`;
}

export function ratelimit(options = {}) {
  const { windowMs = WINDOW_MS, max = DEFAULT_MAX } = options;
  return (req, res, next) => {
    const key = getKey(req);
    const now = Date.now();
    let entry = store.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }
    entry.count += 1;
    res.setHeader('X-Ratelimit-Limit', max);
    res.setHeader('X-Ratelimit-Remaining', Math.max(0, max - entry.count));
    res.setHeader('X-Ratelimit-Reset-After', Math.ceil((entry.resetAt - now) / 1000));
    if (entry.count > max) {
      return res.status(429).json({ type: 'TooManyRequests', error: 'Rate limited' });
    }
    next();
  };
}
