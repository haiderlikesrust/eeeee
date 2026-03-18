import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, useNavigate, useParams, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useWS } from '../context/WebSocketContext';
import { useVoice } from '../context/VoiceContext';
import { useUnread } from '../context/UnreadContext';
import { useToast } from '../context/ToastContext';
import { MobileProvider, useMobile } from '../context/MobileContext';
import { get, post } from '../api';
import ServerBar from '../components/ServerBar';
import ChannelSidebar from '../components/ChannelSidebar';
import ChatArea from '../components/ChatArea';
import MemberSidebar from '../components/MemberSidebar';
import FriendsPage from '../components/FriendsPage';
import VoiceChannelView from '../components/VoiceChannelView';
import './AppLayout.css';

export default function AppLayout() {
  return (
    <MobileProvider>
      <AppLayoutInner />
    </MobileProvider>
  );
}

function AppLayoutInner() {
  const { user, fetchUser } = useAuth();
  const { on } = useWS();
  const location = useLocation();
  const { fetchUnreads } = useUnread();
  const toast = useToast();
  const { isMobile, mobileOverlay, closeMobileOverlay } = useMobile();
  const [servers, setServers] = useState([]);
  const [dms, setDms] = useState([]);

  useEffect(() => {
    if (!on || !toast) return;
    return on('FriendRequest', (d) => {
      const from = d?.from_user?.display_name || d?.from_user?.username || 'Someone';
      toast.success(`${from} sent you a friend request`);
      fetchUser?.();
    });
  }, [on, toast, fetchUser]);

  useEffect(() => {
    if (!on || !fetchUnreads) return;
    return on('MESSAGE_CREATE', (data) => {
      const d = data?.d ?? data?.data ?? data;
      if (!d?.channel) return;
      const path = location.pathname;
      const viewingChannelId = path.startsWith('/channels/@me/')
        ? path.split('/').pop()
        : (path.match(/\/channels\/[^/]+\/([^/]+)$/)?.[1] ?? null);
      if (viewingChannelId !== d.channel) fetchUnreads();
    });
  }, [on, location.pathname, fetchUnreads]);

  const fetchDMs = useCallback(async () => {
    try {
      const channels = await get('/users/dms');
      setDms(channels || []);
    } catch {}
  }, []);

  const fetchServers = useCallback(async () => {
    try {
      const data = await get('/users/servers');
      setServers(Array.isArray(data) ? data : []);
    } catch {}
  }, []);

  useEffect(() => {
    fetchServers();
    fetchDMs();
  }, [fetchServers, fetchDMs]);

  useEffect(() => {
    if (!on) return;
    return on('Ready', (data) => {
      if (data?.servers) setServers(data.servers);
    });
  }, [on]);

  // Stable callbacks so memo(ChannelSidebar) and memo(ServerBar) don't re-render every parent tick
  const addServer = useCallback((server) => {
    setServers((prev) => {
      const idx = prev.findIndex((s) => s._id === server._id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = server;
        return copy;
      }
      return [...prev, server];
    });
  }, []);

  const removeServer = useCallback((serverId) => {
    setServers((prev) => prev.filter((s) => s._id !== serverId));
  }, []);

  return (
    <div
      className={`app-layout${isMobile ? ' mobile' : ''}`}
      data-mobile-overlay={mobileOverlay || ''}
    >
      {isMobile && mobileOverlay && (
        <div
          className="mobile-backdrop"
          onClick={closeMobileOverlay}
          role="presentation"
        />
      )}
      <ServerBar
        servers={servers}
        setServers={setServers}
        onServerAdded={addServer}
      />
      <Routes>
        <Route
          path="@me/*"
          element={
            <>
              <ChannelSidebar type="home" dms={dms} />
              <Routes>
                <Route index element={<FriendsPage />} />
                <Route path=":channelId" element={<ChatView />} />
              </Routes>
            </>
          }
        />
        <Route
          path=":serverId/*"
          element={
            <ServerView
              servers={servers}
              setServers={setServers}
              addServer={addServer}
              removeServer={removeServer}
            />
          }
        />
        <Route
          path="*"
          element={
            <>
              <ChannelSidebar type="home" dms={dms} />
              <FriendsPage />
            </>
          }
        />
      </Routes>
    </div>
  );
}

function ChatView() {
  const { channelId } = useParams();
  return (
    <div className="chat-container">
      <ChatArea channelId={channelId} />
    </div>
  );
}

function ServerView({ servers, setServers, addServer, removeServer }) {
  const { serverId } = useParams();
  const navigate = useNavigate();
  const { on, connected } = useWS();
  const [server, setServer] = useState(null);
  const [channels, setChannels] = useState([]);
  const [members, setMembers] = useState([]);

  const loadServer = useCallback(async () => {
    if (!serverId) return;
    try {
      const s = await get(`/servers/${serverId}`);
      setServer(s);
      const chs = (s.channels || []).filter((c) => typeof c === 'object');
      setChannels(chs);
      addServer(s);
      const m = await get(`/servers/${serverId}/members`);
      setMembers(m || []);
    } catch {}
  }, [serverId]);

  useEffect(() => {
    loadServer();
  }, [loadServer]);

  useEffect(() => {
    if (connected && serverId) {
      get(`/servers/${serverId}/members`).then((m) => setMembers(m || [])).catch(() => {});
    }
  }, [connected, serverId]);

  useEffect(() => {
    if (!on || !serverId) return;
    let presenceTimer = null;
    const unsubPresence = on('PresenceUpdate', (d) => {
      const eventServerId = d?.server_id;
      if (eventServerId != null && String(eventServerId) !== String(serverId)) return;
      if (presenceTimer) clearTimeout(presenceTimer);
      presenceTimer = setTimeout(() => {
        presenceTimer = null;
        get(`/servers/${serverId}/members`).then((m) => setMembers(m || [])).catch(() => {});
      }, 280);
    });
    const unsub1 = on('ServerMemberJoin', (data) => {
      if (data.serverId === serverId && data.member) {
        setMembers((prev) => {
          if (prev.some((m) => m._id === data.member._id)) return prev;
          return [...prev, data.member];
        });
      }
    });
    const unsub2 = on('ServerMemberLeave', (data) => {
      if (data.serverId === serverId && data.userId) {
        setMembers((prev) => prev.filter((m) => {
          const uid = typeof m.user === 'object' ? m.user._id : m.user;
          return uid !== data.userId;
        }));
      }
    });
    return () => {
      if (presenceTimer) clearTimeout(presenceTimer);
      unsubPresence();
      unsub1();
      unsub2();
    };
  }, [on, serverId]);

  // Stable handlers so memo(ChannelSidebar) skips re-renders when only other ServerView state changes
  const handleChannelCreated = useCallback((ch) => {
    if (ch) {
      setChannels((prev) => [...prev, ch]);
    } else {
      loadServer();
    }
  }, [loadServer]);

  const handleServerUpdated = useCallback((updated) => {
    if (updated) {
      setServer(updated);
      addServer(updated);
    }
  }, [addServer]);

  const handleServerDeleted = useCallback((id) => {
    removeServer(id);
  }, [removeServer]);

  return (
    <>
      <ChannelSidebar
        type="server"
        server={server}
        channels={channels}
        serverId={serverId}
        onChannelCreated={handleChannelCreated}
        onServerUpdated={handleServerUpdated}
        onServerDeleted={handleServerDeleted}
      />
      <Routes>
        <Route
          path=":channelId"
          element={<ServerChatView members={members} serverRoles={server?.roles || {}} channels={channels} />}
        />
        <Route
          index
          element={
            channels.length > 0 ? (
              <AutoRedirect serverId={serverId} channels={channels} />
            ) : (
              <div className="chat-container">
                <div className="empty-state">Select a channel</div>
              </div>
            )
          }
        />
      </Routes>
    </>
  );
}

function ServerChatView({ members, serverRoles, channels }) {
  const { channelId } = useParams();
  const channel = (channels || []).find((c) => c._id === channelId);
  const isVoice = channel?.channel_type === 'VoiceChannel';

  if (isVoice) {
    return (
      <div className="chat-container">
        <VoiceChannelView channel={channel} />
        <MemberSidebar members={members} serverRoles={serverRoles} />
      </div>
    );
  }

  return (
    <div className="chat-container">
      <ChatArea channelId={channelId} serverRoles={serverRoles} />
      <MemberSidebar members={members} serverRoles={serverRoles} />
    </div>
  );
}

function AutoRedirect({ serverId, channels }) {
  const navigate = useNavigate();
  useEffect(() => {
    const textChannels = channels.filter((c) => c.channel_type !== 'VoiceChannel');
    if (textChannels.length > 0) {
      navigate(`/channels/${serverId}/${textChannels[0]._id}`, { replace: true });
    } else if (channels.length > 0) {
      navigate(`/channels/${serverId}/${channels[0]._id}`, { replace: true });
    }
  }, [channels, serverId, navigate]);
  return null;
}
