// Bundles the Cloud Functions into a single lib/index.js.
//
// Why we bundle: `@sabeel/shared` is a private workspace package that is never
// published to npm, and `firebase deploy` ships ONLY the functions/ directory to
// Cloud Build. Any reference to `@sabeel/shared` in the deployed package.json makes
// Cloud Build's `npm install` 404. So we inline `@sabeel/shared` (and any other
// @sabeel/* workspace package) into the bundle and keep every real npm dependency
// external — those are installed from the registry by the buildpack as usual.
import { build } from 'esbuild';

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
          if (args.path.startsWith('@sabeel/')) return null;
          return { path: args.path, external: true };
        });
      },
    },
  ],
});
