import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromRoot = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // Quiet vite's logger: inlining the MCP SDK surfaces benign "sourcemap points to
  // missing source files" warnings (it ships maps referencing unshipped .ts sources).
  logLevel: 'error',
  // Resolve cross-package imports to source so tests run without a build step.
  resolve: {
    alias: {
      // More specific entry first: vite matches aliases by prefix.
      '@tars/core/testing': fromRoot('./packages/core/src/test-helpers/index.ts'),
      '@tars/core': fromRoot('./packages/core/src/index.ts'),
      '@tars/mcp': fromRoot('./packages/mcp/src/index.ts'),
      '@tars/server': fromRoot('./packages/server/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
    // Integration tests share one Postgres test database; run files serially so they
    // don't clobber each other's data between resets.
    fileParallelism: false,
    // Ensures the test database exists and is migrated before any test runs.
    globalSetup: ['./packages/core/src/test-helpers/global-setup.ts'],
    server: {
      deps: {
        // The project path contains a space; vite-node fails to native-import
        // externalized deps via the URL-encoded (%20) path. Inlining ALL deps routes
        // them through vite's own resolver instead, which handles the space correctly.
        inline: true,
      },
    },
  },
});
