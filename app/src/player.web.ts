import type { Player, PlayerEvents } from './playerTypes';

/**
 * Web side of the player seam (native sibling: player.ts).
 *
 * A plain HTMLAudioElement: it streams over range requests, seeks without
 * re-downloading, and needs no dependency.
 */
export function createPlayer(events: PlayerEvents): Player {
  const el = new Audio();
  el.preload = 'metadata';
  el.addEventListener('timeupdate', () => events.onProgress(el.currentTime * 1000));
  el.addEventListener('ended', () => events.onEnded());
  el.addEventListener('error', () =>
    events.onError(el.error ? `audio error ${el.error.code}` : 'audio error'),
  );

  return {
    async load(url, startMs) {
      el.src = url;
      // Seeking before metadata has loaded is silently dropped, so wait for it.
      await new Promise<void>((resolve) => {
        if (el.readyState >= 1) return resolve();
        el.addEventListener('loadedmetadata', () => resolve(), { once: true });
      });
      if (startMs > 0) el.currentTime = startMs / 1000;
    },
    play: () => void el.play(),
    pause: () => el.pause(),
    seek: (ms) => {
      el.currentTime = ms / 1000;
    },
    setRate: (rate) => {
      el.playbackRate = rate;
    },
    unload: () => {
      el.pause();
      el.removeAttribute('src');
      el.load();
    },
  };
}
