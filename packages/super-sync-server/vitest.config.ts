import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Integration test that requires real PostgreSQL (run with vitest.integration.config.ts)
      'tests/integration/registration-races.integration.spec.ts',
      'tests/integration/concurrent-upload-seq.integration.spec.ts',
      'tests/integration/clean-slate-atomicity-sql.integration.spec.ts',
      'tests/integration/snapshot-vector-clock-sql.integration.spec.ts',
      'tests/integration/conflict-detection-sql.integration.spec.ts',
      'tests/integration/batch-conflict-plan.integration.spec.ts',
      'tests/integration/repair-causality.integration.spec.ts',
      'tests/integration/health-alert-db-probe.integration.spec.ts',
      'tests/integration/migrate-deploy-db-timeout.integration.spec.ts',
      'tests/integration/migrate-deploy-lock-retry.integration.spec.ts',
      'tests/integration/migrate-deploy-orphan-cleanup.integration.spec.ts',
      'tests/integration/capture-claim-race.integration.spec.ts',
      'tests/integration/connect-claim-race.integration.spec.ts',
    ],
  },
});
