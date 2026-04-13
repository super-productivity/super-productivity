import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // No setupFiles — integration tests use a real database, not mocked Prisma
    include: ['tests/integration/**/*.integration.spec.ts'],
  },
});
