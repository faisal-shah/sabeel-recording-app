import { useEffect, useState } from 'react';
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
  enable: () => void;
  dismiss: () => void;
} {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      // Only 'default' is worth a nudge: granted needs nothing, and denied
      // cannot be re-asked from here at all.
      const [state, dismissed] = await Promise.all([pushPromptState(), isDismissed(uid)]);
      if (live) setVisible(state === 'default' && !dismissed);
    })();
    return () => {
      live = false;
    };
  }, [uid]);

  // registerThisDevice must be the FIRST thing this does — a browser only
  // honours a permission request raised directly from a press, and an await
  // before it loses that. setBusy is synchronous, so it does not separate the
  // two.
  const enable = () => {
    setBusy(true);
    void registerThisDevice(uid, true).catch(() => null).then(() => {
      setBusy(false);
      // Hidden whatever the answer: granted needs no nudge, denied cannot be
      // asked again, and unavailable has nothing behind it. The notifications
      // screen reports whichever state resulted.
      setVisible(false);
    });
  };

  const dismiss = () => {
    setVisible(false);
    void AsyncStorage.setItem(key(uid), '1').catch(() => undefined);
  };

  return { visible, busy, enable, dismiss };
}
