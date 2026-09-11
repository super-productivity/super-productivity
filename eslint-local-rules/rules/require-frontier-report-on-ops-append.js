/**
 * ESLint rule: require-frontier-report-on-ops-append
 *
 * Every method that appends rows to the shared OPS store
 * (`tx.add(STORE_NAMES.OPS, ...)`) MUST report the committed seqs to
 * `TabSeqFrontierService` in the SAME method — `observeOwnWrite` for plain
 * appends, `establishFrontier` when the method also installs the state-cache
 * baseline the live store will match (#9438).
 *
 * Why lint and not a runtime guard: the two possible wiring gaps fail
 * asymmetrically, and the dangerous one is silent. A missed
 * `establishFrontier` merely leaves the tracker default-open ("no new
 * protection"); a missed `observeOwnWrite` makes the tab's NEXT observed own
 * write look like a foreign seq gap → sticky divergence → snapshot saves AND
 * compaction silently disabled for the rest of the session, on ALL platforms
 * including single-instance Electron. Nothing crashes and no data is lost
 * immediately, so no bug report ever points here — see the wiring-invariant
 * note in TabSeqFrontierService and the #9438 comment block in
 * OperationLogStoreService.
 *
 * Heuristic (deliberately simple, low-false-positive):
 * - An "append site" is a call `<recv>.add(STORE_NAMES.OPS, ...)` — the
 *   literal member expression only, matching every real site in
 *   operation-log-store.service.ts.
 * - The report may appear anywhere in the enclosing class method (append
 *   sites live inside `.transaction()` callbacks while the report call runs
 *   after the transaction commits, so the search scope is the method, not the
 *   nearest function).
 *
 * Known gaps (accepted — heuristic, not proof): an append hidden behind a
 * dynamic store name (`tx.add(storeName, ...)` in a generic copy loop) is
 * invisible, as is a report delegated to a helper the method calls. Keep the
 * report call lexically next to its append — that is also what the store
 * wiring-lock spec (multi-tab-frontier-guard.integration.spec.ts) pins
 * behaviorally for the known methods; this rule exists so a NEW append
 * method cannot ship unwired.
 *
 * Scoped to src/app/op-log/** (excluding specs) via eslint.config.js.
 */
const REPORT_METHOD_NAMES = new Set(['observeOwnWrite', 'establishFrontier']);

const isOpsAddCall = (node) =>
  node.type === 'CallExpression' &&
  node.callee.type === 'MemberExpression' &&
  !node.callee.computed &&
  node.callee.property.name === 'add' &&
  node.arguments.length > 0 &&
  node.arguments[0].type === 'MemberExpression' &&
  !node.arguments[0].computed &&
  node.arguments[0].object.type === 'Identifier' &&
  node.arguments[0].object.name === 'STORE_NAMES' &&
  node.arguments[0].property.name === 'OPS';

const isFrontierReportCall = (node) =>
  node.type === 'CallExpression' &&
  node.callee.type === 'MemberExpression' &&
  !node.callee.computed &&
  REPORT_METHOD_NAMES.has(node.callee.property.name);

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'A method appending rows to STORE_NAMES.OPS must report the committed seqs to TabSeqFrontierService (observeOwnWrite / establishFrontier) in the same method (#9438)',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      missingFrontierReport:
        'This method appends to STORE_NAMES.OPS but never reports the committed seqs to TabSeqFrontierService. A missed observeOwnWrite makes the next own write look like a foreign seq gap and silently disables snapshot saves AND compaction for the whole session (#9438). Call observeOwnWrite(seq) after the transaction commits — or establishFrontier(seq) if this method installs a state-cache baseline.',
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.sourceCode;
    /** Append-site call nodes, resolved to their enclosing method on exit. */
    const opsAddCalls = [];
    /** Enclosing-method nodes (or Program) that contain a report call. */
    const scopesWithReport = new Set();

    // The report call runs after the transaction callback returns, so the
    // relevant scope is the enclosing class method (or standalone function /
    // Program for non-class code), NOT the nearest function expression.
    const enclosingMethodScope = (node) => {
      const ancestors = sourceCode.getAncestors(node);
      for (let i = ancestors.length - 1; i >= 0; i--) {
        const a = ancestors[i];
        if (a.type === 'MethodDefinition' || a.type === 'FunctionDeclaration') {
          return a;
        }
      }
      return ancestors[0] ?? node; // Program
    };

    return {
      CallExpression(node) {
        if (isOpsAddCall(node)) {
          opsAddCalls.push(node);
        } else if (isFrontierReportCall(node)) {
          scopesWithReport.add(enclosingMethodScope(node));
        }
      },
      'Program:exit'() {
        for (const addCall of opsAddCalls) {
          if (!scopesWithReport.has(enclosingMethodScope(addCall))) {
            context.report({ node: addCall, messageId: 'missingFrontierReport' });
          }
        }
      },
    };
  },
};
