/**
 * Tests for require-frontier-report-on-ops-append ESLint rule (#9438)
 */
const { RuleTester } = require('eslint');
const rule = require('./require-frontier-report-on-ops-append');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

ruleTester.run('require-frontier-report-on-ops-append', rule, {
  valid: [
    // The blessed pattern: append inside the transaction callback, report
    // after the transaction commits — same method, different function scope.
    {
      code: `
        class Store {
          async append(op) {
            const seq = await this._adapter.transaction([STORE_NAMES.OPS], 'readwrite', async (tx) => {
              return tx.add(STORE_NAMES.OPS, this._buildStoredEntry(op));
            });
            this._tabSeqFrontier.observeOwnWrite(seq);
            return seq;
          }
        }
      `,
    },
    // Baseline installs report via establishFrontier instead.
    {
      code: `
        class Store {
          async commitBaseline(opts) {
            const result = await this._adapter.transaction([STORE_NAMES.OPS], 'readwrite', async (tx) => {
              const seq = await tx.add(STORE_NAMES.OPS, opts.entry);
              return { seq };
            });
            this._tabSeqFrontier.establishFrontier(result.seq);
          }
        }
      `,
    },
    // Batch shape: several adds, one report loop.
    {
      code: `
        class Store {
          async appendBatch(ops) {
            const seqs = await this._adapter.transaction([STORE_NAMES.OPS], 'readwrite', async (tx) => {
              const out = [];
              for (const op of ops) {
                out.push(await tx.add(STORE_NAMES.OPS, op));
              }
              return out;
            });
            for (const seq of seqs) {
              this._tabSeqFrontier.observeOwnWrite(seq);
            }
            return seqs;
          }
        }
      `,
    },
    // Adds to OTHER stores mint no OPS seqs and need no report.
    {
      code: `
        class Store {
          async saveMeta(entry) {
            await this._adapter.transaction([STORE_NAMES.META], 'readwrite', async (tx) => {
              await tx.add(STORE_NAMES.META, entry);
            });
          }
        }
      `,
    },
    // Dynamic store names are a documented gap, not a report target — a
    // generic backend copy loop rewrites EXISTING rows and must not be forced
    // to fake a frontier report.
    {
      code: `
        class Migration {
          async copyAll(tx, storeName, rows) {
            for (const row of rows) {
              await tx.add(storeName, row);
            }
          }
        }
      `,
    },
    // A report without any append is fine (hydrator, repair service).
    {
      code: `
        class Hydrator {
          finish(seq) {
            this.tabSeqFrontier.establishFrontier(seq);
          }
        }
      `,
    },
  ],

  invalid: [
    // The bug this rule exists for: a NEW append method that forgets to
    // report. Sticky divergence would silently disable snapshot saves and
    // compaction for the session.
    {
      code: `
        class Store {
          async appendFancy(op) {
            return this._adapter.transaction([STORE_NAMES.OPS], 'readwrite', async (tx) => {
              return tx.add(STORE_NAMES.OPS, op);
            });
          }
        }
      `,
      errors: [{ messageId: 'missingFrontierReport' }],
    },
    // A report in a DIFFERENT method must not satisfy this one.
    {
      code: `
        class Store {
          async wiredAppend(op) {
            const seq = await this._adapter.transaction([STORE_NAMES.OPS], 'readwrite', async (tx) => {
              return tx.add(STORE_NAMES.OPS, op);
            });
            this._tabSeqFrontier.observeOwnWrite(seq);
          }
          async unwiredAppend(op) {
            return this._adapter.transaction([STORE_NAMES.OPS], 'readwrite', async (tx) => {
              return tx.add(STORE_NAMES.OPS, op);
            });
          }
        }
      `,
      errors: [{ messageId: 'missingFrontierReport' }],
    },
    // Standalone functions are held to the same invariant.
    {
      code: `
        async function appendRaw(tx, op) {
          return tx.add(STORE_NAMES.OPS, op);
        }
      `,
      errors: [{ messageId: 'missingFrontierReport' }],
    },
  ],
});
