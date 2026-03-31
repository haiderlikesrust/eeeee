import { createContext, useContext, useEffect, useRef, useCallback, useState } from 'react';
import { useAuth } from './AuthContext';
import { useWS } from './WebSocketContext';

const NotificationContext = createContext(null);
const CHANNEL_NOTIFICATION_PRESETS_KEY = 'opic.channelNotificationPresets.v1';

function readChannelNotificationPresets() {
  try {
    const raw = localStorage.getItem(CHANNEL_NOTIFICATION_PRESETS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// Notification sound — generate a short beep via Web Audio API
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.25);
  } catch {}
}

export function NotificationProvider({ children }) {
  const { user } = useAuth();
  const { on } = useWS() || {};
  const [enabled, setEnabled] = useState(() =>
    typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted'
  );
  const [soundEnabled, setSoundEnabled] = useState(true);
  const activeChannelRef = useRef(null);

  // Request notification permission
  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) return;
    const result = await Notification.requestPermission();
    setEnabled(result === 'granted');
  }, []);

  const setActiveChannel = useCallback((channelId) => {
    activeChannelRef.current = channelId;
  }, []);

  useEffect(() => {
    if (!on) return;
    const handleIncomingMessage = (data) => {
      if (!data || !user) return;
      const authorId = typeof data.author === 'object' ? data.author?._id : data.author;
      if (authorId === user._id) return;
      const presets = readChannelNotificationPresets();
      const preset = String(presets?.[data.channel] || 'all');
      const mentionsMe = String(data.content || '').toLowerCase().includes(`@${String(user.username || '').toLowerCase()}`)
        || String(data.content || '').includes(`<@${user._id}>`);
      if (preset === 'none') return;
      if (preset === 'mentions' && !mentionsMe) return;
      if (data.channel === activeChannelRef.current && document.hasFocus()) return;

      const authorName = typeof data.author === 'object'
        ? (data.author?.display_name || data.author?.username || 'Someone')
        : 'Someone';
      const content = data.content?.slice(0, 100) || '(attachment)';

      if (soundEnabled) playNotificationSound();

      if (enabled && !document.hasFocus() && typeof window !== 'undefined' && 'Notification' in window) {
        try {
          const notif = new Notification(authorName, {
            body: content,
            icon: '/favicon.ico',
            tag: data._id,
            silent: true,
          });
          notif.onclick = () => {
            window.focus();
            notif.close();
          };
          setTimeout(() => notif.close(), 5000);
        } catch {}
      }
    };
    const unsubCreate = on('MESSAGE_CREATE', handleIncomingMessage);
    const unsubLegacy = on('Message', handleIncomingMessage);
    return () => {
      unsubCreate?.();
      unsubLegacy?.();
    };
  }, [on, user, enabled, soundEnabled]);

  return (
    <NotificationContext.Provider value={{
      enabled,
      soundEnabled,
      requestPermission,
      setEnabled,
      setSoundEnabled,
      setActiveChannel,
    }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationContext) || {};
}
