import AsyncStorage from "@react-native-async-storage/async-storage";

const apiBaseUrlKey = "pit_mobile_api_base_url_v1";

let cachedApiBaseUrl: string | null = null;
let listeners: Array<(url: string) => void> = [];

export const getDefaultApiBaseUrl = () => {
  return (
    ((globalThis as any)?.process?.env?.EXPO_PUBLIC_API_URL as string | undefined) ||
    "http://192.168.1.2:3000/api/v1"
  );
};

export async function getApiBaseUrl(): Promise<string> {
  if (cachedApiBaseUrl) return cachedApiBaseUrl;

  const stored = await AsyncStorage.getItem(apiBaseUrlKey);
  if (stored && stored.trim()) {
    cachedApiBaseUrl = stored.trim();
    return cachedApiBaseUrl;
  }

  cachedApiBaseUrl = getDefaultApiBaseUrl();
  return cachedApiBaseUrl;
}

export function getApiBaseUrlSync(): string {
  return cachedApiBaseUrl || getDefaultApiBaseUrl();
}

export async function setApiBaseUrl(next: string): Promise<void> {
  const normalized = next.trim().replace(/\/$/, "");
  cachedApiBaseUrl = normalized;
  await AsyncStorage.setItem(apiBaseUrlKey, normalized);
  listeners.forEach((l) => l(normalized));
}

export function subscribeApiBaseUrl(listener: (url: string) => void): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}
