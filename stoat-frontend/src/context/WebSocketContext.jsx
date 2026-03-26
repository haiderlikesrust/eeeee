import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { getToken } from '../api';

const WSContext = createContext(null);

/**
 * Build gateway WebSocket URL.
 * - Default: same origin `/ws?token=` (matches Vite dev proxy and typical nginx → Stoat).
 * - VITE_WS_URL: direct API (e.g. ws://localhost:14702) bypasses proxy. Stoat listens at path `/`.
 * - If VITE_WS_URL is the same host as the page (e.g. wss://opic.fun), still use `/ws` so the
 *   reverse proxy upgrades the right path — NOT `/?token=` which hits the HTML server and fails.
 */
function buildWebSocketUrl(token) {
  const q = `token=${encodeURIComponent(token)}`;
  const raw = import.meta.env.VITE_WS_URL?.trim();
  const pagePort = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');

  if (raw) {
    try {
      const normalized = raw.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:');
      const u = new URL(normalized);
      const targetPort = u.port || (u.protocol === 'https:' ? '443' : '80');
      const sameHostAsPage =
        u.hostname === window.location.hostname && String(targetPort) === String(pagePort);
      if (sameHostAsPage) {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        return `${protocol}://${window.location.host}/ws?${q}`;
      }
      const wsProto = u.protocol === 'https:' ? 'wss' : 'ws';
      const path = u.pathname && u.pathname !== '/' ? u.pathname : '/';
      const hostPort = u.port ? `${u.hostname}:${u.port}` : u.hostname;
      return `${wsProto}://${hostPort}${path}?${q}`;
    } catch {
      /* use default below */
    }
  }

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/ws?${q}`;
}

export function WebSocketProvider({ children }) {
  const wsRef = useRef(null);
  const listenersRef = useRef(new Map());
  const [connected, setConnected] = useState(false);
  const [ping, setPing] = useState(null);
  const lastPingSentRef = useRef(null);

  const connect = useCallback(() => {
    const token = getToken();
    if (!token) return;
    if (wsRef.current && wsRef.current.readyState <= 1) return;

    const ws = new WebSocket(buildWebSocketUrl(token));
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      setPing(null);
      setTimeout(connect, 3000);
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'Pong' && lastPingSentRef.current) {
          setPing(Date.now() - lastPingSentRef.current);
        }
        const handlers = listenersRef.current.get(msg.type);
        if (handlers) handlers.forEach((fn) => fn(msg.d ?? msg.data));
      } catch {}
    };
  }, []);

  useEffect(() => {
    // Defer until after first paint so the handshake doesn’t race Chrome’s “page loading” lifecycle.
    const t = setTimeout(() => connect(), 0);
    const interval = setInterval(() => {
      if (wsRef.current?.readyState === 1) {
        lastPingSentRef.current = Date.now();
        wsRef.current.send(JSON.stringify({ type: 'Ping', data: Date.now() }));
      }
    }, 10000);
    return () => {
      clearTimeout(t);
      clearInterval(interval);
      wsRef.current?.close();
    };
  }, [connect]);

  const on = useCallback((type, fn) => {
    if (!listenersRef.current.has(type)) listenersRef.current.set(type, new Set());
    listenersRef.current.get(type).add(fn);
    return () => listenersRef.current.get(type)?.delete(fn);
  }, []);

  const send = useCallback((msg) => {
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return (
    <WSContext.Provider value={{ connected, on, send, connect, ping }}>
      {children}
    </WSContext.Provider>
  );
}

export function useWS() {
  return useContext(WSContext);
}
