import { registerRootComponent } from 'expo';
import { initSentry } from './src/sentry';
import App from './App';

// Before the app renders, so an error during startup is still captured. The seam
// resolves per platform and is a no-op in dev bundles and when no DSN is set.
initSentry();

registerRootComponent(App);
