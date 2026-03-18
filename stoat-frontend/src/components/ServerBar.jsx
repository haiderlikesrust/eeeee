import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useMobile } from '../context/MobileContext';
import { useUnread } from '../context/UnreadContext';
import { resolveFileUrl } from '../utils/avatarUrl';
import { post } from '../api';
import './ServerBar.css';

export default function ServerBar({ servers, setServers, onServerAdded }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { isMobile: isMobileDevice, mobileOverlay, closeMobileOverlay } = useMobile();
  const { hasServerUnread, hasAnyDmUnread } = useUnread();
  const [showCreate, setShowCreate] = useState(false);
  const [serverName, setServerName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [showJoin, setShowJoin] = useState(false);

  const isHome = location.pathname.startsWith('/channels/@me');

  const handleCreate = async () => {
    if (!serverName.trim()) return;
    try {
      const res = await post('/servers/create', { name: serverName });
      onServerAdded(res.server);
      setServerName('');
      setShowCreate(false);
      navigate(`/channels/${res.server._id}`);
    } catch {}
  };

  const handleJoin = async () => {
    if (!inviteCode.trim()) return;
    try {
      const res = await post(`/invites/${inviteCode.trim()}`);
      if (res?.server) {
        const { get: apiGet } = await import('../api');
        const server = await apiGet(`/servers/${res.server}`);
        onServerAdded(server);
        navigate(`/channels/${res.server}`);
      }
      setInviteCode('');
      setShowJoin(false);
    } catch {}
  };

  const initial = (name) => name ? name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() : '?';

  const getIconUrl = (server) => resolveFileUrl(server?.icon);

  const isDrawerOpen = isMobileDevice && mobileOverlay === 'channelSidebar';

  return (
    <div className="server-bar" role={isDrawerOpen ? 'dialog' : undefined} aria-modal={isDrawerOpen ? 'true' : undefined}>
      <div
        className={`server-icon home-icon ${isHome ? 'active' : ''} ${hasAnyDmUnread ? 'has-unread' : ''}`}
        onClick={() => { navigate('/channels/@me'); closeMobileOverlay(); }}
        title="Direct Messages"
      >
        {hasAnyDmUnread && <span className="server-unread-badge" aria-label="Unread messages" />}
        <svg width="28" height="20" viewBox="0 0 28 20"><path fill="currentColor" d="M23.0212 1.67671C21.3107 0.879656 19.5079 0.318797 17.6584 0C17.4062 0.461742 17.1749 0.934541 16.966 1.4184C15.0194 1.11762 13.0495 1.11762 11.1029 1.4184C10.8939 0.934541 10.6627 0.461742 10.4099 0C8.55904 0.320753 6.75599 0.882568 5.04562 1.68093C1.00279 7.77986 -0.0279 13.7264 0.497038 19.5936C2.55888 21.1196 4.88548 22.2563 7.36193 22.9483C7.89225 22.2422 8.36413 21.4953 8.77234 20.7137C8.0196 20.4279 7.29459 20.078 6.60464 19.6685C6.79624 19.5272 6.98378 19.3812 7.16592 19.2352C12.2831 21.597 17.8341 21.597 22.8925 19.2352C23.0764 19.3831 23.2639 19.5291 23.4537 19.6685C22.762 20.0798 22.0352 20.4315 21.2807 20.7183C21.6897 21.4999 22.162 22.2467 22.6929 22.9529C25.1711 22.2617 27.4988 21.1242 29.5613 19.5982C30.1815 12.8264 28.5104 6.93527 23.0212 1.67671ZM9.68261 16.0358C8.22654 16.0358 7.03121 14.7054 7.03121 13.0861C7.03121 11.4667 8.19857 10.1327 9.68261 10.1327C11.1667 10.1327 12.3617 11.4685 12.3340 13.0861C12.3368 14.7054 11.1667 16.0358 9.68261 16.0358ZM20.3752 16.0358C18.9192 16.0358 17.7238 14.7054 17.7238 13.0861C17.7238 11.4667 18.8912 10.1327 20.3752 10.1327C21.8592 10.1327 23.0543 11.4685 23.0266 13.0861C23.0266 14.7054 21.8592 16.0358 20.3752 16.0358Z"/></svg>
      </div>
      <div className="server-separator" />

      {servers.map((s) => {
        const iconUrl = getIconUrl(s);
        const unread = hasServerUnread(s._id);
        return (
          <div
            key={s._id}
            className={`server-icon ${location.pathname.includes(s._id) ? 'active' : ''} ${iconUrl ? 'has-img' : ''} ${unread ? 'has-unread' : ''}`}
            onClick={() => { navigate(`/channels/${s._id}`); closeMobileOverlay(); }}
            title={s.name}
          >
            {unread && <span className="server-unread-badge" aria-label="Unread" />}
            {iconUrl ? <img src={iconUrl} alt={s.name} className="server-icon-image" /> : initial(s.name)}
          </div>
        );
      })}

      <div className="server-icon add-icon" onClick={() => setShowCreate(true)} title="Add a Server">
        <svg width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2.5a1 1 0 0 1 1 1V11h7.5a1 1 0 1 1 0 2H13v7.5a1 1 0 1 1-2 0V13H3.5a1 1 0 0 1 0-2H11V3.5a1 1 0 0 1 1-1z"/></svg>
      </div>
      <div className="server-icon add-icon" onClick={() => setShowJoin(true)} title="Join a Server">
        <svg width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.486 2 2 6.486 2 12C2 17.515 6.486 22 12 22C17.514 22 22 17.515 22 12C22 6.486 17.514 2 12 2ZM16.886 12.553L11.886 15.553C11.6354 15.6988 11.3184 15.6988 11.0678 15.553C10.8171 15.4073 10.6586 15.1359 10.6586 14.8444V8.84441C10.6586 8.55295 10.8171 8.28155 11.0678 8.13583C11.3184 7.99011 11.6354 7.99011 11.886 8.13583L16.886 11.1358C17.1367 11.2816 17.2951 11.553 17.2951 11.8444C17.2951 12.1359 17.1367 12.4073 16.886 12.553Z"/></svg>
      </div>

      <div className="server-bar-spacer" />

      <div className="server-icon user-icon" title={user?.username || 'User'} onClick={logout}>
        <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M18 2H7a1 1 0 0 0 0 2h11a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 0 0 2h11a3 3 0 0 0 3-3V5a3 3 0 0 0-3-3zm-6.707 14.707a1 1 0 0 0 1.414-1.414L10.414 13H17a1 1 0 0 0 0-2h-6.586l2.293-2.293a1 1 0 1 0-1.414-1.414l-4 4a1 1 0 0 0 0 1.414z"/></svg>
      </div>

      {showCreate && createPortal(
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h2>Create a Server</h2>
            <p className="modal-sub">Give your new server a personality with a name.</p>
            <label className="auth-label">
              <span>SERVER NAME</span>
              <input value={serverName} onChange={(e) => setServerName(e.target.value)} placeholder="My Server" autoFocus onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
            </label>
            <div className="modal-actions">
              <button className="modal-btn secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="modal-btn primary" onClick={handleCreate}>Create</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showJoin && createPortal(
        <div className="modal-overlay" onClick={() => setShowJoin(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h2>Join a Server</h2>
            <p className="modal-sub">Enter an invite code to join an existing server.</p>
            <label className="auth-label">
              <span>INVITE CODE</span>
              <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="abcd1234" autoFocus onKeyDown={(e) => e.key === 'Enter' && handleJoin()} />
            </label>
            <div className="modal-actions">
              <button className="modal-btn secondary" onClick={() => setShowJoin(false)}>Cancel</button>
              <button className="modal-btn primary" onClick={handleJoin}>Join</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
