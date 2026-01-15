/**
 * Shared test state for sync.service.spec.ts
 *
 * Separated into its own file to avoid circular import issues with vitest mock hoisting.
 */

export const testState = {
  operations: new Map<string, any>(),
  syncDevices: new Map<string, any>(),
  userSyncStates: new Map<number, any>(),
  users: new Map<number, any>(),
  serverSeqCounter: 0,
};

export function resetTestState(): void {
  testState.operations = new Map();
  testState.syncDevices = new Map();
  testState.userSyncStates = new Map();
  testState.users = new Map();
  testState.serverSeqCounter = 0;
}
