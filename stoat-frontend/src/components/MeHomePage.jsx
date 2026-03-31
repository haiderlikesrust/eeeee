import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useMobile } from '../context/MobileContext';
import { useWS } from '../context/WebSocketContext';
import { useToast } from '../context/ToastContext';
import { get, post } from '../api';
import { resolveFileUrl } from '../utils/avatarUrl';
import './MeHomePage.css';

const ONBOARD_FIRST_POST_KEY = 'opic.onboarding.firstPost.v1';

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
      <path fill="currentColor" d="M12 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm-7 9a7 7 0 0 1 14 0H5Z" />
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
  const { connected, send, on } = useWS();
  const toast = useToast();
  const navigate = useNavigate();
  const name = user?.display_name || user?.username || 'there';

  const [discoverList, setDiscoverList] = useState([]);
  const [discoverLoading, setDiscoverLoading] = useState(true);
  const [checklist, setChecklist] = useState({
    profileComplete: false,
    firstPost: false,
    joinedConversation: false,
    invitedFriend: false,
  });
  const [creatingTemplate, setCreatingTemplate] = useState(null);
  const wsDiscoverReceived = useRef(false);
  const joinWsPending = useRef(false);

  const loadDiscoverHttp = useCallback(async () => {
    try {
      const d = await get('/servers/discover');
      setDiscoverList(Array.isArray(d?.servers) ? d.servers : []);
    } catch {
      setDiscoverList([]);
    }
    setDiscoverLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    wsDiscoverReceived.current = false;
    setDiscoverLoading(true);

    const finishWs = () => {
      if (!cancelled) setDiscoverLoading(false);
    };

    if (connected) {
      const offOk = on('DiscoverServers', (data) => {
        wsDiscoverReceived.current = true;
        if (!cancelled) setDiscoverList(Array.isArray(data?.servers) ? data.servers : []);
        finishWs();
      });
      const offErr = on('DiscoverServersError', () => {
        loadDiscoverHttp();
      });
      send({ type: 'DiscoverServersRequest', d: { limit: 24 } });
      const t = setTimeout(() => {
        if (!cancelled && !wsDiscoverReceived.current) loadDiscoverHttp();
      }, 2000);
      return () => {
        cancelled = true;
        offOk();
        offErr();
        clearTimeout(t);
      };
    }

    loadDiscoverHttp();
    return () => { cancelled = true; };
  }, [connected, on, send, loadDiscoverHttp]);

  useEffect(() => {
    let cancelled = false;
    const loadChecklist = async () => {
      try {
        const [servers, dms] = await Promise.all([
          get('/users/servers').catch(() => []),
          get('/users/dms').catch(() => []),
        ]);
        if (cancelled) return;
        const firstPost = localStorage.getItem(ONBOARD_FIRST_POST_KEY) === '1';
        const profileComplete = !!(user?.display_name || user?.avatar || user?.profile?.bio || user?.profile?.content);
        const joinedConversation = (Array.isArray(servers) && servers.length > 0) || (Array.isArray(dms) && dms.length > 0);
        const invitedFriend = Array.isArray(user?.relations) && user.relations.some((r) => r?.status === 'Friend');
        setChecklist({ profileComplete, firstPost, joinedConversation, invitedFriend });
      } catch {}
    };
    loadChecklist();
    return () => { cancelled = true; };
  }, [user]);

  const checklistDone = Object.values(checklist).filter(Boolean).length;
  const onboardingTip = checklist.profileComplete
    ? (checklist.firstPost ? 'Try a starter template to spin up your first community in one click.' : 'Send your first message to unlock faster onboarding.')
    : 'Add a display name or avatar in User Settings to complete your profile.';

  const createStarterTemplate = useCallback(async (template) => {
    if (creatingTemplate) return;
    setCreatingTemplate(template);
    try {
      const defs = {
        friends: {
          serverName: 'Friends Hangout',
          channels: [
            { name: 'general', type: 'text', description: 'Daily chat and updates' },
            { name: 'memes', type: 'text', description: 'Drop funny stuff' },
            { name: 'voice', type: 'voice', description: 'Jump in and talk' },
          ],
        },
        study: {
          serverName: 'Study Space',
          channels: [
            { name: 'announcements', type: 'text', description: 'Important updates' },
            { name: 'resources', type: 'text', description: 'Links, notes, and docs' },
            { name: 'focus-room', type: 'voice', description: 'Pomodoro and deep work calls' },
          ],
        },
      };
      const def = defs[template];
      if (!def) return;
      const server = await post('/servers/create', { name: def.serverName });
      for (const channel of def.channels) {
        await post(`/servers/${server._id}/channels`, channel);
      }
      toast.success(`${def.serverName} created`);
      navigate(`/channels/${server._id}`);
    } catch (err) {
      toast.error(err?.error || 'Failed to create starter template');
    }
    setCreatingTemplate(null);
  }, [creatingTemplate, navigate, toast]);

  const joinDiscoverServer = useCallback(
    (slug) => {
      if (!slug) return;
      if (connected) {
        if (joinWsPending.current) return;
        joinWsPending.current = true;
        const unsubs = [];
        const done = () => {
          unsubs.forEach((u) => u());
          joinWsPending.current = false;
        };
        unsubs.push(
          on('JoinPublicServer', (d) => {
            done();
            if (d?.serverId) {
              navigate(`/channels/${d.serverId}`);
              toast.success('Joined server');
            }
          }),
        );
        unsubs.push(
          on('JoinPublicServerError', (e) => {
            done();
            toast.error(e?.error || 'Could not join');
            navigate(`/invite/${slug}`);
          }),
        );
        send({ type: 'JoinPublicServerRequest', d: { slug } });
        return;
      }
      navigate(`/invite/${slug}`);
    },
    [connected, navigate, on, send, toast],
  );

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

        <section className="me-home-onboarding" aria-labelledby="me-home-onboarding-heading">
          <div className="me-home-onboarding-top">
            <h2 id="me-home-onboarding-heading" className="me-home-discover-title">First-hour checklist</h2>
            <span className="me-home-onboarding-progress">{checklistDone}/4 complete</span>
          </div>
          <p className="me-home-discover-sub">{onboardingTip}</p>
          <div className="me-home-checklist">
            <div className={`me-home-check-item ${checklist.profileComplete ? 'done' : ''}`}>Profile complete</div>
            <div className={`me-home-check-item ${checklist.firstPost ? 'done' : ''}`}>First post sent</div>
            <div className={`me-home-check-item ${checklist.joinedConversation ? 'done' : ''}`}>Joined a server or DM</div>
            <div className={`me-home-check-item ${checklist.invitedFriend ? 'done' : ''}`}>Added a friend</div>
          </div>
          <div className="me-home-template-row">
            <button
              type="button"
              className="me-home-btn me-home-btn-secondary"
              onClick={() => createStarterTemplate('friends')}
              disabled={!!creatingTemplate}
            >
              {creatingTemplate === 'friends' ? 'Creating...' : 'Starter: Friends Community'}
            </button>
            <button
              type="button"
              className="me-home-btn me-home-btn-secondary"
              onClick={() => createStarterTemplate('study')}
              disabled={!!creatingTemplate}
            >
              {creatingTemplate === 'study' ? 'Creating...' : 'Starter: Study Group'}
            </button>
          </div>
        </section>

        <section className="me-home-discover" aria-labelledby="me-home-discover-heading" data-onboarding-id="onboarding-home-discover">
          <h2 id="me-home-discover-heading" className="me-home-discover-title">
            Discover servers
          </h2>
          <p className="me-home-discover-sub">Public communities you can join in one click.</p>
          {discoverLoading && <p className="me-home-discover-loading">Loading…</p>}
          {!discoverLoading && discoverList.length === 0 && (
            <p className="me-home-discover-empty">No public servers yet. Check back later.</p>
          )}
          {!discoverLoading && discoverList.length > 0 && (
            <div className="me-home-discover-grid">
              {discoverList.map((s) => {
                const bannerUrl = resolveFileUrl(s.banner);
                const iconUrl = resolveFileUrl(s.icon);
                return (
                  <article key={s.id} className="me-home-discover-card">
                    <div
                      className="me-home-discover-card-banner"
                      style={bannerUrl ? { backgroundImage: `url(${bannerUrl})` } : undefined}
                    />
                    <div className="me-home-discover-card-body">
                      <div className="me-home-discover-card-icon">
                        {iconUrl ? (
                          <img src={iconUrl} alt="" />
                        ) : (
                          <span>{(s.name || 'S').slice(0, 2).toUpperCase()}</span>
                        )}
                      </div>
                      <div className="me-home-discover-card-text">
                        <h3 className="me-home-discover-card-name">{s.name}</h3>
                        <p className="me-home-discover-card-desc">
                          {(s.description || '').slice(0, 120)}
                          {(s.description || '').length > 120 ? '…' : ''}
                        </p>
                        <span className="me-home-discover-card-meta">
                          {typeof s.member_count === 'number' ? `${s.member_count} members` : ''}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="me-home-discover-join"
                        onClick={() => joinDiscoverServer(s.slug)}
                      >
                        Join
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

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

        <section className="me-home-rooms-cta">
          <h2 className="me-home-discover-title">Opic Rooms</h2>
          <p className="me-home-discover-sub">
            Temporary hangout spaces with chat and voice. Create one in seconds &mdash; it closes when everyone leaves.
          </p>
          <div className="me-home-template-row">
            <button
              type="button"
              className="me-home-btn me-home-btn-room"
              title="Opic Rooms are still in works"
              onClick={() => toast.info('Opic Rooms are still in works.')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style={{ marginRight: 6 }}>
                <path fill="currentColor" d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
              </svg>
              Create a Room
            </button>
          </div>
        </section>

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
          <Link to="/cloud" className="me-home-btn me-home-btn-secondary">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
            </svg>
            Opic Cloud
          </Link>
          <Link to="/developers/docs/api" className="me-home-btn me-home-btn-secondary">
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
