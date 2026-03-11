import Constants from 'expo-constants';
import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';
import { SpotifyToken } from './types';

const DISCOVERY = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

const TOKEN_KEY = 'spotify_token';

const SCOPES = [
  'user-read-private',
  'user-read-email',
  'user-read-playback-state',
  'user-modify-playback-state',
  'streaming',
  'user-top-read',
  'playlist-modify-public',
  'playlist-modify-private',
];

function clientId(): string {
  const id = (Constants.expoConfig?.extra as any)?.spotifyClientId as string | undefined;
  if (!id || id === 'YOUR_SPOTIFY_CLIENT_ID') {
    throw new Error('Missing Spotify client id in app.json > expo.extra.spotifyClientId');
  }
  return id;
}

export async function saveToken(token: SpotifyToken) {
  await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(token));
}

export async function clearToken() {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function getToken(): Promise<SpotifyToken | null> {
  const raw = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function ensureFreshToken(): Promise<SpotifyToken | null> {
  const token = await getToken();
  if (!token) return null;

  if (!token.expiresAt || Date.now() < token.expiresAt - 60_000) return token;
  if (!token.refreshToken) return token;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: token.refreshToken,
    client_id: clientId(),
  });

  const res = await fetch(DISCOVERY.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    await clearToken();
    return null;
  }

  const json: any = await res.json();
  const next: SpotifyToken = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? token.refreshToken,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };

  await saveToken(next);
  return next;
}

export async function signInSpotify(): Promise<SpotifyToken> {
  const redirectUri = 'diceradio://redirect';

  const req = new AuthSession.AuthRequest({
    clientId: clientId(),
    scopes: SCOPES,
    usePKCE: true,
    responseType: AuthSession.ResponseType.Code,
    redirectUri,
  });

  await req.makeAuthUrlAsync(DISCOVERY);
  const result = await req.promptAsync(DISCOVERY);

  if (result.type !== 'success' || !result.params.code) {
    throw new Error('Spotify login cancelled');
  }

  const tokenRes = await AuthSession.exchangeCodeAsync(
    {
      clientId: clientId(),
      code: result.params.code,
      redirectUri,
      extraParams: {
        code_verifier: req.codeVerifier || '',
      },
    },
    DISCOVERY
  );

  const token: SpotifyToken = {
    accessToken: tokenRes.accessToken,
    refreshToken: tokenRes.refreshToken,
    expiresAt: tokenRes.issuedAt
      ? tokenRes.issuedAt * 1000 + (tokenRes.expiresIn ?? 3600) * 1000
      : Date.now() + (tokenRes.expiresIn ?? 3600) * 1000,
  };

  await saveToken(token);
  return token;
}
