import { describe, expect, it, vi } from 'vitest';

/**
 * The app-wide playback session.
 *
 * It is the riskiest module in the app and it had no tests: one mutable session
 * at module scope, a generation counter, a serialised write queue, and a
 * progress number that staff read off the ledger as audit evidence. Every case
 * below is one an earlier revision got wrong on a real device — a second
 * recording that never started, a write landing on the wrong session, ticks
 * dropped on every save.
 *
 * The seams are mocked because they are seams: the player is a platform
 * implementation and Firestore is a network. What is under test is the
 * bookkeeping between them.
 */
vi.mock('./firebase', () => ({ db: {}, functions: {} }));

const callable = vi.fn();
vi.mock('firebase/functions', () => ({ httpsCallable: () => callable }));

/** The one progress document, as a plain value the fakes read and write. */
let stored: Record<string, unknown> | undefined;
/** Every read and write in order, for the tests about ordering. */
let ioLog: string[] = [];
// SNAPSHOTTED AT CALL TIME, like a real `getDoc`. Reading `stored` from inside
// `data()` instead would hand a read issued minutes ago whatever the document
// says when someone finally looks at it — which is exactly the staleness the
// generation guards exist to survive, hidden from the tests that check them.
const getDoc = vi.fn(() => {
  const snap = stored;
  ioLog.push('get');
  return Promise.resolve({ data: () => snap });
});
const setDoc = vi.fn((_ref: unknown, value: Record<string, unknown>) => {
  stored = value;
  ioLog.push('set');
  return Promise.resolve();
});
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` }),
  getDoc: (...args: unknown[]) => getDoc(...(args as [])),
  setDoc: (...args: [unknown, Record<string, unknown>]) => setDoc(...args),
}));

/**
 * Every player handed out, so a test can drive the one it means.
 *
 * IT RECORDS `startMs` AND CAN BE HELD OPEN, and both matter. Without the first
 * nothing asserts that the stored position is handed to the player, so deleting
 * the restore leaves the suite green. Without the second the window between
 * `createPlayer` and `load` resolving is unreachable, and that window is where a
 * native player emits its first tick — the one that used to write a zero over an
 * hour of listening.
 */
interface Fake {
  events: {
    onProgress: (ms: number) => void;
    onEnded: () => void;
    onError: (m: string) => void;
  };
  loaded: string | null;
  /** The position `load` was asked to start at. */
  startedAt: number | null;
  unloaded: boolean;
  playing: boolean;
  /** Resolves a `load` held open by `holdLoad`. */
  finishLoad: (() => void) | null;
}
const players: Fake[] = [];
/** When set, the next player's `load` waits for `fake.finishLoad()`. */
let holdLoad = false;
/**
 * When set, the next `getPlaybackUrl` waits for `finishMint()`.
 *
 * THE MINT IS THE SLOW LEG. It is a Cloud Function, so a cold start is seconds,
 * and every other test in this file settles it with `await flush()` before doing
 * anything else — which is precisely the window a person walks through when they
 * tap one lecture, change their mind, and tap another.
 */
let holdMint = false;
let finishMint: ((v: { data: Minted }) => void) | null = null;
interface Minted {
  url: string;
  expiresAt: number;
}
vi.mock('./player', () => ({
  createPlayer: (events: Fake['events']) => {
    const fake: Fake = {
      events,
      loaded: null,
      startedAt: null,
      unloaded: false,
      playing: false,
      finishLoad: null,
    };
    players.push(fake);
    return {
      load: (url: string, startMs: number) => {
        fake.loaded = url;
        fake.startedAt = startMs;
        if (!holdLoad) return Promise.resolve();
        return new Promise<void>((resolve) => {
          fake.finishLoad = resolve;
        });
      },
      play: () => {
        fake.playing = true;
      },
      pause: () => {
        fake.playing = false;
      },
      seek: () => {},
      setRate: () => {},
      unload: () => {
        fake.unloaded = true;
      },
    };
  },
}));

type Playback = typeof import('./playback');

/** Fresh module per test: the session, the URL cache and the epoch are global. */
async function load(): Promise<Playback> {
  vi.resetModules();
  players.length = 0;
  holdLoad = false;
  stored = undefined;
  ioLog = [];
  getDoc.mockClear();
  setDoc.mockClear();
  callable.mockReset();
  holdMint = false;
  finishMint = null;
  callable.mockImplementation(() => {
    if (!holdMint) {
      return Promise.resolve({ data: { url: 'https://signed/audio.m4a', expiresAt: 1e15 } });
    }
    holdMint = false;
    return new Promise((resolve) => {
      finishMint = resolve;
    });
  });
  return import('./playback');
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/*
 * A CONTROLLED CLOCK, because the tick handler compares progress against
 * elapsed wall time: it counts a jump as listening only if the audio advanced
 * no faster than about real time. Three ticks fired in the same millisecond of
 * real time are indistinguishable from a seek, so a test that does not advance
 * the clock measures the seek guard rather than the counter.
 */
let nowMs = 1_700_000_000_000;
vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
const wait = (ms: number) => {
  nowMs += ms;
};

const recording = (id: string, studentUid: string | null = 'stu-1') => ({
  recordingId: id,
  courseId: 'course-1',
  title: `Session ${id}`,
  courseName: 'Hikam Foundations',
  durationMs: 3_600_000,
  studentUid,
  dueDate: studentUid ? '2099-01-01' : null,
});

describe('opening and closing', () => {
  it('mints a URL for the recording asked for, and loads it', async () => {
    const pb = await load();
    pb.openPlayback(recording('rec-a'));
    // The player exists before the audio does — the docked bar has to appear
    // the moment someone taps, not two round trips later.
    expect(players).toHaveLength(1);
    expect(players[0].loaded).toBeNull();
    await flush();
    expect(callable).toHaveBeenCalledWith({ recordingId: 'rec-a' });
    expect(players[0].loaded).toBe('https://signed/audio.m4a');
  });

  it('re-opening the SAME recording does not restart it', async () => {
    const pb = await load();
    pb.openPlayback(recording('rec-a'));
    await flush();
    pb.openPlayback(recording('rec-a'));
    await flush();
    expect(players).toHaveLength(1);
    expect(players[0].unloaded).toBe(false);
  });

  /*
   * THE REGRESSION THAT KILLED "PLAY A SECOND RECORDING".
   *
   * `closePlayback` used to await its final write and null the session
   * afterwards, so `openPlayback` — which closes the old session before starting
   * the new one — had the continuation wake up and wipe the session that had
   * just started. The symptom was a transport disabled for good on "Preparing…".
   */
  it('opening a second recording leaves the SECOND one loaded', async () => {
    const pb = await load();
    pb.openPlayback(recording('rec-a'));
    await flush();
    players[0].events.onProgress(30_000);

    pb.openPlayback(recording('rec-b'));
    await flush();
    await flush();

    expect(players).toHaveLength(2);
    expect(players[0].unloaded).toBe(true);
    expect(players[1].loaded).toBe('https://signed/audio.m4a');
    // And the write the first session fired on its way out landed on the first
    // session's document, not on the one that replaced it.
    expect(stored?.recordingId).toBe('rec-a');
  });

  it('the final write is attributed to the session that ENDED', async () => {
    const pb = await load();
    pb.openPlayback(recording('rec-a'));
    await flush();
    players[0].events.onProgress(45_000);
    await pb.closePlayback();
    expect(stored).toMatchObject({ recordingId: 'rec-a', studentUid: 'stu-1' });
    expect(stored?.positionMs).toBe(45_000);
  });

  it('a tick from a closed session cannot write over the open one', async () => {
    const pb = await load();
    pb.openPlayback(recording('rec-a'));
    await flush();
    const first = players[0];
    pb.openPlayback(recording('rec-b'));
    await flush();

    // The old player is torn down but nothing stops a queued callback firing.
    first.events.onProgress(9_000_000);
    await flush();
    expect(stored?.recordingId).not.toBe('rec-b');
  });

  /*
   * A SESSION THAT NEVER LOADED MUST NOT OVERWRITE THE STORED POSITION.
   *
   * `openPlayback` zeroes the position synchronously and restores the stored
   * one two round trips later. `mergeProgress` keeps the LARGER listenedMs but
   * the NEWER positionMs — so a zero written on the way out wins, and the
   * student's place in a two-hour lecture is gone.
   */
  it('closing before the audio loads keeps the stored position', async () => {
    const pb = await load();
    stored = { positionMs: 3_540_000, listenedMs: 3_540_000, updatedAt: 1 };
    pb.openPlayback(recording('rec-a'));
    // No flush: the mint and the progress read are still in the air.
    await pb.closePlayback();
    await flush();
    expect(stored?.positionMs).toBe(3_540_000);
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('a failed mint does not overwrite the stored position either', async () => {
    const pb = await load();
    stored = { positionMs: 1_200_000, listenedMs: 1_200_000, updatedAt: 1 };
    callable.mockRejectedValueOnce(new Error('offline'));
    pb.openPlayback(recording('rec-a'));
    await flush();
    await pb.closePlayback();
    await flush();
    expect(stored?.positionMs).toBe(1_200_000);
  });

  /*
   * A MINT THAT RESOLVES AFTER THE SESSION IT BELONGS TO HAS GONE.
   *
   * `openPlayback` reads the stored progress and assigns it to the module's
   * `listened`/`position` when its `Promise.all` settles. Tap one lecture, back
   * out while the Cloud Function is still cold, tap another, and the first
   * continuation lands inside the second session — assigning the FIRST
   * recording's totals over the one now playing, which the next tick then writes
   * to the second recording's progress document. The generation check before
   * that assignment is the only thing in the way, and it is the same failure as
   * "progress written for the wrong session" reached through a different door.
   */
  it('a mint that resolves after its session ended cannot touch the new one', async () => {
    const pb = await load();
    stored = { positionMs: 3_000_000, listenedMs: 3_000_000, updatedAt: 1 };
    holdMint = true;
    pb.openPlayback(recording('rec-a'));
    await flush();

    // Second thoughts: a different lecture, whose own mint resolves at once.
    stored = undefined;
    pb.openPlayback(recording('rec-b'));
    await flush();

    // Now the abandoned one comes back.
    finishMint?.({ data: { url: 'https://signed/stale.m4a', expiresAt: 1e15 } });
    await flush();

    // The player still holds what it was given, and the session still counts
    // from zero rather than from the other recording's hour.
    expect(players[1].loaded).toBe('https://signed/audio.m4a');
    players[1].events.onProgress(1_000);
    wait(2_000);
    players[1].events.onProgress(3_000);
    await pb.closePlayback();
    await flush();
    expect(stored).toMatchObject({ recordingId: 'rec-b', listenedMs: 2_000 });
  });

  it('closing when nothing is open is a no-op', async () => {
    const pb = await load();
    await expect(pb.closePlayback()).resolves.toBeUndefined();
    expect(setDoc).not.toHaveBeenCalled();
  });
});

describe('who the progress belongs to', () => {
  it('staff listening writes NO progress document', async () => {
    const pb = await load();
    pb.openPlayback(recording('rec-a', null));
    await flush();
    players[0].events.onProgress(60_000);
    await pb.closePlayback();
    expect(setDoc).not.toHaveBeenCalled();
  });

  /*
   * AND NOT ON THE THROTTLED PATH EITHER, which is the other half of the guard.
   *
   * A tick past the write interval, a pause and a seek each persist without
   * going anywhere near `closePlayback`. Without the owner check there, a staff
   * listen writes `listeningProgress/null_<recordingId>` with a null studentUid
   * — a document for nobody, in the collection the ledger reads.
   */
  it('staff listening writes nothing when a tick, a pause or a seek persists', async () => {
    const pb = await load();
    pb.openPlayback(recording('rec-a', null));
    await flush();
    // Past PROGRESS_WRITE_INTERVAL_MS, so the tick itself would persist.
    players[0].events.onProgress(1_000);
    wait(20_000);
    players[0].events.onProgress(21_000);
    pb.playback.seek(30_000);
    pb.playback.pause();
    await flush();
    expect(setDoc).not.toHaveBeenCalled();
    expect(getDoc).not.toHaveBeenCalled();
  });

  it('pausing writes progress without ending the session', async () => {
    const pb = await load();
    pb.openPlayback(recording('rec-a'));
    await flush();
    pb.playback.play();
    expect(players[0].playing).toBe(true);
    players[0].events.onProgress(1_000);
    wait(2_000);
    players[0].events.onProgress(3_000);
    pb.playback.pause();
    await flush();
    expect(players[0].playing).toBe(false);
    // Saved at the pause, not held until the session ends: someone who stops
    // halfway and closes the app keeps their place.
    expect(stored).toMatchObject({ recordingId: 'rec-a', positionMs: 3_000, listenedMs: 2_000 });
    expect(players[0].unloaded).toBe(false);
  });

  it('a student resumes from the position already stored', async () => {
    const pb = await load();
    stored = { positionMs: 120_000, listenedMs: 90_000, updatedAt: 1 };
    pb.openPlayback(recording('rec-a'));
    await flush();
    // HANDED TO THE PLAYER, which is the whole of "resumes": the document is
    // read, and then the audio starts there rather than at the beginning.
    expect(players[0].loaded).toBe('https://signed/audio.m4a');
    expect(players[0].startedAt).toBe(120_000);
    await pb.closePlayback();
    expect(stored?.positionMs).toBe(120_000);
  });

  it('a session with nothing stored starts at the beginning', async () => {
    const pb = await load();
    pb.openPlayback(recording('rec-a'));
    await flush();
    expect(players[0].startedAt).toBe(0);
  });

  /*
   * A TICK BEFORE THE AUDIO IS LOADED SAYS NOTHING ABOUT IT.
   *
   * Native emits a progress event from `replace()` before `seekTo()` lands. At
   * that moment `position` is still the zero set at open and `lastWrite` is 0,
   * so the very first tick persists immediately — and `mergeProgress` takes the
   * NEWER positionMs, so the zero wins over an hour of listening.
   */
  it('ignores a tick that arrives before the audio has loaded', async () => {
    const pb = await load();
    stored = { positionMs: 3_540_000, listenedMs: 3_540_000, updatedAt: 1 };
    holdLoad = true;
    pb.openPlayback(recording('rec-a'));
    await flush();

    players[0].events.onProgress(0);
    await flush();
    expect(setDoc).not.toHaveBeenCalled();

    players[0].finishLoad?.();
    await flush();
    await pb.closePlayback();
    await flush();
    expect(stored?.positionMs).toBe(3_540_000);
  });
});

describe('counting listening', () => {
  it('counts forward movement at real-time speed', async () => {
    const pb = await load();
    pb.openPlayback(recording('rec-a'));
    await flush();
    players[0].events.onProgress(1_000);
    wait(1_000);
    players[0].events.onProgress(2_000);
    wait(1_000);
    players[0].events.onProgress(3_000);
    await pb.closePlayback();
    // The first tick establishes the baseline; two seconds of audio followed.
    expect(stored?.listenedMs).toBe(2_000);
    expect(stored?.positionMs).toBe(3_000);
  });

  /*
   * ONE WRITE PER INTERVAL, not one per tick. The player reports progress several
   * times a second; persisting each would be a Firestore read AND write per tick,
   * for every listener, for the length of a two-hour lecture.
   */
  it('throttles the writes a run of ticks produces', async () => {
    const pb = await load();
    pb.openPlayback(recording('rec-a'));
    await flush();
    // The first tick always persists — there is no previous write to space it
    // from. The four after it fall inside one interval.
    for (const at of [1_000, 2_000, 3_000, 4_000, 5_000]) {
      players[0].events.onProgress(at);
      wait(1_000);
    }
    await flush();
    expect(setDoc).toHaveBeenCalledTimes(1);
  });

  it('a forward SEEK manufactures no listening', async () => {
    const pb = await load();
    pb.openPlayback(recording('rec-a'));
    await flush();
    players[0].events.onProgress(1_000);
    // A jump of ten minutes a second later is a seek, not ten minutes of
    // listening.
    wait(1_000);
    players[0].events.onProgress(601_000);
    await pb.closePlayback();
    expect(stored?.listenedMs).toBe(0);
    expect(stored?.positionMs).toBe(601_000);
  });

  it('never lets the total go backwards behind another device', async () => {
    const pb = await load();
    pb.openPlayback(recording('rec-a'));
    await flush();
    players[0].events.onProgress(1_000);
    wait(3_000);
    players[0].events.onProgress(4_000);
    // A phone that listened further writes while this session is open.
    stored = { positionMs: 500_000, listenedMs: 400_000, updatedAt: Date.now() + 1000 };
    await pb.closePlayback();
    expect(stored?.listenedMs).toBe(400_000);
  });

  /*
   * THE CATCH-UP FROM ANOTHER DEVICE IS APPLIED ONCE, NOT PER QUEUED WRITE.
   *
   * `pause` and `seek` persist with no throttle, so two writes queue routinely.
   * Advancing the local total by `merged - mine` made the second write re-read
   * what the first had just stored and apply the same catch-up again — minutes
   * of listening that never happened, in the number the ledger presents as
   * evidence.
   */
  it('does not re-apply another device\'s total once per queued write', async () => {
    const pb = await load();
    pb.openPlayback(recording('rec-a'));
    await flush();
    players[0].events.onProgress(1_000);
    wait(10_000);
    players[0].events.onProgress(11_000);

    // A laptop finished the same lecture while this session was open.
    stored = { positionMs: 900_000, listenedMs: 900_000, updatedAt: nowMs + 1000 };

    // Three writes queued before any of them resolves. Neither `seek` nor
    // `pause` honours the write throttle, so a skip and a pause are enough.
    pb.playback.seek(20_000);
    players[0].events.onProgress(20_000);
    pb.playback.pause();
    await flush();

    // Now listen a little more, so the session's own running total is written
    // once the queue has drained — which is where the inflation shows up.
    pb.playback.play();
    wait(1_000);
    players[0].events.onProgress(21_000);
    await pb.closePlayback();
    await flush();

    // The laptop's total, plus the one second heard since. Adding the catch-up
    // per queued write instead reached 2,691,000 — three quarters of an hour of
    // listening that never happened, in the number the ledger presents as
    // evidence.
    expect(stored?.listenedMs).toBe(901_000);
  });

  /*
   * AND THE TICKS THAT ARRIVED DURING THE WRITE SURVIVE IT.
   *
   * `mine` is captured before two round trips. Assigning the merged total back
   * — rather than taking the larger of it and the running count — throws away
   * everything heard while the write was in flight, which over a two-hour
   * lecture silently under-reports the number staff read as evidence.
   */
  it('keeps the seconds heard while a write was in flight', async () => {
    const pb = await load();
    pb.openPlayback(recording('rec-a'));
    await flush();

    // The first tick always persists, and it goes out carrying 0 listened.
    players[0].events.onProgress(1_000);
    // Eight seconds of real listening arrive before that write comes back.
    wait(4_000);
    players[0].events.onProgress(5_000);
    wait(4_000);
    players[0].events.onProgress(9_000);
    await flush();

    await pb.closePlayback();
    await flush();
    // Assigning the merged total back instead would have written 0 — the whole
    // eight seconds discarded because they arrived after `mine` was captured.
    expect(stored?.listenedMs).toBe(8_000);
  });

  /*
   * A SEEK PAST THE REAL END MUST NOT FREEZE THE SESSION.
   *
   * `seek` holds the displayed position at its target and discards ticks that
   * disagree, so the thumb does not snap backwards. Past the end of the file
   * that target is unreachable, and without `onEnded` clearing it every later
   * tick is discarded — position and listened time freeze, and the frozen number
   * is what the ledger shows.
   */
  it('resumes counting after a seek past the end, once the file ends', async () => {
    const pb = await load();
    pb.openPlayback(recording('rec-a'));
    await flush();
    players[0].events.onProgress(1_000);
    pb.playback.seek(9_999_000);
    players[0].events.onEnded();
    wait(1_000);
    players[0].events.onProgress(10_000);
    wait(1_000);
    players[0].events.onProgress(11_000);
    await pb.closePlayback();
    expect(stored?.positionMs).toBe(11_000);
  });

  /*
   * AND WHEN THE FILE NEVER ENDS, BECAUSE THE SEEK HAPPENED WHILE PAUSED.
   *
   * `onEnded` only fires when the end is reached WHILE PLAYING, so a forward
   * skip past the real end from a paused player leaves a target no tick can
   * ever match. Every later tick was then discarded and the session froze at a
   * position that does not exist in the file — which is both the resume point
   * and the number the ledger presents as evidence.
   */
  /*
   * AND HOLDS UNTIL IT DOES. Between the seek and the hold expiring, the player
   * keeps reporting where it WAS for a beat; showing those would snap the thumb
   * backwards the instant it is dropped.
   */
  it('discards the stale ticks a seek leaves behind', async () => {
    const pb = await load();
    pb.openPlayback(recording('rec-a'));
    await flush();
    players[0].events.onProgress(600_000);
    pb.playback.seek(60_000);
    // The player is still reporting the old position, well inside the hold.
    wait(200);
    players[0].events.onProgress(600_500);
    wait(200);
    players[0].events.onProgress(601_000);
    await pb.closePlayback();
    await flush();
    expect(stored?.positionMs).toBe(60_000);
  });

  it('gives up on a seek target the player never reaches', async () => {
    const pb = await load();
    // No duration, so `skipForward` cannot clamp — a phone upload supplies none.
    pb.openPlayback({ ...recording('rec-a'), durationMs: 0 });
    await flush();
    players[0].events.onProgress(1_000);
    pb.playback.seek(9_999_000);
    // (Reached through `seek` rather than `skipForward`, which is exercised on
    // its own below — this test is about the hold, not the clamp.)

    // The player clamps at the real end and reports it. No `onEnded`.
    wait(500);
    players[0].events.onProgress(60_000);
    await flush();
    // HELD: inside the window the stale position is discarded, so what is on
    // disk is still the seek's own target rather than the player's report.
    expect(stored?.positionMs).toBe(9_999_000);

    // Past the hold, the player's own position is believed again.
    wait(2_500);
    players[0].events.onProgress(61_000);
    wait(1_000);
    players[0].events.onProgress(62_000);
    await pb.closePlayback();
    await flush();
    expect(stored?.positionMs).toBe(62_000);
  });
});

/*
 * THE CLAMPS, which were argued for in a comment and exercised by nothing.
 *
 * `durationSec` is genuinely nullable — a phone upload supplies none — and
 * clamping to a zero duration turns "forward 30" into "back to the start",
 * which is the note above `skipForward`. Neither skip was called anywhere in
 * this file.
 */
/*
 * ONE WRITE AT A TIME. `writeProgress` is read-modify-write, and `pause` and
 * `seek` both persist without the throttle, so two in flight against one
 * document is routine. Run concurrently they read the same stale value and
 * whichever `setDoc` lands second wins — usually the earlier, smaller one, so
 * the last seconds of a session are the ones lost.
 */
describe('the write queue', () => {
  it('never has two reads of the progress document in flight at once', async () => {
    const pb = await load();
    pb.openPlayback(recording('rec-a'));
    await flush();
    // Discard the session's own opening read of the stored progress; what is
    // under test is the writes that follow it.
    ioLog = [];

    players[0].events.onProgress(1_000);
    wait(1_000);
    players[0].events.onProgress(2_000);
    // Two persists with nothing awaited between them.
    pb.playback.seek(2_000);
    pb.playback.pause();
    await pb.closePlayback();
    await flush();

    // Strictly alternating: each write reads the document its predecessor left.
    expect(ioLog.length).toBeGreaterThanOrEqual(4);
    expect(ioLog.filter((_, i) => i % 2 === 0).every((e) => e === 'get')).toBe(true);
    expect(ioLog.filter((_, i) => i % 2 === 1).every((e) => e === 'set')).toBe(true);
  });
});

describe('the skip controls', () => {
  it('skips forward by 30 seconds', async () => {
    const pb = await load();
    pb.openPlayback(recording('rec-a'));
    await flush();
    players[0].events.onProgress(10_000);
    pb.playback.skipForward();
    await pb.closePlayback();
    expect(stored?.positionMs).toBe(40_000);
  });

  it('does not clamp to zero when the duration is unknown', async () => {
    const pb = await load();
    pb.openPlayback({ ...recording('rec-a'), durationMs: 0 });
    await flush();
    players[0].events.onProgress(600_000);
    pb.playback.skipForward();
    await pb.closePlayback();
    expect(stored?.positionMs).toBe(630_000);
  });

  it('never skips past the end of a recording whose duration is known', async () => {
    const pb = await load();
    pb.openPlayback({ ...recording('rec-a'), durationMs: 20_000 });
    await flush();
    players[0].events.onProgress(10_000);
    pb.playback.skipForward();
    await pb.closePlayback();
    expect(stored?.positionMs).toBe(20_000);
  });

  it('never skips back past the start', async () => {
    const pb = await load();
    pb.openPlayback(recording('rec-a'));
    await flush();
    players[0].events.onProgress(5_000);
    pb.playback.skipBack();
    await pb.closePlayback();
    expect(stored?.positionMs).toBe(0);
  });
});

describe('signed URLs', () => {
  /*
   * REFRESHED BEFORE IT EXPIRES, not after it fails. GCS answers an expired
   * signed URL with a 400 and an `ExpiredToken` body — not a 403 — so a retry
   * handler cannot even tell it apart from a real error, and the listener hears
   * the failure first. The cache hands back a URL only while it has more than
   * the refresh window left on it.
   */
  it('re-mints a cached URL that is close to expiring', async () => {
    const pb = await load();
    callable.mockResolvedValue({
      data: { url: 'https://signed/nearly-stale.m4a', expiresAt: nowMs + 1_000 },
    });
    pb.openPlayback(recording('rec-a'));
    await flush();
    await pb.closePlayback();

    pb.openPlayback(recording('rec-a'));
    await flush();
    expect(callable).toHaveBeenCalledTimes(2);
  });

  it('reuses a cached URL rather than minting per open', async () => {
    const pb = await load();
    pb.openPlayback(recording('rec-a'));
    await flush();
    pb.openPlayback(recording('rec-b'));
    await flush();
    pb.openPlayback(recording('rec-a'));
    await flush();
    expect(callable).toHaveBeenCalledTimes(2);
  });

  /*
   * A signed URL is bound to a RECORDING, not to the account that asked for it,
   * and it stays good for twelve hours — so a cache that outlives the credential
   * hands the next person on a shared device a working link.
   */
  it('sign-out drops the cache, so the next open re-mints', async () => {
    const pb = await load();
    pb.openPlayback(recording('rec-a'));
    await flush();
    await pb.closePlayback();
    pb.forgetPlaybackUrls();
    pb.openPlayback(recording('rec-a'));
    await flush();
    expect(callable).toHaveBeenCalledTimes(2);
  });

  it('a mint still in flight at sign-out never re-seeds the cache', async () => {
    const pb = await load();
    let release: (v: unknown) => void = () => {};
    callable.mockReturnValueOnce(
      new Promise((r) => {
        release = r;
      }),
    );
    pb.openPlayback(recording('rec-a'));
    pb.forgetPlaybackUrls();
    release({ data: { url: 'https://signed/stale.m4a', expiresAt: 1e15 } });
    await flush();
    await pb.closePlayback();

    pb.openPlayback(recording('rec-a'));
    await flush();
    expect(callable).toHaveBeenCalledTimes(2);
    // The URL that resolved after sign-out is not the one the next session got.
    expect(players[1].loaded).toBe('https://signed/audio.m4a');
  });

  it('a failed mint surfaces as an error rather than a silent dead transport', async () => {
    const pb = await load();
    callable.mockRejectedValueOnce(new Error('The due date for this recording has passed.'));
    pb.openPlayback(recording('rec-a'));
    await flush();
    // And the session can be retried: opening it again builds a new player
    // rather than taking the "already loaded" path.
    pb.openPlayback(recording('rec-a'));
    await flush();
    expect(players).toHaveLength(2);
    expect(players[1].loaded).toBe('https://signed/audio.m4a');
  });
});

describe('formatClock', () => {
  it('drops the hour under an hour and pads the minutes above it', async () => {
    const { formatClock } = await load();
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(9_000)).toBe('0:09');
    expect(formatClock(605_000)).toBe('10:05');
    expect(formatClock(3_600_000)).toBe('1:00:00');
    expect(formatClock(7_384_000)).toBe('2:03:04');
  });

  it('floors, so the readout never shows a second that has not happened', async () => {
    const { formatClock } = await load();
    expect(formatClock(1_999)).toBe('0:01');
    expect(formatClock(-500)).toBe('0:00');
  });
});
