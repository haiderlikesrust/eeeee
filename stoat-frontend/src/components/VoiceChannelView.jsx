import { useState, useEffect, useRef } from 'react';
import { useVoice } from '../context/VoiceContext';
import { useAuth } from '../context/AuthContext';
import { useMobile } from '../context/MobileContext';
import { resolveFileUrl } from '../utils/avatarUrl';
import { get } from '../api';
import './VoiceChannelView.css';

export default function VoiceChannelView({ channel }) {
  const voice = useVoice();
  const { user } = useAuth();
  if (!voice) return null;

  const {
    currentChannel,
    voiceMembers,
    joinVoice,
    leaveVoice,
    muted,
    deafened,
    toggleMute,
    toggleDeafen,
    sharingScreen,
    remoteScreenStreams,
    localScreenStream,
    startScreenShare,
    stopScreenShare,
    cameraOn,
    remoteCameraStreams,
    localCameraStream,
    startCamera,
    stopCamera,
  } = voice;
  const { isMobile, openChannelSidebar, openMemberSidebar } = useMobile();
  const [memberUsers, setMemberUsers] = useState({});
  const [expandedScreenUserId, setExpandedScreenUserId] = useState(null);
  const [focusedScreenUserId, setFocusedScreenUserId] = useState(null);

  useEffect(() => {
    if (expandedScreenUserId == null) return;
    const onKey = (e) => { if (e.key === 'Escape') setExpandedScreenUserId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expandedScreenUserId]);

  const isConnected = currentChannel?.id === channel?._id;
  const membersInChannel = voiceMembers?.[channel?._id] || [];

  useEffect(() => {
    const loadUsers = async () => {
      const map = {};
      for (const id of membersInChannel) {
        if (!memberUsers[id]) {
          try {
            const u = await get(`/users/${id}`);
            map[id] = u;
          } catch {
            map[id] = { _id: id, username: 'User' };
          }
        }
      }
      if (Object.keys(map).length > 0) {
        setMemberUsers((prev) => ({ ...prev, ...map }));
      }
    };
    if (membersInChannel.length > 0) loadUsers();
  }, [membersInChannel.join(',')]);

  const getAvatarUrl = (u) => resolveFileUrl(u?.avatar);
  const myScreenTile = isConnected && localScreenStream ? [{ userId: user?._id, stream: localScreenStream, isMe: true }] : [];
  const remoteScreenTiles = Object.entries(remoteScreenStreams || {}).map(([uid, stream]) => ({ userId: uid, stream, isMe: uid === user?._id }));
  const screenTiles = [...myScreenTile, ...remoteScreenTiles.filter((t) => t.userId !== user?._id)];
  const focusedTile = screenTiles.find((t) => t.userId === focusedScreenUserId) || screenTiles[0];
  const screenTileIds = screenTiles.map((t) => t.userId).join(',');

  useEffect(() => {
    if (screenTiles.length === 0) setFocusedScreenUserId(null);
    else setFocusedScreenUserId((prev) => {
      if (prev && screenTiles.some((t) => t.userId === prev)) return prev;
      return screenTiles[0]?.userId ?? null;
    });
  }, [screenTileIds, screenTiles.length]);

  const myCameraTile = isConnected && cameraOn && localCameraStream ? [{ userId: user?._id, stream: localCameraStream, isMe: true }] : [];
  const remoteCameraTiles = Object.entries(remoteCameraStreams || {}).map(([uid, stream]) => ({ userId: uid, stream, isMe: uid === user?._id }));
  const cameraTiles = [...myCameraTile, ...remoteCameraTiles.filter((t) => t.userId !== user?._id)];

  return (
    <div className="voice-view">
      <div className="voice-view-header">
        {isMobile && (
          <button className="mobile-drawer-btn" onClick={openChannelSidebar} aria-label="Open channels">
            <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>
          </button>
        )}
        <svg width="24" height="24" viewBox="0 0 24 24">
          <path fill="currentColor" d="M11.383 3.07904C11.009 2.92504 10.579 3.01004 10.293 3.29604L6.586 7.00304H4C3.45 7.00304 3 7.45304 3 8.00304V16.003C3 16.553 3.45 17.003 4 17.003H6.586L10.293 20.71C10.579 20.996 11.009 21.082 11.383 20.927C11.757 20.772 12 20.407 12 20.003V4.00304C12 3.59904 11.757 3.23404 11.383 3.07904ZM14 5.00304V7.07304C16.892 7.55404 19 10.028 19 13.003C19 15.978 16.892 18.452 14 18.933V21.003C18.045 20.505 21 17.115 21 13.003C21 8.89104 18.045 5.50104 14 5.00304Z"/>
        </svg>
        <span>{channel?.name || 'Voice Channel'}</span>
        {isMobile && (
          <button className="mobile-drawer-btn" style={{ marginLeft: 'auto' }} onClick={openMemberSidebar} aria-label="Open members">
            <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
          </button>
        )}
      </div>

      <div className="voice-view-body">
        <div className={`voice-view-grid${screenTiles.length > 0 ? ' voice-view-grid-has-screen' : ''}`}>
          {/* When someone is screen sharing, hide camera grid so the screen share gets full space */}
          {cameraTiles.length > 0 && screenTiles.length === 0 && (
            <div className="voice-camera-grid">
              {cameraTiles.map((tile) => (
                <VideoTile
                  key={`cam-${tile.userId}`}
                  stream={tile.stream}
                  label={`${memberUsers[tile.userId]?.display_name || memberUsers[tile.userId]?.username || (tile.isMe ? 'You' : tile.userId?.slice(0, 8) || 'User')}${tile.isMe ? ' (You)' : ''}`}
                  isCamera
                />
              ))}
            </div>
          )}
          {screenTiles.length > 0 && (
            <div className={`voice-screen-wrap${screenTiles.length === 1 ? ' voice-screen-wrap-single' : ' voice-screen-wrap-multi'}`}>
              <div className="voice-screen-main">
                {focusedTile && (
                  <div className="voice-screen-focused">
                    <VideoTile
                      key={`screen-focused-${focusedTile.userId}`}
                      stream={focusedTile.stream}
                      label={`${memberUsers[focusedTile.userId]?.display_name || memberUsers[focusedTile.userId]?.username || (focusedTile.isMe ? 'You' : focusedTile.userId?.slice(0, 8) || 'User')}${focusedTile.isMe ? ' (You)' : ''}`}
                      isScreen
                      onExpand={focusedTile.isMe ? undefined : () => setExpandedScreenUserId(focusedTile.userId)}
                      expandTitle="Expand for viewer"
                    />
                  </div>
                )}
              </div>
              {screenTiles.length > 1 && (
                <div className="voice-screen-thumbnails">
                  {screenTiles.map((tile) => (
                    <button
                      key={`screen-thumb-${tile.userId}`}
                      type="button"
                      className={`voice-screen-thumb ${tile.userId === focusedScreenUserId ? 'focused' : ''}`}
                      onClick={() => setFocusedScreenUserId(tile.userId)}
                      title={`View ${memberUsers[tile.userId]?.display_name || memberUsers[tile.userId]?.username || 'screen'}'s share`}
                    >
                      <ScreenThumbVideo stream={tile.stream} />
                      <span className="voice-screen-thumb-label">
                        {memberUsers[tile.userId]?.display_name || memberUsers[tile.userId]?.username || (tile.isMe ? 'You' : tile.userId?.slice(0, 8) || 'User')}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {expandedScreenUserId != null && (() => {
            const tile = screenTiles.find((t) => t.userId === expandedScreenUserId);
            if (!tile) return null;
            const name = memberUsers[tile.userId]?.display_name || memberUsers[tile.userId]?.username || tile.userId?.slice(0, 8) || 'Screen';
            return (
              <div className="voice-screen-overlay" role="dialog" aria-label={`${name}'s shared screen (expanded view)`}>
                <div className="voice-screen-overlay-backdrop" onClick={() => setExpandedScreenUserId(null)} />
                <div className="voice-screen-overlay-content">
                  <div className="voice-screen-overlay-header">
                    <span className="voice-screen-overlay-title">{name}&apos;s screen</span>
                    <button type="button" className="voice-screen-overlay-close" onClick={() => setExpandedScreenUserId(null)} title="Close expanded view">
                      <svg width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg>
                    </button>
                  </div>
                  <div className="voice-screen-overlay-video-wrap">
                    <ScreenShareVideo stream={tile.stream} />
                  </div>
                  <p className="voice-screen-overlay-hint">Click outside or press Escape to close</p>
                </div>
              </div>
            );
          })()}

          {membersInChannel.length === 0 && !isConnected && (
            <div className="voice-empty">
              <div className="voice-empty-icon">
                <svg width="64" height="64" viewBox="0 0 24 24">
                  <path fill="var(--text-muted)" d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2z"/>
                </svg>
              </div>
              <p className="voice-empty-text">No one is in this voice channel yet</p>
              <p className="voice-empty-sub">Click below to join and start talking</p>
            </div>
          )}

          {membersInChannel.length > 0 && (
          <div className="voice-participants-row">
          {membersInChannel.map((uid) => {
            const u = memberUsers[uid] || { _id: uid };
            const avatarUrl = getAvatarUrl(u);
            const isMe = uid === user?._id;
            const isMutedUser = isMe && muted;

            return (
              <div key={uid} className={`voice-participant ${isMe ? 'is-me' : ''} ${isMutedUser ? 'is-muted' : ''}`}>
                <div className="voice-participant-avatar">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" className="voice-participant-img" />
                  ) : (
                    <div className="voice-participant-initial">
                      {(u.display_name || u.username || '?')[0].toUpperCase()}
                    </div>
                  )}
                  {isMutedUser && (
                    <div className="voice-participant-muted-badge">
                      <svg width="14" height="14" viewBox="0 0 24 24"><path fill="#f04747" d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/></svg>
                    </div>
                  )}
                </div>
                <span className="voice-participant-name">
                  {u.display_name || u.username || uid.slice(0, 8)}
                  {isMe && ' (You)'}
                </span>
              </div>
            );
          })}
        </div>
          )}
        </div>
      </div>

      <div className="voice-view-footer">
        {isConnected ? (
          <div className="voice-footer-controls">
            <button
              className={`voice-footer-btn ${cameraOn ? 'active' : ''}`}
              onClick={cameraOn ? stopCamera : startCamera}
              title={cameraOn ? 'Turn off camera' : 'Turn on camera'}
            >
              {cameraOn ? (
                <svg width="22" height="22" viewBox="0 0 24 24"><path fill="currentColor" d="M18 10.48l4-3.98v11l-4-3.98V18c0 .55-.45 1-1 1H5c-.55 0-1-.45-1-1V6c0-.55.45-1 1-1h12c.55 0 1 .45 1 1v4.48z"/></svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24"><path fill="currentColor" d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
              )}
              <span>{cameraOn ? 'Stop Camera' : 'Camera'}</span>
            </button>
            <button
              className={`voice-footer-btn ${sharingScreen ? 'active' : ''}`}
              onClick={sharingScreen ? stopScreenShare : startScreenShare}
              title={sharingScreen ? 'Stop sharing screen' : 'Share screen'}
            >
              {sharingScreen ? (
                <svg width="22" height="22" viewBox="0 0 24 24"><path fill="currentColor" d="M21 3H3c-1.1 0-2 .9-2 2v10h2V5h18v10h2V5c0-1.1-.9-2-2-2zM13 17h-2v2H8v2h8v-2h-3v-2z"/></svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24"><path fill="currentColor" d="M21 3H3c-1.1 0-2 .9-2 2v10h2V5h18v10h2V5c0-1.1-.9-2-2-2zM8 21h8v-2h-3v-2h-2v2H8v2z"/></svg>
              )}
              <span>{sharingScreen ? 'Stop Share' : 'Share Screen'}</span>
            </button>
            <button className={`voice-footer-btn ${muted ? 'active' : ''}`} onClick={toggleMute}>
              {muted ? (
                <svg width="22" height="22" viewBox="0 0 24 24"><path fill="currentColor" d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/></svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24"><path fill="currentColor" d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/></svg>
              )}
              <span>{muted ? 'Unmute' : 'Mute'}</span>
            </button>
            <button className={`voice-footer-btn ${deafened ? 'active' : ''}`} onClick={toggleDeafen}>
              {deafened ? (
                <svg width="22" height="22" viewBox="0 0 24 24"><path fill="currentColor" d="M3.63 3.63a.996.996 0 000 1.41L7.29 8.7 7 9H4c-.55 0-1 .45-1 1v4c0 .55.45 1 1 1h3l3.29 3.29c.63.63 1.71.18 1.71-.71v-4.17l4.18 4.18c-.49.37-1.02.68-1.6.91-.36.15-.58.53-.58.92 0 .72.73 1.18 1.39.91.8-.33 1.55-.77 2.22-1.31l1.34 1.34a.996.996 0 101.41-1.41L5.05 3.63c-.39-.39-1.02-.39-1.42 0zM19 12c0 .82-.15 1.61-.41 2.34l1.53 1.53c.56-1.17.88-2.48.88-3.87 0-3.83-2.4-7.11-5.78-8.4-.59-.23-1.22.23-1.22.86v.19c0 .38.25.71.61.85C17.18 6.54 19 9.06 19 12zm-8.71-6.29l-.17.17L12 7.76V6.41c0-.89-1.08-1.33-1.71-.7zM16.5 12A4.5 4.5 0 0014 7.97v1.79l2.48 2.48c.01-.08.02-.16.02-.24z"/></svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05c1.48-.73 2.5-2.25 2.5-3.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
              )}
              <span>{deafened ? 'Undeafen' : 'Deafen'}</span>
            </button>
            <button className="voice-footer-btn disconnect" onClick={leaveVoice}>
              <svg width="22" height="22" viewBox="0 0 24 24"><path fill="currentColor" d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>
              <span>Disconnect</span>
            </button>
          </div>
        ) : (
          <button className="voice-join-btn" onClick={() => joinVoice(channel._id, channel.name)}>
            <svg width="22" height="22" viewBox="0 0 24 24">
              <path fill="currentColor" d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2z"/>
            </svg>
            Join Voice Channel
          </button>
        )}
      </div>
    </div>
  );
}

function VideoTile({ stream, label, isCamera, isScreen, onExpand, expandTitle }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream || null;
    }
  }, [stream]);
  const className = isCamera ? 'voice-screen-tile voice-camera-tile' : 'voice-screen-tile';
  return (
    <div className={className}>
      <video ref={ref} autoPlay playsInline muted className="voice-screen-video" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      <div className="voice-screen-label">{label}</div>
      {isScreen && onExpand && (
        <button type="button" className="voice-screen-expand-btn" onClick={onExpand} title={expandTitle || 'Expand'} aria-label={expandTitle || 'Expand screen share'}>
          <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
          <span>Expand</span>
        </button>
      )}
    </div>
  );
}

function ScreenShareVideo({ stream }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream || null;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className="voice-screen-overlay-video" />;
}

function ScreenThumbVideo({ stream }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream || null;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className="voice-screen-thumb-video" />;
}
