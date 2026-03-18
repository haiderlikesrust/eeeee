import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { getToken } from '../api';

const WSContext = createContext(null);

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

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws?token=${encodeURIComponent(token)}`);
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
    connect();
    const interval = setInterval(() => {
      if (wsRef.current?.readyState === 1) {
        lastPingSentRef.current = Date.now();
        wsRef.current.send(JSON.stringify({ type: 'Ping', data: Date.now() }));
      }
    }, 10000);
    return () => {
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
