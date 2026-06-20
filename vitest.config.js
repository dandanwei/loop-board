import { defineConfig } from 'vitest/config';

// Unit tests: DB layer + API routes, exercised in-process.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/*.test.js'],
    globals: true,
  },
});
