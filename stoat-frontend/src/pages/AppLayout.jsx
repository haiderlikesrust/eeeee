import { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, useNavigate, useParams, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useWS } from '../context/WebSocketContext';
import { useVoice } from '../context/VoiceContext';
import { useUnread } from '../context/UnreadContext';
import { useToast } from '../context/ToastContext';
import { MobileProvider, useMobile } from '../context/MobileContext';
import { useOfeed } from '../context/OfeedContext';
import { get, post } from '../api';
import ServerBar from '../components/ServerBar';
import ChannelSidebar from '../components/ChannelSidebar';
import ChatArea from '../components/ChatArea';
import MemberSidebar from '../components/MemberSidebar';
import OfeedPanel from '../components/OfeedPanel';
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
  const { user, fetchUser, setUser } = useAuth();
  const { on } = useWS();
  const location = useLocation();
  const navigate = useNavigate();
  const { fetchUnreads } = useUnread();
  const toast = useToast();
  const { isMobile, mobileOverlay, closeMobileOverlay } = useMobile();
  const { setOpen: setOfeedOpen, setDeepLinkPostId } = useOfeed() || {};
  const [servers, setServers] = useState([]);
  const [dms, setDms] = useState([]);

  /** Global Ofeed share links use /channels/@me#ofeed_post=… — redirect here if opened from a server/channel URL. */
  useEffect(() => {
    const hash = location.hash || (typeof window !== 'undefined' ? window.location.hash : '');
    const m = hash.match(/^#?ofeed_post=([^&]+)/);
    if (!m?.[1]) return;
    const postId = m[1];
    if (!location.pathname.startsWith('/channels/@me')) {
      navigate(`/channels/@me#ofeed_post=${postId}`, { replace: true });
      return;
    }
    setOfeedOpen?.(true);
    setDeepLinkPostId?.(postId);
    window.history.replaceState(null, '', location.pathname + location.search);
  }, [location.pathname, location.hash, navigate, setOfeedOpen, setDeepLinkPostId]);

  /** Own presence from API/script: WS used to exclude self; include so UI updates without refresh. */
  useEffect(() => {
    if (!on || !user?._id || !setUser) return;
    return on('PresenceUpdate', (d) => {
      if (d?.status == null || d?.user_id == null) return;
      if (String(d.user_id) !== String(user._id)) return;
      setUser((prev) => (prev ? { ...prev, status: d.status } : prev));
    });
  }, [on, user?._id, setUser]);

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

  const lastRemovalToastRef = useRef({ id: null, t: 0 });
  /** Remove server from sidebar, navigate away if viewing it, toast once (WS + HTTP 403 may both fire). */
  const onSelfRemovedFromServer = useCallback((serverId) => {
    if (!serverId) return;
    setServers((prev) => prev.filter((s) => String(s._id) !== String(serverId)));
    const path = location.pathname;
    if (path.startsWith(`/channels/${serverId}/`) || path === `/channels/${serverId}`) {
      navigate('/channels/@me', { replace: true });
    }
    const now = Date.now();
    if (lastRemovalToastRef.current.id !== serverId || now - lastRemovalToastRef.current.t > 4000) {
      lastRemovalToastRef.current = { id: serverId, t: now };
      toast.info('You were removed from this server.');
    }
  }, [navigate, toast]);

  /** Kicked/banned users are excluded from broadcastToServer — API also notifies them directly. */
  useEffect(() => {
    if (!on || !user?._id) return;
    return on('ServerMemberLeave', (data) => {
      const sid = data?.serverId;
      const uid = data?.userId;
      if (!sid || uid == null || String(uid) !== String(user._id)) return;
      onSelfRemovedFromServer(sid);
    });
  }, [on, user?._id, onSelfRemovedFromServer]);

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
              <div className="chat-container">
                <div className="chat-main">
                  <Routes>
                    <Route index element={<FriendsPage />} />
                    <Route path=":channelId" element={<MeChannelChat />} />
                  </Routes>
                </div>
                <OfeedPanel />
              </div>
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
              onSelfRemovedFromServer={onSelfRemovedFromServer}
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

function MeChannelChat() {
  const { channelId } = useParams();
  return <ChatArea channelId={channelId} />;
}

function ServerView({ servers, setServers, addServer, removeServer, onSelfRemovedFromServer }) {
  const { serverId } = useParams();
  const handleChannelAccessLost = useCallback(() => {
    if (serverId) onSelfRemovedFromServer(serverId);
  }, [serverId, onSelfRemovedFromServer]);
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
      // Apply payload immediately (Ready events omit status; connect refetch still runs separately).
      if (d?.user_id != null && d?.status != null) {
        setMembers((prev) =>
          prev.map((m) => {
            const uid = typeof m.user === 'object' && m.user ? m.user._id : m.user;
            if (String(uid) !== String(d.user_id)) return m;
            if (typeof m.user !== 'object' || !m.user) return m;
            return { ...m, user: { ...m.user, status: d.status } };
          }),
        );
      }
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
      if (String(data.serverId) !== String(serverId) || !data.userId) return;
      setMembers((prev) => prev.filter((m) => {
        const uid = typeof m.user === 'object' ? m.user._id : m.user;
        return String(uid) !== String(data.userId);
      }));
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
          element={(
            <ServerChatView
              members={members}
              serverRoles={server?.roles || {}}
              channels={channels}
              onChannelAccessLost={handleChannelAccessLost}
            />
          )}
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

function ServerChatView({ members, serverRoles, channels, onChannelAccessLost }) {
  const { channelId } = useParams();
  const channel = (channels || []).find((c) => c._id === channelId);
  const isVoice = channel?.channel_type === 'VoiceChannel';

  if (isVoice) {
    return (
      <div className="chat-container">
        <VoiceChannelView channel={channel} />
        <MemberSidebar members={members} serverRoles={serverRoles} />
        <OfeedPanel />
      </div>
    );
  }

  return (
    <div className="chat-container">
      <ChatArea channelId={channelId} serverRoles={serverRoles} onChannelAccessLost={onChannelAccessLost} />
      <MemberSidebar members={members} serverRoles={serverRoles} />
      <OfeedPanel />
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
