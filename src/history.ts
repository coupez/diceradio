import AsyncStorage from "@react-native-async-storage/async-storage";
import { SpotifyTrack } from "./types";

const HISTORY_KEY = "roll_history";
const MAX_HISTORY = 100;

export type HistoryEntry = SpotifyTrack & { rolledAt: number };

export async function getHistory(): Promise<HistoryEntry[]> {
  const raw = await AsyncStorage.getItem(HISTORY_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function addToHistory(track: SpotifyTrack): Promise<HistoryEntry[]> {
  const history = await getHistory();
  const entry: HistoryEntry = { ...track, rolledAt: Date.now() };
  const updated = [entry, ...history].slice(0, MAX_HISTORY);
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  return updated;
}
