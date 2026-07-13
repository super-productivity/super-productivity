import { TestBed } from '@angular/core/testing';
import { OperationEncryptionService } from './operation-encryption.service';
import { SyncOperation } from '../sync-providers/provider.interface';
import { DecryptError, OperationIntegrityError } from '../core/errors/sync-errors';
import { ActionType, OpType } from '../core/operation.types';
import { toLwwUpdateActionType } from '../core/lww-update-action-types';
import { clearSessionKeyCache, setArgon2ParamsForTesting } from '@sp/sync-core';
import { createValidAppData } from '../validation/state-validity-test-utils';
import { stripLocalOnlySyncSettingsFromAppData } from '../../features/config/local-only-sync-settings.util';
import { CURRENT_SCHEMA_VERSION } from '@sp/shared-schema';

describe('OperationEncryptionService', () => {
  let service: OperationEncryptionService;

  const TEST_PASSWORD = 'test-encryption-password-123';

  const createMockSyncOp = (payload: unknown): SyncOperation => ({
    id: 'test-op-id',
    clientId: 'testClient',
    actionType: 'UPDATE_TASK' as ActionType,
    opType: 'UPDATE',
    entityType: 'TASK',
    entityId: 'task-123',
    payload,
    vectorClock: { testClient: 1 },
    timestamp: Date.now(),
    schemaVersion: 1,
  });

  const jsonRoundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

  // Use real encryption with weakened Argon2 params (8KiB memory, 1 iteration).
  // The session cache derives the key once per password across the whole spec,
  // so encrypt/decrypt is ~microseconds after the first call.
  beforeAll(() => {
    setArgon2ParamsForTesting({ parallelism: 1, memorySize: 8, iterations: 1 });
  });

  afterAll(() => {
    setArgon2ParamsForTesting();
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [OperationEncryptionService],
    });
    service = TestBed.inject(OperationEncryptionService);
    clearSessionKeyCache();
  });

  afterEach(() => {
    clearSessionKeyCache();
  });

  describe('encryptOperation', () => {
    it('should encrypt the payload and set isPayloadEncrypted flag', async () => {
      const originalPayload = { title: 'Test Task', done: false };
      const op = createMockSyncOp(originalPayload);

      const encrypted = await service.encryptOperation(op, TEST_PASSWORD);

      expect(encrypted.isPayloadEncrypted).toBe(true);
      expect(typeof encrypted.payload).toBe('string');
      expect(encrypted.payload).not.toEqual(originalPayload);
      // Metadata should be preserved
      expect(encrypted.id).toBe(op.id);
      expect(encrypted.clientId).toBe(op.clientId);
      expect(encrypted.entityType).toBe(op.entityType);
    });

    it('should produce different ciphertext for same plaintext (random IV)', async () => {
      const payload = { title: 'Same content' };
      const op = createMockSyncOp(payload);

      const encrypted1 = await service.encryptOperation(op, TEST_PASSWORD);
      const encrypted2 = await service.encryptOperation(op, TEST_PASSWORD);

      // Due to random IV/salt, ciphertexts should be different
      expect(encrypted1.payload).not.toEqual(encrypted2.payload);
    });
  });

  describe('decryptOperation', () => {
    it('should decrypt an encrypted operation back to original payload', async () => {
      const originalPayload = { title: 'Test Task', done: false, nested: { a: 1 } };
      const op = createMockSyncOp(originalPayload);

      const encrypted = await service.encryptOperation(op, TEST_PASSWORD);
      const decrypted = await service.decryptOperation(encrypted, TEST_PASSWORD);

      expect(decrypted.isPayloadEncrypted).toBe(false);
      expect(decrypted.payload).toEqual(originalPayload);
      // Metadata should be preserved
      expect(decrypted.id).toBe(op.id);
      expect(decrypted.clientId).toBe(op.clientId);
    });

    it('should pass through non-encrypted operations unchanged', async () => {
      const payload = { title: 'Not encrypted' };
      const op = createMockSyncOp(payload);
      // isPayloadEncrypted is not set (undefined/false)

      const result = await service.decryptOperation(op, TEST_PASSWORD);

      expect(result).toBe(op); // Same reference
      expect(result.payload).toEqual(payload);
    });

    it('should throw DecryptError with wrong password', async () => {
      const op = createMockSyncOp({ title: 'Secret' });
      const encrypted = await service.encryptOperation(op, TEST_PASSWORD);

      await expectAsync(
        service.decryptOperation(encrypted, 'wrong-password'),
      ).toBeRejectedWithError(DecryptError);
    });

    it('should throw DecryptError if payload is not a string when isPayloadEncrypted is true', async () => {
      const op = createMockSyncOp({ title: 'Not a string' });
      op.isPayloadEncrypted = true; // Mark as encrypted but payload is not a string

      await expectAsync(
        service.decryptOperation(op, TEST_PASSWORD),
      ).toBeRejectedWithError(DecryptError, 'Encrypted payload must be a string');
    });

    it('should throw DecryptError for corrupted ciphertext', async () => {
      const op = createMockSyncOp(null);
      op.payload = 'invalid-base64-ciphertext!!!';
      op.isPayloadEncrypted = true;

      await expectAsync(
        service.decryptOperation(op, TEST_PASSWORD),
      ).toBeRejectedWithError(DecryptError);
    });
  });

  describe('encryptOperations (batch)', () => {
    it('should encrypt multiple operations', async () => {
      const ops = [
        createMockSyncOp({ title: 'Task 1' }),
        createMockSyncOp({ title: 'Task 2' }),
        createMockSyncOp({ title: 'Task 3' }),
      ];

      const encrypted = await service.encryptOperations(ops, TEST_PASSWORD);

      expect(encrypted.length).toBe(3);
      encrypted.forEach((op) => {
        expect(op.isPayloadEncrypted).toBe(true);
        expect(typeof op.payload).toBe('string');
      });
    });

    it('should handle empty array', async () => {
      const encrypted = await service.encryptOperations([], TEST_PASSWORD);
      expect(encrypted).toEqual([]);
    });
  });

  describe('decryptOperations (batch)', () => {
    it('should decrypt multiple encrypted operations', async () => {
      const payloads = [{ title: 'Task 1' }, { title: 'Task 2' }, { title: 'Task 3' }];
      const ops = payloads.map((p) => createMockSyncOp(p));
      const encrypted = await service.encryptOperations(ops, TEST_PASSWORD);

      const decrypted = await service.decryptOperations(encrypted, TEST_PASSWORD);

      expect(decrypted.length).toBe(3);
      decrypted.forEach((op, i) => {
        expect(op.isPayloadEncrypted).toBe(false);
        expect(op.payload).toEqual(payloads[i]);
      });
    });

    it('should pass through non-encrypted operations in mixed batch', async () => {
      const encryptedOp = await service.encryptOperation(
        createMockSyncOp({ title: 'Encrypted' }),
        TEST_PASSWORD,
      );
      const plainOp = createMockSyncOp({ title: 'Plain' });

      const result = await service.decryptOperations(
        [encryptedOp, plainOp],
        TEST_PASSWORD,
      );

      expect(result[0].isPayloadEncrypted).toBe(false);
      expect(result[0].payload).toEqual({ title: 'Encrypted' });
      expect(result[1].payload).toEqual({ title: 'Plain' });
    });

    it('should handle empty array', async () => {
      const decrypted = await service.decryptOperations([], TEST_PASSWORD);
      expect(decrypted).toEqual([]);
    });

    it('should return same array reference when none are encrypted', async () => {
      const ops = [
        createMockSyncOp({ title: 'Plain 1' }),
        createMockSyncOp({ title: 'Plain 2' }),
        createMockSyncOp({ title: 'Plain 3' }),
      ];

      const result = await service.decryptOperations(ops, TEST_PASSWORD);

      // Should return the same array reference (optimization: no copying needed)
      expect(result).toBe(ops);
      expect(result.length).toBe(3);
    });

    it('should throw DecryptError for malformed encrypted operation (non-string payload)', async () => {
      const malformedOp = createMockSyncOp({ title: 'Not a string' });
      malformedOp.isPayloadEncrypted = true; // Mark as encrypted but payload is object

      await expectAsync(
        service.decryptOperations([malformedOp], TEST_PASSWORD),
      ).toBeRejectedWithError(DecryptError);
    });

    it('should throw DecryptError with op ID for malformed encrypted operation', async () => {
      const malformedOp = createMockSyncOp({ title: 'Not a string' });
      malformedOp.id = 'malformed-op-123';
      malformedOp.isPayloadEncrypted = true;

      try {
        await service.decryptOperations([malformedOp], TEST_PASSWORD);
        fail('Should have thrown DecryptError');
      } catch (e) {
        expect(e).toBeInstanceOf(DecryptError);
        expect((e as Error).message).toContain('malformed-op-123');
      }
    });
  });

  // GHSA-8pxh-mgc7-gp3g: E2EE covers only op.payload; op.entityId travels as
  // plaintext. A tampered entityId on an encrypted LWW-update op must be
  // rejected on decrypt (fail closed) rather than silently retargeting the
  // authenticated changes onto the attacker-chosen entity.
  describe('metadata integrity (GHSA-8pxh-mgc7-gp3g)', () => {
    const LWW_TASK = toLwwUpdateActionType('TASK') as ActionType;

    const createLwwOp = (entityId: string): SyncOperation => ({
      ...createMockSyncOp({ id: entityId, changes: { title: 'legit change' } }),
      actionType: LWW_TASK,
      opType: 'UPDATE',
      entityType: 'TASK',
      entityId,
    });

    it('rejects a decrypted LWW op whose entityId was tampered (single)', async () => {
      const encrypted = await service.encryptOperation(
        createLwwOp('task-123'),
        TEST_PASSWORD,
      );
      // Simulate a malicious server retagging the plaintext entityId.
      const tampered: SyncOperation = { ...encrypted, entityId: 'task-999' };

      await expectAsync(
        service.decryptOperation(tampered, TEST_PASSWORD),
      ).toBeRejectedWithError(OperationIntegrityError);
    });

    it('rejects a decrypted LWW op whose entityId was tampered (batch)', async () => {
      const [encrypted] = await service.encryptOperations(
        [createLwwOp('task-123')],
        TEST_PASSWORD,
      );
      const tampered: SyncOperation = { ...encrypted, entityId: 'task-999' };

      await expectAsync(
        service.decryptOperations([tampered], TEST_PASSWORD),
      ).toBeRejectedWithError(OperationIntegrityError);
    });

    it('accepts a decrypted LWW op with untampered entityId', async () => {
      const encrypted = await service.encryptOperation(
        createLwwOp('task-123'),
        TEST_PASSWORD,
      );
      const decrypted = await service.decryptOperation(encrypted, TEST_PASSWORD);
      expect(decrypted.entityId).toBe('task-123');
      expect(decrypted.payload).toEqual({
        id: 'task-123',
        changes: { title: 'legit change' },
      });
    });

    describe('full-state opType promotion', () => {
      const createFullStateOp = (
        opType: OpType.SyncImport | OpType.BackupImport | OpType.Repair,
        payload: unknown,
        schemaVersion: number = CURRENT_SCHEMA_VERSION,
      ): SyncOperation => ({
        ...createMockSyncOp(payload),
        actionType:
          opType === OpType.Repair ? ActionType.REPAIR_AUTO : ActionType.LOAD_ALL_DATA,
        opType,
        entityType: 'ALL',
        entityId: opType === OpType.BackupImport ? 'backup-import-1' : undefined,
        schemaVersion,
      });

      const createLegacyV1AppData = (): unknown => {
        const state = jsonRoundTrip(createValidAppData());
        const {
          isAutoMarkParentAsDone,
          isAutoAddWorkedOnToToday,
          isConfirmBeforeDelete,
          isTrayShowCurrent,
          isMarkdownFormattingInNotesEnabled,
          defaultProjectId,
          notesTemplate,
          ...unmigratedTaskSettings
        } = state.globalConfig.tasks;

        return {
          ...state,
          globalConfig: {
            ...state.globalConfig,
            misc: {
              ...state.globalConfig.misc,
              isAutMarkParentAsDone: isAutoMarkParentAsDone,
              isAutoAddWorkedOnToToday,
              isConfirmBeforeTaskDelete: isConfirmBeforeDelete,
              isTrayShowCurrentTask: isTrayShowCurrent,
              isTurnOffMarkdown: !isMarkdownFormattingInNotesEnabled,
              defaultProjectId,
              taskNotesTpl: notesTemplate,
            },
            tasks: unmigratedTaskSettings,
          },
        };
      };

      const requiredFullStateKeys = [
        'task',
        'project',
        'tag',
        'note',
        'menuTree',
        'globalConfig',
        'simpleCounter',
        'taskRepeatCfg',
        'reminders',
        'planner',
        'boards',
        'issueProvider',
        'metric',
        'timeTracking',
      ] as const;

      const optionalFullStateKeys = ['pluginUserData', 'pluginMetadata'] as const;

      it('rejects an ordinary encrypted op promoted to SYNC_IMPORT (single)', async () => {
        const encrypted = await service.encryptOperation(
          createMockSyncOp({ task: { id: 'task-123', changes: { title: 'x' } } }),
          TEST_PASSWORD,
        );
        const tampered: SyncOperation = {
          ...encrypted,
          opType: OpType.SyncImport,
        };

        await expectAsync(
          service.decryptOperation(tampered, TEST_PASSWORD),
        ).toBeRejectedWithError(OperationIntegrityError);
      });

      it('rejects an ordinary encrypted op promoted to REPAIR (batch)', async () => {
        const [encrypted] = await service.encryptOperations(
          [createMockSyncOp({ task: { id: 'task-123', changes: { title: 'x' } } })],
          TEST_PASSWORD,
        );
        const tampered: SyncOperation = {
          ...encrypted,
          opType: OpType.Repair,
        };

        await expectAsync(
          service.decryptOperations([tampered], TEST_PASSWORD),
        ).toBeRejectedWithError(OperationIntegrityError);
      });

      it('rejects missing or malformed required roots and malformed optional roots', async () => {
        for (const key of requiredFullStateKeys) {
          for (const invalidValue of ['missing', null] as const) {
            const state = jsonRoundTrip(createValidAppData()) as Record<string, unknown>;
            if (invalidValue === 'missing') {
              delete state[key];
            } else {
              state[key] = invalidValue;
            }

            const encrypted = await service.encryptOperation(
              createMockSyncOp(state),
              TEST_PASSWORD,
            );
            const promoted: SyncOperation = {
              ...encrypted,
              opType: OpType.SyncImport,
            };

            await expectAsync(service.decryptOperation(promoted, TEST_PASSWORD))
              .withContext(`${key} must reject ${invalidValue}`)
              .toBeRejectedWithError(OperationIntegrityError);
          }
        }

        for (const key of optionalFullStateKeys) {
          const state = jsonRoundTrip(createValidAppData()) as Record<string, unknown>;
          state[key] = null;
          const encrypted = await service.encryptOperation(
            createMockSyncOp(state),
            TEST_PASSWORD,
          );
          const promoted: SyncOperation = {
            ...encrypted,
            opType: OpType.SyncImport,
          };

          await expectAsync(service.decryptOperation(promoted, TEST_PASSWORD))
            .withContext(`${key} must reject malformed values when present`)
            .toBeRejectedWithError(OperationIntegrityError);
        }
      });

      it('accepts a legitimate direct SYNC_IMPORT payload', async () => {
        const state = createValidAppData();
        const encrypted = await service.encryptOperation(
          createFullStateOp(OpType.SyncImport, state),
          TEST_PASSWORD,
        );

        const decrypted = await service.decryptOperation(encrypted, TEST_PASSWORD);

        expect(decrypted.payload).toEqual(jsonRoundTrip(state));
      });

      it('accepts a direct SYNC_IMPORT wire payload without local-only schedule settings', async () => {
        const state = stripLocalOnlySyncSettingsFromAppData(
          jsonRoundTrip(createValidAppData()),
        );
        const encrypted = await service.encryptOperation(
          createFullStateOp(OpType.SyncImport, state),
          TEST_PASSWORD,
        );

        const decrypted = await service.decryptOperation(encrypted, TEST_PASSWORD);

        expect(decrypted.payload).toEqual(state);
      });

      it('accepts a schema-v1 SYNC_IMPORT at the decryption boundary without mutating it', async () => {
        const state = createLegacyV1AppData();
        const encrypted = await service.encryptOperation(
          createFullStateOp(OpType.SyncImport, state, 1),
          TEST_PASSWORD,
        );

        const decrypted = await service.decryptOperation(encrypted, TEST_PASSWORD);

        expect(decrypted.payload).toEqual(state);
      });

      it('accepts a legitimate direct BACKUP_IMPORT payload', async () => {
        const state = createValidAppData();
        const encrypted = await service.encryptOperation(
          createFullStateOp(OpType.BackupImport, state),
          TEST_PASSWORD,
        );

        const decrypted = await service.decryptOperation(encrypted, TEST_PASSWORD);

        expect(decrypted.payload).toEqual(jsonRoundTrip(state));
      });

      it('accepts a legitimate wrapped REPAIR payload', async () => {
        const state = createValidAppData();
        const payload = {
          appDataComplete: state,
          repairSummary: {
            entityStateFixed: 1,
            orphanedEntitiesRestored: 0,
            invalidReferencesRemoved: 0,
            relationshipsFixed: 0,
            structureRepaired: 0,
            typeErrorsFixed: 0,
          },
        };
        const encrypted = await service.encryptOperation(
          createFullStateOp(OpType.Repair, payload),
          TEST_PASSWORD,
        );

        const decrypted = await service.decryptOperation(encrypted, TEST_PASSWORD);

        expect(decrypted.payload).toEqual(jsonRoundTrip(payload));
      });

      it('accepts a wrapped REPAIR wire payload without the legacy section slice in a batch', async () => {
        const state = jsonRoundTrip(createValidAppData()) as Record<string, unknown>;
        delete state['section'];
        const payload = {
          appDataComplete: state,
          repairSummary: {
            entityStateFixed: 1,
            orphanedEntitiesRestored: 0,
            invalidReferencesRemoved: 0,
            relationshipsFixed: 0,
            structureRepaired: 0,
            typeErrorsFixed: 0,
          },
        };
        const [encrypted] = await service.encryptOperations(
          [createFullStateOp(OpType.Repair, payload)],
          TEST_PASSWORD,
        );

        const [decrypted] = await service.decryptOperations([encrypted], TEST_PASSWORD);

        expect(decrypted.payload).toEqual(payload);
      });
    });
  });

  describe('encryptPayload / decryptPayload', () => {
    it('should encrypt and decrypt an object payload', async () => {
      const payload = { foo: 'bar', count: 42 };
      const encrypted = await service.encryptPayload(payload, TEST_PASSWORD);

      expect(typeof encrypted).toBe('string');
      expect(encrypted).not.toContain(JSON.stringify(payload)); // Should not expose raw JSON

      const decrypted = await service.decryptPayload(encrypted, TEST_PASSWORD);
      expect(decrypted).toEqual(payload);
    });

    it('should encrypt and decrypt an array payload', async () => {
      const payload = [1, 2, 3, { nested: true }];
      const encrypted = await service.encryptPayload(payload, TEST_PASSWORD);
      const decrypted = await service.decryptPayload<typeof payload>(
        encrypted,
        TEST_PASSWORD,
      );

      expect(decrypted).toEqual(payload);
    });

    it('should throw DecryptError for wrong password', async () => {
      const payload = { secret: 'data' };
      const encrypted = await service.encryptPayload(payload, TEST_PASSWORD);

      await expectAsync(
        service.decryptPayload(encrypted, 'wrong-password'),
      ).toBeRejectedWithError(DecryptError);
    });

    it('should throw DecryptError for corrupted ciphertext', async () => {
      await expectAsync(
        service.decryptPayload('invalid-ciphertext!!!', TEST_PASSWORD),
      ).toBeRejectedWithError(DecryptError);
    });
  });

  describe('round-trip with various payload types', () => {
    it('should handle null payload', async () => {
      const op = createMockSyncOp(null);
      const encrypted = await service.encryptOperation(op, TEST_PASSWORD);
      const decrypted = await service.decryptOperation(encrypted, TEST_PASSWORD);
      expect(decrypted.payload).toBeNull();
    });

    it('should handle string payload', async () => {
      const op = createMockSyncOp('just a string');
      const encrypted = await service.encryptOperation(op, TEST_PASSWORD);
      const decrypted = await service.decryptOperation(encrypted, TEST_PASSWORD);
      expect(decrypted.payload).toBe('just a string');
    });

    it('should handle number payload', async () => {
      const op = createMockSyncOp(42);
      const encrypted = await service.encryptOperation(op, TEST_PASSWORD);
      const decrypted = await service.decryptOperation(encrypted, TEST_PASSWORD);
      expect(decrypted.payload).toBe(42);
    });

    it('should handle array payload', async () => {
      const op = createMockSyncOp(['a', 'b', 'c']);
      const encrypted = await service.encryptOperation(op, TEST_PASSWORD);
      const decrypted = await service.decryptOperation(encrypted, TEST_PASSWORD);
      expect(decrypted.payload).toEqual(['a', 'b', 'c']);
    });

    it('should handle deeply nested payload', async () => {
      const deepPayload = {
        level1: {
          level2: {
            level3: {
              value: 'deep',
            },
          },
        },
      };
      const op = createMockSyncOp(deepPayload);
      const encrypted = await service.encryptOperation(op, TEST_PASSWORD);
      const decrypted = await service.decryptOperation(encrypted, TEST_PASSWORD);
      expect(decrypted.payload).toEqual(deepPayload);
    });

    it('should handle payload with special characters', async () => {
      const op = createMockSyncOp({
        emoji: '🎉🔐',
        unicode: '日本語',
        special: '<script>alert("xss")</script>',
      });
      const encrypted = await service.encryptOperation(op, TEST_PASSWORD);
      const decrypted = await service.decryptOperation(encrypted, TEST_PASSWORD);
      expect(decrypted.payload).toEqual({
        emoji: '🎉🔐',
        unicode: '日本語',
        special: '<script>alert("xss")</script>',
      });
    });
  });
});
