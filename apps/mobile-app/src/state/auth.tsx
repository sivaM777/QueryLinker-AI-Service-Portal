import React from "react";
import type { User } from "../types";
import { api } from "../api/client";
import { clearSession, getSession, saveSession } from "./session";

type AuthState = {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = React.createContext<AuthState | null>(null);

export const useAuth = () => {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = React.useState<User | null>(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      const existing = await getSession();
      if (existing?.accessToken && existing.user) {
        setUser(existing.user);
      }
      setReady(true);
    })();
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api.post<{ token: string; user: User; refresh_token: string }>("/auth/login", {
      email,
      password,
    });

    await saveSession({ accessToken: res.token, refreshToken: res.refresh_token, user: res.user });
    setUser(res.user);
  };

  const logout = async () => {
    const existing = await getSession();
    try {
      await api.post("/auth/logout", existing?.refreshToken ? { refresh_token: existing.refreshToken } : undefined);
    } catch {
      await clearSession();
      setUser(null);
      return;
    }
    await clearSession();
    setUser(null);
  };

  if (!ready) return null;

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
