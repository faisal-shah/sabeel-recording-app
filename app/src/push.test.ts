import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The NATIVE half of the push seam (web sibling: push.web.ts).
 *
 * It had no tests at all. `prompt` is the whole contract here — the silent path
 * must never raise the system dialog — and nothing was holding that down on
 * this side of the seam.
 */
vi.mock('expo-notifications', () => ({
  setNotificationChannelAsync: vi.fn(() => Promise.resolve()),
  requestPermissionsAsync: vi.fn(),
  getPermissionsAsync: vi.fn(),
  getDevicePushTokenAsync: vi.fn(),
  AndroidImportance: { DEFAULT: 3 },
}));
vi.mock('react-native', () => ({ Linking: { openSettings: vi.fn(() => Promise.resolve()) } }));

import {
  getPermissionsAsync,
  getDevicePushTokenAsync,
  requestPermissionsAsync,
} from 'expo-notifications';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function device(opts: { granted: boolean; canAskAgain?: boolean; token?: string | null }) {
  const perm = { granted: opts.granted, canAskAgain: opts.canAskAgain ?? true };
  asMock(getPermissionsAsync).mockResolvedValue(perm);
  asMock(requestPermissionsAsync).mockResolvedValue(perm);
  asMock(getDevicePushTokenAsync).mockResolvedValue({
    data: opts.token === undefined ? 'fcm-native-token' : opts.token,
  });
}

/** Fresh module per test: a successful token is memoised for the process. */
async function loadPush() {
  vi.resetModules();
  return import('./push');
}

beforeEach(() => vi.clearAllMocks());

describe('devicePushToken(false) — the silent path', () => {
  it('never raises the system dialog, however askable the device is', async () => {
    device({ granted: false, canAskAgain: true });
    const { devicePushToken } = await loadPush();
    await expect(devicePushToken(false)).resolves.toBeNull();
    expect(requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('hands over a token when permission was already granted', async () => {
    device({ granted: true });
    const { devicePushToken } = await loadPush();
    await expect(devicePushToken(true)).resolves.toBe('fcm-native-token');
  });
});

describe('devicePushToken(true) — the gesture path', () => {
  it('asks, and yields the token', async () => {
    device({ granted: false });
    asMock(requestPermissionsAsync).mockResolvedValue({ granted: true, canAskAgain: true });
    const { devicePushToken } = await loadPush();
    await expect(devicePushToken(true)).resolves.toBe('fcm-native-token');
    expect(requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('gives nothing back when the dialog is refused', async () => {
    device({ granted: false });
    asMock(requestPermissionsAsync).mockResolvedValue({ granted: false, canAskAgain: false });
    const { devicePushToken } = await loadPush();
    await expect(devicePushToken(true)).resolves.toBeNull();
  });
});

describe('pushPromptState', () => {
  it('reports a device that can still be asked', async () => {
    device({ granted: false, canAskAgain: true });
    const { pushPromptState } = await loadPush();
    await expect(pushPromptState()).resolves.toBe('default');
  });

  it('reports a spent prompt as denied', async () => {
    device({ granted: false, canAskAgain: false });
    const { pushPromptState } = await loadPush();
    await expect(pushPromptState()).resolves.toBe('denied');
  });

  it('reports granted', async () => {
    device({ granted: true });
    const { pushPromptState } = await loadPush();
    await expect(pushPromptState()).resolves.toBe('granted');
  });
});
