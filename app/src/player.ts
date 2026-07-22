import { createAudioPlayer, setAudioModeAsync, requestNotificationPermissionsAsync } from 'expo-audio';
import type { Player, PlayerEvents } from './playerTypes';

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
 * Without (2) audio still plays on an emulator, which is exactly how it would
 * have shipped to be killed on a real device.
 */
export function createPlayer(events: PlayerEvents): Player {
  const player = createAudioPlayer(null);

  void (async () => {
    try {
      await setAudioModeAsync({ shouldPlayInBackground: true, playsInSilentMode: true });
      await requestNotificationPermissionsAsync();
      player.setActiveForLockScreen(true);
    } catch (e) {
      events.onError(`audio setup: ${(e as Error).message}`);
    }
  })();

  const sub = player.addListener('playbackStatusUpdate', (status) => {
    if (status.currentTime != null) events.onProgress(status.currentTime * 1000);
    if (status.didJustFinish) events.onEnded();
  });

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
      sub.remove();
      player.remove();
    },
  };
}
