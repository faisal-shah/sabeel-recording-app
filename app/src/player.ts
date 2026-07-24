import { createAudioPlayer, setAudioModeAsync, requestNotificationPermissionsAsync } from 'expo-audio';
import type { Player, PlayerEvents } from './playerTypes';

type NativePlayer = ReturnType<typeof createAudioPlayer>;

/**
 * Native side of the player seam (web sibling: player.web.ts), on expo-audio.
 * `expo-av` is end-of-life and is not used.
 *
 * Background playback needs three things, and the Phase 3a spike proved that
 * missing any of them fails quietly:
 *
 *  1. `shouldPlayInBackground` in the audio mode;
 *  2. the FOREGROUND_SERVICE permissions and the media service in the manifest —
 *     which come from the config plugin and therefore need `expo prebuild`, since
 *     plugins do not run on their own in the bare workflow;
 *  3. POST_NOTIFICATIONS, or the media controls never appear.
 *
 * Because of (1)+(2) there is a foreground service keeping audio alive, and that
 * is exactly why there must be **at most ONE player alive at a time**. Two
 * problems otherwise, both seen on a real device:
 *  - `player.remove()` alone does NOT stop a playing background player, so a
 *    screen that unmounts leaves audio running with no UI to control it; and
 *  - navigation can create the next player before the previous one's cleanup has
 *    run (or a cleanup fails), so you get two streams at once, and neither the
 *    lock-screen controls nor killing the app can stop the orphan.
 *
 * A module-level handle fixes both: creating a player tears its predecessor down
 * first, and teardown PAUSES (and drops the lock-screen session) before removing.
 */
let current: { player: NativePlayer; detach: () => void } | null = null;

function hardStop(player: NativePlayer, detach: () => void) {
  try { detach(); } catch { /* best-effort teardown */ }
  try { player.setActiveForLockScreen(false); } catch { /* best-effort teardown */ }
  try { player.pause(); } catch { /* best-effort teardown */ }
  try { player.remove(); } catch { /* best-effort teardown */ }
}

function stopCurrent() {
  if (!current) return;
  const c = current;
  current = null;
  hardStop(c.player, c.detach);
}

export function createPlayer(events: PlayerEvents): Player {
  // Kill any predecessor FIRST — this stops an orphan when a recording is
  // re-opened and guarantees a single audio stream from the app.
  stopCurrent();

  const player = createAudioPlayer(null);

  const sub = player.addListener('playbackStatusUpdate', (status) => {
    if (status.currentTime != null) events.onProgress(status.currentTime * 1000);
    if (status.didJustFinish) events.onEnded();
  });
  const detach = () => sub.remove();
  current = { player, detach };

  void (async () => {
    try {
      await setAudioModeAsync({ shouldPlayInBackground: true, playsInSilentMode: true });
      await requestNotificationPermissionsAsync();
      player.setActiveForLockScreen(true);
    } catch (e) {
      events.onError(`audio setup: ${(e as Error).message}`);
    }
  })();

  return {
    async load(url, startMs) {
      player.replace({ uri: url });
      if (startMs > 0) await player.seekTo(startMs / 1000);
    },
    play: () => player.play(),
    pause: () => player.pause(),
    seek: (ms) => void player.seekTo(ms / 1000),
    setRate: (rate) => player.setPlaybackRate(rate),
    unload: () => {
      // If a newer player already replaced this one, just stop this stale
      // instance; otherwise clear the module handle too.
      if (current?.player === player) stopCurrent();
      else hardStop(player, detach);
    },
  };
}
