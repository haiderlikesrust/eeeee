/**
 * Detects Ofeed share deep links (same app): /channels/@me#ofeed_post=<id>
 */
export function parseOfeedShareUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    const path = (u.pathname || '/').replace(/\/$/, '') || '/';
    if (!path.endsWith('/channels/@me')) return null;
    const hash = u.hash.replace(/^#/, '');
    const m = hash.match(/^ofeed_post=([^&]+)/);
    return m ? String(m[1]).trim() || null : null;
  } catch {
    return null;
  }
}

/** Hide raw URL in message body when this URL is unfurled as an Ofeed card. */
export function shouldHideOfeedUrlInMessage(urlPart, linkPreviews) {
  if (!Array.isArray(linkPreviews) || linkPreviews.length === 0) return false;
  const id = parseOfeedShareUrl(urlPart);
  if (!id) return false;
  return linkPreviews.some((p) => {
    const pid = parseOfeedShareUrl(p?.url);
    return Boolean(pid && pid === id);
  });
}
