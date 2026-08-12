import { collection, doc, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { COLLECTIONS, type AttendanceStatus, type SessionDoc } from '@sabeel/shared';
import { db, functions } from './firebase';
import { useLiveDocState, useLiveQuery } from './liveQuery';

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
/**
 * One session, live, plus whether the listener has answered.
 *
 * A DOCUMENT listener rather than `where('__name__','==',id)`, matching
 * useCourse and useRecording: sessions are staff-only and the rule grants get
 * and list alike, so this is not a permissions fix — but a screen resolving a
 * session from a URL has to be able to say "no such session", and only the
 * document form reports that.
 */
export function useSessionState(sessionId: string | null) {
  return useLiveDocState<SessionRow | null>(
    () => (sessionId ? doc(db, COLLECTIONS.sessions, sessionId) : null),
    [sessionId],
    {
      label: 'session',
      map: (snap) => ({ id: snap.id, ...(snap.data() as SessionDoc) }),
      empty: null,
    },
  );
}
