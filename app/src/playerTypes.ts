/** The one interface both platforms implement. Position is in milliseconds
 *  everywhere, so nothing has to remember which unit a given call uses. */
export interface PlayerEvents {
  onProgress: (positionMs: number) => void;
  onEnded: () => void;
  onError: (message: string) => void;
}

export interface Player {
  load: (url: string, startMs: number) => Promise<void>;
  play: () => void;
  pause: () => void;
  seek: (ms: number) => void;
  setRate: (rate: number) => void;
  unload: () => void;
}
