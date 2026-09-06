/** The one interface both platforms implement. Position is in milliseconds
 *  everywhere, so nothing has to remember which unit a given call uses. */
export interface PlayerEvents {
  onProgress: (positionMs: number) => void;
  onEnded: () => void;
  /**
   * The CURRENT source error, or null when there is none.
   *
   * NULLABLE BECAUSE IT IS A STATE, NOT AN EVENT. expo-audio documents
   * `status.error` as "cleared when a new source is loaded or playback resumes
   * successfully" — so a network blip mid-lecture sets it and then clears it,
   * and treating the first as a one-way latch left a live session with a dead
   * transport and eighty minutes of listening uncounted. Report the change in
   * both directions and the session can recover with the player.
   *
   * SOURCE errors only. A failure to configure background audio or the
   * lock-screen controls is not one: the audio plays, the person can do nothing
   * about it, and routing it here put a native error string in a red band and
   * (once `ready` followed `error`) refused to play a recording that had loaded
   * perfectly.
   */
  onError: (message: string | null) => void;
  /**
   * The transport changed WITHOUT this app asking.
   *
   * The lock screen and the notification controls drive the player directly, and
   * a phone call or another app taking audio focus pauses it. None of that goes
   * through `playback.pause()`, so the session's own `playing` flag went on
   * saying true over silence: the docked bar and the player screen both showed
   * the pause glyph, and the first tap called `pause()` on an already-paused
   * player — a no-op — so resuming took two.
   */
  onPlayingChanged: (playing: boolean) => void;
}

export interface Player {
  load: (url: string, startMs: number) => Promise<void>;
  play: () => void;
  pause: () => void;
  seek: (ms: number) => void;
  setRate: (rate: number) => void;
  unload: () => void;
}
