// Vitest global setup for functions tests. Integration tests expect the Firebase
// emulators (see scripts/test-emulator.sh); unit tests run standalone.
import { EMULATOR_PROJECT_ID } from '@sabeel/shared';

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT ?? EMULATOR_PROJECT_ID;
