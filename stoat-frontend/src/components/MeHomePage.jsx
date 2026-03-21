import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useMobile } from '../context/MobileContext';
import './MeHomePage.css';

function IconServers() {
  return (
    <svg className="me-home-card-icon-svg" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path fill="currentColor" d="M4 4h7v7H4V4zm9 0h7v4h-7V4zM4 13h7v7H4v-7zm9 3h7v4h-7v-4z" />
    </svg>
  );
}

function IconFriends() {
  return (
    <svg className="me-home-card-icon-svg" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path fill="currentColor" d="M12 12.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM12.6 14h-1.2a5.4 5.4 0 0 0-5.4 5.36 .6.6 0 0 0 .6.64h10.8a.6.6 0 0 0 .6-.64A5.4 5.4 0 0 0 12.6 14Z" />
    </svg>
  );
}

function IconSpark() {
  return (
    <svg className="me-home-card-icon-svg" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path fill="currentColor" d="m12 3 1.35 4.15L18 8.5l-4.65 1.35L12 14l-1.35-4.15L6 8.5l4.65-1.35L12 3ZM6 14l.9 2.76L9.5 18l-2.6.75L6 21.5l-.9-2.75L2.5 18l2.6-.74L6 14Zm12.5 1.5.55 1.7 1.7.5-1.7.49-.55 1.69-.55-1.7-1.69-.5 1.7-.49.54-1.69Z" />
    </svg>
  );
}

export default function MeHomePage() {
  const { user } = useAuth();
  const { isMobile, openChannelSidebar } = useMobile();
  const name = user?.display_name || user?.username || 'there';

  return (
    <div className="me-home-page">
      <div className="me-home-bg" aria-hidden="true">
        <div className="me-home-bg-blob me-home-bg-blob-a" />
        <div className="me-home-bg-blob me-home-bg-blob-b" />
        <div className="me-home-bg-grid" />
      </div>

      <div className="me-home-inner">
        {isMobile && (
          <div className="me-home-mobile-bar">
            <button type="button" className="mobile-drawer-btn" onClick={openChannelSidebar} aria-label="Open channels">
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
              </svg>
            </button>
            <span className="me-home-mobile-title">Home</span>
          </div>
        )}

        <header className="me-home-hero">
          <span className="me-home-badge">
            <span className="me-home-badge-dot" aria-hidden="true" />
            Your space
          </span>
          <h1 className="me-home-title">
            Welcome to <span className="me-home-title-accent">Opic</span>
          </h1>
          <p className="me-home-lead">
            Hi, <span className="me-home-name">{name}</span>
            <span className="me-home-lead-sep" aria-hidden="true" />
            chat, hang out, and build communities in one place.
          </p>
        </header>

        <div className="me-home-grid" role="list">
          <article className="me-home-card me-home-card-emerald" role="listitem">
            <div className="me-home-card-top">
              <span className="me-home-card-icon" aria-hidden="true">
                <IconServers />
              </span>
              <h2 className="me-home-card-title">Servers &amp; channels</h2>
            </div>
            <p className="me-home-card-text">
              Join or create servers, organize topics into text and voice channels, and keep conversations in one place.
              Permissions and roles help moderators run communities smoothly.
            </p>
          </article>

          <article className="me-home-card me-home-card-violet" role="listitem">
            <div className="me-home-card-top">
              <span className="me-home-card-icon" aria-hidden="true">
                <IconFriends />
              </span>
              <h2 className="me-home-card-title">Friends &amp; DMs</h2>
            </div>
            <p className="me-home-card-text">
              Add friends, accept requests, and open direct messages from the sidebar. Unread badges stay in sync across
              the app.
            </p>
          </article>

          <article className="me-home-card me-home-card-amber" role="listitem">
            <div className="me-home-card-top">
              <span className="me-home-card-icon" aria-hidden="true">
                <IconSpark />
              </span>
              <h2 className="me-home-card-title">More in Opic</h2>
            </div>
            <p className="me-home-card-text">
              Voice channels for group calls, rich profiles and presence, Ofeed for your network, and a developer portal
              for bots and integrations.
            </p>
          </article>
        </div>

        <footer className="me-home-actions">
          <Link to="/channels/@me/friends" className="me-home-btn me-home-btn-primary">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
            </svg>
            Open Friends
          </Link>
          <Link to="/changelog" className="me-home-btn me-home-btn-secondary">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V7h2v2zm6 8h-4v-2h4v2zm0-4h-4v-2h4v2zm0-4h-4V7h4v2z" />
            </svg>
            Changelog
          </Link>
          <Link to="/developers" className="me-home-btn me-home-btn-secondary">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" />
            </svg>
            Developer portal
          </Link>
        </footer>
      </div>
    </div>
  );
}
