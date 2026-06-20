import { defineConfig } from 'vitest/config';

// E2E tests: full workflows against a real listening server.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['e2e/*.test.js'],
    globals: true,
    // E2E spins up a real HTTP server and walks multi-step flows; give it room.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
