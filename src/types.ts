export type SpotifyToken = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
};

export type SpotifyTrack = {
  id: string;
  name: string;
  artists: string[];
  uri: string;
  externalUrl?: string;
  genre?: string;
};

export type RollMode = "track" | "playlist";
