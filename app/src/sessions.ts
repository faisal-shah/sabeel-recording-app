import { collection, doc, getDoc, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { COLLECTIONS, type AttendanceStatus, type SessionDoc } from '@sabeel/shared';
import { db, functions } from './firebase';
import { useLiveQuery } from './liveQuery';

export interface SessionRow extends SessionDoc {
  id: string;
}

const call =
  <I, O>(name: string) =>
  (input: I) =>
    httpsCallable<I, O>(functions, name)(input).then((r) => r.data);

export const createSession = call<
  { courseId: string; date: string; title: string; dueDate: string | null; notes: string },
  { id: string }
>('createSession');

export const updateSession = call<
  { sessionId: string; date?: string; title?: string; dueDate?: string | null; notes?: string },
  { sessionId: string }
>('updateSession');

/** Submit attendance for a session (the explicit-submit step). */
export const submitAttendance = call<
  { sessionId: string; attendance: Record<string, AttendanceStatus> },
  { sessionId: string; marked: number }
>('submitAttendance');

export const deleteSession = call<{ sessionId: string }, { sessionId: string }>('deleteSession');

/** A course's sessions, newest meeting first. Staff-only (rules). */
export function useCourseSessions(courseId: string | null): SessionRow[] {
  return useLiveQuery<SessionRow[]>(
    () =>
      courseId
        ? query(
            collection(db, COLLECTIONS.sessions),
            where('courseId', '==', courseId),
            orderBy('date', 'desc'),
          )
        : null,
    [courseId],
    {
      label: 'courseSessions',
      map: (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as SessionDoc) })),
      empty: [],
    },
  );
}

/** Live single session (for the session detail / attendance screen). */
export function useSession(sessionId: string | null): SessionRow | null {
  const rows = useLiveQuery<SessionRow[]>(
    () =>
      sessionId
        ? query(collection(db, COLLECTIONS.sessions), where('__name__', '==', sessionId))
        : null,
    [sessionId],
    {
      label: 'session',
      map: (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as SessionDoc) })),
      empty: [],
    },
  );
  return rows[0] ?? null;
}

/** Load one session by id (for opening its recording's player directly). */
export async function loadSession(id: string): Promise<SessionRow | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.sessions, id));
  return snap.exists() ? { id: snap.id, ...(snap.data() as SessionDoc) } : null;
}
