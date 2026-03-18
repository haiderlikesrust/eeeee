let badgeMapCache = null;
let badgePromise = null;

function normalizeList(data) {
  const list = Array.isArray(data) ? data : [];
  const out = {};
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || item._id || '').trim();
    if (!id) continue;
    out[id] = {
      id,
      label: item.label || id,
      description: item.description || '',
      icon: item.icon || null,
      active: item.active !== false,
    };
  }
  return out;
}

export async function loadSystemBadgeMap() {
  if (badgeMapCache) return badgeMapCache;
  if (badgePromise) return badgePromise;
  badgePromise = fetch('/api/admin/badges/public')
    .then((res) => (res.ok ? res.json() : []))
    .then((data) => {
      badgeMapCache = normalizeList(data);
      return badgeMapCache;
    })
    .catch(() => {
      badgeMapCache = {};
      return badgeMapCache;
    })
    .finally(() => {
      badgePromise = null;
    });
  return badgePromise;
}

export function clearSystemBadgeCache() {
  badgeMapCache = null;
  badgePromise = null;
}
