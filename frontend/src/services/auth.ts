import { createContext, useContext, useEffect, useRef, useState, ReactNode, createElement, Fragment } from "react";
import { api, setCacheNamespace } from "./api";
import { disconnectSocket, reconnectSocket } from "./socket.service";

export interface User {
  id: string;
  email: string;
  role: "EMPLOYEE" | "AGENT" | "MANAGER" | "ADMIN";
  name: string;
  team_id: string | null;
  phone: string | null;
  department: string | null;
  location: string | null;
  bio: string | null;
  avatar_url: string | null;
  availability_status: "ONLINE" | "BUSY" | "OFFLINE" | "ON_BREAK" | "AWAY" | null;
  max_concurrent_tickets: number | null;
  certifications: string[] | null;
  hire_date: string | null;
  organization_id?: string | null;
  organization_name?: string | null;
  organization_is_demo?: boolean;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<User>;
  demoLogin: (role: User["role"]) => Promise<User>;
  registerOrganization: (input: {
    companyName: string;
    domain: string;
    adminName: string;
    adminEmail: string;
    password: string;
  }) => Promise<User>;
  logout: () => void;
  updateUser: (next: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const heartbeatMs = 5_000;
const sessionUrlStorageKey = "active_session_last_url";

const getOrCreateTabId = () => {
  if (typeof window === "undefined") return "server";
  const existing = window.sessionStorage.getItem("tab_id");
  if (existing) return existing;
  const next =
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
  window.sessionStorage.setItem("tab_id", next);
  return next;
};

const getCurrentUrl = () => {
  if (typeof window === "undefined") return null;
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
};

const getCurrentSessionUrl = () => {
  if (typeof window === "undefined") return undefined;
  const current = getCurrentUrl();
  if (current && current.startsWith("/") && !current.startsWith("/login")) {
    window.sessionStorage.setItem(sessionUrlStorageKey, current);
    return current;
  }
  const stored = window.sessionStorage.getItem(sessionUrlStorageKey);
  if (stored && stored.startsWith("/") && !stored.startsWith("/login")) {
    return stored;
  }
  return undefined;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const tabIdRef = useRef<string>("");

  if (typeof window !== "undefined" && !tabIdRef.current) {
    tabIdRef.current = getOrCreateTabId();
    try {
      window.name = tabIdRef.current;
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.name = tabIdRef.current;
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      try {
        const me = await api.get<User>("/auth/me");
        if (!mounted) return;
        setUser(me.data);
        setCacheNamespace(me.data?.id);
        reconnectSocket();
      } catch {
        try {
          await api.post("/auth/refresh", {
            tab_id: tabIdRef.current,
            current_url: getCurrentSessionUrl(),
          });
          const me = await api.get<User>("/auth/me");
          if (!mounted) return;
          setUser(me.data);
          setCacheNamespace(me.data?.id);
          reconnectSocket();
        } catch {
          if (!mounted) return;
          setUser(null);
          setCacheNamespace("anon");
          disconnectSocket();
        }
      } finally {
        if (mounted) setReady(true);
      }
    };

    void bootstrap();

    return () => {
      mounted = false;
    };
  }, []);

  const login = async (email: string, password: string): Promise<User> => {
    const res = await api.post("/auth/login", {
      email,
      password,
      tab_id: tabIdRef.current,
      current_url: getCurrentSessionUrl(),
    });
    const { user: nextUser } = res.data as { user: User };
    setUser(nextUser);
    setCacheNamespace(nextUser?.id);
    reconnectSocket();
    return nextUser;
  };

  const demoLogin = async (role: User["role"]): Promise<User> => {
    const res = await api.post("/auth/demo-login", {
      role,
      tab_id: tabIdRef.current,
      current_url: getCurrentSessionUrl(),
    });
    const { user: nextUser } = res.data as { user: User };
    setUser(nextUser);
    setCacheNamespace(nextUser?.id);
    reconnectSocket();
    return nextUser;
  };

  const registerOrganization = async (input: {
    companyName: string;
    domain: string;
    adminName: string;
    adminEmail: string;
    password: string;
  }): Promise<User> => {
    const res = await api.post("/auth/register-organization", {
      company_name: input.companyName,
      domain: input.domain,
      admin_name: input.adminName,
      admin_email: input.adminEmail,
      password: input.password,
      tab_id: tabIdRef.current,
      current_url: getCurrentSessionUrl(),
    });
    const { user: nextUser } = res.data as { user: User };
    setUser(nextUser);
    setCacheNamespace(nextUser?.id);
    reconnectSocket();
    return nextUser;
  };

  const logout = () => {
    api.post("/auth/logout").catch(() => undefined);
    setUser(null);
    setCacheNamespace("anon");
    disconnectSocket();
  };

  const updateUser = (next: Partial<User>) => {
    setUser((prev) => (prev ? { ...prev, ...next } : prev));
  };

  useEffect(() => {
    if (typeof window === "undefined" || !user?.email) return undefined;

    const postHeartbeat = () => {
      api
        .post("/auth/heartbeat", {
          tab_id: tabIdRef.current,
          current_url: getCurrentSessionUrl(),
        })
        .catch(() => undefined);
    };

    const releaseSession = () => {
      const payload = JSON.stringify({
        tab_id: tabIdRef.current,
        current_url: getCurrentSessionUrl(),
      });

      try {
        if ("sendBeacon" in navigator) {
          const blob = new Blob([payload], { type: "application/json" });
          if (navigator.sendBeacon("/api/v1/auth/release", blob)) {
            return;
          }
        }
      } catch {
        // Fall back to fetch below.
      }

      fetch("/api/v1/auth/release", {
        method: "POST",
        credentials: "include",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: payload,
      }).catch(() => undefined);
    };

    postHeartbeat();

    const heartbeatInterval = window.setInterval(postHeartbeat, heartbeatMs);

    const onPageHide = () => {
      releaseSession();
    };

    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.clearInterval(heartbeatInterval);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [user?.email]);

  if (!ready) return null;

  return createElement(
    AuthContext.Provider,
    { value: { user, isAuthenticated: !!user, login, demoLogin, registerOrganization, logout, updateUser } },
    createElement(Fragment, null, children)
  );
};
