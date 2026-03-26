import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getToken, setToken, getSession, setSession as saveSession, get, post } from '../api';
import {
  flushAnalytics,
  rotateAnonymousIdentity,
  setServerAnalyticsOptOut,
  track,
} from '../analytics/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    try {
      const u = await get('/users/@me');
      setUser(u);
      try {
        const s = await post('/sync/settings/fetch', { keys: ['analytics_opt_out'] });
        const raw = s?.analytics_opt_out;
        setServerAnalyticsOptOut(
          raw === '1' || raw === 'true' || String(raw || '').toLowerCase() === 'yes',
        );
      } catch {
        setServerAnalyticsOptOut(false);
      }
      // Warm the main app shell chunk so /channels/* doesn’t flash a blank Suspense frame on first visit.
      import('../pages/AppLayout').catch(() => {});
    } catch {
      setToken(null);
      saveSession(null);
      setUser(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (getToken()) fetchUser();
    else setLoading(false);
  }, [fetchUser]);

  const login = async (email, password) => {
    const res = await post('/auth/session/login', { email, password });
    setToken(res.token);
    saveSession(res);
    await fetchUser();
    return res;
  };

  const register = async (email, password, username) => {
    const res = await post('/auth/account/create', { email, password, username });
    setToken(res.token);
    saveSession(res);
    await fetchUser();
    return res;
  };

  const logout = () => {
    track('auth.logout');
    flushAnalytics(false);
    const session = getSession();
    if (session) {
      import('../api').then(({ del }) => del(`/auth/session/${session._id}`).catch(() => {}));
    }
    setToken(null);
    saveSession(null);
    setUser(null);
    setServerAnalyticsOptOut(false);
    rotateAnonymousIdentity();
  };

  return (
    <AuthContext.Provider value={{ user, setUser, loading, login, register, logout, fetchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
