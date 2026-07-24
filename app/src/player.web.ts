import type { Player, PlayerEvents } from './playerTypes';

/**
 * Web side of the player seam (native sibling: player.ts).
 *
 * A plain HTMLAudioElement: it streams over range requests, seeks without
 * re-downloading, and needs no dependency.
 *
 * As on native, there must be AT MOST ONE player alive at a time — if a screen
 * remounts before its cleanup runs, two elements would play at once. A
 * module-level handle enforces it: creating a player stops its predecessor.
 */
let current: HTMLAudioElement | null = null;

function stop(el: HTMLAudioElement) {
  el.pause();
  el.removeAttribute('src');
  el.load();
}

export function createPlayer(events: PlayerEvents): Player {
  if (current) stop(current);

  const el = new Audio();
  el.preload = 'metadata';
  current = el;
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
      stop(el);
      if (current === el) current = null;
    },
  };
}
