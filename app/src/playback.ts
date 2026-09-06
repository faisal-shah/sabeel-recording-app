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
import { errorText } from './errors';
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
/** Bumped by `forgetPlaybackUrls`; a mint from an older epoch is discarded. */
let cacheEpoch = 0;

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
  // The epoch, not just the map: a mint started moments before sign-out resolves
  // afterwards and would otherwise re-seed the cache with a URL good for another
  // twelve hours — the exact hole clearing it is meant to close.
  cacheEpoch += 1;
}

async function playbackUrl(recordingId: string): Promise<string> {
  const hit = cache.get(recordingId);
  if (hit && hit.expiresAt - Date.now() > SIGNED_URL_REFRESH_MS) return hit.url;
  const epoch = cacheEpoch;
  const fresh = await mintUrl(recordingId);
  if (epoch === cacheEpoch) cache.set(recordingId, fresh);
  return fresh.url;
}

/** What is loaded, so any surface can name it without re-fetching. */
export interface NowPlaying {
  recordingId: string;
  /** The course, so any surface can re-check that it may still be played. */
  courseId: string;
  title: string;
  courseName: string;
  durationMs: number;
  /**
   * Whose deadline `dueDate` is, or null when staff are listening.
   *
   * The deadline closes a STUDENT's access and nobody else's — the server says
   * the same, returning no due date for staff before it checks one. Any surface
   * acting on `dueDate` has to consult this first, or a manager reviewing a
   * lecture from last term is cut off the moment they leave the player.
   */
  studentUid: string | null;
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

/**
 * Nothing playing. Exported because the player screen needs the same shape: the
 * session is app-wide, so on the first render after arriving it may still
 * describe the PREVIOUS recording, and the screen substitutes this until the
 * session is about the one it is showing. A second copy there drifted the moment
 * `PlaybackState` gained a field.
 */
export const IDLE: PlaybackState = {
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
 * Teardown is EXPLICIT (`closePlayback`), not a side effect of unmounting — and
 * that is a bill every involuntary end has to pay too. A session ends when a
 * different recording is opened, when the listener closes it, when access is
 * revoked under it (the recording unpublished, the course archived, the
 * student's own deadline passing), and on every way out of an account: signing
 * out, being disabled mid-lecture, or the credential being rejected. Miss one
 * and a foreground service keeps streaming with nothing on screen to stop it.
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
/*
 * WHEN THE HOLD WAS SET, because a target the player can never report would
 * otherwise hold for ever.
 *
 * `durationSec` is genuinely nullable — a phone upload supplies none — so
 * `skipForward` cannot clamp, and a stored duration longer than the file has
 * the same effect: the seek lands clamped at the real end and no tick ever
 * comes within 1500ms of the target. Every later tick was then discarded, so
 * position and listened time froze for the rest of the session and the frozen
 * numbers are what the ledger shows. `onEnded` clears the hold too, but only
 * fires when the end is reached WHILE PLAYING — seeking past it while paused
 * never gets there.
 */
let seekAt = 0;
/** How long a seek may hold the display before stale ticks are accepted again. */
const SEEK_HOLD_MS = 2_000;
// Who the progress belongs to. Staff listen with no student uid and write none.
let owner: { studentUid: string | null; recordingId: string; courseId: string } | null = null;
// Bumped on every open; a load that resolves after a newer open is discarded.
let generation = 0;

function set(next: Partial<PlaybackState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l(state));
}

/**
 * The write queue for the current session's progress document.
 *
 * ONE AT A TIME. `persistFor` is read-modify-write, and two of them in flight
 * against the same document race: the throttled tick and the write on the way
 * out both read the same stale value, and whichever `setDoc` lands second wins
 * — which is usually the throttled one, so the LAST seconds of a session are
 * the ones lost. Chaining is enough; there is only ever one session.
 */
let writes: Promise<void> = Promise.resolve();

function persistFor(
  gen: number,
  who: { studentUid: string; recordingId: string; courseId: string },
  positionMs: number,
  listenedMs: number,
): Promise<void> {
  writes = writes.then(() => writeProgress(gen, who, positionMs, listenedMs));
  return writes;
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
async function writeProgress(
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
    // TAKE THE LARGER, never add the difference. `mine` was captured before two
    // round trips and the ticks that arrived during them are already in
    // `listened`, so assigning the merged total would throw them away — but
    // ADDING the catch-up is worse, because `pause` and `seek` persist with no
    // throttle and two writes queue routinely: the second re-reads the document
    // the first just wrote and applies the same catch-up again. Measured, that
    // turned a laptop's 15 minutes into 44, in the number the ledger presents as
    // evidence. `max` keeps the in-flight ticks and cannot double-count.
    if (generation === gen) listened = Math.max(listened, merged.listenedMs);
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
 * ONE ARGUMENT, because `NowPlaying` already carries the course and the listener
 * — passing them again alongside it gave the same two facts two sources that
 * were free to disagree, and the session would then be owned by one student
 * while every surface named another.
 *
 * Idempotent for the recording already loaded, which is what lets the player
 * screen be opened, left and re-opened without interrupting the audio: arriving
 * at a screen for something already playing must not restart it at zero.
 */
export function openPlayback(now: NowPlaying): void {
  /*
   * Re-entering the screen for what is ALREADY PLAYING must not restart it —
   * and must not be mistaken for a session that cannot play.
   *
   * `player` as well as `owner`, because an owner with no player is a torn-down
   * session and returning early would leave a play button that never works. And
   * `!state.error`, because a failed mint leaves the player assigned but never
   * loaded: without it, coming back to retry hits this branch and the transport
   * is disabled for good, with no way back but closing the docked bar.
   */
  if (player && !state.error && owner?.recordingId === now.recordingId) {
    // Same recording — refresh only the metadata the caller may know better
    // (a staff visit has no due date; the student's own grant does).
    set({ now });
    return;
  }
  closePlayback();

  const gen = ++generation;
  owner = { studentUid: now.studentUid, recordingId: now.recordingId, courseId: now.courseId };
  listened = 0;
  position = 0;
  lastTick = null;
  lastWrite = 0;
  dirty = false;
  seekTarget = null;
  seekAt = 0;
  state = { ...IDLE, now };
  listeners.forEach((l) => l(state));

  const p = createPlayer({
    onProgress: (ms) => {
      if (generation !== gen) return;
      // Before the audio is loaded a tick reports nothing about this recording,
      // and acting on one is not harmless: `position` is still the zero set at
      // open, `lastWrite` is 0 so the very first tick persists immediately, and
      // `mergeProgress` takes the NEWER positionMs — so a tick that arrives
      // between `replace()` and `seekTo()` writes a zero over the student's
      // saved place in a two-hour lecture.
      if (!state.ready) return;
      if (seekTarget !== null) {
        if (Math.abs(ms - seekTarget) <= 1500) {
          seekTarget = null;
        } else if (Date.now() - seekAt < SEEK_HOLD_MS) {
          return;
        } else {
          // Unreachable target. Take the player's word for where it is.
          seekTarget = null;
          lastTick = Date.now();
          position = ms;
          set({ positionMs: ms });
          return;
        }
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
      // CLEAR THE SEEK HOLD. A forward skip past the real end — reachable when
      // `durationSec` is null, or when the stored duration is longer than the
      // file — leaves a target the player can never reach, and every later tick
      // is then discarded as stale. Position and listened time freeze for the
      // rest of the session, and the frozen number is what the ledger shows.
      seekTarget = null;
      set({ playing: false });
      persist();
    },
    onError: (message) => {
      /*
       * `ready: false` TOO, or the transport stays live over a dead source.
       *
       * The two failure paths have to agree: a mint that throws leaves `ready`
       * false and the player screen draws "Preparing…" with everything
       * disabled, while an audio error used to leave a fully enabled scrubber,
       * two skips and four rate chips over a source that never loaded. Tapping
       * play then set `playing: true` on a player that emits no `play` event,
       * so even the correction from `onPlayingChanged` could not fire and the
       * pause glyph sat over silence.
       *
       * `openPlayback`'s idempotency guard keys on `!state.error`, so this
       * remains retryable: leaving the screen and coming back builds a new
       * player rather than taking the early return.
       */
      if (generation === gen) set({ error: message, ready: false, playing: false });
    },
    onPlayingChanged: (playing) => {
      // The lock screen, the notification controls, a phone call taking audio
      // focus. `playback.play`/`pause` already set this optimistically, so this
      // is only ever correcting it — never the other way round.
      if (generation === gen && state.playing !== playing) {
        if (!playing) lastTick = null;
        set({ playing });
      }
    },
  });
  player = p;

  void (async () => {
    try {
      const [url, saved] = await Promise.all([
        playbackUrl(now.recordingId),
        now.studentUid
          ? getDoc(
              doc(db, COLLECTIONS.listeningProgress, progressId(now.studentUid, now.recordingId)),
            )
          : Promise.resolve(null),
      ]);
      if (generation !== gen) return;
      const prior = saved?.data() as ListeningProgressDoc | undefined;
      listened = prior?.listenedMs ?? 0;
      position = prior?.positionMs ?? 0;
      await p.load(url, position);
      if (generation !== gen) return;
      // NOT OVER AN ERROR. `load` resolves on a failed source as well as a
      // loaded one — on web it has to, or a stalled request leaves the promise
      // pending for ever — so the error the player already reported would
      // otherwise be overwritten here by a ready transport.
      if (state.error) return;
      set({ ready: true, positionMs: position, listenedMs: listened });
    } catch (e) {
      // `errorText`, like every other failure a person reads: an offline tap on
      // a lecture, or any unhandled throw in `getPlaybackUrl`, otherwise put the
      // bare word "internal" in a full-width red band on the student's player.
      if (generation === gen) set({ error: errorText(e) });
    }
  })();
}

/**
 * End the session and release the audio. Safe to call when nothing is open.
 *
 * EVERY STATE CHANGE IS SYNCHRONOUS, AND IT HAS TO BE. `openPlayback` calls this
 * and then sets up the next recording; if any part of the teardown resumed after
 * an await, it would wake up and wipe the session that had just started, and the
 * symptom is a permanently disabled transport stuck on "Preparing…" with nothing
 * to recover it but leaving the screen. An await on an already-resolved promise
 * is enough to cause it, so it happens every time rather than under load.
 *
 * So: every mutation happens in one tick, and the final write is handed its own
 * snapshot and fired detached. The returned promise is only that write, for the
 * one caller that must not race it — signing out drops the credential, and a
 * write still in flight is refused. Fire and forget everywhere else.
 */
export function closePlayback(): Promise<void> {
  const p = player;
  const dying = owner;
  const finalPosition = position;
  const finalListened = listened;
  /*
   * NOTHING HEARD, NOTHING WRITTEN — and this is the guard, not an optimisation.
   *
   * `openPlayback` zeroes the position synchronously and restores the stored one
   * two round trips later, so a session closed before it loads still has
   * `position === 0`. Writing that zero is not harmless: `mergeProgress` takes
   * `listenedMs` as a max but `positionMs` from whichever record is NEWER, and
   * the zero is newer — so tapping a lecture and immediately closing the bar,
   * or opening one while offline so the mint fails, threw away the student's
   * place in a two-hour recording. `dirty` is only ever set by a tick or a seek,
   * which is exactly "this session went somewhere".
   */
  const moved = dirty;
  /*
   * A GENERATION THAT CAN NEVER MATCH AGAIN: take the current one for the dying
   * session, then move past it. The final write's `generation === gen` guard is
   * false however this was reached — including a bare close with no `openPlayback`
   * behind it, which is the mini player's ×, sign-out, and a revoked recording.
   */
  const gen = generation;
  generation += 1;

  player = null;
  owner = null;
  dirty = false;
  lastTick = null;
  seekTarget = null;
  seekAt = 0;
  if (state.now || state.ready || state.playing) {
    state = IDLE;
    listeners.forEach((l) => l(state));
  }

  if (p) p.unload();
  // Whatever happened since the last tick would otherwise be lost exactly at the
  // moment someone stops listening. It cannot write the wrong session's numbers:
  // `gen` is stale by construction, so nothing module-level is touched when it
  // lands.
  if (!dying?.studentUid) return Promise.resolve();
  // Nothing new since the last throttled save — but one may still be in flight,
  // and the caller that awaits this is about to drop the credential.
  if (!moved) return writes;
  return persistFor(
    gen,
    { studentUid: dying.studentUid, recordingId: dying.recordingId, courseId: dying.courseId },
    finalPosition,
    finalListened,
  );
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
    seekAt = Date.now();
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
  skipForward: () => {
    // `durationSec` is genuinely nullable — a phone upload supplies none — and
    // clamping to a zero duration turned "forward 30" into "back to the start".
    const end = state.now?.durationMs ?? 0;
    const target = state.positionMs + SKIP_FORWARD_MS;
    playback.seek(end > 0 ? Math.min(end, target) : target);
  },
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
