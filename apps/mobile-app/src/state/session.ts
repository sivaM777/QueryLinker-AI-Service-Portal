import AsyncStorage from "@react-native-async-storage/async-storage";
import type { User } from "../types";

const key = "pit_mobile_session_v1";

type Session = {
  accessToken: string;
  refreshToken: string;
  user: User;
};

export async function saveSession(session: Session) {
  await AsyncStorage.setItem(key, JSON.stringify(session));
}

export async function getSession(): Promise<Session | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export async function clearSession() {
  await AsyncStorage.removeItem(key);
}
