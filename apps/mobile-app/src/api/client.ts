import { getApiBaseUrl, subscribeApiBaseUrl } from "../state/appConfig";
import { getSession, saveSession, clearSession } from "../state/session";

const platformHeaders = {
  "x-client-platform": "mobile",
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let cachedBaseUrl: string | null = null;
void getApiBaseUrl().then((v) => {
  cachedBaseUrl = v;
});
subscribeApiBaseUrl((v) => {
  cachedBaseUrl = v;
});

async function apiBaseUrl(): Promise<string> {
  if (cachedBaseUrl) return cachedBaseUrl;
  cachedBaseUrl = await getApiBaseUrl();
  return cachedBaseUrl;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = await getSession();

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...platformHeaders,
    ...(init.headers as Record<string, string> | undefined),
  };

  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }

  if (init.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  let res: Response;
  const baseUrl = await apiBaseUrl();
  try {
    res = await fetch(`${baseUrl}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(
      0,
      "Network request failed. Check that your phone is on the same Wi-Fi as the server and that the API URL is reachable."
    );
  }

  if (res.status === 401 && session?.refreshToken && path !== "/auth/refresh" && path !== "/auth/login") {
    let refreshed: Response;
    try {
      refreshed = await fetch(`${baseUrl}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...platformHeaders },
        body: JSON.stringify({ refresh_token: session.refreshToken }),
      });
    } catch {
      await clearSession();
      throw new ApiError(0, "Network request failed");
    }

    if (refreshed.ok) {
      const data = (await refreshed.json()) as any;
      const nextAccess = typeof data?.token === "string" ? data.token : null;
      const nextRefresh = typeof data?.refresh_token === "string" ? data.refresh_token : null;
      if (nextAccess && nextRefresh) {
        await saveSession({ accessToken: nextAccess, refreshToken: nextRefresh, user: data.user ?? session.user });
        return request<T>(path, init);
      }
    }

    await clearSession();
    throw new ApiError(401, "Unauthorized");
  }

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const msg = typeof json?.message === "string" ? json.message : `Request failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }

  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
};
