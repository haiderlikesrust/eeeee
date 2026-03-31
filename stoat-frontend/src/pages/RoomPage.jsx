import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useWS } from '../context/WebSocketContext';
import { useVoice } from '../context/VoiceContext';
import { useToast } from '../context/ToastContext';
import { get, post } from '../api';
import { resolveFileUrl } from '../utils/avatarUrl';
import ChatArea from '../components/ChatArea';
import VoiceChannelView from '../components/VoiceChannelView';
import './RoomPage.css';

export default function RoomPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { on } = useWS();
  const voice = useVoice();
  const toast = useToast();

  const [room, setRoom] = useState(null);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState([]);
  const [memberUsers, setMemberUsers] = useState({});
  const [showVoice, setShowVoice] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [copied, setCopied] = useState(false);
  const [closing, setClosing] = useState(false);

  const fetchRoom = useCallback(async () => {
    try {
      const r = await get(`/rooms/${roomId}`);
      setRoom(r);
      setMembers(r.members || []);
    } catch {
      setRoom(null);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    fetchRoom();
  }, [fetchRoom]);

  useEffect(() => {
    const loadUsers = async () => {
      const map = {};
      for (const id of members) {
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
    if (members.length > 0) loadUsers();
  }, [members]);

  useEffect(() => {
    if (!on) return;
    const unsub1 = on('RoomMemberJoin', (d) => {
      if (d?.roomId !== roomId) return;
      setMembers((prev) => prev.includes(d.userId) ? prev : [...prev, d.userId]);
    });
    const unsub2 = on('RoomMemberLeave', (d) => {
      if (d?.roomId !== roomId) return;
      setMembers((prev) => prev.filter((m) => m !== d.userId));
    });
    const unsub3 = on('RoomClosed', (d) => {
      if (d?.roomId !== roomId) return;
      toast.info('This room has been closed.');
      navigate('/channels/@me', { replace: true });
    });
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [on, roomId, navigate, toast]);

  const handleLeave = async () => {
    try {
      await post(`/rooms/${roomId}/leave`);
      if (voice?.currentChannel?.id === room?.voice_channel) {
        voice.leaveVoice();
      }
      navigate('/channels/@me', { replace: true });
    } catch {}
  };

  const handleClose = async () => {
    if (closing) return;
    setClosing(true);
    try {
      await post(`/rooms/${roomId}/close`);
      if (voice?.currentChannel?.id === room?.voice_channel) {
        voice.leaveVoice();
      }
      navigate('/channels/@me', { replace: true });
    } catch (err) {
      toast.error(err?.error || 'Failed to close room');
    } finally {
      setClosing(false);
    }
  };

  const handleCopyInvite = () => {
    if (!room?.invite_code) return;
    const url = `${window.location.origin}/rooms/join/${room.invite_code}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  if (loading) {
    return (
      <div className="room-page room-page--loading">
        <div className="room-loading-text">Joining room...</div>
      </div>
    );
  }

  if (!room || room.status === 'closed') {
    return (
      <div className="room-page room-page--closed">
        <div className="room-closed-card">
          <h2>Room Closed</h2>
          <p>This room is no longer active.</p>
          <button className="room-btn room-btn-primary" onClick={() => navigate('/channels/@me')}>
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  const voiceChannel = room.voice_channel ? { _id: room.voice_channel, name: 'voice', channel_type: 'VoiceChannel' } : null;

  return (
    <div className="room-page">
      <header className="room-header">
        <div className="room-header-left">
          <div className="room-badge">ROOM</div>
          <h1 className="room-name">{room.name}</h1>
          <span className="room-member-count">{members.length} {members.length === 1 ? 'person' : 'people'}</span>
        </div>
        <div className="room-header-actions">
          <button
            className={`room-header-btn ${showVoice ? 'active' : ''}`}
            onClick={() => setShowVoice(!showVoice)}
            title="Toggle voice"
          >
            <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08a6.993 6.993 0 005.91-5.78c.1-.6-.39-1.14-1-1.14z"/></svg>
          </button>
          <button
            className="room-header-btn"
            onClick={() => setShowInvite(!showInvite)}
            title="Invite link"
          >
            <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
          </button>
          {room.is_owner && (
            <button
              className="room-header-btn room-header-btn--danger"
              onClick={handleClose}
              disabled={closing}
              title="Close room"
            >
              <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          )}
          <button className="room-header-btn room-header-btn--leave" onClick={handleLeave} title="Leave room">
            <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M10.09 15.59L11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5c-1.11 0-2 .9-2 2v4h2V5h14v14H5v-4H3v4c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/></svg>
          </button>
        </div>
      </header>

      {showInvite && (
        <div className="room-invite-bar">
          <span className="room-invite-label">Invite link:</span>
          <code className="room-invite-code">{`${window.location.origin}/rooms/join/${room.invite_code}`}</code>
          <button className="room-btn room-btn-small" onClick={handleCopyInvite}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      )}

      <div className={`room-body ${showVoice ? 'room-body--split' : ''}`}>
        <div className="room-chat-pane">
          {room.text_channel && <ChatArea channelId={room.text_channel} isRoom roomName={room.name} />}
        </div>

        {showVoice && voiceChannel && (
          <div className="room-voice-pane">
            <VoiceChannelView channel={voiceChannel} />
          </div>
        )}

        <aside className="room-participants">
          <div className="room-participants-title">Participants</div>
          {members.map((id) => {
            const u = memberUsers[id];
            const avatarUrl = u?.avatar ? resolveFileUrl(u.avatar) : null;
            return (
              <div key={id} className="room-participant">
                <div className="room-participant-avatar">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" className="room-participant-avatar-img" />
                  ) : (
                    <span>{(u?.display_name || u?.username || '?')[0].toUpperCase()}</span>
                  )}
                </div>
                <span className="room-participant-name">
                  {u?.display_name || u?.username || id}
                  {String(id) === String(room.owner) && <span className="room-owner-tag">Host</span>}
                </span>
              </div>
            );
          })}
        </aside>
      </div>
    </div>
  );
}
