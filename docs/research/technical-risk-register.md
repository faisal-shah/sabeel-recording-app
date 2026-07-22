# Technical Risk Register

This register captures technical questions discovered during product grooming. It is not the implementation plan yet.

| Area | Risk | Status |
|---|---|---|
| Accountability | Evaluate how reliably mobile and web can track listening progress and what can be trusted as evidence. | Not evaluated |
| Accountability | Design progress tracking as audit evidence while completion is student-attested, including seeking, playback speed, offline use, and partial sessions. | Not evaluated |
| Authentication | Design Google sign-in domain restriction plus application-level staff approval and role assignment. Domain membership alone must not grant permissions. | Not evaluated |
| Authentication | Evaluate Firebase Auth flows for staff-created email/password student accounts, initial password setup, email verification, and password reset. | Not evaluated |
| Authorization | Design role- and scope-based permissions so Managers only access assigned classes while Admins can configure staff access. | Not evaluated |
| Data model | Design recording asset records, assignment records, change history, and reconciliation behavior when published class/cohort changes after students have progress or completion. | Not evaluated |
| Media pipeline | Evaluate whether to stream Zoom audio directly, extract audio from video, store derived audio assets, and keep the MVP audio-only. | Not evaluated |
| Media pipeline | Design manual audio upload: accepted formats, upload size limits, duration extraction, transcoding or normalization, storage, retry/error handling, and draft metadata defaults. | Not evaluated |
| Media pipeline | Evaluate whether Zoom provides separate audio-only recording files or whether the app must derive/store audio assets from Zoom video recordings. | Not evaluated |
| Media playback | Evaluate Expo/React Native background audio behavior, lock-screen controls, playback speed, and parity with web playback. | Not evaluated |
| Media playback | Implement and test pending offline completion state, sync-on-reconnect, conflict handling, staff report semantics, and clear student messaging. | Not evaluated |
| Media playback | Evaluate mobile offline media downloads, local storage limits, playback progress while offline, sync-on-reconnect, web offline limitations, and cleanup policy. | Not evaluated |
| Media playback | Evaluate durable cross-device progress sync, offline progress buffering, conflict handling, and how frequently playback position/listened duration should be saved. | Not evaluated |
| Notifications | Evaluate Expo push notifications, web push support, notification permissions, user preferences, delivery reliability, and Firebase integration. | Not evaluated |
| Observability | Design Admin-only backend stats for storage usage, recording counts, import/job failures, notification errors, user counts, and any bandwidth metrics available from Firebase/GCS. | Not evaluated |
| Security/storage | Design protected audio storage, authorized playback URLs, in-app offline storage, and no external file export while recognizing client-side media cannot be perfectly protected. | Not evaluated |
| Zoom integration | Evaluate central Sabeel Zoom source setup, token management, recording list permissions, and multi-host recording access. | Not evaluated |
| Zoom integration | Evaluate Zoom API access, recording download permissions, webhook/import options, and staff workflow constraints. | Not evaluated |
| Zoom integration | Evaluate listing Zoom cloud recordings, staff authorization model, recording download URLs, storage transfer, and whether recordings can be imported without manual file handling. | Not evaluated |

## De-risking order recommendation

1. Prove Zoom audio import from the central Sabeel source.
2. Prove audio playback across mobile and web, including background audio on mobile.
3. Prove progress tracking, completion, offline completion, and pending sync.
4. Prove protected storage and authorized playback/download behavior.
5. Prove scoped staff authorization with Admin and class-scoped Manager roles.
6. Prove Admin backend stats for storage usage, import/job failures, and notification errors.
7. Prove push notifications with student-controlled preferences.
