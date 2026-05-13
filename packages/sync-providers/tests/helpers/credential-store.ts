/**
 * Shared test helpers for `SyncCredentialStorePort` mocks.
 *
 * Two flavours are exported:
 *
 * - `createStatefulCredentialStore(initial)` — keeps the config in a
 *   closure variable. `load()` returns the latest value, mutating methods
 *   update it. Use this when a provider/test needs the store to behave
 *   like a real one (e.g. setComplete followed by load).
 *
 *   By default each method is wrapped in `vi.fn`, so callers can still
 *   `expect(store.setComplete).toHaveBeenCalled(...)`. Pass
 *   `{ spy: false }` to get plain async functions (matches the older
 *   `webdav-base-provider` / `local-file-sync-base` shape).
 *
 * - `createMockCredentialStore()` — every method is a bare `vi.fn()` with
 *   no built-in state. Matches the spy-only `createCredentialStore`
 *   factory used in dropbox + provider-types specs.
 */
import { vi } from 'vitest';
import type { SyncCredentialStorePort } from '../../src/credential-store-port';

export interface StatefulCredentialStoreOptions {
  /** When `true` (default) every method is wrapped in `vi.fn`. */
  spy?: boolean;
}

export const createStatefulCredentialStore = <PID extends string, TPrivateCfg>(
  initial: TPrivateCfg | null,
  { spy = true }: StatefulCredentialStoreOptions = {},
): SyncCredentialStorePort<PID, TPrivateCfg> => {
  let state: TPrivateCfg | null = initial;

  const load = async (): Promise<TPrivateCfg | null> => state;
  const setComplete = async (cfg: TPrivateCfg): Promise<void> => {
    state = cfg;
  };
  const updatePartial = async (updates: Partial<TPrivateCfg>): Promise<void> => {
    state = { ...((state ?? {}) as TPrivateCfg), ...updates } as TPrivateCfg;
  };
  const upsertPartial = async (updates: Partial<TPrivateCfg>): Promise<void> => {
    state = { ...((state ?? {}) as TPrivateCfg), ...updates } as TPrivateCfg;
  };
  const clear = async (): Promise<void> => {
    state = null;
  };

  if (!spy) {
    return { load, setComplete, updatePartial, upsertPartial, clear };
  }

  return {
    load: vi.fn(load),
    setComplete: vi.fn(setComplete),
    updatePartial: vi.fn(updatePartial),
    upsertPartial: vi.fn(upsertPartial),
    clear: vi.fn(clear),
  };
};

export const createMockCredentialStore = <
  PID extends string,
  TPrivateCfg,
>(): SyncCredentialStorePort<PID, TPrivateCfg> => ({
  load: vi.fn(),
  setComplete: vi.fn(),
  updatePartial: vi.fn(),
  upsertPartial: vi.fn(),
  clear: vi.fn(),
});
