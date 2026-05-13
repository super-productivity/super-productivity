/**
 * Shared test helpers for SyncLogger mocks.
 *
 * - `NOOP_TEST_LOGGER` re-exports the no-op logger from `@sp/sync-core` so
 *   specs that just need *some* logger don't have to import it directly.
 * - `createMockSyncLogger()` returns a logger whose methods are individually
 *   spy-able `vi.fn()`s — use this when a test needs to assert on log calls.
 */
import { vi } from 'vitest';
import { NOOP_SYNC_LOGGER, type SyncLogger } from '@sp/sync-core';

export const NOOP_TEST_LOGGER: SyncLogger = NOOP_SYNC_LOGGER;

export const createMockSyncLogger = (): SyncLogger => ({
  log: vi.fn(),
  error: vi.fn(),
  err: vi.fn(),
  normal: vi.fn(),
  verbose: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  critical: vi.fn(),
  debug: vi.fn(),
});
