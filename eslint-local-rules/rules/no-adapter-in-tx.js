/**
 * ESLint rule: no-adapter-in-tx
 *
 * Code inside an `adapter.transaction(async (tx) => { ... })` callback MUST use
 * only the `tx` handle. An adapter method (`this._adapter.get(...)` instead of
 * `tx.get(...)`) runs in its own implicit transaction, so its read/write is not
 * atomic with the enclosing one, and awaiting it can let the IndexedDB
 * transaction auto-commit early. The now-removed SQLite backend serialized
 * entry points through a FIFO queue, where the same call deadlocked all op-log
 * persistence (see docs/sync-and-op-log/sqlite-migration.md). A runtime guard
 * cannot tell a legal concurrent call from an illegal re-entrant one, so
 * enforcement lives here.
 *
 * Heuristic (deliberately simple, low-false-positive):
 * - Inside any function passed as an argument to a `.transaction(...)` call
 *   (nested functions included), flag member access on the SAME receiver the
 *   transaction was opened on — both plain identifiers (`dest.put(...)` inside
 *   `dest.transaction(...)`) and `this.<field>`
 *   receivers (`this.<anyField>.get(...)` inside
 *   `this.<anyField>.transaction(...)`), so the rule survives field renames.
 *   Access to a DIFFERENT receiver (e.g. `source.get(...)` inside
 *   `dest.transaction`) stays legal — that is a different connection.
 * - Additionally flag `this._adapter` / `this.adapter` (the conventional shared
 *   adapter fields in this dir) inside ANY tx callback, since a second adapter
 *   instance over the same connection also runs outside the transaction.
 *
 * Known gaps (accepted — heuristic, not proof): a callback EXTRACTED to a named
 * function/method and passed by reference is not analyzed; aliasing
 * (`const a = this._adapter`) and adapter access hidden behind a method call
 * inside the callback are invisible; identifier matching is name-based, not
 * scope-aware.
 *
 * Scoped to src/app/op-log/** via eslint.config.js.
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Inside a .transaction() callback use only the tx handle; adapter methods run outside the transaction',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      noAdapterInTx:
        'Do not call adapter methods inside a `.transaction()` callback — use the `tx` handle. Adapter methods run in their own transaction, so the write is not atomic with this one.',
    },
    schema: [],
  },

  create(context) {
    // One entry per enclosing `.transaction(...)` callback we are lexically
    // inside; holds the receiver identifier name (or null for `this.*`-based
    // receivers, which the this-check below covers).
    const txCallbackStack = [];

    const isThisAdapterAccess = (node) =>
      node.type === 'MemberExpression' &&
      !node.computed &&
      node.object.type === 'ThisExpression' &&
      (node.property.name === '_adapter' || node.property.name === 'adapter');

    const isTransactionCallbackArg = (fnNode) => {
      const parent = fnNode.parent;
      return (
        parent &&
        parent.type === 'CallExpression' &&
        parent.arguments.includes(fnNode) &&
        parent.callee.type === 'MemberExpression' &&
        !parent.callee.computed &&
        parent.callee.property.name === 'transaction'
      );
    };

    // Stable key for a transaction receiver: `id:<name>` for plain identifiers
    // (`dest.transaction(...)`), `this:<prop>` for `this.<prop>.transaction(...)`
    // — so the rule stays correct if the adapter field is ever renamed.
    const receiverKeyOf = (node) => {
      if (node.type === 'Identifier') return `id:${node.name}`;
      if (
        node.type === 'MemberExpression' &&
        !node.computed &&
        node.object.type === 'ThisExpression'
      ) {
        return `this:${node.property.name}`;
      }
      return null;
    };

    const enterFunction = (node) => {
      if (!isTransactionCallbackArg(node)) return;
      txCallbackStack.push({
        fnNode: node,
        receiverKey: receiverKeyOf(node.parent.callee.object),
      });
    };

    const exitFunction = (node) => {
      const top = txCallbackStack[txCallbackStack.length - 1];
      if (top && top.fnNode === node) {
        txCallbackStack.pop();
      }
    };

    return {
      FunctionExpression: enterFunction,
      'FunctionExpression:exit': exitFunction,
      ArrowFunctionExpression: enterFunction,
      'ArrowFunctionExpression:exit': exitFunction,

      MemberExpression(node) {
        if (txCallbackStack.length === 0) return;
        // `this._adapter.<x>` / `this.adapter.<x>` — the conventional shared
        // adapter fields in this dir; flagged inside ANY tx callback because a
        // second adapter instance still shares the per-connection queue.
        if (isThisAdapterAccess(node.object)) {
          context.report({ node, messageId: 'noAdapterInTx' });
          return;
        }
        // `<recv>.<x>` where <recv> is the SAME receiver the enclosing
        // `.transaction(...)` was called on — rename-proof: covers `dest.put()`
        // inside `dest.transaction(...)` AND `this.<anyField>.get()` inside
        // `this.<anyField>.transaction(...)`. Access to a DIFFERENT receiver
        // (e.g. `source.get()` inside `dest`'s transaction) stays legal — that
        // is a different connection.
        const key = receiverKeyOf(node.object);
        if (key !== null && txCallbackStack.some((ctx) => ctx.receiverKey === key)) {
          context.report({ node, messageId: 'noAdapterInTx' });
        }
      },
    };
  },
};
