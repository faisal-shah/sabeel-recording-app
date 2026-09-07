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
  let sourceError: string | null = null;
  /** Only on a CHANGE — `canplay` fires again after every seek and rebuffer. */
  const report = (message: string | null) => {
    if (message === sourceError) return;
    sourceError = message;
    events.onError(message);
  };
  el.addEventListener('error', () => {
    report(el.error ? `audio error ${el.error.code}` : 'audio error');
    /*
     * AND SAY IT STOPPED, which the element will not.
     *
     * A mid-stream `MEDIA_ERR_NETWORK` or `MEDIA_ERR_DECODE` sets `error` and
     * fires `error`, but leaves `paused` false and emits no `pause` event — so
     * the session, which takes `playing` from the transport, went on believing
     * a dead stream was playing. Both surfaces then drew a greyed PAUSE glyph
     * over silence, and the docked bar carries no error text at all. The native
     * player reports `status.playing` false in the same situation; this is that
     * signal, sent by the side that knows the semantics.
     */
    events.onPlayingChanged(false);
  });
  // The other direction — the element recovered, so the session may re-enable
  // its transport. `canplay` fires once a source is actually playable, which
  // means the previous failure is over.
  el.addEventListener('canplay', () => report(null));
  // The element pauses itself at the end of the media and when the browser's own
  // media keys are used, neither of which goes through `playback.pause()`.
  el.addEventListener('play', () => events.onPlayingChanged(true));
  el.addEventListener('pause', () => events.onPlayingChanged(false));

  return {
    async load(url, startMs) {
      el.src = url;
      /*
       * Seeking before metadata has loaded is silently dropped, so wait for it —
       * but SETTLE ON FAILURE TOO. A request that stalls or 403s fires `error`
       * and never `loadedmetadata`, so waiting on that alone left this promise
       * pending for ever and the session stuck on "Preparing…" with no way to
       * retry. The `error` listener above has already reported it; this only has
       * to stop blocking.
       */
      await new Promise<void>((resolve) => {
        if (el.readyState >= 1) return resolve();
        el.addEventListener('loadedmetadata', () => resolve(), { once: true });
        el.addEventListener('error', () => resolve(), { once: true });
      });
      if (startMs > 0 && el.readyState >= 1) el.currentTime = startMs / 1000;
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
