import { useState, useEffect } from 'react';
import { getValidToken, logout as doLogout } from '../spotify/auth';

export function useSpotifyAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    getValidToken().then((t) => {
      setToken(t);
      setIsAuthenticated(t !== null);
    });
  }, []);

  function logout() {
    doLogout();
    setToken(null);
    setIsAuthenticated(false);
  }

  return { isAuthenticated, token, logout };
}
