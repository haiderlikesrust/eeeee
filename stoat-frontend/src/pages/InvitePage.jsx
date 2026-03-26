import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { get, post } from '../api';
import { useToast } from '../context/ToastContext';
import { resolveFileUrl } from '../utils/avatarUrl';
import './InvitePage.css';

export default function InvitePage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchPreview = async () => {
      try {
        const data = await get(`/invites/${code}/preview`);
        if (!cancelled) setPreview(data);
      } catch {
        if (!cancelled) setPreview(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    if (code) fetchPreview();
    return () => { cancelled = true; };
  }, [code]);

  const handleJoin = async () => {
    if (!user || !code) return;
    setJoining(true);
    try {
      const channel = await post(`/invites/${code}`);
      const serverId = channel?.server || preview?.server?.id;
      if (serverId) navigate(`/channels/${serverId}`);
      else navigate('/channels/@me');
      toast.success(`Joined ${preview?.server?.name || 'server'}`);
    } catch (err) {
      if (err?.type === 'ServerLocked') {
        toast.error('This server is locked; no new members can join.');
      } else if (err?.type === 'AlreadyInServer') {
        const serverId = preview?.server?.id;
        if (serverId) navigate(`/channels/${serverId}`);
        else navigate('/channels/@me');
      } else {
        toast.error(err?.error || err?.message || 'Failed to join');
      }
    } finally {
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="invite-page">
        <div className="invite-card">
          <p className="invite-loading">Loading invite...</p>
        </div>
      </div>
    );
  }

  if (!preview || !preview.server) {
    return (
      <div className="invite-page">
        <div className="invite-card invite-card-error">
          <h1 className="invite-title">Invalid or expired invite</h1>
          <p className="invite-sub">This invite link may have been revoked or never existed.</p>
          {user ? (
            <Link to="/channels/@me" className="invite-btn primary">Go to app</Link>
          ) : (
            <Link to="/login" className="invite-btn primary">Log in</Link>
          )}
        </div>
      </div>
    );
  }

  const serverName = preview.server.name;
  const isLocked = preview.server.locked;
  const bannerUrl = resolveFileUrl(preview.server.banner);
  const iconUrl = resolveFileUrl(preview.server.icon);
  const hasHero = Boolean(bannerUrl || iconUrl);

  return (
    <div className={`invite-page ${hasHero ? 'invite-page--hero' : ''}`}>
      <div className={`invite-card ${hasHero ? 'invite-card--hero' : ''}`}>
        {hasHero && (
          <div
            className="invite-card-hero"
            style={bannerUrl ? { backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.2) 0%, var(--bg-secondary) 100%), url(${bannerUrl})` } : undefined}
          >
            <div className="invite-card-hero-icon">
              {iconUrl ? (
                <img src={iconUrl} alt="" />
              ) : (
                <span aria-hidden="true">{serverName.slice(0, 2).toUpperCase()}</span>
              )}
            </div>
          </div>
        )}
        <div className="invite-card-inner">
        <h1 className="invite-title">You've been invited to join</h1>
        <p className="invite-server-name">{serverName}</p>

        {isLocked ? (
          <div className="invite-locked">
            <span className="invite-locked-icon" aria-hidden>🔒</span>
            <p>This server is locked</p>
            <p className="invite-locked-sub">No new members can join right now.</p>
          </div>
        ) : !user ? (
          <div className="invite-actions">
            <p className="invite-login-prompt">Log in to join this server.</p>
            <Link to={`/login?redirect=${encodeURIComponent(`/invite/${code}`)}`} className="invite-btn primary">
              Log in to join
            </Link>
          </div>
        ) : (
          <div className="invite-actions">
            <button
              type="button"
              className="invite-btn primary"
              onClick={handleJoin}
              disabled={joining}
            >
              {joining ? 'Joining...' : 'Join server'}
            </button>
          </div>
        )}

        {user && !isLocked && (
          <Link to="/channels/@me" className="invite-back">Back to app</Link>
        )}
        </div>
      </div>
    </div>
  );
}
