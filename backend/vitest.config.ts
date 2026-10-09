import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    reporters: ['default'],
    // Tests deliberately exercise error paths; keep their expected 4xx/404
    // logging out of the way so real failures are visible.
    env: { LOG_LEVEL: 'error', NODE_ENV: 'test' },
  },
});
