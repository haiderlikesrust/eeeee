import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useOfeed } from '../context/OfeedContext';
import { useMobile } from '../context/MobileContext';
import { useToast } from '../context/ToastContext';
import { get, post, del } from '../api';
import { resolveFileUrl } from '../utils/avatarUrl';
import './OfeedPanel.css';

const MAX_LEN = 280;
const PAGE_SIZE = 40;

function formatTime(iso) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${Math.max(0, s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatFullTime(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return '';
  }
}

function displayName(author) {
  if (!author) return 'Unknown';
  return author.display_name || author.username || 'User';
}

function handleLine(author) {
  if (!author) return '';
  const u = author.username || 'user';
  const d = author.discriminator != null ? String(author.discriminator).padStart(4, '0') : '0000';
  return `@${u}#${d}`;
}

function compactCount(n) {
  const x = Number(n) || 0;
  if (x < 1000) return String(x);
  if (x < 1_000_000) return `${(x / 1000).toFixed(x >= 10_000 ? 0 : 1)}K`;
  return `${(x / 1_000_000).toFixed(1)}M`;
}

function PostEmbedded({ embedded }) {
  if (!embedded) {
    return (
      <div className="ofeed-embedded ofeed-embedded--missing">
        <span>Original post unavailable</span>
      </div>
    );
  }
  const av = embedded.author?.avatar ? resolveFileUrl(embedded.author.avatar) : null;
  return (
    <div className="ofeed-embedded">
      <div className="ofeed-embedded-head">
        <div className="ofeed-embedded-avatar">
          {av ? <img src={av} alt="" /> : (
            <span>{displayName(embedded.author).slice(0, 1).toUpperCase()}</span>
          )}
        </div>
        <div className="ofeed-embedded-meta">
          <span className="ofeed-embedded-name">{displayName(embedded.author)}</span>
          <span className="ofeed-embedded-handle">{handleLine(embedded.author)}</span>
        </div>
      </div>
      <p className="ofeed-embedded-text">{embedded.content}</p>
    </div>
  );
}

export default function OfeedPanel() {
  const { open, setOpen, deepLinkPostId, setDeepLinkPostId } = useOfeed() || {};
  const { user } = useAuth();
  const { isMobile } = useMobile();
  const toast = useToast();
  const [posts, setPosts] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [likeBusy, setLikeBusy] = useState(null);
  const [repostBusy, setRepostBusy] = useState(null);
  const [quoteFor, setQuoteFor] = useState(null);
  const [quoteDraft, setQuoteDraft] = useState('');
  const [repostMenu, setRepostMenu] = useState(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (!repostMenu) return;
    const close = (e) => {
      if (!e.target.closest?.('.ofeed-repost-wrap')) setRepostMenu(null);
    };
    document.addEventListener('click', close, true);
    return () => document.removeEventListener('click', close, true);
  }, [repostMenu]);

  const fetchPosts = useCallback(async (opts = {}) => {
    const { append, before } = opts;
    const qs = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (before) qs.set('before', before);
    const data = await get(`/ofeed/posts?${qs.toString()}`);
    const list = Array.isArray(data?.posts) ? data.posts : [];
    if (append) {
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p._id));
        const next = [...prev];
        for (const p of list) {
          if (!seen.has(p._id)) {
            seen.add(p._id);
            next.push(p);
          }
        }
        return next;
      });
    } else {
      setPosts(list);
    }
    setHasMore(list.length >= PAGE_SIZE);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setHasMore(true);
    (async () => {
      try {
        await fetchPosts({});
      } catch (e) {
        if (!cancelled) toast?.error?.(e?.error || 'Could not load Ofeed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, fetchPosts, toast]);

  /** If hash pointed at a post not in the first page, fetch it by id. */
  useEffect(() => {
    if (!deepLinkPostId || !open || loading) return;
    if (posts.some((p) => p._id === deepLinkPostId)) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await get(`/ofeed/posts/${deepLinkPostId}`);
        if (cancelled || !data?.post) return;
        setPosts((prev) => {
          if (prev.some((p) => p._id === data.post._id)) return prev;
          return [data.post, ...prev];
        });
      } catch {
        if (!cancelled) {
          toast?.error?.('Could not load linked post');
          setDeepLinkPostId?.(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [deepLinkPostId, open, loading, posts, toast, setDeepLinkPostId]);

  useEffect(() => {
    if (!deepLinkPostId || loading) return;
    if (!posts.some((p) => p._id === deepLinkPostId)) return;
    const el = document.getElementById(`ofeed-card-${deepLinkPostId}`);
    if (!el) return;
    const t = window.setTimeout(() => {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('ofeed-post-card--highlight');
      setTimeout(() => {
        el.classList.remove('ofeed-post-card--highlight');
        setDeepLinkPostId?.(null);
      }, 2000);
    }, 150);
    return () => window.clearTimeout(t);
  }, [deepLinkPostId, loading, posts, setDeepLinkPostId]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || posts.length === 0) return;
    const last = posts[posts.length - 1];
    if (!last?._id) return;
    setLoadingMore(true);
    try {
      await fetchPosts({ append: true, before: last._id });
    } catch (e) {
      toast?.error?.(e?.error || 'Could not load more');
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, posts, fetchPosts, toast]);

  const addPost = useCallback(async () => {
    const text = draft.trim();
    if (!text || !user) return;
    setPosting(true);
    try {
      const created = await post('/ofeed/posts', { content: text.slice(0, MAX_LEN) });
      setDraft('');
      setPosts((prev) => {
        if (prev.some((p) => p._id === created._id)) return prev;
        return [created, ...prev];
      });
    } catch (e) {
      toast?.error?.(e?.error || 'Could not post');
    } finally {
      setPosting(false);
    }
  }, [draft, user, toast]);

  const removePost = useCallback(async (id) => {
    try {
      await del(`/ofeed/posts/${id}`);
      setPosts((prev) => prev.filter((p) => p._id !== id));
    } catch (e) {
      toast?.error?.(e?.error || 'Could not delete');
    }
  }, [toast]);

  const toggleLike = useCallback(async (id) => {
    if (!user) return;
    setLikeBusy(id);
    try {
      const data = await post(`/ofeed/posts/${id}/like`);
      setPosts((prev) => prev.map((p) => (p._id === id
        ? { ...p, like_count: data.like_count, liked: data.liked }
        : p)));
    } catch (e) {
      toast?.error?.(e?.error || 'Could not update like');
    } finally {
      setLikeBusy(null);
    }
  }, [user, toast]);

  const doRepost = useCallback(async (originalId, quoteText = '') => {
    if (!user) return;
    setRepostBusy(originalId);
    setRepostMenu(null);
    try {
      const body = { repost_of: originalId };
      const q = quoteText.trim();
      if (q) body.content = q.slice(0, MAX_LEN);
      const created = await post('/ofeed/posts', body);
      const oid = created.repost_of;
      setPosts((prev) => {
        const merged = prev.some((p) => p._id === created._id) ? prev : [created, ...prev];
        if (!oid) return merged;
        return merged.map((x) => {
          if (String(x._id) === String(oid)) {
            return { ...x, repost_count: (x.repost_count ?? 0) + 1 };
          }
          if (x.embedded && String(x.embedded._id) === String(oid)) {
            return {
              ...x,
              embedded: { ...x.embedded, repost_count: (x.embedded.repost_count ?? 0) + 1 },
            };
          }
          return x;
        });
      });
      setQuoteFor(null);
      setQuoteDraft('');
      toast?.success?.('Reposted');
    } catch (e) {
      if (e?.type === 'AlreadyReposted') toast?.info?.('You already reposted this');
      else toast?.error?.(e?.error || 'Could not repost');
    } finally {
      setRepostBusy(null);
    }
  }, [user, toast]);

  const copyLink = useCallback((id) => {
    /** Always share from /channels/@me so the link works for anyone — not tied to a server/channel path. */
    const url = `${window.location.origin}/channels/@me#ofeed_post=${id}`;
    navigator.clipboard.writeText(url).then(() => {
      toast?.success?.('Link copied');
    }).catch(() => toast?.error?.('Could not copy'));
  }, [toast]);

  const repostTargetId = (p) => (p.repost_of ? p.repost_of : p._id);

  if (!open) return null;

  const panel = (
    <aside className={`ofeed-panel ${isMobile ? 'ofeed-panel--mobile' : ''}`} aria-label="Ofeed">
      <div className="ofeed-panel-header">
        <div className="ofeed-panel-header-row">
          <div className="ofeed-panel-title-row">
            <h2 className="ofeed-panel-title">Ofeed</h2>
            <span className="ofeed-panel-beta" title="Beta">Beta</span>
          </div>
          <button
            type="button"
            className="ofeed-panel-close"
            onClick={() => setOpen?.(false)}
            aria-label="Close Ofeed"
          >
            <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
        <span className="ofeed-panel-sub">Share it with others</span>
      </div>

      <div className="ofeed-compose">
        <div className="ofeed-compose-avatar">
          {user?.avatar ? (
            <img src={resolveFileUrl(user.avatar)} alt="" />
          ) : (
            <span>{(user?.username || user?.display_name || '?').slice(0, 1).toUpperCase()}</span>
          )}
        </div>
        <div className="ofeed-compose-body">
          <textarea
            className="ofeed-compose-input"
            placeholder="What's happening?"
            value={draft}
            maxLength={MAX_LEN}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                addPost();
              }
            }}
          />
          <div className="ofeed-compose-footer">
            <span className="ofeed-compose-count">{draft.length}/{MAX_LEN}</span>
            <button type="button" className="ofeed-post-btn" onClick={addPost} disabled={!draft.trim() || posting}>
              {posting ? 'Posting…' : 'Post'}
            </button>
          </div>
        </div>
      </div>

      {quoteFor && (
        <div className="ofeed-quote-modal">
          <div className="ofeed-quote-modal-inner">
            <div className="ofeed-quote-modal-title">Quote Ofeed</div>
            <textarea
              className="ofeed-compose-input"
              placeholder="Add a comment…"
              value={quoteDraft}
              maxLength={MAX_LEN}
              rows={3}
              onChange={(e) => setQuoteDraft(e.target.value)}
            />
            <div className="ofeed-quote-modal-actions">
              <button type="button" className="ofeed-quote-cancel" onClick={() => { setQuoteFor(null); setQuoteDraft(''); }}>Cancel</button>
              <button
                type="button"
                className="ofeed-post-btn"
                onClick={() => doRepost(quoteFor, quoteDraft)}
                disabled={repostBusy === quoteFor}
              >
                {repostBusy === quoteFor ? '…' : 'Quote repost'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="ofeed-list" ref={listRef}>
        {loading && (
          <div className="ofeed-empty">Loading…</div>
        )}
        {!loading && posts.length === 0 && (
          <div className="ofeed-empty">No posts yet. Be the first!</div>
        )}
        {!loading && posts.map((p) => {
          const author = p.author;
          const avatar = author?.avatar ? resolveFileUrl(author.avatar) : null;
          const mine = user && author && String(author._id) === String(user._id);
          const isRepost = !!p.repost_of;
          const quoteText = (p.content || '').trim();
          const showQuote = isRepost && quoteText.length > 0;

          return (
            <article id={`ofeed-card-${p._id}`} key={p._id} className="ofeed-post-card">
              {isRepost && (
                <div className="ofeed-repost-badge">
                  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d="M4 12a8 8 0 018-8V.5L18.5 4 12 7.5V4a8 8 0 00-8 8zm8 8a8 8 0 008-8h-3L18.5 4 22 10.5H19a8 8 0 01-8 8v3.5L4.5 20 11 13.5H8z"/></svg>
                  <span>{displayName(author)} reposted</span>
                </div>
              )}
              <div className="ofeed-post-card-inner">
                <div className="ofeed-post-avatar">
                  {avatar ? <img src={avatar} alt="" /> : (
                    <span>{displayName(author).slice(0, 1).toUpperCase()}</span>
                  )}
                </div>
                <div className="ofeed-post-body">
                  <div className="ofeed-post-top">
                    <div className="ofeed-post-identity">
                      <span className="ofeed-post-name">{displayName(author)}</span>
                      <span className="ofeed-post-handle">{handleLine(author)}</span>
                      <span className="ofeed-post-dot" aria-hidden>·</span>
                      <time className="ofeed-post-time" dateTime={p.created_at} title={formatFullTime(p.created_at)}>
                        {formatTime(p.created_at)}
                      </time>
                    </div>
                    {mine && (
                      <button
                        type="button"
                        className="ofeed-post-delete"
                        onClick={() => removePost(p._id)}
                        title="Delete post"
                        aria-label="Delete post"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                      </button>
                    )}
                  </div>
                  {showQuote && <p className="ofeed-post-quote">{quoteText}</p>}
                  {isRepost && <PostEmbedded embedded={p.embedded} />}
                  {!isRepost && <p className="ofeed-post-text">{p.content}</p>}

                  <div className="ofeed-actions">
                    <button
                      type="button"
                      className={`ofeed-action ofeed-action--like ${p.liked ? 'is-active' : ''}`}
                      onClick={() => toggleLike(p._id)}
                      disabled={!user || likeBusy === p._id}
                      title="Like"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
                        <path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                      </svg>
                      <span>{compactCount(p.like_count)}</span>
                    </button>

                    <div className="ofeed-repost-wrap">
                      <button
                        type="button"
                        className="ofeed-action ofeed-action--repost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRepostMenu(repostMenu === p._id ? null : p._id);
                        }}
                        disabled={!user || repostBusy === p._id}
                        title="Repost"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
                          <path fill="currentColor" d="M4 12a8 8 0 018-8V.5L18.5 4 12 7.5V4a8 8 0 00-8 8zm8 8a8 8 0 008-8h-3L18.5 4 22 10.5H19a8 8 0 01-8 8v3.5L4.5 20 11 13.5H8z"/>
                        </svg>
                        <span>{compactCount(p.repost_of ? (p.embedded?.repost_count ?? 0) : (p.repost_count ?? 0))}</span>
                      </button>
                      {repostMenu === p._id && user && (
                        <div className="ofeed-repost-menu" onClick={(e) => e.stopPropagation()}>
                          <button type="button" onClick={() => doRepost(repostTargetId(p))}>Repost</button>
                          <button
                            type="button"
                            onClick={() => {
                              setQuoteFor(repostTargetId(p));
                              setQuoteDraft('');
                              setRepostMenu(null);
                            }}
                          >
                            Quote
                          </button>
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      className="ofeed-action ofeed-action--share"
                      onClick={() => copyLink(p._id)}
                      title="Copy link"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
                        <path fill="currentColor" d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
        {!loading && hasMore && posts.length > 0 && (
          <div className="ofeed-load-more-wrap">
            <button type="button" className="ofeed-load-more" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </aside>
  );

  if (isMobile) {
    return (
      <>
        <div className="ofeed-mobile-backdrop" onClick={() => setOpen?.(false)} role="presentation" />
        {panel}
      </>
    );
  }

  return panel;
}
