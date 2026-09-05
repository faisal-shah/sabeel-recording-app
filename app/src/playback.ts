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

/**
 * Drop every cached URL. Called on sign-out.
 *
 * A signed URL is valid for 12 hours and is bound to a recording, not to the
 * account that asked for it — so a cache that outlives the credential hands the
 * next person on a shared device a working link to something they were never
 * entitled to, without `getPlaybackUrl` ever being consulted.
 */
export function forgetPlaybackUrls(): void {
  cache.clear();
}

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

/**
 * Write one session's progress. TAKES ITS SUBJECT, rather than reading the
 * module's.
 *
 * Every argument is captured by the caller before the first `await`, and the
 * generation is checked before anything module-level is touched again. That is
 * what makes a write belonging to the recording you just left unable to land on
 * the one you just opened: the round trip is two network calls long, and in that
 * window `owner`, `position` and `listened` can all belong to something else.
 * Writing the wrong `listenedMs` here is not a cosmetic bug — that number is the
 * audit evidence staff read on the ledger.
 */
async function persistFor(
  gen: number,
  who: { studentUid: string; recordingId: string; courseId: string },
  positionMs: number,
  listenedMs: number,
): Promise<void> {
  const { studentUid, recordingId, courseId } = who;
  const ref = doc(db, COLLECTIONS.listeningProgress, progressId(studentUid, recordingId));
  const mine = {
    positionMs: Math.round(positionMs),
    listenedMs: Math.round(listenedMs),
    updatedAt: Date.now(),
  };
  try {
    // Merge against whatever is already there rather than overwriting: another
    // device may have listened further, and total listening must never go
    // backwards.
    const existing = (await getDoc(ref)).data() as ListeningProgressDoc | undefined;
    const merged = existing ? mergeProgress(mine, existing) : mine;
    await setDoc(ref, { studentUid, recordingId, courseId, ...merged });
    if (generation === gen) listened = merged.listenedMs;
  } catch {
    // A failed write must not break playback. The next tick retries — but only
    // for the session that is still open; a session already ended has had its
    // one best-effort attempt.
    if (generation === gen) dirty = true;
  }
}

/** Persist the CURRENT session, if it has anything to write. */
function persist(): void {
  if (!owner?.studentUid || !dirty) return;
  dirty = false;
  lastWrite = Date.now();
  void persistFor(
    generation,
    { studentUid: owner.studentUid, recordingId: owner.recordingId, courseId: owner.courseId },
    position,
    listened,
  );
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
  // `player` as well as `owner`: an owner with no player is a session that has
  // been torn down, and treating that as "already open" would return without
  // ever creating one — a play button that does nothing, for good.
  if (player && owner?.recordingId === now.recordingId) {
    // Same recording — refresh only the metadata the caller may know better
    // (a staff visit has no due date; the student's own grant does).
    set({ now });
    return;
  }
  closePlayback();

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
      if (at - lastWrite >= PROGRESS_WRITE_INTERVAL_MS) persist();
    },
    onEnded: () => {
      if (generation !== gen) return;
      set({ playing: false });
      persist();
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

/**
 * End the session and release the audio. Safe to call when nothing is open.
 *
 * SYNCHRONOUS, AND IT HAS TO BE. This used to `await persist()` in the middle
 * and null `owner` and `state` afterwards — which meant `openPlayback` calling
 * it and then setting up the next recording ran to completion first, and the
 * continuation woke up and wiped the session that had just started. The symptom
 * was that playing a second recording left a permanently disabled transport
 * stuck on "Preparing…", with nothing to recover it but leaving the screen; and
 * `await` on an already-resolved promise is enough to reproduce it, so it fired
 * every time rather than under load.
 *
 * So: every mutation happens in one tick, and the final write is handed its own
 * snapshot and fired detached. A session that has ended can no longer reach the
 * one that replaced it.
 */
export function closePlayback(): void {
  const p = player;
  const dying = owner;
  const finalPosition = position;
  const finalListened = listened;
  const unsaved = dirty;
  const gen = ++generation;

  player = null;
  owner = null;
  dirty = false;
  lastTick = null;
  seekTarget = null;
  if (state.now || state.ready || state.playing) {
    state = IDLE;
    listeners.forEach((l) => l(state));
  }

  if (p) p.unload();
  // Whatever happened since the last tick would otherwise be lost exactly at the
  // moment someone stops listening. Best effort, and it can no longer write the
  // wrong session's numbers: `gen` is already stale, so `persistFor` will not
  // touch anything module-level when it lands.
  if (unsaved && dying?.studentUid) {
    void persistFor(
      gen,
      { studentUid: dying.studentUid, recordingId: dying.recordingId, courseId: dying.courseId },
      finalPosition,
      finalListened,
    );
  }
}

/**
 * How far the skip controls move. ONE definition: the player screen and the
 * docked bar are two views of the same session, and a 15 in one and a 15 in the
 * other are the same 15 — right up until somebody changes one of them.
 */
export const SKIP_BACK_MS = 15_000;
export const SKIP_FORWARD_MS = 30_000;

/**
 * `h:mm:ss` (or `m:ss` under an hour) for a position in a recording.
 *
 * Lives here rather than in either view, because it was in BOTH and the two
 * copies disagreed — one floored the seconds and the other rounded them, so the
 * same audio read a second apart depending on which surface you looked at.
 */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
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
    persist();
  },
  seek: (ms: number) => {
    player?.seek(ms);
    position = ms;
    seekTarget = ms;
    lastTick = Date.now();
    dirty = true;
    set({ positionMs: ms });
    persist();
  },
  setRate: (rate: number) => {
    player?.setRate(rate);
    set({ rate });
  },
  toggle: () => (state.playing ? playback.pause() : playback.play()),
  // Clamped here rather than at each call site, so neither view has to know the
  // duration or the amounts.
  skipBack: () => playback.seek(Math.max(0, state.positionMs - SKIP_BACK_MS)),
  skipForward: () =>
    playback.seek(Math.min(state.now?.durationMs ?? 0, state.positionMs + SKIP_FORWARD_MS)),
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
