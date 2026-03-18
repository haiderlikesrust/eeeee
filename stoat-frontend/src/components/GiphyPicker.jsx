import { useEffect, useMemo, useState } from 'react';
import { GiphyFetch } from '@giphy/js-fetch-api';
import './GiphyPicker.css';

const PUBLIC_BETA_KEY = 'dc6zaTOxFJmzC';
const RAW_KEY = import.meta.env.VITE_GIPHY_API_KEY || '';
const GIPHY_API_KEY = String(RAW_KEY).replace(/^['"]|['"]$/g, '');
const TENOR_KEY = String(import.meta.env.VITE_TENOR_API_KEY || 'LIVDSRZULELA').replace(/^['"]|['"]$/g, '');

function mapTenorResults(raw) {
  const results = raw?.results || [];
  return results.map((item) => {
    const media = Array.isArray(item.media) ? item.media[0] : null;
    const preview = media?.tinygif?.url || media?.gif?.preview || media?.nanogif?.url || media?.gif?.url;
    const full = media?.gif?.url || media?.mediumgif?.url || media?.tinygif?.url || preview;
    return {
      id: item.id,
      title: item.title || item.content_description || 'GIF',
      images: {
        fixed_width_small: { url: preview || full },
        original: { url: full || preview },
      },
    };
  }).filter((x) => x.images.fixed_width_small.url && x.images.original.url);
}

async function fetchTenor(query) {
  const base = query
    ? 'https://g.tenor.com/v1/search'
    : 'https://g.tenor.com/v1/trending';
  const qs = new URLSearchParams({
    key: TENOR_KEY,
    limit: '24',
    media_filter: 'minimal',
  });
  if (query) qs.set('q', query);
  const res = await fetch(`${base}?${qs.toString()}`);
  if (!res.ok) throw new Error(`TENOR_${res.status}`);
  const data = await res.json();
  return { data: mapTenorResults(data) };
}

async function fetchWithFallback(query) {
  const keys = [GIPHY_API_KEY, PUBLIC_BETA_KEY].filter(Boolean);
  const tried = new Set();
  let lastErr = null;

  for (const key of keys) {
    if (tried.has(key)) continue;
    tried.add(key);
    try {
      const client = new GiphyFetch(key);
      const res = query
        ? await client.search(query, { limit: 24, rating: 'pg-13' })
        : await client.trending({ limit: 24, rating: 'pg-13' });
      return { res, usedKey: key };
    } catch (err) {
      lastErr = err;
    }
  }

  // Hard fallback when Giphy keys are banned or unavailable.
  try {
    const tenorRes = await fetchTenor(query);
    return { res: tenorRes, usedKey: 'tenor' };
  } catch (err) {
    throw err || lastErr || new Error('Unknown GIF provider error');
  }
}

export default function GiphyPicker({ onSelect }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const trimmedQuery = useMemo(() => query.trim(), [query]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const { res } = await fetchWithFallback(trimmedQuery);
        if (!cancelled) setItems(res?.data || []);
      } catch (err) {
        if (!cancelled) {
          const msg = err?.message || err?.statusText || 'Failed to load GIFs';
          setError(`Failed to load GIFs (${msg})`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 260);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmedQuery]);

  return (
    <div className="giphy-picker" onClick={(e) => e.stopPropagation()}>
      <div className="giphy-header">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search GIFs"
          className="giphy-search"
          autoFocus
        />
      </div>
      <div className="giphy-grid-wrap">
        {loading && <div className="giphy-status">Loading GIFs...</div>}
        {error && <div className="giphy-status">{error}</div>}
        {!loading && !error && items.length === 0 && <div className="giphy-status">No GIFs found</div>}
        {!loading && !error && items.length > 0 && (
          <div className="giphy-grid">
            {items.map((gif) => {
              const preview = gif.images?.fixed_width_small?.url || gif.images?.preview_gif?.url || gif.images?.original?.url;
              const full = gif.images?.original?.url || preview;
              if (!preview || !full) return null;
              return (
                <button
                  type="button"
                  key={gif.id}
                  className="giphy-item"
                  title={gif.title || 'GIF'}
                  onClick={() => onSelect({ id: gif.id, url: full, preview, title: gif.title || '' })}
                >
                  <img src={preview} alt={gif.title || 'GIF'} loading="lazy" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
