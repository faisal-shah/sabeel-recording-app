import { describe, expect, it } from 'vitest';
import { KIND_ORDER, buildTodayQueue } from './todayQueue';
import type { RecordingDoc, SessionDoc } from '@sabeel/shared';

/**
 * The staff work queue's derivation.
 *
 * Everything this screen is lives in one pure function: which sessions become
 * work, which of that work is BLOCKING (the number on the tab badge), what order
 * it comes in, and which of three sentences an empty result produces. None of it
 * had a test — the sweep photographs whatever the seeded world happens to
 * contain, which is a handful of the cases below and none of the edges.
 *
 * `today` is fixed at 2026-09-06 throughout; every date is written relative to
 * it in the helpers.
 */
const TODAY = '2026-09-06';
const COURSE = 'c1';

const day = (offset: number) => {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

function session(
  id: string,
  opts: Partial<SessionDoc> & { metDaysAgo?: number; dueInDays?: number } = {},
): SessionDoc & { id: string } {
  const { metDaysAgo = 3, dueInDays = 14, ...rest } = opts;
  return {
    id,
    courseId: COURSE,
    cohortId: 'co1',
    date: day(-metDaysAgo),
    title: id,
    dueDate: day(dueInDays),
    notes: '',
    recordingId: null,
    attendance: {},
    attendanceSubmittedAt: 1,
    archived: false,
    createdAt: 1,
    createdBy: 'admin',
    updatedAt: 1,
    ...rest,
  } as SessionDoc & { id: string };
}

function recording(
  id: string,
  status: RecordingDoc['status'],
): RecordingDoc & { id: string } {
  return {
    id,
    sessionId: 's',
    courseId: COURSE,
    cohortId: 'co1',
    title: id,
    notes: '',
    date: TODAY,
    status,
    source: 'manual',
    audioPath: null,
    durationSec: null,
    sizeBytes: null,
    createdAt: 1,
    createdBy: 'admin',
    updatedAt: 1,
  } as RecordingDoc & { id: string };
}

const build = (
  sessions: (SessionDoc & { id: string })[],
  recordings: (RecordingDoc & { id: string })[] = [],
  over: Partial<Parameters<typeof buildTodayQueue>[0]> = {},
) =>
  buildTodayQueue({
    courses: [{ id: COURSE, name: 'Hikam Foundations' }],
    sessions,
    recordings: new Map(recordings.map((r) => [r.id, r])),
    scope: [COURSE],
    today: TODAY,
    failed: false,
    settled: true,
    truncated: false,
    ...over,
  });

describe('what becomes work', () => {
  it('a met session with no attendance is the top of the queue', () => {
    const q = build([session('s1', { attendanceSubmittedAt: null, metDaysAgo: 3 })]);
    expect(q.items).toHaveLength(1);
    expect(q.items[0].kind).toBe('attendance');
    expect(q.items[0].detail).toBe(
      'Met 3 days ago. Nobody has access until attendance is taken.',
    );
  });

  it('says "today" rather than "0 days ago"', () => {
    const q = build([session('s1', { attendanceSubmittedAt: null, metDaysAgo: 0 })]);
    expect(q.items[0].detail).toBe('Met today. Nobody has access until attendance is taken.');
  });

  it('a session that has NOT met yet is not work', () => {
    const q = build([session('s1', { attendanceSubmittedAt: null, metDaysAgo: -2 })]);
    expect(q.items).toHaveLength(0);
  });

  it('attendance in and no recording asks for the audio', () => {
    const q = build([session('s1')]);
    expect(q.items[0].kind).toBe('recording');
    expect(q.items[0].recordingId).toBeNull();
  });

  it('an archived session is not work at all', () => {
    const q = build([session('s1', { archived: true, attendanceSubmittedAt: null })]);
    expect(q.items).toHaveLength(0);
  });

  it('a published recording well inside its deadline is not work', () => {
    const q = build(
      [session('s1', { recordingId: 'r1', dueInDays: 30 })],
      [recording('r1', 'published')],
    );
    expect(q.items).toHaveLength(0);
  });

  it('a published recording closing this week is work', () => {
    const q = build(
      [session('s1', { recordingId: 'r1', dueInDays: 2 })],
      [recording('r1', 'published')],
    );
    expect(q.items[0].kind).toBe('closing');
    expect(q.items[0].detail).toBe('Access closes in 2 days.');
  });

  it('a deadline already past is not work — nothing can be done about it', () => {
    const q = build(
      [session('s1', { recordingId: 'r1', dueInDays: -1 })],
      [recording('r1', 'published')],
    );
    expect(q.items).toHaveLength(0);
  });

  it('a recording id with no recording behind it asks for the audio', () => {
    const q = build([session('s1', { recordingId: 'gone' })], []);
    expect(q.items[0].kind).toBe('recording');
  });
});

/*
 * THE BADGE COUNTS WHAT IS BLOCKING ACCESS, WHICH IS NOT THE SAME AS WHAT IS
 * WAITING. A draft is work; nobody was promised it, so nobody is locked out of
 * it. An unpublished recording is the opposite — every excused student HAD it
 * and now does not.
 */
describe('what the badge counts', () => {
  it('counts an un-taken register', () => {
    const q = build([session('s1', { attendanceSubmittedAt: null })]);
    expect(q.blocking).toBe(1);
  });

  it('counts an unpublished recording, because it revoked access', () => {
    const q = build(
      [session('s1', { recordingId: 'r1' })],
      [recording('r1', 'unpublished')],
    );
    expect(q.items[0].kind).toBe('publish');
    expect(q.items[0].detail).toBe('Unpublished, so nobody excused can open it.');
    expect(q.blocking).toBe(1);
  });

  it('does NOT count a draft, which has granted nothing yet', () => {
    const q = build([session('s1', { recordingId: 'r1' })], [recording('r1', 'draft')]);
    expect(q.items[0].kind).toBe('publish');
    expect(q.blocking).toBe(0);
  });

  it('does not count an import that needs attention', () => {
    const q = build(
      [session('s1', { recordingId: 'r1' })],
      [recording('r1', 'needsAttention')],
    );
    expect(q.items[0].detail).toBe('The import needs attention before it can be published.');
    expect(q.blocking).toBe(0);
  });

  it('does not count a deadline that is merely near', () => {
    const q = build(
      [session('s1', { recordingId: 'r1', dueInDays: 1 })],
      [recording('r1', 'published')],
    );
    expect(q.blocking).toBe(0);
  });
});

describe('the order', () => {
  it('sorts by kind first, in KIND_ORDER', () => {
    const q = build(
      [
        session('closing', { recordingId: 'r1', dueInDays: 3 }),
        session('norec'),
        session('draft', { recordingId: 'r2' }),
        session('att', { attendanceSubmittedAt: null }),
      ],
      [recording('r1', 'published'), recording('r2', 'draft')],
    );
    const kinds = q.items.map((i) => i.kind);
    expect(kinds).toEqual([...KIND_ORDER].filter((k) => kinds.includes(k)));
    expect(kinds[0]).toBe('attendance');
  });

  it('within a kind, the longest outstanding comes first', () => {
    const q = build([
      session('recent', { attendanceSubmittedAt: null, metDaysAgo: 1 }),
      session('old', { attendanceSubmittedAt: null, metDaysAgo: 9 }),
    ]);
    expect(q.items.map((i) => i.title)).toEqual(['old', 'recent']);
  });

  /*
   * `age: -left` IS THE SIGN TRICK THAT MAKES ONE COMPARATOR DO BOTH.
   *
   * Overdue rows sort oldest-first on a descending age; a closing row's urgency
   * runs the other way — sooner is more urgent — so it stores the negated days
   * remaining and falls out in the right order under the same comparison.
   */
  it('among closing rows, the nearest deadline comes first', () => {
    const q = build(
      [
        session('later', { recordingId: 'r1', dueInDays: 6 }),
        session('sooner', { recordingId: 'r2', dueInDays: 1 }),
      ],
      [recording('r1', 'published'), recording('r2', 'published')],
    );
    expect(q.items.map((i) => i.title)).toEqual(['sooner', 'later']);
  });

  it('ties break on the title, so the order never wobbles between renders', () => {
    const q = build([
      session('Bravo', { attendanceSubmittedAt: null, metDaysAgo: 4 }),
      session('Alpha', { attendanceSubmittedAt: null, metDaysAgo: 4 }),
    ]);
    expect(q.items.map((i) => i.title)).toEqual(['Alpha', 'Bravo']);
  });
});

/*
 * AN EMPTY QUEUE HAS THREE CAUSES AND THEY ARE THREE DIFFERENT SENTENCES.
 * `scoped` and `allFinished` are what the screen picks between; getting them
 * wrong tells a manager at the end of term that nobody has assigned them a
 * course.
 */
describe('an empty queue', () => {
  it('with courses running: nothing is waiting', () => {
    const q = build([]);
    expect(q).toMatchObject({ loading: false, scoped: true, allFinished: false });
  });

  it('with no courses at all: nothing has been assigned', () => {
    const q = build([], [], { courses: [], scope: [] });
    expect(q).toMatchObject({ scoped: false, allFinished: false });
  });

  it('with courses that have all finished: the term is over', () => {
    const q = build([], [], { scope: [] });
    expect(q).toMatchObject({ scoped: false, allFinished: true });
  });

  it('waits for the courses rather than claiming there are none', () => {
    const q = build([], [], { courses: null, settled: false, scope: [] });
    expect(q).toMatchObject({ loading: true, scoped: true });
  });

  it('stops waiting once the course listener has answered', () => {
    const q = build([], [], { courses: null, settled: true, scope: [] });
    expect(q.loading).toBe(false);
  });

  it('waits for the sessions once there is something to subscribe to', () => {
    const q = build([], [], { sessions: null });
    expect(q).toMatchObject({ loading: true, scoped: true });
  });

  it('a refused listener reports failure rather than loading for ever', () => {
    const q = build([], [], { courses: null, settled: false, scope: [], failed: true });
    expect(q).toMatchObject({ loading: false, failed: true });
  });

  it('carries the truncation flag through every early return', () => {
    const q = build([], [], { courses: null, settled: false, scope: [], truncated: true });
    expect(q.truncated).toBe(true);
  });
});
