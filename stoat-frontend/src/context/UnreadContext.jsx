import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { get, put } from '../api';

const UnreadContext = createContext(null);

export function UnreadProvider({ children }) {
  const [unreads, setUnreads] = useState([]);

  const fetchUnreads = useCallback(async () => {
    try {
      const list = await get('/sync/unreads');
      setUnreads(Array.isArray(list) ? list : []);
    } catch {
      setUnreads([]);
    }
  }, []);

  useEffect(() => {
    fetchUnreads();
    const interval = setInterval(fetchUnreads, 45000);
    return () => clearInterval(interval);
  }, [fetchUnreads]);

  const ackChannel = useCallback(async (channelId, messageId) => {
    try {
      if (messageId) {
        await put(`/channels/${channelId}/ack/${messageId}`);
      } else {
        await put(`/channels/${channelId}/ack`);
      }
      await fetchUnreads();
    } catch {}
  }, [fetchUnreads]);

  const isChannelUnread = useCallback((channelId) => {
    return unreads.some((u) => u.channel_id === channelId);
  }, [unreads]);

  const hasServerUnread = useCallback((serverId) => {
    return unreads.some((u) => u.server_id === serverId);
  }, [unreads]);

  const hasAnyDmUnread = unreads.some((u) => !u.server_id);

  const unreadCountForChannel = useCallback((channelId) => {
    const u = unreads.find((x) => x.channel_id === channelId);
    return u ? 1 : 0;
  }, [unreads]);

  return (
    <UnreadContext.Provider
      value={{
        unreads,
        fetchUnreads,
        ackChannel,
        isChannelUnread,
        hasServerUnread,
        hasAnyDmUnread,
        unreadCountForChannel,
      }}
    >
      {children}
    </UnreadContext.Provider>
  );
}

export function useUnread() {
  return useContext(UnreadContext) || {};
}
