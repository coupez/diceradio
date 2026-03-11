import { registerWidgetTaskHandler } from "react-native-android-widget";
import { ensureFreshToken } from "./auth";
import { addToHistory, getHistory } from "./history";
import {
  fetchChaoticTrack,
  fetchChaoticPlaylist,
  getRollMode,
  queueRelatedTracks,
  startPlayback,
  startPlaylistPlayback,
  syncHistoryToPlaylist,
} from "./spotify";
import { DiceWidget } from "./widget/DiceWidget";

registerWidgetTaskHandler(async ({ renderWidget, widgetAction }) => {
  if (widgetAction === "WIDGET_CLICK") {
    const token = await ensureFreshToken();
    if (!token) return;

    try {
      const mode = await getRollMode();

      if (mode === "playlist") {
        const playlist = await fetchChaoticPlaylist(token);
        await addToHistory(playlist, "playlist");
        await startPlaylistPlayback(token, playlist.uri);
      } else {
        const track = await fetchChaoticTrack(token);
        await addToHistory(track, "track");
        const history = await getHistory();
        await syncHistoryToPlaylist(
          token,
          history.map((e) => e.uri),
        ).catch(() => {});
        await startPlayback(token, track.uri);
        if (track.genre) {
          queueRelatedTracks(token, track.genre, track.uri).catch(() => {});
        }
      }
    } catch (err) {
      console.warn("Widget roll failed:", err);
    }
  }

  renderWidget(<DiceWidget />);
});
