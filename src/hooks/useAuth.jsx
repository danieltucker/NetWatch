import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,          setUser]          = useState(undefined); // undefined = loading
  const [setupRequired, setSetupRequired] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/auth/me').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/auth/check-setup').then(r => r.json()).catch(() => ({ setupRequired: false })),
    ]).then(([me, setup]) => {
      setSetupRequired(Boolean(setup?.setupRequired));
      setUser(me);
    });
  }, []);

  // Intercept 401 responses from any non-auth API call and drop the session
  useEffect(() => {
    const original = window.fetch;
    window.fetch = function (...args) {
      return original.apply(this, args).then(res => {
        if (res.status === 401) {
          const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');
          if (!url.includes('/api/auth/')) setUser(null);
        }
        return res;
      });
    };
    return () => { window.fetch = original; };
  }, []);

  const login = useCallback(async (username, password) => {
    const r = await fetch('/api/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    });
    if (!r.ok) { const { error } = await r.json(); throw new Error(error); }
    const userData = await r.json();
    setUser(userData);
    return userData;
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    '{}',
    });
    setUser(null);
  }, []);

  const completeSetup = useCallback(async (password) => {
    const r = await fetch('/api/auth/setup', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ password }),
    });
    if (!r.ok) { const { error } = await r.json(); throw new Error(error); }
    const userData = await r.json();
    setSetupRequired(false);
    setUser(userData);
    return userData;
  }, []);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const r = await fetch('/api/auth/change-password', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ currentPassword, newPassword }),
    });
    if (!r.ok) { const { error } = await r.json(); throw new Error(error); }
    return true;
  }, []);

  return (
    <AuthContext.Provider value={{ user, setupRequired, login, logout, completeSetup, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
