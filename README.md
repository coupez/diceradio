# Dice Radio

Chaotic Spotify discovery app. Tap roll, get a random track, and let the music play.

## Features

- **Random roll** — searches Spotify with random genres and wildcards to surface unexpected tracks
- **Auto-radio** — queues ~10 related tracks after each roll so music keeps playing
- **Playlist sync** — every rolled track is saved to a "Chaos Calls" playlist on Spotify (no duplicates)
- **Roll history** — persisted locally, tap any entry to open it in Spotify
- **Home screen widget** — 1x1 Android widget that rolls a track without opening the app
- **Quick action** — long-press the app icon to roll with a cute dice animation
- **Background playback** — starts music on your active Spotify device without switching apps

## Setup

1. Create a Spotify app at https://developer.spotify.com/dashboard
2. Add redirect URI: `diceradio://redirect`
3. Add your Spotify account under **User Management** (required in development mode)
4. The client ID is already configured in `app.json` — replace `expo.extra.spotifyClientId` if using your own app

## Run (development)

```bash
npm install
npx expo prebuild
npx expo run:android
```

> Requires a native build (not Expo Go) for the widget and quick actions.

## Build APK

```bash
npm run build:apk
```

Outputs an installable APK. Transfer to your Android device and install.

## Project structure

```
App.tsx                     Main app UI (connect, history, roll, settings)
src/
  auth.ts                   Spotify OAuth (PKCE) + token management
  spotify.ts                Search, playback, queue, playlist sync
  spotify-seed.ts           Genre seed list for random searches
  history.ts                Roll history (AsyncStorage)
  types.ts                  TypeScript types
  widget/DiceWidget.tsx     Android home screen widget
  widgetTaskHandler.tsx     Background roll handler for widget
```

## Tech stack

- React Native (Expo SDK 55)
- Spotify Web API (search, playback, playlists, queue)
- expo-auth-session (OAuth PKCE)
- expo-secure-store (token storage)
- react-native-android-widget (home screen widget)
- expo-quick-actions (app shortcuts)
- AsyncStorage (history + playlist ID persistence)
