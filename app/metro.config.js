// Metro configured for the npm-workspaces monorepo: watch the repo root and
// resolve modules from both the app and the hoisted root node_modules.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

/**
 * Keep the transform cache INSIDE this repo.
 *
 * Expo's default is `os.tmpdir()/metro-cache` — one directory shared by every
 * Expo project on the machine. That would be merely wasteful, except that
 * `--clear` does not clear *this project's* entries: Expo's FileStore sees a
 * root inside `os.tmpdir()` and `renameSync`s THE WHOLE DIRECTORY away
 * (`@expo/metro-config/build/file-store.js`). Every e2e entry point here passes
 * `--clear`, and each one is load-bearing, because `EXPO_PUBLIC_*` is inlined at
 * bundle time and a stale cache serves a bundle built under different env. So
 * the sibling checkouts were taking turns deleting each other's warm cache.
 *
 * Set as a FUNCTION, not an array: Metro calls it with the `metro-cache` module
 * (`metro-config/src/loadConfig.js`, `mergeConfigObjects`), so this file does
 * not have to `require("metro-cache")` — a dependency whose version is pinned
 * transitively by `@expo/metro` and would drift from it.
 */
config.cacheStores = ({ FileStore }) => [
  new FileStore({ root: path.resolve(projectRoot, '.metro-cache') }),
];

module.exports = config;
