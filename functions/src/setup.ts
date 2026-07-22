import { setGlobalOptions } from 'firebase-functions/v2';
import { REGION } from '@sabeel/shared';

// Imported for its side effect before any function is defined.
//
// `invoker: 'public'` makes every callable reachable at the Cloud Run layer —
// auth is still enforced in-code by the require* helpers. Without it, gen-2
// callables 403 *before the code runs*, which reads as a broken function rather
// than a missing IAM grant and needs a manual console fix.
setGlobalOptions({ region: REGION, maxInstances: 10, invoker: 'public' });
