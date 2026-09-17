// Bundles the Cloud Functions into a single lib/index.js.
//
// Why we bundle: `@sabeel/shared` is a private workspace package that is never
// published to npm, and `firebase deploy` ships ONLY the functions/ directory to
// Cloud Build. Any reference to `@sabeel/shared` in the deployed package.json makes
// Cloud Build's `npm install` 404. So we inline `@sabeel/shared` (and any other
// @sabeel/* workspace package) into the bundle and keep every real npm dependency
// external — those are installed from the registry by the buildpack as usual.
//
// Inlined FROM SOURCE, not from the package's compiled `lib/`: the shared
// package also holds app-only code (the .xlsx writer) with its own npm
// dependency, and only ESM input can be tree-shaken. Bundling the CommonJS
// `lib/` kept a `require("fflate")` the functions never call, Cloud Build did
// not install it, and every container failed its start-up probe (v0.7.0's
// first deploy). `bundleExternals.test.ts` holds the bundle's bare requires
// to the dependencies this package.json declares.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
/** `@sabeel/<pkg>` → that workspace's `src/index.ts`. */
const workspaceSource = (specifier) =>
  join(dirname(require.resolve(`${specifier}/package.json`)), 'src', 'index.ts');

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
  plugins: [
    {
      name: 'externalize-npm-deps',
      setup(b) {
        // Bare specifiers (not starting with "." or "/"). Bundle @sabeel/*
        // workspace packages; leave everything else (npm deps, node builtins)
        // external so it's required from node_modules at runtime.
        b.onResolve({ filter: /^[^./]/ }, (args) => {
          if (args.path.startsWith('@sabeel/')) return { path: workspaceSource(args.path) };
          return { path: args.path, external: true };
        });
      },
    },
  ],
});
