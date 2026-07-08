/**
 * Tests for no-adapter-in-tx ESLint rule
 */
const { RuleTester } = require('eslint');
const rule = require('./no-adapter-in-tx');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

ruleTester.run('no-adapter-in-tx', rule, {
  valid: [
    // The blessed pattern: only the tx handle inside the callback.
    {
      code: `
        class Store {
          async replace() {
            await this._adapter.transaction(['ops'], 'readwrite', async (tx) => {
              await tx.clear('ops');
              await tx.add('ops', { seq: 1 });
              const all = await tx.getAll('ops');
              return all.length;
            });
          }
        }
      `,
    },
    // Adapter methods OUTSIDE any transaction callback are the normal API.
    {
      code: `
        class Store {
          async load() {
            const entry = await this._adapter.get('ops', 1);
            await this._adapter.put('meta', entry, 'k');
          }
        }
      `,
    },
    // Adapter use after the transaction call completed — not inside the callback.
    {
      code: `
        class Store {
          async run() {
            await this._adapter.transaction(['ops'], 'readwrite', async (tx) => {
              await tx.add('ops', { seq: 1 });
            });
            await this._adapter.get('ops', 1);
          }
        }
      `,
    },
    // A DIFFERENT adapter identifier inside the callback is a different
    // connection (op-log-backend-migration.ts: source reads inside dest's tx
    // would be legal; only dest re-entry deadlocks).
    {
      code: `
        const migrate = async (source, dest) => {
          await dest.transaction(['ops'], 'readwrite', async (tx) => {
            const row = await source.get('ops', 1);
            await tx.put('ops', row, 1);
          });
        };
      `,
    },
    // `.transaction` on the native IDB handle inside the adapter impl itself
    // uses the returned tx object, not the adapter.
    {
      code: `
        class IdbAdapter {
          iterate(store) {
            const tx = this._database.transaction(store, 'readwrite');
            return tx.done;
          }
        }
      `,
    },
  ],
  invalid: [
    // The core footgun: awaiting an adapter method inside its own tx callback.
    {
      code: `
        class Store {
          async run() {
            await this._adapter.transaction(['ops'], 'readwrite', async (tx) => {
              await this._adapter.get('ops', 1);
            });
          }
        }
      `,
      errors: [{ messageId: 'noAdapterInTx' }],
    },
    // Rename-proof: ANY \`this.<field>\` receiver is matched against its own
    // transaction — the rule must not depend on the field being named _adapter.
    {
      code: `
        class Store {
          async run() {
            await this._opLogDb.transaction(['ops'], 'readwrite', async (tx) => {
              await this._opLogDb.get('ops', 1);
            });
          }
        }
      `,
      errors: [{ messageId: 'noAdapterInTx' }],
    },
    // Alternate field name `this.adapter`.
    {
      code: `
        class Store {
          async run() {
            await this.adapter.transaction(['ops'], 'readwrite', async (tx) => {
              await this.adapter.put('ops', {}, 1);
            });
          }
        }
      `,
      errors: [{ messageId: 'noAdapterInTx' }],
    },
    // Nested arrow function inside the callback still deadlocks.
    {
      code: `
        class Store {
          async run() {
            await this._adapter.transaction(['ops'], 'readwrite', async (tx) => {
              const helper = async () => this._adapter.count('ops');
              await helper();
            });
          }
        }
      `,
      errors: [{ messageId: 'noAdapterInTx' }],
    },
    // Nested (non-arrow) async function expression inside the callback.
    {
      code: `
        class Store {
          async run() {
            await this._adapter.transaction(['ops'], 'readwrite', async function (tx) {
              const helper = async function () {
                return this._adapter.getAll('ops');
              };
              await helper();
            });
          }
        }
      `,
      errors: [{ messageId: 'noAdapterInTx' }],
    },
    // Identifier receiver (migration style): re-entering `dest` inside
    // `dest.transaction` deadlocks.
    {
      code: `
        const migrate = async (source, dest) => {
          await dest.transaction(['ops'], 'readwrite', async (tx) => {
            await dest.put('ops', {}, 1);
          });
        };
      `,
      errors: [{ messageId: 'noAdapterInTx' }],
    },
    // Nested transaction on the same adapter is itself re-entry.
    {
      code: `
        class Store {
          async run() {
            await this._adapter.transaction(['ops'], 'readwrite', async (tx) => {
              await this._adapter.transaction(['meta'], 'readwrite', async (tx2) => {
                await tx2.put('meta', {}, 'k');
              });
            });
          }
        }
      `,
      errors: [{ messageId: 'noAdapterInTx' }],
    },
    // Two violations in one callback are each reported.
    {
      code: `
        class Store {
          async run() {
            await this._adapter.transaction(['ops'], 'readwrite', async (tx) => {
              await this._adapter.delete('ops', 1);
              await this._adapter.add('ops', { seq: 2 });
            });
          }
        }
      `,
      errors: [{ messageId: 'noAdapterInTx' }, { messageId: 'noAdapterInTx' }],
    },
  ],
});

// eslint-disable-next-line no-console
console.log('no-adapter-in-tx: all RuleTester cases passed');
