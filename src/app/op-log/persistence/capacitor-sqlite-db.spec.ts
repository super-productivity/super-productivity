import { CapacitorSqliteDb } from './capacitor-sqlite-db';

interface PluginHarness {
  readonly loadPlugin: () => Promise<{
    CapacitorSQLite: never;
    SQLiteConnection: never;
  }>;
  readonly closeConnection: jasmine.Spy;
  readonly connectionCreations: () => number;
}

const createPluginHarness = (closeRejects = false): PluginHarness => {
  let targetQueryCalls = 0;
  let creations = 0;
  const closeConnection = jasmine.createSpy('closeConnection');
  if (closeRejects) {
    closeConnection.and.rejectWith(new Error('close failed'));
  } else {
    closeConnection.and.resolveTo(undefined);
  }

  const connection = {
    isDBOpen: () => Promise.resolve({ result: true }),
    open: () => Promise.resolve(),
    execute: () => Promise.resolve({ changes: { changes: 0 } }),
    query: (sql: string) => {
      if (sql.startsWith('PRAGMA')) {
        return Promise.resolve({ values: [{}] });
      }
      targetQueryCalls++;
      return targetQueryCalls === 1
        ? new Promise<never>(() => undefined)
        : Promise.resolve({ values: [] });
    },
  };
  const manager = {
    checkConnectionsConsistency: () => Promise.resolve({ result: true }),
    isConnection: () => Promise.resolve({ result: false }),
    createConnection: () => {
      creations++;
      return Promise.resolve(connection);
    },
    closeConnection,
    isDatabase: () => Promise.resolve({ result: false }),
  };

  const SQLiteConnection = class {
    constructor() {
      return manager;
    }
  };
  return {
    loadPlugin: () =>
      Promise.resolve({
        CapacitorSQLite: {} as never,
        SQLiteConnection: SQLiteConnection as never,
      }),
    closeConnection,
    connectionCreations: () => creations,
  };
};

describe('CapacitorSqliteDb timeout recovery', () => {
  it('closes a connection before allowing work after a statement timeout', async () => {
    const harness = createPluginHarness();
    const db = new CapacitorSqliteDb('TEST', 100, 5, harness.loadPlugin);

    await expectAsync(db.query('SELECT hangs')).toBeRejectedWith(
      jasmine.objectContaining({ name: 'TimeoutError' }),
    );
    expect(harness.closeConnection).toHaveBeenCalled();

    await expectAsync(db.query('SELECT recovers')).toBeResolvedTo([]);
    expect(harness.connectionCreations()).toBe(2);
  });

  it('quarantines the handle when a timed-out connection cannot be closed', async () => {
    const harness = createPluginHarness(true);
    const db = new CapacitorSqliteDb('TEST', 20, 5, harness.loadPlugin);

    await expectAsync(db.query('SELECT hangs')).toBeRejectedWith(
      jasmine.objectContaining({ name: 'TimeoutError' }),
    );
    expect(await db.databaseExists()).toBeTrue();
    await expectAsync(db.query('SELECT must not reopen')).toBeRejectedWith(
      jasmine.objectContaining({ name: 'InvalidStateError' }),
    );
    expect(harness.connectionCreations()).toBe(1);
  });
});
