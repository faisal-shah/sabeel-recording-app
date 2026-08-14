// The ONE way to subscribe to live Firestore data from a hook. Every live hook
// in the app goes through here — never hand-roll onSnapshot state in a hook.
//
// Invariants (born of a real bug in the sibling time-tracker — its
// docs/POSTMORTEM-2026-07-16-stale-week.md; inherited here, not re-learned):
//  1. State RESETS to `empty` the moment the subscription inputs change. React
//     state otherwise persists across dependency changes, so query A's results
//     would stay on screen while query B's first snapshot is in flight — on a
//     slow connection that showed one week's entries under another week.
//  2. Listener errors also reset to `empty`: an empty screen plus a console
//     warning beats silently-wrong data that never corrects itself.
import { useEffect, useState } from 'react';
import {
  onSnapshot,
  type DocumentReference,
  type DocumentSnapshot,
  type Query,
  type QuerySnapshot,
} from 'firebase/firestore';
import { captureError } from './sentry';

// ---- Listener-error visibility -------------------------------------------
// A server-rejected listen (a missing index, a rules denial) otherwise dies as
// a console.warn nobody sees on a phone. Screens surface the latest live-data
// error via useListenerError; a later success from the same source clears it.
const errorWatchers = new Set<(msg: string | null) => void>();
let lastListenerError: string | null = null;

/**
 * Whether there is an account behind these subscriptions that may read anything.
 *
 * Signing out does not tear the listeners down first. Firestore re-issues every
 * live listen the moment the credential drops, and the server refuses them —
 * while React is still unmounting the screen that owns them. So the last thing
 * a student does before leaving raises a permission denial from their own home
 * screen, which is where the Sign out button is. It reached Sentry as a defect.
 *
 * It is not one: with no usable session, EVERY rule denies by design, so a
 * denial in that state carries no information. Set from the auth session (see
 * session.ts) — its `onAuthStateChanged` callback runs in the same tick the
 * credential drops, well before the server's refusal can come back over the
 * wire, so the flag is always already false by the time this is consulted.
 *
 * Narrow on purpose. It suppresses ONLY permission errors, and only while the
 * app knows the account cannot read: a denial to a signed-in, active user is
 * the interesting kind and still reports.
 */
let sessionCanRead = false;

/** Called by the auth session whenever the account's readability changes. */
export function setLiveDataSession(canRead: boolean): void {
  sessionCanRead = canRead;
}

function reportListenerError(label: string, e: { code?: string; message: string }) {
  const code = e.code ?? '';
  if (!sessionCanRead && (code === 'permission-denied' || code === 'unauthenticated')) {
    // Still logged, and marked — the e2e counts unmarked listener warnings and
    // must not be blinded by this, but neither should it fail on a denial we
    // deliberately expect.
    console.warn(`${label} listener`, code, '(session ended — expected)');
    return;
  }
  lastListenerError = `Live data error (${label}): ${e.code ?? e.message}`;
  errorWatchers.forEach((w) => w(lastListenerError));
  console.warn(`${label} listener`, e.code ?? e.message);
  // Off-device visibility: a listener failure in a phone console is invisible.
  //
  // REPORT OUR MESSAGE, NOT FIRESTORE'S. Handing Sentry the raw FirebaseError
  // groups every listener in the app into one issue titled "Missing or
  // insufficient permissions", over a stack of minified SDK internals that names
  // no screen and no collection — an issue that cannot be acted on without
  // guessing which of two dozen subscriptions produced it. The label is the
  // whole diagnostic, so it belongs in the title; the code and the original
  // message ride along, and the SDK frames were never worth reading.
  captureError(new Error(lastListenerError), {
    source: label,
    code: e.code ?? 'none',
    detail: e.message,
  });
}

function reportListenerSuccess(label: string) {
  if (lastListenerError?.includes(`(${label})`)) {
    lastListenerError = null;
    errorWatchers.forEach((w) => w(null));
  }
}

/** Latest live-listener failure, app-wide; null when healthy. */
export function useListenerError(): string | null {
  const [err, setErr] = useState(lastListenerError);
  useEffect(() => {
    errorWatchers.add(setErr);
    return () => {
      errorWatchers.delete(setErr);
    };
  }, []);
  return err;
}
// ---------------------------------------------------------------------------

export interface LiveQueryOptions<T> {
  /** Names this subscription in listener errors and in Sentry. */
  label: string;
  map: (snap: QuerySnapshot) => T;
  /** Rendered before the first snapshot, and after an error or an input change. */
  empty: T;
  /**
   * Also re-fire when only metadata changes — specifically when a local write
   * flips from pending to synced. Screens showing a "Pending sync" state need
   * that transition; without it the snapshot fires once with `hasPendingWrites`
   * true and never again when the write lands, so the badge sticks forever. Off
   * by default because it doubles snapshot callbacks and most screens do not care.
   */
  includeMetadataChanges?: boolean;
}

/**
 * Live query results. `make`/`map` are called fresh per (re)subscription;
 * a null query means "not subscribed" (e.g. role-gated queries) → `empty`.
 *
 * ARGUMENT ORDER IS LOAD-BEARING. `make` first and `deps` second is the only
 * shape `react-hooks/exhaustive-deps` can read (see eslint.config.mjs), and that
 * rule is what mechanically proves every live screen resubscribes when its
 * inputs change. Everything else is options precisely so these two stay in the
 * positions the linter requires — move them and the check goes quiet without
 * failing, which is worse than never having had it.
 */
export function useLiveQuery<T>(
  make: () => Query | null,
  deps: readonly unknown[],
  { label, map, empty, includeMetadataChanges = false }: LiveQueryOptions<T>,
): T {
  const [value, setValue] = useState<T>(empty);
  useEffect(() => {
    setValue(empty);
    const q = make();
    if (!q) return;
    return onSnapshot(
      q,
      { includeMetadataChanges },
      (snap) => {
        setValue(map(snap));
        reportListenerSuccess(label);
      },
      (e) => {
        setValue(empty);
        reportListenerError(label, e);
      },
    );
    // deps are the caller's subscription inputs; make/map/empty are per-render
    // closures over exactly those inputs.
    //
    // The one place exhaustive-deps is deliberately overridden, and the only
    // one that should ever be: this hook's contract IS a caller-supplied dep
    // list, so the rule cannot see what it needs to. Obeying it here would mean
    // adding make/map/empty — all rebuilt on every render — which tears down and
    // re-establishes the Firestore listener on every render of every live
    // screen. Callers get no exemption: their `deps` argument must still list
    // every input `make` reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

export interface LiveDocOptions<T> {
  label: string;
  map: (snap: DocumentSnapshot) => T;
  /** Rendered before the first snapshot, on an error, and when the doc is absent. */
  empty: T;
}

/**
 * One document, live — the single-document counterpart of useLiveQuery, with the
 * same reset-on-input-change and reset-on-error invariants.
 *
 * A DOCUMENT listener, not `where('__name__','==',id)`: the latter is a `list`,
 * and students are granted `get` on a course they are enrolled in and never
 * `list`. So this is the only way a student screen can hold a live course — and
 * a one-shot getDoc would leave the archived and archived-listening flags frozen
 * at mount, which decide whether the "listening is off" notice shows and whether
 * the player enables its transport.
 *
 * `resolved` says whether the listener has answered. `empty` alone cannot tell
 * "still loading" from "there is no such document", and that difference became
 * visible the moment screens started resolving their subjects from a URL: a link
 * to something deleted, or a recording unpublished while a student had the
 * player open, would otherwise sit on a spinner for ever. It stays false while
 * the ref is null — "not subscribed", which for a chained read (recording → its
 * course) means still waiting on the step before it, not an answer.
 *
 * Argument order matches useLiveQuery, and for the same reason: `make` at 0 and
 * `deps` at 1 is what lets react-hooks/exhaustive-deps check the dependencies.
 */
export function useLiveDocState<T>(
  make: () => DocumentReference | null,
  deps: readonly unknown[],
  { label, map, empty }: LiveDocOptions<T>,
): { value: T; resolved: boolean } {
  const [state, setState] = useState<{ value: T; resolved: boolean }>({
    value: empty,
    resolved: false,
  });
  useEffect(() => {
    setState({ value: empty, resolved: false });
    const ref = make();
    if (!ref) return;
    return onSnapshot(
      ref,
      (snap) => {
        setState({ value: snap.exists() ? map(snap) : empty, resolved: true });
        reportListenerSuccess(label);
      },
      (e) => {
        // A denial is an answer too: the caller may not read it, and telling
        // them it is unavailable beats a spinner that never stops.
        setState({ value: empty, resolved: true });
        reportListenerError(label, e);
      },
    );
    // Same caller-supplied-deps contract as useLiveQuery; see the note there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

