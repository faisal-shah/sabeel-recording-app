import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import {
  COLLECTIONS,
  DUE_SOON_DAYS,
  INSTITUTE_TIMEZONE,
  todayInZone,
  type RecordingDoc,
  type SessionDoc,
} from '@sabeel/shared';
import { db } from './firebase';
import type { CourseRow } from './structure';
import { captureError } from './sentry';

export type TodayKind = 'attendance' | 'recording' | 'publish' | 'closing';

export interface TodayItem {
  key: string;
  kind: TodayKind;
  sessionId: string;
  courseId: string;
  courseName: string;
  title: string;
  /** The session's meeting date, `YYYY-MM-DD`. */
  date: string;
  /** What the reader has to do about it, in their own words. */
  detail: string;
  recordingId: string | null;
  /** Days past due (negative = still to come). Drives the ordering. */
  age: number;
}

/**
 * How urgent each kind is, before age is considered.
 *
 * ATTENDANCE IS FIRST AND IT IS NOT A CLOSE CALL. Under the excused-only
 * policy an un-taken sheet grants nobody anything, so a whole class is locked
 * out of a published recording with nothing on any screen saying why. Every
 * other row here is work that is visibly outstanding somewhere; this one is
 * work whose absence is invisible.
 */
const RANK: Record<TodayKind, number> = {
  attendance: 0,
  publish: 1,
  recording: 2,
  closing: 3,
};

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * The staff work queue, derived — never stored.
 *
 * Every row is computed from sessions and recordings the reader can already
 * see. There is no queue collection, nothing to keep in step with the documents
 * it describes, and no way for it to claim work that is already done: close the
 * gap and the row is gone on the next read.
 *
 * Read with `getDocs`, not a live listener. This is a to-do list refreshed when
 * you arrive at it, and a live version would need one listener per course plus
 * one per recording — a lot of sockets for a screen whose content changes when
 * the person looking at it changes something.
 *
 * `in` takes at most 30 course ids. An institute past that is past the point
 * where one flat list is the right screen anyway, so it truncates rather than
 * paginating, and says so.
 */
export function useTodayQueue(courses: CourseRow[]): {
  items: TodayItem[];
  loading: boolean;
  truncated: boolean;
} {
  const [items, setItems] = useState<TodayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const ids = courses.map((c) => c.id).sort();
  const key = ids.join(',');
  const truncated = ids.length > 30;

  useEffect(() => {
    let cancelled = false;
    const scope = ids.slice(0, 30);
    if (scope.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }
    const names = new Map(courses.map((c) => [c.id, c.name]));
    const today = todayInZone(INSTITUTE_TIMEZONE);

    void (async () => {
      try {
        const [sessionSnap, recordingSnap] = await Promise.all([
          getDocs(query(collection(db, COLLECTIONS.sessions), where('courseId', 'in', scope))),
          getDocs(query(collection(db, COLLECTIONS.recordings), where('courseId', 'in', scope))),
        ]);
        if (cancelled) return;

        const recordings = new Map<string, RecordingDoc & { id: string }>();
        for (const d of recordingSnap.docs) {
          recordings.set(d.id, { id: d.id, ...(d.data() as RecordingDoc) });
        }

        const out: TodayItem[] = [];
        for (const d of sessionSnap.docs) {
          const s = d.data() as SessionDoc;
          if (s.archived) continue;
          const courseName = names.get(s.courseId) ?? '';
          const met = daysBetween(s.date, today);
          const base = {
            sessionId: d.id,
            courseId: s.courseId,
            courseName,
            title: s.title,
            date: s.date,
          };

          if (s.attendanceSubmittedAt === null && met >= 0) {
            out.push({
              ...base,
              key: `att-${d.id}`,
              kind: 'attendance',
              recordingId: null,
              age: met,
              detail:
                met === 0
                  ? 'Met today. Nobody has access until attendance is taken.'
                  : `Met ${met} ${met === 1 ? 'day' : 'days'} ago. Nobody has access until attendance is taken.`,
            });
            continue;
          }

          const rec = s.recordingId ? recordings.get(s.recordingId) : null;
          if (!rec) {
            if (met >= 0) {
              out.push({
                ...base,
                key: `rec-${d.id}`,
                kind: 'recording',
                recordingId: null,
                age: met,
                detail: 'Attendance is in. The recording has not been added yet.',
              });
            }
            continue;
          }

          if (rec.status === 'needsAttention' || rec.status === 'draft') {
            out.push({
              ...base,
              key: `pub-${d.id}`,
              kind: 'publish',
              recordingId: rec.id,
              age: met,
              detail:
                rec.status === 'needsAttention'
                  ? 'The import needs attention before it can be published.'
                  : 'A draft is waiting to be published.',
            });
            continue;
          }

          if (rec.status === 'published') {
            const left = daysBetween(today, s.dueDate);
            if (left >= 0 && left <= DUE_SOON_DAYS) {
              out.push({
                ...base,
                key: `close-${d.id}`,
                kind: 'closing',
                recordingId: rec.id,
                age: -left,
                detail:
                  left === 0
                    ? 'Access closes today. Check who still has not listened.'
                    : `Access closes in ${left} ${left === 1 ? 'day' : 'days'}.`,
              });
            }
          }
        }

        out.sort((a, b) => RANK[a.kind] - RANK[b.kind] || b.age - a.age || a.title.localeCompare(b.title));
        setItems(out);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        captureError(e, { label: 'todayQueue' });
        setItems([]);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // `key` is the joined course ids — the courses array itself is a new
    // reference on every render of the live query that produced it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { items, loading, truncated };
}
