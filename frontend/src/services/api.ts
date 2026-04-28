import axios, {
  AxiosError,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";

let refreshPromise: Promise<boolean> | null = null;

type CacheEntry = {
  expiresAt: number;
  data: unknown;
  status: number;
  statusText: string;
  headers: Record<string, string>;
};

type CacheAwareConfig = InternalAxiosRequestConfig & {
  __cacheKey?: string;
  __cacheTTL?: number;
  __fromCache?: boolean;
  skipAuthRedirect?: boolean;
};

// Real-time first: caching is opt-in per request via `x-cache-ttl` header.
const DEFAULT_CACHE_TTL_MS = 0;
const CACHE_PREFIX = "api_cache_v1:";
const memoryCache = new Map<string, CacheEntry>();
let cacheNamespace = "anon";

const normalizeHeaders = (headers: unknown): Record<string, string> => {
  if (!headers || typeof headers !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (typeof value === "string") out[key.toLowerCase()] = value;
  }
  return out;
};

const buildCacheKey = (input: { baseURL?: string; url?: string; params?: unknown }) => {
  const base = input.baseURL || "";
  const url = input.url || "";
  const params = input.params ? JSON.stringify(input.params) : "";
  return `${cacheNamespace}|${base}|${url}|${params}`;
};

const readCache = (key: string): CacheEntry | null => {
  const now = Date.now();
  const mem = memoryCache.get(key);
  if (mem) {
    if (mem.expiresAt > now) return mem;
    memoryCache.delete(key);
  }
  try {
    const raw = window.sessionStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed || typeof parsed.expiresAt !== "number") return null;
    if (parsed.expiresAt <= now) {
      window.sessionStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    memoryCache.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
};

const writeCache = (key: string, entry: CacheEntry) => {
  memoryCache.set(key, entry);
  try {
    window.sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    return;
  }
};

export const getCachedData = <T>(input: { url: string; params?: unknown; baseURL?: string }): T | null => {
  if (typeof window === "undefined") return null;
  const key = buildCacheKey(input);
  const entry = readCache(key);
  return entry ? (entry.data as T) : null;
};

export const clearApiCache = () => {
  memoryCache.clear();
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i);
      if (key && key.startsWith(CACHE_PREFIX)) keys.push(key);
    }
    keys.forEach((k) => window.sessionStorage.removeItem(k));
  } catch {
    return;
  }
};

export const setCacheNamespace = (namespace: string | null | undefined) => {
  cacheNamespace = String(namespace || "anon");
  clearApiCache();
};

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api/v1",
  withCredentials: true,
});

const getCurrentSessionUrl = () => {
  if (typeof window === "undefined") return undefined;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current.startsWith("/") && !current.startsWith("/login")) {
    window.sessionStorage.setItem("active_session_last_url", current);
    return current;
  }
  const stored = window.sessionStorage.getItem("active_session_last_url");
  if (stored && stored.startsWith("/") && !stored.startsWith("/login")) {
    return stored;
  }
  return undefined;
};

export const getApiErrorMessage = (
  error: unknown,
  fallbackMessage: string
): string => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    if (data && typeof data === "object" && "message" in data) {
      const message = (data as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
    }
  }
  return fallbackMessage;
};

export const isCanceledError = (error: unknown): boolean => {
  return axios.isCancel(error);
};

// Note: No Authorization header interceptor needed - httpOnly cookies are sent automatically
api.interceptors.request.use((config) => {
  const tabId = typeof window !== "undefined" ? window.sessionStorage.getItem("tab_id") : null;
  if (tabId) {
    const nextHeaders = {
      ...(config.headers as Record<string, unknown> | undefined),
      "x-tab-id": tabId,
    };
    config.headers = nextHeaders as any;
  }
  const method = String(config.method || "get").toLowerCase();
  if (method !== "get") return config;
  const url = String(config.url || "");
  if (url.includes("/auth/")) return config;
  if (url.includes("/notifications")) return config;
  if (url.includes("/schedule")) return config;
  if (url.includes("/users")) return config;
  const headers = config.headers as Record<string, unknown> | undefined;
  const ttlHeader = headers?.["x-cache-ttl"] ?? headers?.["X-Cache-TTL"];
  const ttl = typeof ttlHeader === "string" ? parseInt(ttlHeader, 10) : DEFAULT_CACHE_TTL_MS;
  if (headers) {
    delete headers["x-cache-ttl"];
    delete headers["X-Cache-TTL"];
  }

  // Force fresh data for real-time UX unless explicitly overridden with a positive TTL.
  const effectiveTtl = Number.isFinite(ttl) && ttl > 0 ? ttl : 0;
  if (effectiveTtl <= 0) {
    const nextHeaders = {
      ...(config.headers as Record<string, unknown> | undefined),
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    };
    config.headers = nextHeaders as any;
    return config;
  }

  const cacheKey = buildCacheKey({ baseURL: config.baseURL, url: config.url, params: config.params });
  const cached = typeof window !== "undefined" ? readCache(cacheKey) : null;
  (config as CacheAwareConfig).__cacheKey = cacheKey;
  (config as CacheAwareConfig).__cacheTTL = effectiveTtl;
  if (cached) {
    (config as CacheAwareConfig).__fromCache = true;
    config.adapter = async () => {
      const response: AxiosResponse = {
        data: cached.data,
        status: cached.status,
        statusText: cached.statusText,
        headers: cached.headers,
        config,
        request: undefined,
      };
      return response;
    };
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    const config = response.config as CacheAwareConfig;
    const method = String(config.method || "get").toLowerCase();
    const url = String(config.url || "");
    const ttl = config.__cacheTTL ?? 0;
    if (
      method === "get" &&
      ttl > 0 &&
      !url.includes("/auth/") &&
      !url.includes("/notifications") &&
      !url.includes("/schedule") &&
      !url.includes("/users")
    ) {
      const cacheKey = config.__cacheKey || buildCacheKey({ baseURL: config.baseURL, url: config.url, params: config.params });
      const entry: CacheEntry = {
        expiresAt: Date.now() + ttl,
        data: response.data,
        status: response.status,
        statusText: response.statusText,
        headers: normalizeHeaders(response.headers),
      };
      if (typeof window !== "undefined") writeCache(cacheKey, entry);
    }
    if (method !== "get") {
      clearApiCache();
    }
    return response;
  },
  async (error: AxiosError) => {
    const status = error.response?.status;
    const original = error.config as (InternalAxiosRequestConfig & { __isRetryRequest?: boolean }) | undefined;
    const suppressRedirect = Boolean((original as CacheAwareConfig | undefined)?.skipAuthRedirect);

    const url = String(original?.url || "");
    const isAuthEndpoint = url.includes("/auth/");

    if (status === 401 && original && !original.__isRetryRequest && !isAuthEndpoint) {
      original.__isRetryRequest = true;

      try {
        if (!refreshPromise) {
          const tabId = typeof window !== "undefined" ? window.sessionStorage.getItem("tab_id") : null;
          refreshPromise = api
            .post("/auth/refresh", {
              tab_id: tabId ?? undefined,
              current_url: getCurrentSessionUrl(),
            })
            .then(() => {
              // Token refreshed via httpOnly cookie - no need to handle token manually
              return true;
            })
            .catch(() => {
              return false;
            })
            .finally(() => {
              refreshPromise = null;
            });
        }

        const success = await refreshPromise;
        if (!success) {
          if (!suppressRedirect && window.location.pathname !== "/login") {
            window.location.href = "/login";
          }
          return Promise.reject(error);
        }

        // Retry the original request - cookie is sent automatically
        return api(original);
      } catch {
        if (!suppressRedirect && window.location.pathname !== "/login") {
          window.location.href = "/login";
        }
      }
    }

    return Promise.reject(error);
  }
);
