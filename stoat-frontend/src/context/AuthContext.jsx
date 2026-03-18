import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getToken, setToken, getSession, setSession as saveSession, get, post } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    try {
      const u = await get('/users/@me');
      setUser(u);
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
    const session = getSession();
    if (session) {
      import('../api').then(({ del }) => del(`/auth/session/${session._id}`).catch(() => {}));
    }
    setToken(null);
    saveSession(null);
    setUser(null);
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
