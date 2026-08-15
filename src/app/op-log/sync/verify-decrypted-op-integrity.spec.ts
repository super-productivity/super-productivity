import {
  assertDecryptedFullStateOpIntegrity,
  assertDecryptedOpMetadataIntegrity,
} from './verify-decrypted-op-integrity';
import { SyncOperation } from '../sync-providers/provider.interface';
import { OperationIntegrityError } from '../core/errors/sync-errors';
import { ActionType } from '../core/action-types.enum';
import { toLwwUpdateActionType } from '../core/lww-update-action-types';
import { SINGLETON_ENTITY_ID } from '../core/entity-registry';
import { OpType } from '../core/operation.types';
import frozen from '../validation/test-fixtures/frozen-state-v18.15.json';

describe('assertDecryptedOpMetadataIntegrity', () => {
  const LWW_TASK = toLwwUpdateActionType('TASK');
  const LWW_TIME_TRACKING = toLwwUpdateActionType('TIME_TRACKING');

  const createOp = (over: Partial<SyncOperation>): SyncOperation => ({
    id: 'op-1',
    clientId: 'clientA',
    actionType: LWW_TASK,
    opType: 'UPDATE',
    entityType: 'TASK',
    entityId: 'task-123',
    payload: null,
    vectorClock: { clientA: 1 },
    timestamp: 1,
    schemaVersion: 1,
    ...over,
  });

  describe('rejects tampering (fail closed)', () => {
    it('throws when a LWW-update entityId does not match the authenticated payload.id', () => {
      // Attacker retagged op.entityId from the real target (task-123) to task-999.
      const op = createOp({ entityId: 'task-999' });
      const authenticatedPayload = { id: 'task-123', changes: { title: 'x' } };

      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, authenticatedPayload),
      ).toThrowError(OperationIntegrityError);
    });

    it('detects tampering for a multi-entity-wrapped LWW payload (actionPayload.id)', () => {
      const op = createOp({ entityId: 'task-999' });
      // Multi-entity payload shape: the real id lives under actionPayload.
      const authenticatedPayload = {
        actionPayload: { id: 'task-123', changes: { title: 'x' } },
        entityChanges: [{ entityType: 'TASK', entityId: 'task-123', opType: 'UPDATE' }],
      };

      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, authenticatedPayload),
      ).toThrowError(OperationIntegrityError);
    });

    it('fails closed when an in-scope LWW payload carries no string id', () => {
      // convertOpToAction would coerce id = op.entityId (the tampered value)
      // when payload.id is absent, so a missing id must be rejected too, not
      // skipped. (Codex/correctness finding on the interim fix.)
      const op = createOp({ entityId: 'task-999' });
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, { changes: { title: 'x' } }),
      ).toThrowError(OperationIntegrityError);
    });

    it('fails closed for a non-object payload on an in-scope LWW op', () => {
      const op = createOp({ entityId: 'task-123' });
      expect(() => assertDecryptedOpMetadataIntegrity(op, null)).toThrowError(
        OperationIntegrityError,
      );
      expect(() => assertDecryptedOpMetadataIntegrity(op, 'a string')).toThrowError(
        OperationIntegrityError,
      );
    });

    it('throws for an array-entity LWW op whose entityId was retargeted (#9526 lockstep)', () => {
      // Since the reducer applies array LWW updates by payload identity,
      // array entities are retargetable and must be in scope of the gate.
      const op = createOp({
        actionType: toLwwUpdateActionType('PLUGIN_USER_DATA'),
        entityType: 'PLUGIN_USER_DATA',
        entityId: 'victim-plugin',
      });
      const authenticatedPayload = {
        actionPayload: { id: 'real-plugin', data: '{}' },
        entityChanges: [],
        lwwUpdateMode: 'replace',
      };

      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, authenticatedPayload),
      ).toThrowError(OperationIntegrityError);
    });
  });

  describe('accepts legitimate ops (no false positives)', () => {
    it('passes when payload.id matches op.entityId', () => {
      const op = createOp({ entityId: 'task-123' });
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, { id: 'task-123', changes: {} }),
      ).not.toThrow();
    });

    it('ignores non-LWW action types (e.g. plain updates)', () => {
      const op = createOp({ actionType: 'UPDATE_TASK', entityId: 'task-999' });
      // Even a mismatch is out of scope: convertOpToAction won't LWW-coerce it.
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, { id: 'task-123' }),
      ).not.toThrow();
    });

    it('ignores singleton LWW targets even when their conflict id is composite', () => {
      const op = createOp({
        actionType: LWW_TIME_TRACKING,
        entityType: 'TIME_TRACKING',
        entityId: 'PROJECT:project-1:2026-03-24',
      });
      expect(() => assertDecryptedOpMetadataIntegrity(op, { foo: 'bar' })).not.toThrow();
    });

    it('does not throw when entityId is missing (out of scope)', () => {
      const op = createOp({ entityId: undefined });
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, { id: 'task-123' }),
      ).not.toThrow();
    });

    it('passes a genuine array-entity LWW op (payload.id matches entityId)', () => {
      const op = createOp({
        actionType: toLwwUpdateActionType('PLUGIN_USER_DATA'),
        entityType: 'PLUGIN_USER_DATA',
        entityId: 'sync-md',
      });
      const authenticatedPayload = {
        actionPayload: { id: 'sync-md', data: '{}' },
        entityChanges: [],
        lwwUpdateMode: 'replace',
      };

      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, authenticatedPayload),
      ).not.toThrow();
    });
  });

  describe('rejects project-move footprint tampering (fail closed)', () => {
    it('throws when op.entityIds injects a victim id absent from the authenticated footprint', () => {
      // Valid encrypted move of task-123 (+ subtask sub-1). A compromised server
      // appended victim-task to the plaintext envelope so the LWW project-repair
      // reducer would drag it out of its project too. GHSA-8pxh-mgc7-gp3g.
      const op = createOp({
        entityId: 'task-123',
        entityIds: ['task-123', 'sub-1', 'victim-task'],
      });
      const authenticatedPayload = {
        id: 'task-123',
        projectMoveSubTaskIds: ['sub-1'],
        changes: { projectId: 'project-2' },
      };
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, authenticatedPayload),
      ).toThrowError(OperationIntegrityError);
    });

    it('throws for the multi-entity-wrapped move payload too', () => {
      const op = createOp({
        entityId: 'task-123',
        entityIds: ['task-123', 'victim-task'],
      });
      const authenticatedPayload = {
        actionPayload: { id: 'task-123', projectMoveSubTaskIds: [] },
        entityChanges: [],
      };
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, authenticatedPayload),
      ).toThrowError(OperationIntegrityError);
    });

    it('throws when a non-string id is injected into op.entityIds', () => {
      const op = createOp({
        entityId: 'task-123',
        entityIds: ['task-123', 42 as unknown as string],
      });
      const authenticatedPayload = {
        id: 'task-123',
        projectMoveSubTaskIds: ['sub-1'],
      };
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, authenticatedPayload),
      ).toThrowError(OperationIntegrityError);
    });
  });

  describe('accepts legitimate project moves (no false positives)', () => {
    it('passes when op.entityIds exactly equals {entityId} ∪ projectMoveSubTaskIds (flat)', () => {
      const op = createOp({
        entityId: 'task-123',
        entityIds: ['task-123', 'sub-1', 'sub-2'],
      });
      const authenticatedPayload = {
        id: 'task-123',
        projectMoveSubTaskIds: ['sub-1', 'sub-2'],
        changes: { projectId: 'project-2' },
      };
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, authenticatedPayload),
      ).not.toThrow();
    });

    it('passes for the multi-entity-wrapped move payload', () => {
      const op = createOp({
        entityId: 'task-123',
        entityIds: ['task-123', 'sub-1'],
      });
      const authenticatedPayload = {
        actionPayload: { id: 'task-123', projectMoveSubTaskIds: ['sub-1'] },
        entityChanges: [],
      };
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, authenticatedPayload),
      ).not.toThrow();
    });

    it('ignores ordering differences (set, not sequence, equality)', () => {
      const op = createOp({
        entityId: 'task-123',
        entityIds: ['sub-1', 'task-123'],
      });
      const authenticatedPayload = {
        id: 'task-123',
        projectMoveSubTaskIds: ['sub-1'],
      };
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, authenticatedPayload),
      ).not.toThrow();
    });

    it('does not validate entityIds when the payload carries no authenticated footprint (synthetic LWW op)', () => {
      // Synthetic conflict-resolution ops carry entityIds in the envelope only;
      // there is no projectMoveSubTaskIds to bind against, so they must pass
      // untouched (validating them would reject valid ops and break sync).
      const op = createOp({
        entityId: 'task-123',
        entityIds: ['task-123', 'sub-1', 'anything'],
      });
      const authenticatedPayload = { id: 'task-123', changes: {} };
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, authenticatedPayload),
      ).not.toThrow();
    });

    it('does not validate footprint when op.entityIds is absent', () => {
      const op = createOp({ entityId: 'task-123', entityIds: undefined });
      const authenticatedPayload = {
        id: 'task-123',
        projectMoveSubTaskIds: ['sub-1'],
      };
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, authenticatedPayload),
      ).not.toThrow();
    });
  });

  describe('Today-list bulk footprint binding (#9426, GHSA-8pxh)', () => {
    const planOp = (over: Partial<SyncOperation>): SyncOperation =>
      createOp({
        actionType: ActionType.TASK_SHARED_PLAN_FOR_TODAY,
        entityId: 'task-1',
        entityIds: ['task-1', 'task-2'],
        ...over,
      });
    const planPayload = (taskIds: unknown): unknown => ({
      actionPayload: { taskIds, today: '2026-07-30' },
      entityChanges: [],
    });

    it('throws when op.entityIds injects a victim id absent from the authenticated taskIds', () => {
      const op = planOp({ entityIds: ['task-1', 'task-2', 'victim-task'] });
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, planPayload(['task-1', 'task-2'])),
      ).toThrowError(OperationIntegrityError);
    });

    it('throws when the envelope is stripped to look single-entity (undercount)', () => {
      const op = planOp({ entityIds: undefined });
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, planPayload(['task-1', 'task-2'])),
      ).toThrowError(OperationIntegrityError);
    });

    it('throws for a bulk unplan whose envelope diverges from the authenticated taskIds', () => {
      const op = planOp({
        actionType: ActionType.TASK_SHARED_REMOVE_FROM_TODAY,
        entityIds: ['task-1', 'other-task'],
      });
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, planPayload(['task-1', 'task-2'])),
      ).toThrowError(OperationIntegrityError);
    });

    it('throws for a Today drag whose envelope diverges from the authenticated pair', () => {
      const op = planOp({
        actionType: ActionType.TASK_SHARED_MOVE_IN_TODAY,
        entityIds: ['task-1', 'victim-task'],
      });
      const payload = {
        actionPayload: { toTaskId: 'task-1', fromTaskId: 'task-2' },
        entityChanges: [],
      };
      expect(() => assertDecryptedOpMetadataIntegrity(op, payload)).toThrowError(
        OperationIntegrityError,
      );
    });

    it('passes genuine bulk ops for all four action types', () => {
      expect(() =>
        assertDecryptedOpMetadataIntegrity(planOp({}), planPayload(['task-1', 'task-2'])),
      ).not.toThrow();
      expect(() =>
        assertDecryptedOpMetadataIntegrity(
          planOp({ actionType: ActionType.TASK_SHARED_PLAN_DEADLINE_FOR_TODAY }),
          planPayload(['task-1', 'task-2']),
        ),
      ).not.toThrow();
      expect(() =>
        assertDecryptedOpMetadataIntegrity(
          planOp({ actionType: ActionType.TASK_SHARED_REMOVE_FROM_TODAY }),
          planPayload(['task-1', 'task-2']),
        ),
      ).not.toThrow();
      expect(() =>
        assertDecryptedOpMetadataIntegrity(
          planOp({ actionType: ActionType.TASK_SHARED_MOVE_IN_TODAY }),
          {
            actionPayload: { toTaskId: 'task-1', fromTaskId: 'task-2' },
            entityChanges: [],
          },
        ),
      ).not.toThrow();
    });

    it('passes a genuine single-task plan op (entityIds = [id])', () => {
      const op = planOp({ entityIds: ['task-1'] });
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, planPayload(['task-1'])),
      ).not.toThrow();
    });

    it('leaves ops without an authenticated footprint shape untouched (interim tolerance)', () => {
      const op = planOp({ entityIds: ['task-1', 'anything'] });
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, {
          actionPayload: { someOtherShape: true },
          entityChanges: [],
        }),
      ).not.toThrow();
    });

    it('ignores out-of-scope actions that also carry taskIds (e.g. round-time)', () => {
      const op = planOp({
        actionType: ActionType.TASK_ROUND_TIME_SPENT,
        entityIds: ['task-1', 'mismatched-task'],
      });
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, planPayload(['task-1', 'task-2'])),
      ).not.toThrow();
    });
  });
});

describe('assertDecryptedFullStateOpIntegrity', () => {
  // This gate defends the encrypted-download path against an opType-promotion
  // attack: a compromised server relabels a single-entity op as SYNC_IMPORT so its
  // decrypted payload is applied as a full-state replacement. It must reject that,
  // but must NOT reject a legitimate snapshot that merely predates a field a later
  // version made required (rule 11) — doing so blocks recovery behind a "possible
  // tampering" error (#9256). frozen-state-v18.15 is a real, validated full-state
  // snapshot (see frozen-state.spec.ts), reused READ-ONLY here. GHSA-8pxh-mgc7-gp3g.
  const JIRA_ID = 'ip-JIRA';

  const createFullStateOp = (over: Partial<SyncOperation> = {}): SyncOperation => ({
    id: 'op-full-1',
    clientId: 'clientA',
    actionType: 'LOAD_ALL_DATA',
    opType: OpType.SyncImport,
    entityType: 'TASK',
    entityId: SINGLETON_ENTITY_ID,
    payload: null,
    vectorClock: { clientA: 1 },
    timestamp: 1,
    schemaVersion: frozen.__frozenAtSchemaVersion,
    ...over,
  });

  const validSnapshot = (): Record<string, unknown> =>
    structuredClone(frozen.state) as unknown as Record<string, unknown>;

  const jiraCfgOf = (snapshot: Record<string, unknown>): Record<string, unknown> =>
    (snapshot.issueProvider as { entities: Record<string, Record<string, unknown>> })
      .entities[JIRA_ID];

  it('accepts an untampered, fully-valid full-state snapshot', async () => {
    await expectAsync(
      assertDecryptedFullStateOpIntegrity(createFullStateOp(), validSnapshot()),
    ).toBeResolved();
  });

  it('accepts a legitimate snapshot missing fields a later version made required (rule 11: JiraCfg.allowFetchFallback/altPublicLinkHost #7628) — regression for #9256', async () => {
    const snapshot = validSnapshot();
    const jira = jiraCfgOf(snapshot);
    // Both required in v18.10 (#7628); a Jira provider configured earlier lacks
    // them. They are now optional (layer 1), so strict validation passes.
    delete jira.allowFetchFallback;
    delete jira.altPublicLinkHost;

    await expectAsync(
      assertDecryptedFullStateOpIntegrity(createFullStateOp(), snapshot),
    ).toBeResolved();
  });

  it('heals a still-required field drifted deep inside a present root instead of rejecting', async () => {
    const snapshot = validSnapshot();
    // usePAT stays a REQUIRED boolean (not loosened): strict validation fails, but
    // the drift is recoverable exactly as the real apply path heals it downstream
    // (autoFixTypiaErrors boolean->false). Exercises the heal-before-reject path.
    delete jiraCfgOf(snapshot).usePAT;

    await expectAsync(
      assertDecryptedFullStateOpIntegrity(createFullStateOp(), snapshot),
    ).toBeResolved();
  });

  it('still rejects a promoted single-entity payload (opType-promotion attack)', async () => {
    // A single-entity LWW payload relabeled SYNC_IMPORT. It is not complete app
    // data and auto-fix never fabricates the missing top-level sections, so it
    // stays invalid and is rejected.
    const promotedSingleEntity = { id: 'task-1', changes: { title: 'x' } };
    await expectAsync(
      assertDecryptedFullStateOpIntegrity(createFullStateOp(), promotedSingleEntity),
    ).toBeRejectedWithError(OperationIntegrityError);
  });

  it('still rejects a snapshot missing an entire top-level section (healing never manufactures sections)', async () => {
    const snapshot = validSnapshot();
    delete snapshot.task;
    await expectAsync(
      assertDecryptedFullStateOpIntegrity(createFullStateOp(), snapshot),
    ).toBeRejectedWithError(OperationIntegrityError);
  });

  it('still rejects a present-but-mis-typed root (globalConfig: []) — heal must not fabricate a wrong-kind section', async () => {
    // A present-but-degenerate container yields ONLY nested typia errors (no
    // bare-root error), so without the container-kind guard autoFixTypiaErrors'
    // globalConfig catch-all would rebuild the section from defaults and heal a
    // malformed array-typed root into a "valid" snapshot.
    const snapshot = validSnapshot();
    snapshot.globalConfig = [];
    await expectAsync(
      assertDecryptedFullStateOpIntegrity(createFullStateOp(), snapshot),
    ).toBeRejectedWithError(OperationIntegrityError);
  });

  it('ignores non-full-state ops (out of scope)', async () => {
    const op = createFullStateOp({ opType: OpType.Update });
    // A single-entity payload on a non-full-state op must pass untouched.
    await expectAsync(
      assertDecryptedFullStateOpIntegrity(op, { id: 'task-1' }),
    ).toBeResolved();
  });
});
