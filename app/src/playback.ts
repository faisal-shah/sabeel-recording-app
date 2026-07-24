import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  COLLECTIONS,
  PROGRESS_WRITE_INTERVAL_MS,
  SIGNED_URL_REFRESH_MS,
  mergeProgress,
  progressId,
  type ListeningProgressDoc,
} from '@sabeel/shared';
import { db, functions } from './firebase';
import { createPlayer } from './player';
import type { Player } from './playerTypes';

interface Minted {
  url: string;
  expiresAt: number;
}

const mintUrl = (recordingId: string) =>
  httpsCallable<{ recordingId: string }, Minted>(functions, 'getPlaybackUrl')({ recordingId })
    .then((r) => r.data);

/**
 * Cached playback URLs, refreshed BEFORE they expire.
 *
 * Re-minting only after a failure would mean a seek near the boundary fails
 * audibly first — and it would not even be catchable by status code: GCS
 * returns 400 with `ExpiredToken` on an expired signed URL, not 403. Proactive
 * refresh sidesteps that entirely, which is why it is the rule rather than a
 * retry handler.
 */
const cache = new Map<string, Minted>();

async function playbackUrl(recordingId: string): Promise<string> {
  const hit = cache.get(recordingId);
  if (hit && hit.expiresAt - Date.now() > SIGNED_URL_REFRESH_MS) return hit.url;
  const fresh = await mintUrl(recordingId);
  cache.set(recordingId, fresh);
  return fresh.url;
}

export interface PlaybackState {
  ready: boolean;
  playing: boolean;
  positionMs: number;
  listenedMs: number;
  rate: number;
  error: string | null;
}

/**
 * Drives one recording: mints the URL, restores the saved position, and
 * persists progress.
 *
 * Progress is written on a throttle plus at every moment the listener might
 * disappear — pause, seek, unmount. A write only on an interval loses whatever
 * happened since the last tick when someone closes the tab, and that lost
 * minute is the one a student would argue about.
 */
export function usePlayback(recordingId: string, studentUid: string | null, classId: string) {
  const [state, setState] = useState<PlaybackState>({
    ready: false,
    playing: false,
    positionMs: 0,
    listenedMs: 0,
    rate: 1,
    error: null,
  });

  const player = useRef<Player | null>(null);
  // Refs, not state: the throttled writer reads these from inside a closure
  // that must not be re-created on every progress tick.
  const listened = useRef(0);
  const position = useRef(0);
  const lastTick = useRef<number | null>(null);
  const lastWrite = useRef(0);
  const dirty = useRef(false);
  // After a seek, the player keeps emitting the OLD position for a beat until it
  // actually gets there. Hold the displayed position at the target and ignore
  // those stale ticks, so the thumb doesn't snap backwards right after you drop
  // it. Cleared once the player reports a position near the target.
  const seekTarget = useRef<number | null>(null);

  const persist = useCallback(async () => {
    if (!studentUid || !dirty.current) return;
    dirty.current = false;
    lastWrite.current = Date.now();
    const ref = doc(db, COLLECTIONS.listeningProgress, progressId(studentUid, recordingId));
    const mine = {
      positionMs: Math.round(position.current),
      listenedMs: Math.round(listened.current),
      updatedAt: Date.now(),
    };
    try {
      // Merge against whatever is already there rather than overwriting: another
      // device may have listened further, and total listening must never go
      // backwards.
      const existing = (await getDoc(ref)).data() as ListeningProgressDoc | undefined;
      const merged = existing ? mergeProgress(mine, existing) : mine;
      await setDoc(ref, { studentUid, recordingId, classId, ...merged });
      listened.current = merged.listenedMs;
    } catch {
      // A failed write must not break playback. The next tick retries.
      dirty.current = true;
    }
  }, [studentUid, recordingId, classId]);

  useEffect(() => {
    let cancelled = false;
    const p = createPlayer({
      onProgress: (ms) => {
        // Ignore stale ticks from before an in-flight seek has landed; once the
        // player reports a position near the target, resume normal tracking.
        if (seekTarget.current !== null) {
          if (Math.abs(ms - seekTarget.current) > 1500) return;
          seekTarget.current = null;
        }
        // Count only forward movement at roughly real-time speed as "listened".
        // A seek forward must not manufacture listening that never happened.
        const now = Date.now();
        if (lastTick.current !== null) {
          const advanced = ms - position.current;
          const elapsed = now - lastTick.current;
          if (advanced > 0 && advanced <= elapsed * 3) listened.current += advanced;
        }
        lastTick.current = now;
        position.current = ms;
        dirty.current = true;
        setState((s) => ({ ...s, positionMs: ms, listenedMs: listened.current }));
        if (now - lastWrite.current >= PROGRESS_WRITE_INTERVAL_MS) void persist();
      },
      onEnded: () => {
        setState((s) => ({ ...s, playing: false }));
        void persist();
      },
      onError: (message) => setState((s) => ({ ...s, error: message })),
    });
    player.current = p;

    void (async () => {
      try {
        const [url, saved] = await Promise.all([
          playbackUrl(recordingId),
          studentUid
            ? getDoc(doc(db, COLLECTIONS.listeningProgress, progressId(studentUid, recordingId)))
            : Promise.resolve(null),
        ]);
        if (cancelled) return;
        const prior = saved?.data() as ListeningProgressDoc | undefined;
        listened.current = prior?.listenedMs ?? 0;
        position.current = prior?.positionMs ?? 0;
        await p.load(url, position.current);
        if (cancelled) return;
        setState((s) => ({
          ...s,
          ready: true,
          positionMs: position.current,
          listenedMs: listened.current,
        }));
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, error: (e as Error).message }));
      }
    })();

    return () => {
      cancelled = true;
      // Persist on the way out: whatever happened since the last tick would
      // otherwise be lost exactly when someone closes the screen.
      void persist();
      p.unload();
      player.current = null;
    };
  }, [recordingId, studentUid, persist]);

  return {
    state,
    play: () => {
      lastTick.current = Date.now();
      player.current?.play();
      setState((s) => ({ ...s, playing: true }));
    },
    pause: () => {
      player.current?.pause();
      lastTick.current = null;
      setState((s) => ({ ...s, playing: false }));
      void persist();
    },
    seek: (ms: number) => {
      player.current?.seek(ms);
      position.current = ms;
      seekTarget.current = ms;
      lastTick.current = Date.now();
      dirty.current = true;
      setState((s) => ({ ...s, positionMs: ms }));
      void persist();
    },
    setRate: (rate: number) => {
      player.current?.setRate(rate);
      setState((s) => ({ ...s, rate }));
    },
  };
}
