// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.tsbuildinfo',
      'coverage/**',
      'packages/server/scripts/**',
      // Operational launchd/runtime scripts (voice stack) — not library code, same
      // rationale as server/scripts above.
      'voice/**',
      'scripts/**',
      // Other sessions' git worktrees and Python venvs live inside the checkout — never lint
      // them from the primary working tree.
      '.claude/**',
      '**/.venv/**',
      '**/*.config.js',
      '**/*.config.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // `core` is the transport-agnostic brain: hold it to the strictest bar.
    files: ['packages/core/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  prettier,
);
