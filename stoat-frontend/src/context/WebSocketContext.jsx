import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { getToken } from '../api';

const WSContext = createContext(null);

/** Dev: set VITE_WS_URL=ws://localhost:14702 to skip the Vite proxy and connect straight to the API. */
function buildWebSocketUrl(token) {
  const direct = import.meta.env.VITE_WS_URL;
  if (direct && String(direct).trim()) {
    const base = String(direct).replace(/\/$/, '');
    return `${base}/?token=${encodeURIComponent(token)}`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/ws?token=${encodeURIComponent(token)}`;
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
