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
import { onSnapshot, type Query, type QuerySnapshot } from 'firebase/firestore';
import { captureError } from './sentry';

// ---- Listener-error visibility -------------------------------------------
// A server-rejected listen (a missing index, a rules denial) otherwise dies as
// a console.warn nobody sees on a phone. Screens surface the latest live-data
// error via useListenerError; a later success from the same source clears it.
const errorWatchers = new Set<(msg: string | null) => void>();
let lastListenerError: string | null = null;

function reportListenerError(label: string, e: { code?: string; message: string }) {
  lastListenerError = `Live data error (${label}): ${e.code ?? e.message}`;
  errorWatchers.forEach((w) => w(lastListenerError));
  console.warn(`${label} listener`, e.code ?? e.message);
  // Off-device visibility: a listener failure in a phone console is invisible.
  // captureError is a no-op until a Sentry DSN exists; the call site is here so
  // wiring it later reaches every listener at once.
  captureError(e, { source: label });
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

/** Live query results. `make`/`map` are called fresh per (re)subscription;
 *  a null query means "not subscribed" (e.g. role-gated queries) → `empty`.
 *
 *  `includeMetadataChanges` makes the subscription also re-fire when only
 *  metadata changes — specifically when a local write flips from pending to
 *  synced. Screens showing a "Pending sync" state need that transition; without
 *  it the snapshot fires once with `hasPendingWrites` true and never again when
 *  the write lands, so the badge would stick forever. Off by default because it
 *  doubles snapshot callbacks, and most screens do not care. */
export function useLiveQuery<T>(
  label: string,
  make: () => Query | null,
  map: (snap: QuerySnapshot) => T,
  empty: T,
  deps: readonly unknown[],
  includeMetadataChanges = false,
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
  }, deps);
  return value;
}

