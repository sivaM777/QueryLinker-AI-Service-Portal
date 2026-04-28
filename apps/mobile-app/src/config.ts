export const API_BASE_URL =
  (((globalThis as any)?.process?.env?.EXPO_PUBLIC_API_URL as string | undefined) || "http://192.168.1.2:3000/api/v1");
