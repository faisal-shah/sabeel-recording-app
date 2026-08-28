import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { pushPromptState } from './push';
import { registerThisDevice } from './notifications';

/**
 * The one-time nudge to switch notifications on, shown on the first screen
 * after signing in.
 *
 * It exists because the permission prompt has to follow a press (see
 * notify.web.ts), and the only control that does that lives on the
 * notifications screen — which someone who never goes looking will never find.
 * This is the discoverable route to the same call.
 *
 * Dismissing costs NOTHING. That is the whole point of asking on our own card
 * before the browser's: a "not now" here is free and repeatable, while a
 * dismissed browser or OS dialog can never be raised again. The notifications
 * screen always offers the same control, so nobody is trapped by dismissing.
 */

/**
 * Per DEVICE because permission is per device, and per ACCOUNT because a shared
 * browser must not hide the nudge from whoever signs in next. AsyncStorage is
 * localStorage on web, so one implementation covers both surfaces.
 */
const key = (uid: string) => `pushNudgeDismissed:${uid}`;

async function isDismissed(uid: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key(uid))) === '1';
  } catch {
    // Storage blocked — a locked-down browser, a private window. Showing the
    // nudge is the safe answer: it is dismissible, and the alternative is
    // hiding it from someone who never chose to hide it.
    return false;
  }
}

export function usePushNudge(uid: string): {
  visible: boolean;
  busy: boolean;
  /** Permission was granted but no token came back — say so, do not vanish. */
  failed: boolean;
  enable: () => Promise<void>;
  dismiss: () => void;
} {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // On FOCUS, not on mount. This screen sits under a stack navigator, so it
  // stays mounted while the notification settings screen is pushed over it —
  // someone who enables notifications there and comes back would otherwise
  // return to a nudge still insisting they are not enabled.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      void (async () => {
        // Only 'default' is worth a nudge: granted needs nothing, and denied
        // cannot be re-asked from here at all.
        const [state, dismissed] = await Promise.all([pushPromptState(), isDismissed(uid)]);
        if (!live) return;
        // Cleared on every re-check: a failure is about one attempt, not about
        // the device forever.
        setFailed(false);
        setVisible(state === 'default' && !dismissed);
      })();
      return () => {
        live = false;
      };
    }, [uid]),
  );

  // registerThisDevice must be the FIRST thing this does — a browser only
  // honours a permission request raised directly from a press, and an await
  // before it loses that. setBusy is synchronous, so it does not separate the
  // two.
  const enable = () => {
    setBusy(true);
    // RETURNED, not voided: a Button that awaits its handler to drive its own
    // progress gets nothing from a void. Returning the promise does not await
    // it, so the request above is still raised synchronously inside the press.
    return registerThisDevice(uid, true)
      .catch(() => null)
      .then(async (token) => {
        setBusy(false);
        if (token) return setVisible(false);
        // A null is not necessarily a refusal. Permission granted with NO token
        // behind it is a silent failure that looks exactly like success — the
        // card would vanish and nothing would ever arrive — so say so. A real
        // refusal is sticky and just goes away.
        const state = await pushPromptState();
        if (state === 'granted' || state === 'unsupported') return setFailed(true);
        if (state === 'denied') setVisible(false);
      });
  };

  const dismiss = () => {
    setVisible(false);
    void AsyncStorage.setItem(key(uid), '1').catch(() => undefined);
  };

  return { visible, busy, failed, enable, dismiss };
}
