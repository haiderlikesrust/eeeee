import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './ChangelogPage.css';

const TAGS = {
  new: { label: 'New', className: 'tag-new' },
  improved: { label: 'Improved', className: 'tag-improved' },
  fixed: { label: 'Fixed', className: 'tag-fixed' },
};

const CHANGELOG = [
  {
    version: '0.2.0',
    date: '2026-03-18',
    title: 'Voice, presence & polish',
    changes: [
      { tag: 'new', text: 'Screen share in voice channels — share your screen; viewers get a large feed with Expand overlay.' },
      { tag: 'improved', text: 'Screen share viewer layout — main feed fills width; multiple shares show one focused feed plus thumbnails; click to focus.' },
      { tag: 'fixed', text: 'Screen share reliability — backend relay, track handling, and renegotiation so the other browser receives the stream.' },
      { tag: 'fixed', text: 'Screen share viewer size — grid layout and compact participants strip so the shared screen is large for viewers. Note: this layout issue may resurface with future UI or CSS changes; report if the shared screen appears small again.' },
      { tag: 'new', text: 'Voice join/leave sounds — short tones when you or others join or leave a voice channel.' },
      { tag: 'improved', text: 'Real-time presence — member list updates when users come online or go offline without refresh; heartbeat and disconnect broadcast.' },
      { tag: 'improved', text: 'Changelog page — expand/collapse all, print and reduced-motion styles, Back to top.' },
      { tag: 'new', text: 'Opic rebrand — app name shown as Opic in title, login, register, and changelog.' },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-03-18',
    title: 'Initial Release',
    changes: [
      { tag: 'new', text: 'Real-time presence — member list updates instantly when users come online or go offline.' },
      { tag: 'improved', text: 'Offline detection via heartbeat catches closed tabs and network drops within ~35 seconds.' },
      { tag: 'new', text: 'Changelog page to view release notes and track updates.' },
      { tag: 'new', text: 'Invite system with shareable links and preview pages.' },
      { tag: 'new', text: 'Voice channels with WebRTC support.' },
      { tag: 'new', text: 'Role management with permissions, colors, and hoisted display.' },
      { tag: 'new', text: 'Direct messages and group conversations.' },
      { tag: 'new', text: 'Bot SDK and no-code bot builder for custom integrations.' },
      { tag: 'new', text: 'Developer portal for managing bots and tokens.' },
    ],
  },
];

export default function ChangelogPage() {
  const { user } = useAuth();
  const [expandedVersion, setExpandedVersion] = useState(CHANGELOG[0]?.version ?? null);
  const topRef = useRef(null);

  useEffect(() => {
    const prev = document.title;
    document.title = 'Changelog — Opic';
    return () => { document.title = prev; };
  }, []);

  const expandedSet = expandedVersion == null
    ? new Set()
    : Array.isArray(expandedVersion)
      ? new Set(expandedVersion)
      : new Set([expandedVersion]);
  const isExpanded = (version) => expandedSet.has(version);
  const expandAll = () => setExpandedVersion(CHANGELOG.map((r) => r.version));
  const collapseAll = () => setExpandedVersion(null);
  const toggleOne = (version) => setExpandedVersion(isExpanded(version) ? null : version);
  const hasMultiple = CHANGELOG.length > 1;

  return (
    <div className="changelog-page" ref={topRef}>
      <div className="changelog-container">
        <header className="changelog-header">
          <div className="changelog-brand">
            <img src="/favicon.svg" alt="" className="changelog-logo" />
            <div>
              <h1>Changelog</h1>
              <p className="changelog-sub">What's new in Opic</p>
            </div>
          </div>
          <nav className="changelog-nav">
            {user ? (
              <Link to="/channels/@me" className="changelog-nav-btn">← Back to app</Link>
            ) : (
              <>
                <Link to="/login" className="changelog-nav-btn">Log in</Link>
                <Link to="/register" className="changelog-nav-btn primary">Sign up</Link>
              </>
            )}
          </nav>
        </header>

        {hasMultiple && (
          <div className="changelog-actions">
            <button type="button" className="changelog-action-btn" onClick={expandAll}>
              Expand all
            </button>
            <button type="button" className="changelog-action-btn" onClick={collapseAll}>
              Collapse all
            </button>
          </div>
        )}

        <div className="changelog-timeline">
          {CHANGELOG.map((release, idx) => {
            const expanded = isExpanded(release.version);
            const isLatest = idx === 0;
            return (
              <article key={release.version} className={`changelog-release ${expanded ? 'expanded' : ''}`}>
                <div className="changelog-dot-line">
                  <span className={`changelog-dot ${isLatest ? 'latest' : ''}`} />
                  {idx < CHANGELOG.length - 1 && <span className="changelog-line" />}
                </div>
                <div className="changelog-release-body">
                  <button
                    type="button"
                    className="changelog-release-header"
                    onClick={() => toggleOne(release.version)}
                    aria-expanded={expanded}
                  >
                    <div className="changelog-release-meta">
                      <span className="changelog-version">v{release.version}</span>
                      {isLatest && <span className="changelog-latest-badge">Latest</span>}
                      {release.title && <span className="changelog-title">{release.title}</span>}
                    </div>
                    <time className="changelog-date" dateTime={release.date}>
                      {formatDate(release.date)}
                    </time>
                    <svg className={`changelog-chevron ${expanded ? 'open' : ''}`} width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M4.47 5.47a.75.75 0 0 1 1.06 0L8 7.94l2.47-2.47a.75.75 0 1 1 1.06 1.06l-3 3a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 0 1 0-1.06Z"/></svg>
                  </button>
                  {expanded && (
                    <ul className="changelog-changes">
                      {release.changes.map((item, i) => {
                        const change = typeof item === 'string' ? { text: item } : item;
                        const tag = change.tag && TAGS[change.tag];
                        return (
                          <li key={i}>
                            {tag && <span className={`changelog-tag ${tag.className}`}>{tag.label}</span>}
                            <span>{change.text}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        <footer className="changelog-footer">
          <button type="button" className="changelog-back-top" onClick={() => topRef.current?.scrollIntoView({ behavior: 'smooth' })}>
            Back to top
          </button>
          {user && (
            <Link to="/channels/@me" className="changelog-footer-link">Open Opic</Link>
          )}
        </footer>
      </div>
    </div>
  );
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return iso;
  }
}
