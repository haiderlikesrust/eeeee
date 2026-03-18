/**
 * Fetch Open Graph / meta metadata from a URL for link previews.
 * Safe: only GET, only http/https, timeout and size limit.
 */

const FETCH_TIMEOUT_MS = 3500;
const MAX_BODY_BYTES = 512 * 1024; // 512KB

// Match URLs; exclude trailing punctuation and balanced parens for YouTube-style links
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

function extractUrls(text) {
  if (!text || typeof text !== 'string') return [];
  const matches = text.match(URL_REGEX) || [];
  const seen = new Set();
  const out = [];
  for (const raw of matches) {
    let url = raw.replace(/[.,;:!?)]+$/, ''); // trim trailing punctuation
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      const key = u.href; // dedupe by full URL so same video = one preview
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(u.href);
    } catch {
      // ignore invalid URLs
    }
  }
  return out;
}

function parseMeta(html, baseUrl) {
  const result = { title: null, description: null, image: null, site_name: null };
  if (!html || typeof html !== 'string') return result;

  const ogTitle = html.match(/<meta[^>]*property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']*)["']/i)
    || html.match(/<meta[^>]*content\s*=\s*["']([^"']*)["'][^>]*property\s*=\s*["']og:title["']/i)
    || html.match(/<meta[^>]*content\s*=\s*'([^']*)'[^>]*property\s*=\s*'og:title'/i);
  if (ogTitle) result.title = ogTitle[1].trim().slice(0, 200);

  const ogDesc = html.match(/<meta\s+[^>]*property\s*=\s*["']og:description["'][^>]*content\s*=\s*["']([^"']*)["']/i)
    || html.match(/<meta\s+[^>]*content\s*=\s*["']([^"']*)["'][^>]*property\s*=\s*["']og:description["']/i);
  if (ogDesc) result.description = ogDesc[1].trim().slice(0, 300);

  const ogImage = html.match(/<meta\s+[^>]*property\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']*)["']/i)
    || html.match(/<meta\s+[^>]*content\s*=\s*["']([^"']*)["'][^>]*property\s*=\s*["']og:image["']/i);
  if (ogImage) {
    let imgUrl = ogImage[1].trim();
    if (baseUrl && (imgUrl.startsWith('/') || !imgUrl.startsWith('http'))) {
      try {
        imgUrl = new URL(imgUrl, baseUrl).href;
      } catch {}
    }
    result.image = imgUrl;
  }

  const ogSite = html.match(/<meta\s+[^>]*property\s*=\s*["']og:site_name["'][^>]*content\s*=\s*["']([^"']*)["']/i)
    || html.match(/<meta\s+[^>]*content\s*=\s*["']([^"']*)["'][^>]*property\s*=\s*["']og:site_name["']/i);
  if (ogSite) result.site_name = ogSite[1].trim().slice(0, 100);

  if (!result.title) {
    const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (titleTag) result.title = titleTag[1].trim().slice(0, 200);
  }

  return result;
}

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Try oEmbed for YouTube and Twitter (they often block direct HTML).
 */
async function fetchOEmbedPreview(url, signal) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    let oembedUrl = null;
    let siteName = null;
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}`;
      siteName = 'YouTube';
    } else if (host.includes('twitter.com') || host === 'x.com') {
      oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}`;
      siteName = 'X (Twitter)';
    }
    if (!oembedUrl) return null;

    const res = await fetch(oembedUrl, {
      method: 'GET',
      signal,
      headers: { 'Accept': 'application/json', 'User-Agent': BROWSER_UA },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data) return null;

    const title = data.title || data.author_name || null;
    const image = data.thumbnail_url || null;
    if (!title && !image) return null;

    return {
      url,
      title: title ? String(title).slice(0, 200) : undefined,
      description: data.description ? String(data.description).slice(0, 300) : undefined,
      image: image || undefined,
      site_name: siteName || data.provider_name || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch one URL and return preview object or null.
 * @param {string} url - Full URL (http/https only)
 * @returns {Promise<{ url: string, title?: string, description?: string, image?: string, site_name?: string } | null>}
 */
export async function fetchLinkPreview(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const signal = controller.signal;

  try {
    const host = new URL(url).hostname.toLowerCase();
    const isTwitter = host.includes('twitter.com') || host === 'x.com';
    const isYouTube = host.includes('youtube.com') || host.includes('youtu.be');

    // For X/Twitter: try HTML first to get og:title (tweet text), og:description, og:image (Discord-style).
    // oEmbed only gives author_name, no tweet content or image.
    if (isTwitter) {
      clearTimeout(timeout);
      const controller2 = new AbortController();
      const timeout2 = setTimeout(() => controller2.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(url, { method: 'GET', signal: controller2.signal, headers: { 'User-Agent': BROWSER_UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }, redirect: 'follow' });
        clearTimeout(timeout2);
        const ct = res.headers.get('content-type')?.toLowerCase() || '';
        const isHtml = res.ok && (ct.includes('text/html') || ct.includes('application/xhtml'));
        if (isHtml) {
          const contentLength = res.headers.get('content-length');
          if (!contentLength || parseInt(contentLength, 10) <= MAX_BODY_BYTES) {
            const text = await res.text();
            if (text.length <= MAX_BODY_BYTES) {
              const meta = parseMeta(text, url);
              if (meta.title || meta.description || meta.image) {
                return { url, title: meta.title || undefined, description: meta.description || undefined, image: meta.image || undefined, site_name: meta.site_name || 'X (Twitter)' };
              }
            }
          }
        }
      } catch {
        clearTimeout(timeout2);
      }
      // Fallback: oEmbed at least gives author name
      const controller3 = new AbortController();
      const timeout3 = setTimeout(() => controller3.abort(), FETCH_TIMEOUT_MS);
      try {
        const oembed = await fetchOEmbedPreview(url, controller3.signal);
        clearTimeout(timeout3);
        if (oembed) return oembed;
      } catch {
        clearTimeout(timeout3);
      }
      return null;
    }

    // YouTube: oEmbed is reliable and gives title + thumbnail
    if (isYouTube) {
      const oembed = await fetchOEmbedPreview(url, signal);
      if (oembed) {
        clearTimeout(timeout);
        return oembed;
      }
      clearTimeout(timeout);
      const controller2 = new AbortController();
      const timeout2 = setTimeout(() => controller2.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(url, { method: 'GET', signal: controller2.signal, headers: { 'User-Agent': BROWSER_UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }, redirect: 'follow' });
        clearTimeout(timeout2);
        const ct = res.headers.get('content-type')?.toLowerCase() || '';
        const isHtml = res.ok && (ct.includes('text/html') || ct.includes('application/xhtml'));
        if (!isHtml) return null;
        const contentLength = res.headers.get('content-length');
        if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) return null;
        const text = await res.text();
        if (text.length > MAX_BODY_BYTES) return null;
        const meta = parseMeta(text, url);
        if (!meta.title && !meta.description && !meta.image) return null;
        return { url, title: meta.title || undefined, description: meta.description || undefined, image: meta.image || undefined, site_name: meta.site_name || undefined };
      } catch {
        clearTimeout(timeout2);
        return null;
      }
    }

    const res = await fetch(url, {
      method: 'GET',
      signal,
      headers: { 'User-Agent': BROWSER_UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      redirect: 'follow',
    });
    clearTimeout(timeout);
    const ct = res.headers.get('content-type')?.toLowerCase() || '';
    const isHtml = res.ok && (ct.includes('text/html') || ct.includes('application/xhtml'));
    if (!isHtml) return null;

    const contentLength = res.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) return null;

    const text = await res.text();
    if (text.length > MAX_BODY_BYTES) return null;

    const meta = parseMeta(text, url);
    if (!meta.title && !meta.description && !meta.image) return null;

    return {
      url,
      title: meta.title || undefined,
      description: meta.description || undefined,
      image: meta.image || undefined,
      site_name: meta.site_name || undefined,
    };
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

/**
 * Extract URLs from message content and fetch previews for the first N.
 * @param {string} content - Message content
 * @param {number} maxPreviews - Max number of previews to fetch (default 2)
 * @returns {Promise<Array<{ url: string, title?: string, description?: string, image?: string, site_name?: string }>>}
 */
export async function fetchLinkPreviewsForContent(content, maxPreviews = 2) {
  const urls = extractUrls(content);
  const previews = [];
  for (let i = 0; i < Math.min(urls.length, maxPreviews); i++) {
    const p = await fetchLinkPreview(urls[i]);
    if (p) previews.push(p);
  }
  return previews;
}
