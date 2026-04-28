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

const readPresence = (email: string) => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`active_session:${email.toLowerCase()}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { tabId?: string; url?: string; ts?: number };
    if (!parsed?.tabId || !parsed.ts) return null;
    return parsed;
  } catch {
    return null;
  }
};

const removePresence = (email: string, tabId: string) => {
  if (typeof window === "undefined") return;
  const key = `active_session:${email.toLowerCase()}`;
  const parsed = readPresence(email);
  if (!parsed || parsed.tabId !== tabId) return;
  window.localStorage.removeItem(key);
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [focusBannerUrl, setFocusBannerUrl] = useState<string | null>(null);
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
    const email = user?.email ?? null;
    if (email) {
      removePresence(email, tabIdRef.current);
    }
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

    const email = user.email.toLowerCase();
    const key = `active_session:${email}`;
    const broadcast = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("auth-session") : null;
    let released = false;

    const getPresencePayload = () => ({
      tabId: tabIdRef.current,
      email,
      url: getCurrentSessionUrl(),
      ts: Date.now(),
    });

    const writePresence = () => {
      try {
        window.localStorage.setItem(key, JSON.stringify(getPresencePayload()));
      } catch {
        return;
      }
    };

    const postHeartbeat = () => {
      api
        .post("/auth/heartbeat", {
          tab_id: tabIdRef.current,
          current_url: getCurrentSessionUrl(),
        })
        .catch(() => undefined);
    };

    const releaseSession = () => {
      if (released) return;
      released = true;
      removePresence(email, tabIdRef.current);
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

    writePresence();
    postHeartbeat();

    const presenceInterval = window.setInterval(writePresence, heartbeatMs);
    const heartbeatInterval = window.setInterval(postHeartbeat, heartbeatMs);

    const onMessage = (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; email?: string; requestId?: string; tabId?: string; url?: string }
        | undefined;
      if (!data || typeof data !== "object") return;

      if (data.type === "check-session" && data.email === email) {
        broadcast?.postMessage({
          type: "session-active",
          requestId: data.requestId,
          tabId: tabIdRef.current,
          url: getCurrentSessionUrl(),
        });
        return;
      }

      if (data.type === "focus-tab" && data.tabId === tabIdRef.current) {
        const nextUrl =
          data.url && data.url.startsWith("/") && !data.url.startsWith("/login")
            ? data.url
            : getCurrentSessionUrl();
        setFocusBannerUrl(nextUrl ?? getCurrentUrl());
        if (nextUrl && nextUrl !== getCurrentUrl()) {
          window.location.assign(nextUrl);
        }
        window.localStorage.setItem(
          "focus_tab_ack",
          JSON.stringify({ tabId: tabIdRef.current, ts: Date.now(), url: nextUrl ?? null })
        );
        window.focus();
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== "focus_tab" || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue) as { tabId?: string; url?: string };
        if (parsed?.tabId !== tabIdRef.current) return;
        const nextUrl =
          parsed.url && parsed.url.startsWith("/") && !parsed.url.startsWith("/login")
            ? parsed.url
            : getCurrentSessionUrl();
        setFocusBannerUrl(nextUrl ?? getCurrentUrl());
        if (nextUrl && nextUrl !== getCurrentUrl()) {
          window.location.assign(nextUrl);
        }
        window.localStorage.setItem(
          "focus_tab_ack",
          JSON.stringify({ tabId: tabIdRef.current, ts: Date.now(), url: nextUrl ?? null })
        );
        window.focus();
      } catch {
        return;
      }
    };

    const onPageHide = () => {
      releaseSession();
    };

    broadcast?.addEventListener("message", onMessage);
    window.addEventListener("storage", onStorage);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.clearInterval(presenceInterval);
      window.clearInterval(heartbeatInterval);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pagehide", onPageHide);
      broadcast?.removeEventListener("message", onMessage);
      broadcast?.close();
    };
  }, [user?.email]);

  if (!ready) return null;

  return createElement(
    AuthContext.Provider,
    { value: { user, isAuthenticated: !!user, login, demoLogin, registerOrganization, logout, updateUser } },
    createElement(
      Fragment,
      null,
      children,
      focusBannerUrl
        ? createElement(
            "div",
            {
              style: {
                position: "fixed",
                right: 16,
                bottom: 16,
                zIndex: 2000,
                maxWidth: 360,
                background: "#111827",
                color: "#ffffff",
                padding: "14px 16px",
                borderRadius: 12,
                boxShadow: "0 18px 40px rgba(15, 23, 42, 0.28)",
                border: "1px solid rgba(255,255,255,0.12)",
              },
            },
            createElement(
              "div",
              { style: { fontWeight: 700, marginBottom: 6 } },
              "Active session is here"
            ),
            createElement(
              "div",
              { style: { fontSize: 14, lineHeight: 1.45, opacity: 0.9, marginBottom: 12 } },
              "This is the tab already signed in for this user."
            ),
            createElement(
              "div",
              { style: { display: "flex", gap: 8 } },
              createElement(
                "button",
                {
                  onClick: () => {
                    if (focusBannerUrl && focusBannerUrl !== getCurrentUrl()) {
                      window.location.assign(focusBannerUrl);
                    }
                    window.focus();
                    setFocusBannerUrl(null);
                  },
                  style: {
                    border: 0,
                    borderRadius: 8,
                    padding: "8px 12px",
                    background: "#2563eb",
                    color: "#ffffff",
                    cursor: "pointer",
                    fontWeight: 600,
                  },
                },
                "Stay Here"
              ),
              createElement(
                "button",
                {
                  onClick: () => setFocusBannerUrl(null),
                  style: {
                    borderRadius: 8,
                    padding: "8px 12px",
                    background: "transparent",
                    color: "#ffffff",
                    cursor: "pointer",
                    border: "1px solid rgba(255,255,255,0.24)",
                    fontWeight: 600,
                  },
                },
                "Dismiss"
              )
            )
          )
        : null
    )
  );
};
