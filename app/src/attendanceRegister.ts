import type { AttendanceStatus } from '@sabeel/shared';

/**
 * The register's marks — the pure part of the attendance section.
 *
 * A NEW register starts everyone as Present: marking who was away is the
 * teacher's whole job, and a default of nothing would make every submit a
 * fourteen-tap chore. A register that has already been SUBMITTED is a
 * different thing: it is the record of who was in the room, and a student who
 * joined the class since is not in it. Defaulting them to Present too wrote a
 * "present" for a meeting they were not enrolled for on the next correction —
 * into their tally, into their own attendance record, and over the report's
 * "not marked", which exists for exactly this student. So on a submitted
 * register a roster member with no stored mark is NOT MARKED until staff pick
 * one, and is left out of what is sent.
 */
export type RegisterMark = AttendanceStatus | null;

export interface RegisterSession {
  attendanceSubmittedAt: number | null;
  attendance: Record<string, AttendanceStatus>;
}

/** What the register shows for one student: a mark, or nothing yet. */
export function registerMark(
  session: RegisterSession,
  marks: Record<string, AttendanceStatus>,
  uid: string,
): RegisterMark {
  const local = marks[uid];
  if (local) return local;
  const stored = session.attendance[uid];
  if (stored) return stored;
  return session.attendanceSubmittedAt === null ? 'present' : null;
}

/** What is sent: every marked student on the roster, and nobody else. */
export function attendancePayload(
  session: RegisterSession,
  activeUids: readonly string[],
  marks: Record<string, AttendanceStatus>,
): Record<string, AttendanceStatus> {
  const out: Record<string, AttendanceStatus> = {};
  for (const uid of activeUids) {
    const mark = registerMark(session, marks, uid);
    if (mark) out[uid] = mark;
  }
  return out;
}
