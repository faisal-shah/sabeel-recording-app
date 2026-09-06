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
const getDoc = vi.fn(() => Promise.resolve({ data: () => stored }));
const setDoc = vi.fn((_ref: unknown, value: Record<string, unknown>) => {
  stored = value;
  return Promise.resolve();
});
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` }),
  getDoc: (...args: unknown[]) => getDoc(...(args as [])),
  setDoc: (...args: [unknown, Record<string, unknown>]) => setDoc(...args),
}));

/** Every player handed out, so a test can drive the one it means. */
interface Fake {
  events: {
    onProgress: (ms: number) => void;
    onEnded: () => void;
    onError: (m: string) => void;
  };
  loaded: string | null;
  unloaded: boolean;
  playing: boolean;
}
const players: Fake[] = [];
vi.mock('./player', () => ({
  createPlayer: (events: Fake['events']) => {
    const fake: Fake = { events, loaded: null, unloaded: false, playing: false };
    players.push(fake);
    return {
      load: (url: string) => {
        fake.loaded = url;
        return Promise.resolve();
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
  stored = undefined;
  getDoc.mockClear();
  setDoc.mockClear();
  callable.mockReset();
  callable.mockResolvedValue({ data: { url: 'https://signed/audio.m4a', expiresAt: 1e15 } });
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
  it('loads the audio and reports what is playing', async () => {
    const pb = await load();
    pb.openPlayback(recording('rec-a'));
    expect(pb.playback).toBeDefined();
    await flush();
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
    // And the second session is the one every surface now describes.
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
    expect(players[0].loaded).toBe('https://signed/audio.m4a');
    await pb.closePlayback();
    // Resumed, not reset: the stored position survives a session that added
    // nothing to it.
    expect(stored?.positionMs).toBe(120_000);
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
   * A SEEK PAST THE REAL END MUST NOT FREEZE THE SESSION.
   *
   * `seek` holds the displayed position at its target and discards ticks that
   * disagree, so the thumb does not snap backwards. Past the end of the file
   * that target is unreachable, and without `onEnded` clearing it every later
   * tick is discarded — position and listened time freeze, and the frozen number
   * is what the ledger shows.
   */
  it('resumes counting after a seek past the end', async () => {
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
});

describe('signed URLs', () => {
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
