import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useMobile } from '../context/MobileContext';
import { post, get, put, del } from '../api';
import ProfileCard from './ProfileCard';
import './FriendsPage.css';

export default function FriendsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { isMobile, openChannelSidebar } = useMobile();
  const [tab, setTab] = useState('online');
  const [addUsername, setAddUsername] = useState('');
  const [addResult, setAddResult] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [profileCard, setProfileCard] = useState(null);

  const friends = (user?.relations || []).filter((r) => r.status === 'Friend');
  const pending = (user?.relations || []).filter((r) => r.status === 'Incoming' || r.status === 'Outgoing');
  const blocked = (user?.relations || []).filter((r) => r.status === 'Blocked');

  const handleAdd = async () => {
    if (!addUsername.trim()) return;
    setAddResult(null);
    try {
      await post('/users/friend', { username: addUsername.trim() });
      setAddResult({ success: true, msg: 'Friend request sent!' });
      setAddUsername('');
    } catch (err) {
      setAddResult({ success: false, msg: err.error || 'Failed to send request' });
    }
  };

  const acceptFriend = async (userId) => {
    try {
      await put(`/users/${userId}/friend`);
    } catch {}
  };

  const removeFriend = async (userId) => {
    try {
      await del(`/users/${userId}/friend`);
    } catch {}
  };

  const blockUser = async (userId) => {
    try {
      await put(`/users/${userId}/block`);
    } catch {}
  };

  const unblockUser = async (userId) => {
    try {
      await del(`/users/${userId}/block`);
    } catch {}
  };

  const openDM = async (userId) => {
    try {
      const dm = await get(`/users/${userId}/dm`);
      if (dm?._id) navigate(`/channels/@me/${dm._id}`);
    } catch {}
  };

  const openProfileCard = async (userId, rect) => {
    try {
      const target = await get(`/users/${userId}`);
      let left = rect.right + 8;
      let top = rect.top;
      if (left + 320 > window.innerWidth - 8) left = rect.left - 328;
      if (top + 380 > window.innerHeight - 8) top = window.innerHeight - 388;
      setProfileCard({
        user: target,
        style: { left: `${Math.max(8, left)}px`, top: `${Math.max(8, top)}px`, position: 'fixed' },
      });
    } catch {}
  };

  const displayList = tab === 'pending' ? pending : tab === 'blocked' ? blocked : friends;

  return (
    <div className="friends-page">
      {profileCard && (
        <>
          <div className="profile-card-backdrop" onClick={() => setProfileCard(null)} />
          <ProfileCard user={profileCard.user} style={profileCard.style} />
        </>
      )}
      <div className="chat-header friends-header">
        {isMobile && (
          <button className="mobile-drawer-btn" onClick={openChannelSidebar} aria-label="Open channels">
            <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>
          </button>
        )}
        <svg width="24" height="24" viewBox="0 0 24 24" style={{ flexShrink: 0 }}><path fill="currentColor" d="M12 12.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM12.6 14h-1.2a5.4 5.4 0 0 0-5.4 5.36 .6.6 0 0 0 .6.64h10.8a.6.6 0 0 0 .6-.64A5.4 5.4 0 0 0 12.6 14Z"/></svg>
        <span className="friends-title">Friends</span>
        <div className="friends-divider" />
        <button className={`friends-tab ${tab === 'online' ? 'active' : ''}`} onClick={() => { setTab('online'); setShowAdd(false); }}>All</button>
        <button className={`friends-tab ${tab === 'pending' ? 'active' : ''}`} onClick={() => { setTab('pending'); setShowAdd(false); }}>Pending</button>
        <button className={`friends-tab ${tab === 'blocked' ? 'active' : ''}`} onClick={() => { setTab('blocked'); setShowAdd(false); }}>Blocked</button>
        <button className="friends-tab add-btn" onClick={() => setShowAdd(!showAdd)}>Add Friend</button>
      </div>

      {showAdd && (
        <div className="add-friend-bar">
          <div className="add-friend-desc">You can add friends with their username.</div>
          <div className="add-friend-row">
            <input
              className="add-friend-input"
              value={addUsername}
              onChange={(e) => setAddUsername(e.target.value)}
              placeholder="Enter a username"
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <button className="add-friend-btn" onClick={handleAdd} disabled={!addUsername.trim()}>
              Send Friend Request
            </button>
          </div>
          {addResult && (
            <div className={`add-result ${addResult.success ? 'success' : 'error'}`}>
              {addResult.msg}
            </div>
          )}
        </div>
      )}

      <div className="friends-list">
        {displayList.length === 0 && (
          <div className="friends-empty">
            {showAdd ? '' : tab === 'pending' ? 'No pending requests' : tab === 'blocked' ? 'No blocked users' : 'No friends yet. Add some!'}
          </div>
        )}
        {displayList.map((r) => (
          <div key={r._id} className="friend-item">
            <div className="friend-avatar" onClick={(e) => openProfileCard(r._id, e.currentTarget.getBoundingClientRect())}>{(r._id || '?')[0].toUpperCase()}</div>
            <div className="friend-info">
              <span className="friend-name" onClick={(e) => openProfileCard(r._id, e.currentTarget.getBoundingClientRect())}>{r._id}</span>
              <span className="friend-status">{r.status}</span>
            </div>
            <div className="friend-actions">
              {r.status === 'Friend' && (
                <>
                  <button className="friend-action-btn message" onClick={() => openDM(r._id)} title="Message">
                    <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>
                  </button>
                  <button className="friend-action-btn danger" onClick={() => removeFriend(r._id)} title="Remove Friend">
                    <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                  </button>
                </>
              )}
              {r.status === 'Incoming' && (
                <>
                  <button className="friend-action-btn accept" onClick={() => acceptFriend(r._id)} title="Accept">
                    <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                  </button>
                  <button className="friend-action-btn danger" onClick={() => removeFriend(r._id)} title="Decline">
                    <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                  </button>
                </>
              )}
              {r.status === 'Outgoing' && (
                <button className="friend-action-btn danger" onClick={() => removeFriend(r._id)} title="Cancel Request">
                  <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                </button>
              )}
              {r.status === 'Blocked' && (
                <button className="friend-action-btn accept" onClick={() => unblockUser(r._id)} title="Unblock">
                  Unblock
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
