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
export const EMULATOR_PROJECT_ID = 'demo-sabeel-recordings';

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
 *
 * AND IT SPILLS PAST THE DEADLINE, by up to its own length. `getPlaybackUrl`
 * refuses once the listen-by date has gone, but a URL minted at 23:50 on that
 * date keeps working until noon the next day, and nothing revokes one — not
 * unpublishing, not unenrolling, not disabling the account. That is inside the
 * documented threat model (a determined listener extracting audio from their own
 * device is accepted), but "the deadline is enforced at the audio" reads as
 * absolute and is not: it is enforced at MINTING. Shortening the TTL narrows the
 * window at the cost of re-minting mid-lecture; twelve hours is chosen so a
 * two-hour session started at any point in an evening finishes on one URL.
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

/**
 * Where the public privacy policy WILL live.
 *
 * Required in two places and for two different reasons: in the store listing,
 * and reachable from INSIDE the app (Apple 5.1.1(i) — store metadata alone does
 * not satisfy it). It must answer an anonymous fetch, because reviewers and
 * store crawlers do not sign in and a client-side route behind auth looks empty
 * to them — which means a static page plus a Hosting rewrite ahead of the
 * catch-all, since `**` currently rewrites everything to the SPA.
 *
 * THE PAGE DOES NOT EXIST YET, and the host is not settled either. The link is
 * live in the More menu, so until both are, following it answers with nothing a
 * reviewer would accept. Tracked in `TODO.md`; it is a release blocker, not a
 * nice-to-have.
 *
 * Absolute, not a relative path: it is opened from the native apps as well as
 * the browser, where there is no origin to be relative to.
 */
export const PRIVACY_URL = 'https://recordings.oursabeel.com/privacy';

/**
 * How many courses the staff work queue may span in one query, per role.
 *
 * TWO DIFFERENT CEILINGS, because the two roles pay different prices for the
 * same query. Firestore's `in` operator takes at most 30 values, which is the
 * whole of an ADMIN's constraint — their arm of the sessions and recordings
 * rules reads no documents. A MANAGER's arm resolves `get(courses/{id})` for
 * every document returned, against a per-evaluation cap on document-access
 * calls, so their ceiling is lower and has nothing to do with `in`.
 *
 * 10 IS THE DOCUMENTED PRODUCTION CEILING, not a measured one — and this is the
 * one number in the app that a green emulator suite cannot establish. Firestore
 * allows ten `exists()`/`get()`/`getAfter()` calls per single-document or QUERY
 * request (twenty only for transactions and batched writes), and repeated calls
 * on the same path within a request are cached, so the cost here is exactly one
 * per DISTINCT course in the result set. Eleven live courses would have made the
 * staff landing screen fail closed for that manager, with the badge stuck at
 * zero and a denial per session in Sentry.
 *
 * `rules.sessions.test.ts` sends exactly this query at exactly
 * `QUEUE_SCOPE.manager` and asserts it is served with every row returned, then
 * sends it at `QUEUE_SCOPE.admin` and asserts a manager is refused while an
 * admin is not. That pair BRACKETS the emulator's ceiling — which sits higher,
 * because the emulator does not enforce production's document-access limit — and
 * brackets it loosely. Treat it as a regression guard on the rule's shape, never
 * as a licence to raise this number: raising it needs a measurement against a
 * real project.
 */
export const QUEUE_SCOPE = { admin: 30, manager: 10 } as const;

/**
 * How many audit entries one screen reads.
 *
 * THE ONE COLLECTION IN THIS PRODUCT THAT ONLY EVER GROWS. Everything else a
 * screen subscribes to is bounded by the institute — students, courses,
 * sessions, a course's assignments — and gets smaller when a term is archived.
 * The audit log is append-only by design ("never updated or deleted"), so a
 * query with no limit is a live subscription to every change ever made,
 * re-downloaded on every visit, growing for the life of the deployment. Three
 * years of attendance submissions, publishes and overrides is tens of thousands
 * of documents streamed to a phone to render the first screenful.
 *
 * 200 is roughly a term's activity for one course and several weeks across all
 * of them — enough that "what happened recently" is answered on the page, and
 * the screen says so when it is full rather than implying the log ends there.
 * Anything older is a data question, not a screen question.
 */
export const AUDIT_PAGE = 200;

/**
 * The WEB OAuth client id (client_type: 3) from `google-services.json`.
 *
 * SHARED because two sides must agree on it. The native Google Sign-In SDK
 * passes it as `webClientId` to obtain a token, and `accountExists` pins it as
 * the expected AUDIENCE when verifying that token — without which a token minted
 * for any other OAuth client would verify happily and the gate would open for a
 * stranger. Two copies of one id is exactly the drift that would be invisible
 * until it mattered.
 *
 * Not a secret, in the same way the Firebase web config is not: an OAuth client
 * id is public by design and ships in every client bundle.
 *
 * It must be the *web* client id even on Android — passing the Android one is a
 * classic source of the opaque `DEVELOPER_ERROR`.
 */
export const GOOGLE_WEB_CLIENT_ID =
  '977423479850-k1r54fn135p62fa165n8gfngbafssv5q.apps.googleusercontent.com';
