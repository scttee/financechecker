import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      // `server-only` throws by design when imported outside a server bundle.
      // Under test we are importing the modules directly, so it is stubbed.
      {
        find: /^server-only$/,
        replacement: fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
  },
});
