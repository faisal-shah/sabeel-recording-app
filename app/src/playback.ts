import { useEffect, useState } from 'react';
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

/** What is loaded, so any surface can name it without re-fetching. */
export interface NowPlaying {
  recordingId: string;
  title: string;
  courseName: string;
  durationMs: number;
  /** The listener's deadline, for the surfaces that state it. Null for staff. */
  dueDate: string | null;
}

export interface PlaybackState {
  ready: boolean;
  playing: boolean;
  positionMs: number;
  listenedMs: number;
  rate: number;
  error: string | null;
  /** Null until something is opened, and again after it is closed. */
  now: NowPlaying | null;
}

const IDLE: PlaybackState = {
  ready: false,
  playing: false,
  positionMs: 0,
  listenedMs: 0,
  rate: 1,
  error: null,
  now: null,
};

/**
 * ONE PLAYBACK SESSION FOR THE WHOLE APP, held at module scope rather than in
 * the screen that started it.
 *
 * This is what makes background audio navigable. While the player lived in
 * `PlayerScreen`'s state, leaving the screen unmounted the hook and tore the
 * audio down — so a student could not check their attendance record, or answer
 * a message, without stopping a two-hour lecture and losing their place. Every
 * audio product solves this the same way: playback belongs to the app, and the
 * player screen is one of several VIEWS onto it.
 *
 * It also collapses an invariant that `player.ts` previously had to defend by
 * hand. That module keeps a module-level handle so a second player can never
 * outlive the first; with the session itself held here there is only ever one
 * caller, so "at most one player" stops being a rule and becomes the shape.
 *
 * Teardown is now EXPLICIT (`closePlayback`), not a side effect of unmounting.
 * The only things that end a session are opening a different recording, signing
 * out, and the listener closing it.
 */
let state: PlaybackState = IDLE;
let player: Player | null = null;
const listeners = new Set<(s: PlaybackState) => void>();

// Progress bookkeeping. Module-level rather than refs for the same reason the
// refs existed: the throttled writer reads them from inside a closure that must
// not be rebuilt on every tick.
let listened = 0;
let position = 0;
let lastTick: number | null = null;
let lastWrite = 0;
let dirty = false;
// After a seek the player keeps emitting the OLD position for a beat. Hold the
// displayed position at the target and ignore those stale ticks, so the thumb
// does not snap backwards right after it is dropped.
let seekTarget: number | null = null;
// Who the progress belongs to. Staff listen with no student uid and write none.
let owner: { studentUid: string | null; recordingId: string; courseId: string } | null = null;
// Bumped on every open; a load that resolves after a newer open is discarded.
let generation = 0;

function set(next: Partial<PlaybackState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l(state));
}

async function persist() {
  if (!owner?.studentUid || !dirty) return;
  const { studentUid, recordingId, courseId } = owner;
  dirty = false;
  lastWrite = Date.now();
  const ref = doc(db, COLLECTIONS.listeningProgress, progressId(studentUid, recordingId));
  const mine = {
    positionMs: Math.round(position),
    listenedMs: Math.round(listened),
    updatedAt: Date.now(),
  };
  try {
    // Merge against whatever is already there rather than overwriting: another
    // device may have listened further, and total listening must never go
    // backwards.
    const existing = (await getDoc(ref)).data() as ListeningProgressDoc | undefined;
    const merged = existing ? mergeProgress(mine, existing) : mine;
    await setDoc(ref, { studentUid, recordingId, courseId, ...merged });
    listened = merged.listenedMs;
  } catch {
    // A failed write must not break playback. The next tick retries.
    dirty = true;
  }
}

/**
 * Start (or re-focus) a playback session.
 *
 * Idempotent for the recording already loaded, which is what lets the player
 * screen be opened, left and re-opened without interrupting the audio: arriving
 * at a screen for something already playing must not restart it at zero.
 */
export function openPlayback(
  now: NowPlaying,
  studentUid: string | null,
  courseId: string,
): void {
  if (owner?.recordingId === now.recordingId) {
    // Same recording — refresh only the metadata the caller may know better
    // (a staff visit has no due date; the student's own grant does).
    set({ now });
    return;
  }
  void closePlayback();

  const gen = ++generation;
  owner = { studentUid, recordingId: now.recordingId, courseId };
  listened = 0;
  position = 0;
  lastTick = null;
  lastWrite = 0;
  dirty = false;
  seekTarget = null;
  state = { ...IDLE, now };
  listeners.forEach((l) => l(state));

  const p = createPlayer({
    onProgress: (ms) => {
      if (generation !== gen) return;
      if (seekTarget !== null) {
        if (Math.abs(ms - seekTarget) > 1500) return;
        seekTarget = null;
      }
      // Count only forward movement at roughly real-time speed as "listened".
      // A seek forward must not manufacture listening that never happened.
      const at = Date.now();
      if (lastTick !== null) {
        const advanced = ms - position;
        const elapsed = at - lastTick;
        if (advanced > 0 && advanced <= elapsed * 3) listened += advanced;
      }
      lastTick = at;
      position = ms;
      dirty = true;
      set({ positionMs: ms, listenedMs: listened });
      if (at - lastWrite >= PROGRESS_WRITE_INTERVAL_MS) void persist();
    },
    onEnded: () => {
      if (generation !== gen) return;
      set({ playing: false });
      void persist();
    },
    onError: (message) => {
      if (generation === gen) set({ error: message });
    },
  });
  player = p;

  void (async () => {
    try {
      const [url, saved] = await Promise.all([
        playbackUrl(now.recordingId),
        studentUid
          ? getDoc(doc(db, COLLECTIONS.listeningProgress, progressId(studentUid, now.recordingId)))
          : Promise.resolve(null),
      ]);
      if (generation !== gen) return;
      const prior = saved?.data() as ListeningProgressDoc | undefined;
      listened = prior?.listenedMs ?? 0;
      position = prior?.positionMs ?? 0;
      await p.load(url, position);
      if (generation !== gen) return;
      set({ ready: true, positionMs: position, listenedMs: listened });
    } catch (e) {
      if (generation === gen) set({ error: (e as Error).message });
    }
  })();
}

/** End the session and release the audio. Safe to call when nothing is open. */
export async function closePlayback(): Promise<void> {
  if (!player) {
    owner = null;
    if (state.now) set({ ...IDLE });
    return;
  }
  generation++;
  const p = player;
  player = null;
  // Persist on the way out: whatever happened since the last tick would
  // otherwise be lost exactly at the moment someone stops listening.
  await persist();
  owner = null;
  p.unload();
  state = IDLE;
  listeners.forEach((l) => l(state));
}

export const playback = {
  play: () => {
    lastTick = Date.now();
    player?.play();
    set({ playing: true });
  },
  pause: () => {
    player?.pause();
    lastTick = null;
    set({ playing: false });
    void persist();
  },
  seek: (ms: number) => {
    player?.seek(ms);
    position = ms;
    seekTarget = ms;
    lastTick = Date.now();
    dirty = true;
    set({ positionMs: ms });
    void persist();
  },
  setRate: (rate: number) => {
    player?.setRate(rate);
    set({ rate });
  },
  toggle: () => (state.playing ? playback.pause() : playback.play()),
};

/** Subscribe a component to the one session. */
export function usePlayback(): PlaybackState {
  const [s, setS] = useState(state);
  useEffect(() => {
    listeners.add(setS);
    setS(state);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}
