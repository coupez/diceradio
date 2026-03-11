import AsyncStorage from "@react-native-async-storage/async-storage";
import { SpotifyToken, SpotifyTrack } from "./types";
import { GENRE_SEEDS } from "./spotify-seed";

const API = "https://api.spotify.com/v1";
const PLAYLIST_ID_KEY = "dice_radio_playlist_id";

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Random wildcard character to inject randomness into search queries
function randomWildcard(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  return chars[Math.floor(Math.random() * chars.length)];
}

export async function fetchChaoticTrack(
  token: SpotifyToken,
  attempts = 5,
  maxOffset?: number,
): Promise<SpotifyTrack> {
  const headers = { Authorization: `Bearer ${token.accessToken}` };

  // Use Spotify Search API with a random genre + wildcard query
  const genre = pick(GENRE_SEEDS);
  const wildcard = randomWildcard();
  const offset = Math.floor(Math.random() * Math.min(990, maxOffset ?? 990));
  let q = encodeURIComponent(`genre:${genre} ${wildcard}`);

  const res = await fetch(
    `${API}/search?type=track&limit=10&offset=${offset}&q=${q}`,
    { headers },
  );

  if (!res.ok) {
    const body = await res.text();
    console.log(JSON.stringify(res));
    console.warn(`Search failed (${res.status}): ${body}`);
    throw new Error(`Search failed (${res.status}): ${body}`);
  }

  const json = await res.json();
  const tracks: any[] = json.tracks?.items ?? [];
  if (!tracks.length) {
    if (attempts > 0) {
      return fetchChaoticTrack(token, attempts - 1, Math.floor(offset / 2));
    }
    throw new Error("No tracks found — try again");
  }

  const t: any = pick(tracks);
  return {
    id: t.id,
    name: t.name,
    artists: (t.artists ?? []).map((a: any) => a.name),
    uri: t.uri,
    externalUrl: t.external_urls?.spotify,
    genre,
  };
}

export async function startPlayback(
  token: SpotifyToken,
  trackUri: string,
): Promise<void> {
  const res = await fetch(`${API}/me/player/play`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ uris: [trackUri] }),
  });

  // 204 = success, 404 = no active device, 403/401 = auth issue
  if (res.status === 204) return;
  const body = await res.text();
  throw new Error(
    `Playback failed (${res.status}): ${body || "No active Spotify device"}`,
  );
}

export async function queueRelatedTracks(
  token: SpotifyToken,
  genre: string,
  excludeUri: string,
): Promise<void> {
  const headers = { Authorization: `Bearer ${token.accessToken}` };
  const wildcard = randomWildcard();
  const offset = Math.floor(Math.random() * 990);
  const q = encodeURIComponent(`genre:${genre} ${wildcard}`);

  const res = await fetch(
    `${API}/search?type=track&limit=10&offset=${offset}&q=${q}`,
    { headers },
  );

  if (!res.ok) return;
  const json = await res.json();
  const tracks: any[] = (json.tracks?.items ?? []).filter(
    (t: any) => t.uri !== excludeUri,
  );

  for (const t of tracks) {
    await fetch(`${API}/me/player/queue?uri=${encodeURIComponent(t.uri)}`, {
      method: "POST",
      headers,
    }).catch(() => {});
  }
  console.log(
    `[radio] queued ${tracks.length} related tracks for genre: ${genre}`,
  );
}

async function getOrCreatePlaylist(token: SpotifyToken): Promise<string> {
  const stored = await AsyncStorage.getItem(PLAYLIST_ID_KEY);
  console.log("[playlist] stored id:", stored);
  if (stored) {
    const check = await fetch(`${API}/playlists/${stored}`, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });
    console.log("[playlist] verify existing:", check.status);
    if (check.ok) return stored;
  }

  console.log("[playlist] creating new playlist...");
  const res = await fetch(`${API}/me/playlists`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Chaos Calls",
      description: "Tracks rolled by Dice Radio",
      public: false,
    }),
  });

  const body = await res.text();
  console.log("[playlist] create response:", res.status, body);

  if (!res.ok) {
    throw new Error(`Could not create playlist (${res.status}): ${body}`);
  }

  const json = JSON.parse(body);
  await AsyncStorage.setItem(PLAYLIST_ID_KEY, json.id);
  console.log("[playlist] saved id:", json.id);
  return json.id;
}

async function getPlaylistTrackUris(
  token: SpotifyToken,
  playlistId: string,
): Promise<Set<string>> {
  const uris = new Set<string>();
  let url: string | null =
    `${API}/playlists/${playlistId}/items?fields=items(item(uri)),next&limit=100`;

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });
    if (!res.ok) break;
    const json = await res.json();
    for (const entry of json.items ?? []) {
      if (entry.item?.uri) uris.add(entry.item.uri);
    }
    url = json.next ?? null;
  }

  return uris;
}

export async function refreshPlaylist(token: SpotifyToken): Promise<string> {
  const stored = await AsyncStorage.getItem(PLAYLIST_ID_KEY);
  if (stored) {
    const check = await fetch(`${API}/playlists/${stored}`, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });
    if (check.ok) return "Playlist OK: " + stored;
    // Playlist gone — clear and recreate
    await AsyncStorage.removeItem(PLAYLIST_ID_KEY);
  }
  const id = await getOrCreatePlaylist(token);
  return "Created new playlist: " + id;
}

export async function syncHistoryToPlaylist(
  token: SpotifyToken,
  trackUris: string[],
): Promise<void> {
  console.log("[sync] called with", trackUris.length, "uris");
  if (!trackUris.length) return;
  const playlistId = await getOrCreatePlaylist(token);

  // Get existing tracks to avoid duplicates
  const existing = await getPlaylistTrackUris(token, playlistId);
  const missing = trackUris.filter((uri) => !existing.has(uri));
  console.log("[sync] existing:", existing.size, "missing:", missing.length);
  if (!missing.length) return;

  // Spotify allows max 100 URIs per request
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    const res = await fetch(`${API}/playlists/${playlistId}/items`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ uris: batch }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.warn(`Failed to sync batch to playlist (${res.status}): ${body}`);
    }
  }
}
