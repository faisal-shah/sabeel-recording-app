import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the app's PURE logic — helpers and seams, not components.
 *
 * Node environment and `.ts` only, deliberately: anything importing
 * `react-native` needs a transform this does not set up, and the component
 * surface is covered by the Playwright suites. Keep that boundary — if a test
 * here needs a renderer, it belongs in an e2e suite instead.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
