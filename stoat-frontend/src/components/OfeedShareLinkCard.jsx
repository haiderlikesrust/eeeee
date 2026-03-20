import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { get } from '../api';
import { useOfeed } from '../context/OfeedContext';
import { resolveFileUrl } from '../utils/avatarUrl';
import { parseOfeedShareUrl } from '../utils/ofeedShareUrl';
import './OfeedShareLinkCard.css';

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

export default function OfeedShareLinkCard({ url }) {
  const postId = parseOfeedShareUrl(url);
  const navigate = useNavigate();
  const { setOpen: setOfeedOpen, setDeepLinkPostId } = useOfeed() || {};
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(!!postId);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!postId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    get(`/ofeed/posts/${postId}`)
      .then((data) => {
        if (cancelled) return;
        if (data?.post) setPost(data.post);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [postId]);

  const openInOfeed = (e) => {
    e.preventDefault();
    if (!postId) return;
    navigate(`/channels/@me#ofeed_post=${postId}`);
    setOfeedOpen?.(true);
    setDeepLinkPostId?.(postId);
  };

  if (!postId) return null;

  const mainAuthor = post?.author;
  const embedded = post?.embedded;
  const showQuote = Boolean(post?.repost_of && embedded);
  const commentText = (post?.content && String(post.content).trim()) || '';

  return (
    <button type="button" className="msg-ofeed-share" onClick={openInOfeed}>
      <div className="msg-ofeed-share-top">
        <div className="msg-ofeed-share-brand">
          <h3 className="msg-ofeed-share-title">Ofeed</h3>
          <span className="msg-ofeed-share-beta">Beta</span>
        </div>
        <span className="msg-ofeed-share-chevron" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
      <p className="msg-ofeed-share-tagline">Share it with others</p>
      <div className="msg-ofeed-share-body">
        {loading && (
          <div className="msg-ofeed-share-loading">
            <div className="msg-ofeed-share-skel" style={{ width: '40%' }} />
            <div className="msg-ofeed-share-skel" style={{ width: '100%' }} />
            <div className="msg-ofeed-share-skel" style={{ width: '85%' }} />
          </div>
        )}
        {!loading && failed && (
          <p className="msg-ofeed-share-error">Couldn’t load this post. Open Ofeed to try again.</p>
        )}
        {!loading && !failed && post && (
          <>
            <div className="msg-ofeed-share-author">
              <div className="msg-ofeed-share-avatar">
                {mainAuthor?.avatar ? (
                  <img src={resolveFileUrl(mainAuthor.avatar)} alt="" />
                ) : (
                  <span>{displayName(mainAuthor).slice(0, 1).toUpperCase()}</span>
                )}
              </div>
              <div className="msg-ofeed-share-meta">
                <span className="msg-ofeed-share-name">{displayName(mainAuthor)}</span>
                <span className="msg-ofeed-share-handle">{handleLine(mainAuthor)}</span>
              </div>
            </div>
            {showQuote && (
              <div className="msg-ofeed-share-quote">
                <div className="msg-ofeed-share-quote-head">
                  <span className="msg-ofeed-share-quote-name">{displayName(embedded.author)}</span>
                </div>
                <p className="msg-ofeed-share-quote-text">{embedded.content || ''}</p>
              </div>
            )}
            {!showQuote && (post?.content || '').trim().length > 0 && (
              <p className="msg-ofeed-share-text">{post.content}</p>
            )}
            {showQuote && commentText.length > 0 && (
              <p className="msg-ofeed-share-text">{commentText}</p>
            )}
          </>
        )}
      </div>
    </button>
  );
}
