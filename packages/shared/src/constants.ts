/** Cloud Functions region. One constant so app, functions and tests agree. */
export const REGION = 'us-central1';

/**
 * The institute's timezone (Houston, TX), for date-only due dates.
 *
 * Due dates are a calendar day, not an instant (docs/PRODUCT_BRIEF.md § Due
 * dates), so "is this overdue?" depends entirely on where the day rolls over.
 * It is ONE institute-wide constant, not per-student — everyone is answerable
 * to the same calendar. IANA name so `Intl.DateTimeFormat` handles DST without
 * a date library.
 */
export const INSTITUTE_TIMEZONE = 'America/Chicago';

/** "Due soon" window for the student home: incomplete and due within this many
 *  days. From the brief's § Student home ordering. */
export const DUE_SOON_DAYS = 7;

/** How long after a session an excused student has to listen, by default. Staff
 *  can change it per session; it only prefills the field, and cannot be blank. */
export const DEFAULT_DUE_DAYS = 7;

/**
 * Project id used against the emulator suite.
 *
 * The Firestore and Storage emulators PARTITION DATA BY PROJECT ID: a client
 * configured with a different id talks to a different database inside the same
 * emulator, and the symptom is writes that succeed while the client insists the
 * document does not exist — even reporting a server snapshot. This one exported
 * constant is what the app, the tests and `emulators:exec --project` all use, so
 * they cannot drift apart.
 */
export const EMULATOR_PROJECT_ID = 'demo-sabeel';

/**
 * The Storage bucket used against the emulator suite.
 *
 * Needed as an explicit constant because NEITHER side has a usable default:
 * the client's `firebaseConfig.storageBucket` is a placeholder until the real
 * project exists, and the Admin SDK throws "Bucket name not specified" unless
 * one is configured. Left unset, the client uploads to one bucket name while
 * the server looks in another, and the only symptom is a finalize step
 * reporting "no audio found" for a file that uploaded successfully.
 */
export const EMULATOR_STORAGE_BUCKET = `${EMULATOR_PROJECT_ID}.appspot.com`;

/**
 * How long a playback signed URL stays valid.
 *
 * Faisal's threat model (2026-07-21): a leaked link must expire, but a
 * determined user extracting audio from their own device is acceptable. That
 * rules out Firebase's `getDownloadURL()`, whose download token never expires.
 * Twelve hours comfortably exceeds any single listening session, so a URL never
 * dies mid-playback.
 */
export const SIGNED_URL_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Re-mint a signed URL before starting playback when less than this remains.
 *
 * Refreshing only after a 403 means a seek near the expiry boundary fails
 * audibly first; refreshing ahead of time means the failure never reaches the
 * user.
 */
export const SIGNED_URL_REFRESH_MS = 60 * 60 * 1000;
