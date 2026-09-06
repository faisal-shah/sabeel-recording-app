/** The one interface both platforms implement. Position is in milliseconds
 *  everywhere, so nothing has to remember which unit a given call uses. */
export interface PlayerEvents {
  onProgress: (positionMs: number) => void;
  onEnded: () => void;
  onError: (message: string) => void;
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
