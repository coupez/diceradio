import { StatusBar } from "expo-status-bar";
import * as QuickActions from "expo-quick-actions";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  BackHandler,
  Easing,
  FlatList,
  Image,
  Linking,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { requestWidgetUpdate } from "react-native-android-widget";
import { clearToken, ensureFreshToken, signInSpotify } from "./src/auth";
import { addToHistory, getHistory, HistoryEntry } from "./src/history";
import {
  fetchChaoticTrack,
  refreshPlaylist,
  queueRelatedTracks,
  startPlayback,
  syncHistoryToPlaylist,
} from "./src/spotify";
import { SpotifyToken } from "./src/types";
import { DiceWidget } from "./src/widget/DiceWidget";

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const [token, setToken] = useState<SpotifyToken | null>(null);
  const [loading, setLoading] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [quickRolling, setQuickRolling] = useState(false);
  const wobbleAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  // Reset quick roll overlay when app comes back to foreground
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && quickRolling) {
        setQuickRolling(false);
        wobbleAnim.setValue(0);
        scaleAnim.setValue(1);
      }
    });
    return () => sub.remove();
  }, [quickRolling]);

  useEffect(() => {
    (async () => {
      const t = await ensureFreshToken();
      setToken(t);
      setHistory(await getHistory());
    })();
  }, []);

  async function onLogin() {
    setAuthBusy(true);
    try {
      const t = await signInSpotify();
      setToken(t);

      const existing = await getHistory();
      if (existing.length) {
        syncHistoryToPlaylist(
          t,
          [...existing].reverse().map((e) => e.uri),
        ).catch((e) => console.warn("Playlist sync failed:", e));
      }
    } catch (err: any) {
      Alert.alert("Spotify login failed", err?.message ?? "Unknown error");
    } finally {
      setAuthBusy(false);
    }
  }

  async function onLogout() {
    await clearToken();
    setToken(null);
    setSettingsOpen(false);
  }

  async function onRefreshPlaylist() {
    if (!token) return;
    setRefreshing(true);
    try {
      const fresh = (await ensureFreshToken()) ?? token;
      if (!fresh) throw new Error("Session expired");
      const result = await refreshPlaylist(fresh);
      Alert.alert("Playlist", result);
    } catch (err: any) {
      Alert.alert("Error", err?.message ?? "Unknown error");
    } finally {
      setRefreshing(false);
    }
  }

  const onRoll = useCallback(async () => {
    if (!token?.accessToken) {
      Alert.alert(
        "Connect Spotify first",
        'Tap "Connect Spotify" to continue.',
      );
      return;
    }

    setLoading(true);
    try {
      const fresh = (await ensureFreshToken()) ?? token;
      if (!fresh?.accessToken) {
        throw new Error("Session expired. Please reconnect Spotify.");
      }

      const track = await fetchChaoticTrack(fresh);
      const updated = await addToHistory(track);
      setHistory(updated);

      // Sync to playlist first so playback can use playlist context
      await syncHistoryToPlaylist(
        fresh,
        updated.map((e) => e.uri),
      ).catch((e) => console.warn("Playlist sync failed:", e));

      try {
        await startPlayback(fresh, track.uri);
        if (track.genre) {
          queueRelatedTracks(fresh, track.genre, track.uri).catch((e) =>
            console.warn("Queue failed:", e),
          );
        }
      } catch {
        if (track.externalUrl) {
          await Linking.openURL(track.externalUrl);
        } else {
          await Linking.openURL("spotify://");
        }
      }
    } catch (err: any) {
      Alert.alert("Roll failed", err?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    requestWidgetUpdate({
      widgetName: "DiceWidget",
      renderWidget: () => <DiceWidget />,
    }).catch(() => {});

    QuickActions.setItems([
      {
        id: "roll",
        title: "Roll",
        icon: "shortcut_roll",
        params: { href: "diceradio://roll" },
      },
    ]);
  }, []);

  useEffect(() => {
    const maybeRollFromUrl = async (url: string | null) => {
      if (!url) return;
      if (url.startsWith("diceradio://roll")) {
        await onRoll();
      }
    };

    Linking.getInitialURL().then(maybeRollFromUrl);
    const sub = Linking.addEventListener("url", ({ url }) => {
      maybeRollFromUrl(url);
    });

    const doQuickRoll = async () => {
      setQuickRolling(true);
      Animated.loop(
        Animated.sequence([
          Animated.timing(wobbleAnim, {
            toValue: 1,
            duration: 200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(wobbleAnim, {
            toValue: -1,
            duration: 400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(wobbleAnim, {
            toValue: 0,
            duration: 200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ).start();
      Animated.loop(
        Animated.sequence([
          Animated.timing(scaleAnim, {
            toValue: 1.15,
            duration: 400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim, {
            toValue: 1,
            duration: 400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ).start();
      await onRoll();
      await new Promise((r) => setTimeout(r, 800));
      BackHandler.exitApp();
    };

    const initial = QuickActions.initial;
    if (initial?.id === "roll") doQuickRoll();
    const qaSub = QuickActions.addListener((action) => {
      if (action.id === "roll") doQuickRoll();
    });

    return () => {
      sub.remove();
      qaSub.remove();
    };
  }, [onRoll]);

  const wobble = wobbleAnim.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: ["-15deg", "0deg", "15deg"],
  });

  // ---------- Quick action overlay ----------
  if (quickRolling) {
    return (
      <View style={styles.quickRollOverlay}>
        <Animated.Image
          source={require("./assets/dice-logo.png")}
          style={[
            styles.quickRollDice,
            { transform: [{ rotate: wobble }, { scale: scaleAnim }] },
          ]}
        />
        <StatusBar style="light" translucent backgroundColor="transparent" />
      </View>
    );
  }

  // ---------- Not logged in ----------
  if (!token) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.connectContainer}>
          <Image
            source={require("./assets/dice-logo.png")}
            style={styles.logo}
          />
          <Text style={styles.title}>Dice Radio</Text>
          <Text style={styles.subtitle}>Chaotic Spotify discovery</Text>
          <TouchableOpacity
            style={styles.connectButton}
            onPress={onLogin}
            disabled={authBusy}
          >
            {authBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.connectText}>Connect Spotify</Text>
            )}
          </TouchableOpacity>
        </View>
        <StatusBar style="light" />
      </SafeAreaView>
    );
  }

  // ---------- Logged in ----------
  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Dice Radio</Text>
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() => setSettingsOpen(true)}
        >
          <Text style={styles.settingsIcon}>⚙</Text>
        </TouchableOpacity>
      </View>

      {/* History */}
      <View style={styles.historyContainer}>
        {history.length > 0 ? (
          <FlatList
            data={history}
            keyExtractor={(item, i) => `${item.id}-${i}`}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.historyList}
            renderItem={({ item, index }) => (
              <TouchableOpacity
                style={styles.historyItem}
                onPress={() =>
                  item.externalUrl && Linking.openURL(item.externalUrl)
                }
                activeOpacity={0.6}
              >
                <View style={styles.historyIndex}>
                  <Text style={styles.historyIndexText}>{index + 1}</Text>
                </View>
                <View style={styles.historyMeta}>
                  <Text style={styles.historyTrack} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.historyArtist} numberOfLines={1}>
                    {item.artists.join(", ")}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          />
        ) : (
          <View style={styles.emptyHistory}>
            <Text style={styles.emptyText}>No rolls yet</Text>
            <Text style={styles.emptySubtext}>
              Hit ROLL to discover something chaotic
            </Text>
          </View>
        )}
      </View>

      {/* Roll button — pinned to bottom */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.rollButton, loading && styles.rollButtonLoading]}
          onPress={onRoll}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color="#111" size="small" />
          ) : (
            <Text style={styles.rollText}>🎲 ROLL</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Settings Modal */}
      <Modal
        visible={settingsOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setSettingsOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Settings</Text>

            <TouchableOpacity
              style={styles.settingsRow}
              onPress={onRefreshPlaylist}
              disabled={refreshing}
            >
              {refreshing ? (
                <ActivityIndicator color="#1ed760" size="small" />
              ) : (
                <Text style={styles.settingsRowIcon}>🔄</Text>
              )}
              <View style={styles.settingsRowContent}>
                <Text style={styles.settingsRowText}>Refresh playlist</Text>
                <Text style={styles.settingsRowHint}>
                  Check if "Chaos Calls" exists, or create it
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.settingsRow} onPress={onLogout}>
              <Text style={styles.settingsRowIcon}>🚪</Text>
              <View style={styles.settingsRowContent}>
                <Text style={[styles.settingsRowText, { color: "#ff4d4d" }]}>
                  Disconnect Spotify
                </Text>
                <Text style={styles.settingsRowHint}>
                  Sign out and clear session
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.closeModal}
              onPress={() => setSettingsOpen(false)}
            >
              <Text style={styles.closeModalText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <StatusBar style="light" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // ---------- Quick roll overlay ----------
  quickRollOverlay: {
    flex: 1,
    backgroundColor: "#0f0f12",
    alignItems: "center",
    justifyContent: "center",
  },
  quickRollDice: {
    width: 120,
    height: 120,
    resizeMode: "contain",
  },

  container: {
    flex: 1,
    backgroundColor: "#0f0f12",
  },

  // ---------- Connect screen ----------
  connectContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  logo: {
    width: 100,
    height: 100,
    resizeMode: "contain",
    marginBottom: 12,
  },
  title: {
    color: "#fff",
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  subtitle: {
    color: "#777",
    fontSize: 16,
    marginTop: 4,
    marginBottom: 32,
  },
  connectButton: {
    backgroundColor: "#1ed760",
    borderRadius: 999,
    paddingVertical: 16,
    paddingHorizontal: 48,
    minWidth: 220,
    alignItems: "center",
  },
  connectText: {
    color: "#111",
    fontWeight: "800",
    fontSize: 16,
    letterSpacing: 0.5,
  },

  // ---------- Header ----------
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  settingsButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1c1c24",
    alignItems: "center",
    justifyContent: "center",
  },
  settingsIcon: {
    fontSize: 18,
    color: "#888",
  },

  // ---------- History ----------
  historyContainer: {
    flex: 1,
    paddingHorizontal: 20,
  },
  historyList: {
    paddingTop: 8,
    paddingBottom: 16,
  },
  historyItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomColor: "#1a1a22",
    borderBottomWidth: 1,
    gap: 14,
  },
  historyIndex: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "#1c1c24",
    alignItems: "center",
    justifyContent: "center",
  },
  historyIndexText: {
    color: "#555",
    fontSize: 12,
    fontWeight: "700",
  },
  historyMeta: {
    flex: 1,
  },
  historyTrack: {
    color: "#eee",
    fontSize: 15,
    fontWeight: "600",
  },
  historyArtist: {
    color: "#666",
    fontSize: 13,
    marginTop: 2,
  },
  emptyHistory: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    color: "#555",
    fontSize: 18,
    fontWeight: "700",
  },
  emptySubtext: {
    color: "#3a3a44",
    fontSize: 14,
    marginTop: 6,
  },

  // ---------- Bottom bar ----------
  bottomBar: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    paddingTop: 12,
  },
  rollButton: {
    backgroundColor: "#1ed760",
    borderRadius: 999,
    paddingVertical: 18,
    alignItems: "center",
  },
  rollButtonLoading: {
    opacity: 0.7,
  },
  rollText: {
    color: "#111",
    fontWeight: "900",
    fontSize: 18,
    letterSpacing: 1.5,
  },

  // ---------- Settings modal ----------
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#17171c",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 12,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#333",
    alignSelf: "center",
    marginBottom: 20,
  },
  modalTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 20,
  },
  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    borderBottomColor: "#222",
    borderBottomWidth: 1,
    gap: 14,
  },
  settingsRowIcon: {
    fontSize: 20,
    width: 28,
    textAlign: "center",
  },
  settingsRowContent: {
    flex: 1,
  },
  settingsRowText: {
    color: "#eee",
    fontSize: 16,
    fontWeight: "600",
  },
  settingsRowHint: {
    color: "#555",
    fontSize: 13,
    marginTop: 2,
  },
  closeModal: {
    marginTop: 24,
    backgroundColor: "#1c1c24",
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
  },
  closeModalText: {
    color: "#ccc",
    fontWeight: "700",
    fontSize: 16,
  },
});
