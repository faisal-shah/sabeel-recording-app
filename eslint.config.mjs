import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-web/**',
      '**/lib/**',
      '**/build/**',
      '**/coverage/**',
      '**/.expo/**',
      'app/android/**',
      '**/*.config.js',
      '**/*.config.mjs',
      '**/*.config.cjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['app/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    // Every color must come from a semantic theme token (src/theme), so a
    // hardcoded hex/rgb/hsl literal is a bug — it bypasses the Option-1 palette
    // and could not be re-themed in one place (the whole point of the token
    // layer). The only exemption is src/theme/** itself, which IS the palette.
    //
    // app/** not app/src/**: App.tsx lives at the app root, and in the sibling
    // time-tracker it hardcoded a header tint before this rule existed. Starting
    // the rule wide on day one is why this repo will not repeat that.
    files: ['app/**/*.{ts,tsx}'],
    ignores: ['app/src/theme/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]",
          message:
            'Hardcoded color. Use a semantic token from src/theme (e.g. t.bg.surface, t.text.muted).',
        },
        {
          selector: "Literal[value=/^(?:rgb|rgba|hsl|hsla)\\(/]",
          message: 'Hardcoded color. Use a semantic token from src/theme.',
        },
      ],
    },
  },
  {
    // Live Firestore subscriptions must go through useLiveQuery/useLiveDoc,
    // which reset state when inputs change and on errors. Hand-rolled onSnapshot
    // state showed one week's entries under another on slow connections in the
    // sibling time-tracker, and stayed invisible for a week
    // (its docs/POSTMORTEM-2026-07-16-stale-week.md). liveQuery.ts is the choke
    // point and is therefore the only exemption.
    files: ['app/src/**/*.{ts,tsx}'],
    ignores: ['app/src/liveQuery.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'firebase/firestore',
              importNames: ['onSnapshot'],
              message:
                'Subscribe via useLiveQuery/useLiveDoc (src/liveQuery.ts) — they reset on input change and clear on error.',
            },
          ],
        },
      ],
    },
  },
);
