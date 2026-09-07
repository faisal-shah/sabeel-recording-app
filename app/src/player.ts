import { createAudioPlayer, setAudioModeAsync, requestNotificationPermissionsAsync } from 'expo-audio';
import type { Player, PlayerEvents } from './playerTypes';
import { captureError } from './sentry';

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

  let playing: boolean | null = null;
  let sourceError: string | null = null;
  const sub = player.addListener('playbackStatusUpdate', (status) => {
    /*
     * THE ERROR FIELD, WHICH NOTHING WAS READING. `onError` was reachable only
     * from the audio-mode setup below, so a source that failed to load — the
     * ordinary outcome of opening a lecture on a flaky connection — reported
     * nothing at all. `load` does not await `replace`, so the session went
     * `ready: true` with a fully enabled transport, no error notice, and a play
     * button that did nothing; and `openPlayback`'s idempotency guard keys on
     * `!state.error`, so leaving the screen and coming back took the
     * early-return branch and could not retry. The only way out was the × on
     * the docked bar.
     */
    // ON CHANGE, IN BOTH DIRECTIONS. `status.error` is a sticky field, so
    // reporting it on every update re-rendered both surfaces at the status rate
    // for as long as a failed session stayed open — and never told anyone when
    // it cleared, which expo-audio documents as the normal end of a transient
    // fault.
    if (status.error !== sourceError) {
      sourceError = status.error;
      events.onError(sourceError);
    }
    if (status.currentTime != null) events.onProgress(status.currentTime * 1000);
    // Only on a CHANGE: this fires several times a second.
    if (status.playing !== playing) {
      playing = status.playing;
      events.onPlayingChanged(status.playing);
    }
    if (status.didJustFinish) events.onEnded();
  });
  const detach = () => sub.remove();
  current = { player, detach };

  void (async () => {
    try {
      /*
       * `doNotMix` — EXCLUSIVE AUDIO FOCUS, and the default is not it.
       *
       * expo-audio defaults to `mixWithOthers`, which its own docs describe as
       * "no audio focus is requested… best suited for sound effects, UI feedback,
       * or short audio clips". A two-hour lecture is the opposite of that: it
       * played over whatever else was going, did not duck or pause for a phone
       * call, and had no claim on the transport the OS hands to the app that
       * owns focus — which is the same focus `setActiveForLockScreen` needs for
       * the lock-screen controls to bind.
       */
      await setAudioModeAsync({
        shouldPlayInBackground: true,
        playsInSilentMode: true,
        interruptionMode: 'doNotMix',
      });
      await requestNotificationPermissionsAsync();
      player.setActiveForLockScreen(true);
    } catch (e) {
      /*
       * REPORTED, NOT SURFACED. Background playback or the lock-screen controls
       * failing to configure does not stop the audio, and there is nothing the
       * person can do — while `onError` puts a native message in a full-width
       * red band and, since the transport follows it, refused to play a
       * recording that had loaded perfectly. A source error is the only thing
       * that channel is for.
       *
       * But it still has to leave evidence somewhere a person will look: this
       * module's own header says missing any of the three setup calls fails
       * QUIETLY, and a console line on somebody's phone is the definition of
       * quiet. `captureError` is where every other invisible failure in this app
       * goes.
       */
      captureError(e, { source: 'audioSetup' });
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
