import { Platform } from 'react-native';

// Baked in at bundle time: EXPO_PUBLIC_USE_EMULATORS=1 npx expo start [--web]
//
// On a native DEBUG build this value comes from the environment that started
// METRO, not from the APK — the APK carries no EXPO_PUBLIC_* values to fix. If
// the flag looks unset on the emulator, restart Metro with `--clear` and the
// var set, then relaunch the app.
export const USE_EMULATORS = process.env.EXPO_PUBLIC_USE_EMULATORS === '1';

// The Android emulator reaches the host machine at 10.0.2.2.
// Web uses the LITERAL 127.0.0.1, never 'localhost': the Firebase emulators bind
// to IPv4 only, while 'localhost' can resolve to IPv6 ::1 first — the request
// then fails at connect, which surfaces as a CORS error ("no
// Access-Control-Allow-Origin") because there is no response to carry headers.
export const EMULATOR_HOST = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
