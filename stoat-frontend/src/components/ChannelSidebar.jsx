import { useState, useEffect, useRef, memo } from 'react';
import { useNavigate, useParams, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useWS } from '../context/WebSocketContext';
import { useVoice } from '../context/VoiceContext';
import { useMobile } from '../context/MobileContext';
import { useUnread } from '../context/UnreadContext';
import { resolveFileUrl } from '../utils/avatarUrl';
import { formatActivityPrimary } from '../utils/activityDisplay';
import { Permissions, hasPermission, hasServerPermission } from '../utils/permissions';
import { get, post, patch, del } from '../api';
import ServerSettings from './ServerSettings';
import UserSettings from './UserSettings';
import VoicePanel from './VoicePanel';
import ProfileCard from './ProfileCard';
import { isBotUser, isVerifiedBotUser } from '../utils/botDisplay';
import { userHasOpicStaff } from '../utils/opicStaff';
import ServerOwnerCrown from './ServerOwnerCrown';
import { showServerOwnerCrownForUser } from '../utils/serverOwnerCrownDisplay';
import './ChannelSidebar.css';

function VoiceChannelTimer({ startTime }) {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (startTime == null) return;
    const tick = () => setElapsed(Math.floor((Date.now() - startTime) / 1000));
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [startTime]);

  if (startTime == null) return null;
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return (
    <span className="voice-channel-timer" aria-label={`Call duration ${m}:${String(s).padStart(2, '0')}`}>
      {m}:{String(s).padStart(2, '0')}
    </span>
  );
}

function ChannelSidebar({
  type,
  server,
  channels,
  serverId,
  serverChannelsLoading = false,
  dms,
  onChannelCreated,
  onServerUpdated,
  onServerDeleted,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const params = useParams();
  const { isMobile: isMobileDevice, mobileOverlay, closeMobileOverlay } = useMobile();
  const { isChannelUnread } = useUnread();
  const isDrawerOpen = isMobileDevice && mobileOverlay === 'channelSidebar';
  const [showDropdown, setShowDropdown] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showEditChannel, setShowEditChannel] = useState(null);
  const [channelName, setChannelName] = useState('');
  const [channelDesc, setChannelDesc] = useState('');
  const [channelType, setChannelType] = useState('text');
  const [editChName, setEditChName] = useState('');
  const [editChDesc, setEditChDesc] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const voice = useVoice();
  /** Bitfield from GET /servers/:id/permissions. Default 0 until loaded — never assume full perms. */
  const [serverPerms, setServerPerms] = useState(0);
  const [profileCard, setProfileCard] = useState(null);

  const isOwner = server && user && server.owner === user._id;
  const canManageChannels = hasServerPermission(serverPerms, Permissions.MANAGE_CHANNELS);
  const canManageServer = hasServerPermission(serverPerms, Permissions.MANAGE_SERVER) || isOwner;
  const canCreateInvites = hasServerPermission(serverPerms, Permissions.CREATE_INVITES);
  const canAccessSettings = canManageServer
    || hasServerPermission(serverPerms, Permissions.MANAGE_ROLES)
    || hasServerPermission(serverPerms, Permissions.MANAGE_CHANNELS)
    || hasServerPermission(serverPerms, Permissions.KICK_MEMBERS)
    || hasServerPermission(serverPerms, Permissions.BAN_MEMBERS)
    || hasServerPermission(serverPerms, Permissions.ADMINISTRATOR);

  useEffect(() => {
    if (serverId && type !== 'home') {
      setServerPerms(0);
      get(`/servers/${serverId}/permissions`)
        .then((p) => setServerPerms(typeof p?.permissions === 'number' ? p.permissions : 0))
        .catch(() => setServerPerms(0));
    }
  }, [serverId, type]);

  if (type === 'home') {
    const path = location.pathname.replace(/\/$/, '') || '/';
    const isMeHome = path === '/channels/@me';
    const isFriends = path === '/channels/@me/friends';
    return (
      <div className="channel-sidebar" role={isDrawerOpen ? 'dialog' : undefined} aria-modal={isDrawerOpen ? 'true' : undefined} aria-label={isDrawerOpen ? 'Navigation' : undefined}>
        <div className="sidebar-header">
          <input className="sidebar-search" placeholder="Find or start a conversation" readOnly />
        </div>
        <div className="sidebar-channels" data-onboarding-id="onboarding-sidebar-nav">
          <div
            className={`channel-item ${isMeHome ? 'active' : ''}`}
            onClick={() => { navigate('/channels/@me'); closeMobileOverlay(); }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" className="channel-icon-svg" aria-hidden="true">
              <path fill="currentColor" d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8h5Z" />
            </svg>
            <span>Home</span>
          </div>
          <div
            className={`channel-item ${isFriends ? 'active' : ''} ${((user?.relations || []).filter((r) => r.status === 'Incoming').length > 0) ? 'has-pending-friends' : ''}`}
            onClick={() => { navigate('/channels/@me/friends'); closeMobileOverlay(); }}
          >
            {(user?.relations || []).filter((r) => r.status === 'Incoming').length > 0 && (
              <span className="friends-pending-badge" aria-label="Pending friend requests">
                {(user?.relations || []).filter((r) => r.status === 'Incoming').length}
              </span>
            )}
            <svg width="24" height="24" viewBox="0 0 24 24" className="channel-icon-svg"><path fill="currentColor" d="M12 12.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM12.6 14h-1.2a5.4 5.4 0 0 0-5.4 5.36 .6.6 0 0 0 .6.64h10.8a.6.6 0 0 0 .6-.64A5.4 5.4 0 0 0 12.6 14Z"/></svg>
            <span>Friends</span>
          </div>
          {dms && dms.length > 0 && (
            <>
              <div className="channel-category">DIRECT MESSAGES</div>
              <div className="dm-list">
              {dms.map((dm) => (
                <div
                  key={dm._id}
                  className={`channel-item ${params.channelId === dm._id ? 'active' : ''} ${isChannelUnread(dm._id) ? 'has-unread' : ''}`}
                  onClick={() => { navigate(`/channels/@me/${dm._id}`); closeMobileOverlay(); }}
                >
                  {isChannelUnread(dm._id) && <span className="channel-unread-dot" aria-label="Unread" />}
                  <span
                    className="dm-avatar"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const targetId = (dm.recipients || []).find((r) => r !== user?._id);
                      if (!targetId) return;
                      try {
                        const u = dm.other_user ? { ...dm.other_user, _id: targetId } : await get(`/users/${targetId}`);
                        const rect = e.currentTarget.getBoundingClientRect();
                        let left = rect.right + 8;
                        let top = rect.top;
                        if (left + 320 > window.innerWidth - 8) left = rect.left - 328;
                        if (top + 380 > window.innerHeight - 8) top = window.innerHeight - 388;
                        setProfileCard({ user: u, style: { left: `${Math.max(8, left)}px`, top: `${Math.max(8, top)}px`, position: 'fixed' } });
                      } catch {}
                    }}
                  >
                    {dm.other_user?.avatar ? (
                      <img src={resolveFileUrl(dm.other_user.avatar)} alt="" className="dm-avatar-img" />
                    ) : (
                      (dm.other_user?.display_name || dm.other_user?.username || '?')[0].toUpperCase()
                    )}
                  </span>
                  <span className="channel-name">{dm.other_user?.display_name || dm.other_user?.username || dm.name || 'Direct Message'}</span>
                </div>
              ))}
              </div>
            </>
          )}
          <div className="channel-category channel-changelog-wrap">
            <Link to="/changelog" className="channel-changelog-link" onClick={() => closeMobileOverlay?.()}>Changelog</Link>
          </div>
        </div>
        {profileCard && (
          <>
            <div className="profile-card-backdrop" onClick={() => setProfileCard(null)} />
            <ProfileCard user={profileCard.user} style={profileCard.style} onClose={() => setProfileCard(null)} />
          </>
        )}
        <UserPanel user={user} />
      </div>
    );
  }

  const handleCreateChannel = async () => {
    if (!channelName.trim()) return;
    try {
      const ch = await post(`/servers/${serverId}/channels`, {
        name: channelName,
        description: channelDesc || undefined,
        type: channelType,
      });
      setChannelName('');
      setChannelDesc('');
      setChannelType('text');
      setShowCreateChannel(false);
      if (onChannelCreated) onChannelCreated(ch);
      if (ch.channel_type !== 'VoiceChannel') {
        navigate(`/channels/${serverId}/${ch._id}`);
      }
    } catch {}
  };

  const handleCreateInvite = async () => {
    if (!channels || channels.length === 0) return;
    setInviteLoading(true);
    try {
      const res = await post(`/channels/${channels[0]._id}/invites`);
      setInviteCode(res._id);
    } catch {}
    setInviteLoading(false);
  };

  const handleLeaveServer = async () => {
    if (!confirm('Are you sure you want to leave this server?')) return;
    try {
      const members = await import('../api').then(({ get }) => get(`/servers/${serverId}/members`));
      const myMember = members.find((m) => {
        const uid = typeof m.user === 'object' ? m.user._id : m.user;
        return uid === user._id;
      });
      if (myMember) {
        await del(`/servers/${serverId}/members/${myMember._id}`);
      }
      if (onServerDeleted) onServerDeleted(serverId);
      navigate('/channels/@me');
    } catch {}
  };

  const handleDeleteServer = async () => {
    if (!confirm(`Delete "${server?.name}"? This cannot be undone.`)) return;
    try {
      await del(`/servers/${serverId}`);
      if (onServerDeleted) onServerDeleted(serverId);
      navigate('/channels/@me');
    } catch {}
  };

  const handleEditChannel = async () => {
    if (!showEditChannel) return;
    try {
      await patch(`/channels/${showEditChannel}`, { name: editChName || undefined, description: editChDesc || undefined });
      if (onChannelCreated) onChannelCreated(null); // trigger refresh
      setShowEditChannel(null);
    } catch {}
  };

  const handleDeleteChannel = async (chId) => {
    if (!confirm('Delete this channel?')) return;
    try {
      await del(`/channels/${chId}`);
      if (onChannelCreated) onChannelCreated(null);
      navigate(`/channels/${serverId}`);
    } catch {}
  };

  return (
    <div className="channel-sidebar" role={isDrawerOpen ? 'dialog' : undefined} aria-modal={isDrawerOpen ? 'true' : undefined} aria-label={isDrawerOpen ? 'Channels' : undefined}>
      {serverChannelsLoading ? (
        <>
          <div className="sidebar-header server-name-header channel-sidebar-header--loading" aria-busy="true">
            <span className="channel-sidebar-skel-title" />
            <span className="channel-sidebar-skel-chevron" aria-hidden="true" />
          </div>
          <div className="sidebar-channels channel-sidebar-channels--loading">
            <div className="channel-category channel-sidebar-skel-label">TEXT CHANNELS</div>
            <div className="channel-sidebar-skel-row" />
            <div className="channel-sidebar-skel-row medium" />
            <div className="channel-sidebar-skel-row" />
            <div className="channel-category channel-sidebar-skel-label">VOICE CHANNELS</div>
            <div className="channel-sidebar-skel-row short" />
          </div>
        </>
      ) : (
        <>
      <div className="sidebar-header server-name-header" onClick={() => setShowDropdown(!showDropdown)}>
        <span className="server-title">{server?.name || 'Server'}</span>
        <svg width="18" height="18" viewBox="0 0 24 24" className="dropdown-arrow"><path fill="currentColor" d="M7 10l5 5 5-5z"/></svg>
      </div>

      {showDropdown && (
        <>
          <div className="dropdown-backdrop" onClick={() => setShowDropdown(false)} />
          <div className="server-dropdown">
            {canCreateInvites && (
              <div className="dropdown-item" onClick={() => { setShowInvite(true); setShowDropdown(false); handleCreateInvite(); }}>
                <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M13 9h-2V7h2m0 10h-2v-6h2m-1-9A10 10 0 002 12a10 10 0 0010 10 10 10 0 0010-10A10 10 0 0012 2z"/></svg>
                Invite People
              </div>
            )}
            {canAccessSettings && (
              <div className="dropdown-item" onClick={() => { setShowSettings(true); setShowDropdown(false); }}>
                <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1112 8.4a3.6 3.6 0 010 7.2z"/></svg>
                Server Settings
              </div>
            )}
            {canManageChannels && (
              <div className="dropdown-item" onClick={() => { setShowCreateChannel(true); setShowDropdown(false); }}>
                <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2.5a1 1 0 011 1V11h7.5a1 1 0 110 2H13v7.5a1 1 0 11-2 0V13H3.5a1 1 0 010-2H11V3.5a1 1 0 011-1z"/></svg>
                Create Channel
              </div>
            )}
            <div className="dropdown-separator" />
            {isOwner ? (
              <div className="dropdown-item danger" onClick={() => { handleDeleteServer(); setShowDropdown(false); }}>
                <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                Delete Server
              </div>
            ) : (
              <div className="dropdown-item danger" onClick={() => { handleLeaveServer(); setShowDropdown(false); }}>
                <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M10.09 15.59L11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5a2 2 0 00-2 2v4h2V5h14v14H5v-4H3v4a2 2 0 002 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/></svg>
                Leave Server
              </div>
            )}
          </div>
        </>
      )}

      {(() => {
        const bannerUrl = resolveFileUrl(server?.banner);
        if (!bannerUrl) return null;
        return (
          <div className="server-sidebar-banner" role="img" aria-label={`${server?.name || 'Server'} banner`}>
            <div
              className="server-sidebar-banner-crop"
              style={{ backgroundImage: `url(${bannerUrl})` }}
            />
          </div>
        );
      })()}

      <div className="sidebar-channels">
        {(() => {
          const textChannels = (channels || []).filter((ch) => ch.channel_type !== 'VoiceChannel' && ch.channel_type !== 'Thread');
          const voiceChannels = (channels || []).filter((ch) => ch.channel_type === 'VoiceChannel');
          return (
            <>
              <div className="channel-category">
                <span>TEXT CHANNELS</span>
                {canManageChannels && (
                  <svg width="18" height="18" viewBox="0 0 24 24" className="category-add" onClick={() => { setChannelType('text'); setShowCreateChannel(true); }} title="Create Channel">
                    <path fill="currentColor" d="M12 2.5a1 1 0 011 1V11h7.5a1 1 0 110 2H13v7.5a1 1 0 11-2 0V13H3.5a1 1 0 010-2H11V3.5a1 1 0 011-1z"/>
                  </svg>
                )}
              </div>
              {textChannels.map((ch) => {
                const isActive = params['*']?.includes(ch._id) || params.channelId === ch._id;
                const hasUnread = isChannelUnread(ch._id);
                return (
                  <div key={ch._id} className={`channel-item ${isActive ? 'active' : ''} ${hasUnread ? 'has-unread' : ''}`}>
                    {hasUnread && <span className="channel-unread-dot" aria-label="Unread" />}
                    <div className="channel-item-main" onClick={() => { navigate(`/channels/${serverId}/${ch._id}`); closeMobileOverlay(); }}>
                      <span className="hash">#</span>
                      <span className="channel-name">{ch.name}</span>
                    </div>
                    {canManageChannels && isActive && (
                      <div className="channel-actions">
                        <svg width="16" height="16" viewBox="0 0 24 24" className="channel-action-btn" title="Edit" onClick={() => { setShowEditChannel(ch._id); setEditChName(ch.name); setEditChDesc(ch.description || ''); }}>
                          <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                        </svg>
                        <svg width="16" height="16" viewBox="0 0 24 24" className="channel-action-btn danger-icon" title="Delete" onClick={() => handleDeleteChannel(ch._id)}>
                          <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                        </svg>
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="channel-category">
                <span>VOICE CHANNELS</span>
                {canManageChannels && (
                  <svg width="18" height="18" viewBox="0 0 24 24" className="category-add" onClick={() => { setChannelType('voice'); setShowCreateChannel(true); }} title="Create Voice Channel">
                    <path fill="currentColor" d="M12 2.5a1 1 0 011 1V11h7.5a1 1 0 110 2H13v7.5a1 1 0 11-2 0V13H3.5a1 1 0 010-2H11V3.5a1 1 0 011-1z"/>
                  </svg>
                )}
              </div>
              {voiceChannels.map((ch) => {
                const isInThisChannel = voice?.currentChannel?.id === ch._id;
                const membersInChannel = voice?.voiceMembers?.[ch._id] || [];
                return (
                  <div key={ch._id}>
                    <div className={`channel-item voice-channel ${isInThisChannel ? 'active' : ''}`}>
                      <div
                        className="channel-item-main"
                        onClick={() => {
                        if (isInThisChannel) return;
                        voice?.joinVoice(ch._id, ch.name, serverId, server?.name);
                        closeMobileOverlay();
                        }}
                        onDoubleClick={() => {
                          if (!isInThisChannel) {
                            voice?.joinVoice(ch._id, ch.name, serverId, server?.name);
                          }
                          navigate(`/channels/${serverId}/${ch._id}`);
                          closeMobileOverlay();
                        }}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" className="voice-channel-icon">
                          <path fill="currentColor" d="M11.383 3.07904C11.009 2.92504 10.579 3.01004 10.293 3.29604L6.586 7.00304H4C3.45 7.00304 3 7.45304 3 8.00304V16.003C3 16.553 3.45 17.003 4 17.003H6.586L10.293 20.71C10.579 20.996 11.009 21.082 11.383 20.927C11.757 20.772 12 20.407 12 20.003V4.00304C12 3.59904 11.757 3.23404 11.383 3.07904ZM14 5.00304V7.07304C16.892 7.55404 19 10.028 19 13.003C19 15.978 16.892 18.452 14 18.933V21.003C18.045 20.505 21 17.115 21 13.003C21 8.89104 18.045 5.50104 14 5.00304Z"/>
                        </svg>
                        <span className="channel-name">{ch.name}</span>
                        {membersInChannel.length > 0 && voice?.channelActiveSince?.[ch._id] != null && (
                          <VoiceChannelTimer startTime={voice.channelActiveSince[ch._id]} />
                        )}
                      </div>
                      {canManageChannels && (
                        <div className="channel-actions">
                          <svg width="16" height="16" viewBox="0 0 24 24" className="channel-action-btn danger-icon" title="Delete" onClick={() => handleDeleteChannel(ch._id)}>
                            <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                          </svg>
                        </div>
                      )}
                    </div>
                    {membersInChannel.length > 0 && (
                      <VoiceChannelMembers memberIds={membersInChannel} channelId={ch._id} serverOwnerId={server?.owner} />
                    )}
                  </div>
                );
              })}
            </>
          );
        })()}
      </div>
      <VoicePanel />
        </>
      )}
      <UserPanel user={user} />

      {showCreateChannel && (
        <div className="modal-overlay" onClick={() => setShowCreateChannel(false)}>
          <div className="modal-box create-channel-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create Channel</h2>
            <div className="channel-type-selector">
              <span className="auth-label-text">CHANNEL TYPE</span>
              <div className="channel-type-options">
                <label className={`channel-type-option ${channelType === 'text' ? 'selected' : ''}`}>
                  <input type="radio" name="chtype" value="text" checked={channelType === 'text'} onChange={() => setChannelType('text')} />
                  <span className="channel-type-icon">#</span>
                  <span>Text</span>
                </label>
                <label className={`channel-type-option ${channelType === 'voice' ? 'selected' : ''}`}>
                  <input type="radio" name="chtype" value="voice" checked={channelType === 'voice'} onChange={() => setChannelType('voice')} />
                  <svg width="18" height="18" viewBox="0 0 24 24" className="channel-type-icon"><path fill="currentColor" d="M11.383 3.07904C11.009 2.92504 10.579 3.01004 10.293 3.29604L6.586 7.00304H4C3.45 7.00304 3 7.45304 3 8.00304V16.003C3 16.553 3.45 17.003 4 17.003H6.586L10.293 20.71C10.579 20.996 11.009 21.082 11.383 20.927C11.757 20.772 12 20.407 12 20.003V4.00304C12 3.59904 11.757 3.23404 11.383 3.07904Z"/></svg>
                  <span>Voice</span>
                </label>
              </div>
            </div>
            <label className="auth-label">
              <span>CHANNEL NAME</span>
              <input value={channelName} onChange={(e) => setChannelName(e.target.value)} placeholder={channelType === 'voice' ? 'General' : 'new-channel'} autoFocus onKeyDown={(e) => e.key === 'Enter' && handleCreateChannel()} />
            </label>
            {channelType === 'text' && (
              <label className="auth-label">
                <span>DESCRIPTION (OPTIONAL)</span>
                <input value={channelDesc} onChange={(e) => setChannelDesc(e.target.value)} placeholder="What's this channel about?" />
              </label>
            )}
            <div className="modal-actions">
              <button className="modal-btn secondary" onClick={() => setShowCreateChannel(false)}>Cancel</button>
              <button className="modal-btn primary" onClick={handleCreateChannel}>Create Channel</button>
            </div>
          </div>
        </div>
      )}

      {showInvite && (
        <div className="modal-overlay" onClick={() => { setShowInvite(false); setInviteCode(''); }}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h2>Invite Friends</h2>
            <p className="modal-sub">Share this invite link with others to grant access to <strong>{server?.name}</strong></p>
            {inviteLoading ? (
              <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Creating invite...</p>
            ) : inviteCode ? (
              <div className="invite-code-box">
                <input
                  className="invite-code-input"
                  value={typeof window !== 'undefined' ? `${window.location.origin}/invite/${inviteCode}` : inviteCode}
                  readOnly
                  onClick={(e) => e.target.select()}
                />
                <button
                  className="modal-btn primary"
                  onClick={() => {
                    const link = typeof window !== 'undefined' ? `${window.location.origin}/invite/${inviteCode}` : inviteCode;
                    navigator.clipboard.writeText(link);
                  }}
                >
                  Copy link
                </button>
              </div>
            ) : (
              <p style={{ textAlign: 'center', color: 'var(--red-400)' }}>Failed to create invite</p>
            )}
            <div className="modal-actions">
              <button className="modal-btn secondary" onClick={() => { setShowInvite(false); setInviteCode(''); }}>Done</button>
            </div>
          </div>
        </div>
      )}

      {showEditChannel && (
        <div className="modal-overlay" onClick={() => setShowEditChannel(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h2>Edit Channel</h2>
            <label className="auth-label">
              <span>CHANNEL NAME</span>
              <input value={editChName} onChange={(e) => setEditChName(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && handleEditChannel()} />
            </label>
            <label className="auth-label">
              <span>DESCRIPTION</span>
              <input value={editChDesc} onChange={(e) => setEditChDesc(e.target.value)} />
            </label>
            <div className="modal-actions">
              <button className="modal-btn secondary" onClick={() => setShowEditChannel(null)}>Cancel</button>
              <button className="modal-btn primary" onClick={handleEditChannel}>Save</button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <ServerSettings
          server={server}
          serverId={serverId}
          onClose={() => setShowSettings(false)}
          onUpdated={onServerUpdated}
          userPerms={serverPerms}
        />
      )}
    </div>
  );
}

function VoiceChannelMembers({ memberIds, channelId, serverOwnerId }) {
  const voice = useVoice();
  const [users, setUsers] = useState({});
  const [profileCard, setProfileCard] = useState(null);
  const isCurrentChannel = voice?.currentChannel?.id === channelId;
  const speakingUserIds = voice?.speakingUserIds ?? new Set();

  useEffect(() => {
    const load = async () => {
      const { get } = await import('../api');
      const map = {};
      for (const id of memberIds) {
        try {
          const u = await get(`/users/${id}`);
          map[id] = u;
        } catch {
          map[id] = { _id: id, username: 'User' };
        }
      }
      if (Object.keys(map).length > 0) setUsers((prev) => ({ ...prev, ...map }));
    };
    if (memberIds.length > 0) load();
  }, [memberIds.join(',')]);

  return (
    <>
      <div className="voice-members-list">
        {memberIds.map((uid) => {
          const u = users[uid];
          const avatarUrl = resolveFileUrl(u?.avatar);
          return (
            <div
              key={uid}
              className={`voice-member-item${isCurrentChannel && speakingUserIds.has(uid) ? ' voice-member-item--speaking' : ''}`}
              onClick={(e) => {
                if (!u?._id) return;
                const rect = e.currentTarget.getBoundingClientRect();
                let left = rect.right + 8;
                let top = rect.top;
                if (left + 340 > window.innerWidth - 8) left = rect.left - 348;
                if (top + 380 > window.innerHeight - 8) top = window.innerHeight - 388;
                setProfileCard({
                  user: u,
                  style: {
                    left: `${Math.max(8, left)}px`,
                    top: `${Math.max(8, top)}px`,
                    position: 'fixed',
                  },
                });
              }}
            >
              <div className="voice-member-avatar">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="voice-member-avatar-img" />
                ) : (
                  <span className="voice-member-avatar-initial">{(u?.display_name || u?.username || '?')[0].toUpperCase()}</span>
                )}
                {showServerOwnerCrownForUser(u, serverOwnerId, uid) && <ServerOwnerCrown size="voice" />}
              </div>
              <span className="voice-member-name">{u?.display_name || u?.username || uid.slice(0, 6)}</span>
              {(isBotUser(u) || isVerifiedBotUser(u) || userHasOpicStaff(u)) && (
                <span className="voice-member-badges">
                  {isBotUser(u) && (
                    <span className="voice-member-bot-badge" title="Bot">
                      <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true">
                        <use href="/icons.svg#bot-icon" />
                      </svg>
                      BOT
                    </span>
                  )}
                  {isVerifiedBotUser(u) && (
                    <span className="voice-member-verified-badge" title="Verified bot">
                      <svg width="9" height="9" viewBox="0 0 24 24" aria-hidden="true">
                        <path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                      </svg>
                      Verified
                    </span>
                  )}
                  {userHasOpicStaff(u) && (
                    <span className="voice-member-staff-badge" title="Opic Staff">Staff</span>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {profileCard && (
        <>
          <div className="profile-card-backdrop" onClick={() => setProfileCard(null)} />
          <ProfileCard user={profileCard.user} style={profileCard.style} onClose={() => setProfileCard(null)} />
        </>
      )}
    </>
  );
}

function UserPanel({ user }) {
  const [showSettings, setShowSettings] = useState(false);
  const [profileCard, setProfileCard] = useState(null);
  const ws = useWS();
  if (!user) return null;

  const getPingColor = () => {
    if (!ws?.ping) return 'var(--text-muted)';
    if (ws.ping < 100) return '#43b581';
    if (ws.ping < 250) return '#faa61a';
    return '#f04747';
  };

  return (
    <>
      <div className="user-panel" data-onboarding-id="onboarding-user-panel">
        <div
          className="user-panel-avatar"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            let left = rect.left;
            let top = rect.top - 388;
            if (left + 340 > window.innerWidth - 8) left = window.innerWidth - 348;
            if (top < 8) top = rect.bottom + 8;
            setProfileCard({
              user,
              style: {
                left: `${Math.max(8, left)}px`,
                top: `${Math.max(8, top)}px`,
                position: 'fixed',
              },
            });
          }}
          title="View profile"
        >
          {(() => {
            const url = resolveFileUrl(user.avatar);
            return url ? <img src={url} alt="" className="user-panel-avatar-img" /> : (user.username || 'U')[0].toUpperCase();
          })()}
        </div>
        <div
          className="user-panel-info"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            let left = rect.left;
            let top = rect.top - 388;
            if (left + 340 > window.innerWidth - 8) left = window.innerWidth - 348;
            if (top < 8) top = rect.bottom + 8;
            setProfileCard({
              user,
              style: {
                left: `${Math.max(8, left)}px`,
                top: `${Math.max(8, top)}px`,
                position: 'fixed',
              },
            });
          }}
          title="View profile"
        >
          <div className="user-panel-name">{user.display_name || user.username}</div>
          {formatActivityPrimary(user?.status?.activity) && (
            <div className="user-panel-activity" title={formatActivityPrimary(user.status.activity)}>
              {formatActivityPrimary(user.status.activity)}
            </div>
          )}
          <div className="user-panel-tag">
            {ws?.connected ? (
              <span className="user-panel-ping" style={{ color: getPingColor() }} title={`Ping: ${ws.ping ?? '...'}ms | Status: Connected`}>
                <svg width="10" height="10" viewBox="0 0 24 24" style={{ verticalAlign: 'middle', marginRight: 3 }}>
                  <circle cx="12" cy="12" r="8" fill={getPingColor()} />
                </svg>
                {ws.ping != null ? `${ws.ping}ms` : '...'}
              </span>
            ) : (
              <span className="user-panel-ping" style={{ color: '#f04747' }} title="Disconnected">
                <svg width="10" height="10" viewBox="0 0 24 24" style={{ verticalAlign: 'middle', marginRight: 3 }}>
                  <circle cx="12" cy="12" r="8" fill="#f04747" />
                </svg>
                Offline
              </span>
            )}
          </div>
        </div>
        <button
          className="user-settings-btn"
          onClick={(e) => {
            e.stopPropagation();
            setShowSettings(true);
          }}
          title="User Settings"
        >
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1112 8.4a3.6 3.6 0 010 7.2z"/></svg>
        </button>
      </div>
      {profileCard && (
        <>
          <div className="profile-card-backdrop" onClick={() => setProfileCard(null)} />
          <ProfileCard user={profileCard.user} style={profileCard.style} onClose={() => setProfileCard(null)} />
        </>
      )}
      {showSettings && <UserSettings onClose={() => setShowSettings(false)} />}
    </>
  );
}

export default memo(ChannelSidebar);
