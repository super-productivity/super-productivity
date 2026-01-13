import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { VectorClockService } from '../../sync/vector-clock.service';
import { OpType } from '../../core/operation.types';
import {
  compareVectorClocks,
  VectorClockComparison,
} from '../../../core/util/vector-clock';
import { TestClient, resetTestUuidCounter } from './helpers/test-client.helper';
import {
  createTaskOperation,
  createProjectOperation,
  createTagOperation,
  createNoteOperation,
  createGlobalConfigOperation,
} from './helpers/operation-factory.helper';
import { MockSyncServer } from './helpers/mock-sync-server.helper';
import { SimulatedClient } from './helpers/simulated-client.helper';

/**
 * Integration tests for cross-entity dependencies and singleton entity sync.
 *
 * These tests verify:
 * - TAG → TASK soft dependencies (tag.taskIds referencing tasks)
 * - NOTE → PROJECT soft dependencies (note.projectId)
 * - Singleton entities (GLOBAL_CONFIG) conflict detection
 * - Cross-entity operation ordering in multi-client scenarios
 *
 * Tests use real IndexedDB for realistic behavior.
 */
describe('Cross-Entity Sync Integration', () => {
  let storeService: OperationLogStoreService;
  let vectorClockService: VectorClockService;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [OperationLogStoreService, VectorClockService],
    });
    storeService = TestBed.inject(OperationLogStoreService);
    vectorClockService = TestBed.inject(VectorClockService);

    await storeService.init();
    await storeService._clearAllDataForTesting();
    resetTestUuidCounter();
  });

  describe('TAG → TASK dependency ordering', () => {
    it('should store TAG with taskIds referencing tasks', async () => {
      const client = new TestClient('client-test');

      // Create tasks first
      const task1Op = createTaskOperation(client, 'task-1', OpType.Create, {
        title: 'Task 1',
      });
      const task2Op = createTaskOperation(client, 'task-2', OpType.Create, {
        title: 'Task 2',
      });

      // Create tag referencing both tasks
      const tagOp = createTagOperation(client, 'tag-1', OpType.Create, {
        title: 'Important',
        taskIds: ['task-1', 'task-2'],
      });

      await storeService.append(task1Op, 'local');
      await storeService.append(task2Op, 'local');
      await storeService.append(tagOp, 'local');

      const ops = await storeService.getOpsAfterSeq(0);
      expect(ops.length).toBe(3);

      // Verify tag has taskIds in payload
      const storedTagOp = ops.find((e) => e.op.entityType === 'TAG');
      expect(storedTagOp).toBeDefined();
      expect((storedTagOp!.op.payload as any).taskIds).toEqual(['task-1', 'task-2']);
    });

    it('should handle TAG update adding new taskIds', async () => {
      const client = new TestClient('client-test');

      // Create tag without tasks
      const tagCreateOp = createTagOperation(client, 'tag-1', OpType.Create, {
        title: 'Work',
        taskIds: [],
      });

      // Create tasks
      const taskOp = createTaskOperation(client, 'task-1', OpType.Create, {
        title: 'Task 1',
        tagIds: ['tag-1'],
      });

      // Update tag to include task
      const tagUpdateOp = createTagOperation(client, 'tag-1', OpType.Update, {
        taskIds: ['task-1'],
      });

      await storeService.append(tagCreateOp, 'local');
      await storeService.append(taskOp, 'local');
      await storeService.append(tagUpdateOp, 'local');

      const ops = await storeService.getOpsAfterSeq(0);
      expect(ops.length).toBe(3);

      // Both tag operations should be stored
      const tagOps = ops.filter((e) => e.op.entityType === 'TAG');
      expect(tagOps.length).toBe(2);
    });

    it('should track TAG and TASK operations in entity frontier separately', async () => {
      const client = new TestClient('client-test');

      await storeService.append(
        createTaskOperation(client, 'task-1', OpType.Create, { title: 'Task' }),
        'local',
      );
      await storeService.append(
        createTagOperation(client, 'tag-1', OpType.Create, {
          title: 'Tag',
          taskIds: ['task-1'],
        }),
        'local',
      );

      const frontier = await vectorClockService.getEntityFrontier();

      // Both entities should have separate frontier entries
      expect(frontier.get('TASK:task-1')).toBeDefined();
      expect(frontier.get('TAG:tag-1')).toBeDefined();
    });
  });

  describe('NOTE → PROJECT dependency ordering', () => {
    it('should store NOTE with projectId referencing a project', async () => {
      const client = new TestClient('client-test');

      // Create project first
      const projectOp = createProjectOperation(client, 'proj-1', OpType.Create, {
        title: 'Work Project',
      });

      // Create note referencing project
      const noteOp = createNoteOperation(client, 'note-1', OpType.Create, {
        content: 'Project notes',
        projectId: 'proj-1',
      });

      await storeService.append(projectOp, 'local');
      await storeService.append(noteOp, 'local');

      const ops = await storeService.getOpsAfterSeq(0);
      expect(ops.length).toBe(2);

      // Verify note has projectId
      const storedNoteOp = ops.find((e) => e.op.entityType === 'NOTE');
      expect(storedNoteOp).toBeDefined();
      expect((storedNoteOp!.op.payload as any).projectId).toBe('proj-1');
    });

    it('should store NOTE even when project arrives later (soft dependency)', async () => {
      const client = new TestClient('client-test');

      // Create note first (before project exists)
      const noteOp = createNoteOperation(client, 'note-1', OpType.Create, {
        content: 'Orphaned note',
        projectId: 'proj-1',
      });

      // Project arrives later
      const projectOp = createProjectOperation(client, 'proj-1', OpType.Create, {
        title: 'Work Project',
      });

      await storeService.append(noteOp, 'local');
      await storeService.append(projectOp, 'local');

      const ops = await storeService.getOpsAfterSeq(0);
      expect(ops.length).toBe(2);

      // Both should be stored (soft dependency doesn't block)
      expect(ops.some((e) => e.op.entityType === 'NOTE')).toBe(true);
      expect(ops.some((e) => e.op.entityType === 'PROJECT')).toBe(true);
    });
  });

  describe('Singleton entity (GLOBAL_CONFIG) sync', () => {
    it('should store GLOBAL_CONFIG operations with entityId "*"', async () => {
      const client = new TestClient('client-test');

      const configOp = createGlobalConfigOperation(client, OpType.Update, {
        sectionKey: 'misc',
        sectionValue: { isDarkMode: true },
      });

      await storeService.append(configOp, 'local');

      const ops = await storeService.getOpsAfterSeq(0);
      expect(ops.length).toBe(1);
      expect(ops[0].op.entityType).toBe('GLOBAL_CONFIG');
      expect(ops[0].op.entityId).toBe('*');
    });

    it('should detect concurrent GLOBAL_CONFIG edits as conflicts', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      // Both clients edit config without knowledge of each other
      const opA = createGlobalConfigOperation(clientA, OpType.Update, {
        sectionKey: 'misc',
        sectionValue: { isDarkMode: true },
      });

      const opB = createGlobalConfigOperation(clientB, OpType.Update, {
        sectionKey: 'misc',
        sectionValue: { isDarkMode: false },
      });

      // Vector clocks should be concurrent
      const comparison = compareVectorClocks(opA.vectorClock, opB.vectorClock);
      expect(comparison).toBe(VectorClockComparison.CONCURRENT);
    });

    it('should track GLOBAL_CONFIG in entity frontier with "*" key', async () => {
      const client = new TestClient('client-test');

      await storeService.append(
        createGlobalConfigOperation(client, OpType.Update, {
          sectionKey: 'misc',
          sectionValue: { isDarkMode: true },
        }),
        'local',
      );

      const frontier = await vectorClockService.getEntityFrontier();

      // Singleton should use GLOBAL_CONFIG:* as key
      const configClock = frontier.get('GLOBAL_CONFIG:*');
      expect(configClock).toBeDefined();
      expect(configClock!['client-test']).toBe(1);
    });

    it('should handle multiple GLOBAL_CONFIG updates from same client', async () => {
      const client = new TestClient('client-test');

      await storeService.append(
        createGlobalConfigOperation(client, OpType.Update, {
          sectionKey: 'misc',
          sectionValue: { isDarkMode: true },
        }),
        'local',
      );

      await storeService.append(
        createGlobalConfigOperation(client, OpType.Update, {
          sectionKey: 'keyboard',
          sectionValue: { globalShowHideHotkey: 'Ctrl+Space' },
        }),
        'local',
      );

      const ops = await storeService.getOpsAfterSeq(0);
      expect(ops.length).toBe(2);

      // Both target same entity (singleton)
      expect(ops[0].op.entityId).toBe('*');
      expect(ops[1].op.entityId).toBe('*');

      // Vector clock should progress
      expect(ops[1].op.vectorClock['client-test']).toBe(2);
    });
  });

  describe('Multi-client cross-entity scenarios', () => {
    let server: MockSyncServer;

    beforeEach(() => {
      server = new MockSyncServer();
    });

    it('should sync TAG and TASK created on different clients', async () => {
      const clientA = new SimulatedClient('client-a-test', storeService);
      const clientB = new SimulatedClient('client-b-test', storeService);

      // Client A creates a task
      await clientA.createLocalOp('TASK', 'task-1', OpType.Create, '[Task] Add Task', {
        title: 'Task from A',
        tagIds: [],
      });
      await clientA.sync(server);

      // Client B creates a tag referencing that task
      await clientB.sync(server); // Download task first
      await clientB.createLocalOp('TAG', 'tag-1', OpType.Create, '[Tag] Add Tag', {
        title: 'Tag from B',
        taskIds: ['task-1'],
      });
      await clientB.sync(server);

      // Client A syncs to get the tag
      const syncResult = await clientA.sync(server);
      expect(syncResult.downloaded).toBe(1);

      // Server should have both ops
      const serverOps = server.getAllOps();
      expect(serverOps.length).toBe(2);
      expect(serverOps.some((o) => o.op.entityType === 'TASK')).toBe(true);
      expect(serverOps.some((o) => o.op.entityType === 'TAG')).toBe(true);
    });

    it('should handle concurrent TAG edits adding different tasks', async () => {
      const clientA = new SimulatedClient('client-a-test', storeService);
      const clientB = new SimulatedClient('client-b-test', storeService);

      // Both clients start with same tag (empty taskIds)
      await clientA.createLocalOp('TAG', 'shared-tag', OpType.Create, '[Tag] Add Tag', {
        title: 'Shared Tag',
        taskIds: [],
      });
      await clientA.sync(server);
      await clientB.sync(server);

      // Client A creates task-a and adds to tag
      await clientA.createLocalOp('TASK', 'task-a', OpType.Create, '[Task] Add Task', {
        title: 'Task A',
        tagIds: ['shared-tag'],
      });
      await clientA.createLocalOp(
        'TAG',
        'shared-tag',
        OpType.Update,
        '[Tag] Update Tag',
        {
          taskIds: ['task-a'],
        },
      );

      // Client B creates task-b and adds to tag (concurrently)
      await clientB.createLocalOp('TASK', 'task-b', OpType.Create, '[Task] Add Task', {
        title: 'Task B',
        tagIds: ['shared-tag'],
      });
      await clientB.createLocalOp(
        'TAG',
        'shared-tag',
        OpType.Update,
        '[Tag] Update Tag',
        {
          taskIds: ['task-b'],
        },
      );

      // A syncs first
      await clientA.sync(server);

      // B syncs (has concurrent tag update)
      await clientB.sync(server);

      // Server should have all ops
      const serverOps = server.getAllOps();

      // 1 tag create + 2 task creates + 2 tag updates = 5 ops
      expect(serverOps.length).toBe(5);

      // Both tag updates should be present (concurrent edits)
      const tagUpdates = serverOps.filter(
        (o) => o.op.entityType === 'TAG' && o.op.opType === OpType.Update,
      );
      expect(tagUpdates.length).toBe(2);
    });

    it('should sync GLOBAL_CONFIG changes between clients', async () => {
      const clientA = new SimulatedClient('client-a-test', storeService);
      const clientB = new SimulatedClient('client-b-test', storeService);

      // Client A updates config
      await clientA.createLocalOp(
        'GLOBAL_CONFIG',
        '*',
        OpType.Update,
        '[Global Config] Update Global Config Section',
        { sectionKey: 'misc', sectionValue: { isDarkMode: true } },
      );
      await clientA.sync(server);

      // Client B syncs and gets the config
      const syncResult = await clientB.sync(server);
      expect(syncResult.downloaded).toBe(1);

      // Verify server has the config op
      const serverOps = server.getAllOps();
      expect(serverOps.length).toBe(1);
      expect(serverOps[0].op.entityType).toBe('GLOBAL_CONFIG');
      expect(serverOps[0].op.entityId).toBe('*');
    });

    it('should handle concurrent GLOBAL_CONFIG updates from different clients', async () => {
      const clientA = new SimulatedClient('client-a-test', storeService);
      const clientB = new SimulatedClient('client-b-test', storeService);

      // Both clients update config concurrently (different sections)
      await clientA.createLocalOp(
        'GLOBAL_CONFIG',
        '*',
        OpType.Update,
        '[Global Config] Update Global Config Section',
        { sectionKey: 'misc', sectionValue: { isDarkMode: true } },
      );

      await clientB.createLocalOp(
        'GLOBAL_CONFIG',
        '*',
        OpType.Update,
        '[Global Config] Update Global Config Section',
        { sectionKey: 'keyboard', sectionValue: { globalShowHideHotkey: 'F1' } },
      );

      // A syncs first
      await clientA.sync(server);

      // B syncs (concurrent config edit)
      await clientB.sync(server);

      // A syncs to get B's changes
      await clientA.sync(server);

      // Server should have both config updates
      const serverOps = server.getAllOps();
      expect(serverOps.length).toBe(2);

      // Both should target GLOBAL_CONFIG:*
      serverOps.forEach((op) => {
        expect(op.op.entityType).toBe('GLOBAL_CONFIG');
        expect(op.op.entityId).toBe('*');
      });

      // Different section keys
      const sectionKeys = serverOps.map((o) => (o.op.payload as any).sectionKey);
      expect(sectionKeys).toContain('misc');
      expect(sectionKeys).toContain('keyboard');
    });

    it('should handle NOTE with project created on different client', async () => {
      const clientA = new SimulatedClient('client-a-test', storeService);
      const clientB = new SimulatedClient('client-b-test', storeService);

      // Client A creates project
      await clientA.createLocalOp(
        'PROJECT',
        'proj-1',
        OpType.Create,
        '[Project] Add Project',
        { title: 'Work' },
      );
      await clientA.sync(server);

      // Client B downloads project, then creates note referencing it
      await clientB.sync(server);
      await clientB.createLocalOp('NOTE', 'note-1', OpType.Create, '[Note] Add Note', {
        content: 'Meeting notes',
        projectId: 'proj-1',
      });
      await clientB.sync(server);

      // Verify server has both
      const serverOps = server.getAllOps();
      expect(serverOps.length).toBe(2);

      const noteOp = serverOps.find((o) => o.op.entityType === 'NOTE');
      expect(noteOp).toBeDefined();
      expect((noteOp!.op.payload as any).projectId).toBe('proj-1');
    });
  });

  describe('Complex cross-entity workflow', () => {
    let server: MockSyncServer;

    beforeEach(() => {
      server = new MockSyncServer();
    });

    it('should handle full workflow: project, tasks, tags, notes, and config', async () => {
      const clientA = new SimulatedClient('client-a-desktop', storeService);
      const clientB = new SimulatedClient('client-b-mobile', storeService);

      // === Phase 1: Client A sets up project structure ===
      await clientA.createLocalOp(
        'PROJECT',
        'proj-1',
        OpType.Create,
        '[Project] Add Project',
        { title: 'Q4 Planning', taskIds: ['task-1', 'task-2'] },
      );
      await clientA.createLocalOp('TASK', 'task-1', OpType.Create, '[Task] Add Task', {
        title: 'Research',
        projectId: 'proj-1',
        tagIds: ['tag-urgent'],
      });
      await clientA.createLocalOp('TASK', 'task-2', OpType.Create, '[Task] Add Task', {
        title: 'Write proposal',
        projectId: 'proj-1',
        tagIds: [],
      });
      await clientA.createLocalOp('TAG', 'tag-urgent', OpType.Create, '[Tag] Add Tag', {
        title: 'Urgent',
        taskIds: ['task-1'],
      });
      await clientA.createLocalOp(
        'GLOBAL_CONFIG',
        '*',
        OpType.Update,
        '[Global Config] Update Global Config Section',
        { sectionKey: 'misc', sectionValue: { defaultProjectId: 'proj-1' } },
      );

      const syncA1 = await clientA.sync(server);
      expect(syncA1.uploaded).toBe(5);

      // === Phase 2: Client B syncs and adds content ===
      const syncB1 = await clientB.sync(server);
      expect(syncB1.downloaded).toBe(5);

      // B adds a note to the project
      await clientB.createLocalOp('NOTE', 'note-1', OpType.Create, '[Note] Add Note', {
        content: 'Kickoff meeting notes from mobile',
        projectId: 'proj-1',
      });

      // B adds urgent tag to task-2
      await clientB.createLocalOp('TASK', 'task-2', OpType.Update, '[Task] Update Task', {
        tagIds: ['tag-urgent'],
      });
      await clientB.createLocalOp(
        'TAG',
        'tag-urgent',
        OpType.Update,
        '[Tag] Update Tag',
        {
          taskIds: ['task-1', 'task-2'],
        },
      );

      const syncB2 = await clientB.sync(server);
      expect(syncB2.uploaded).toBe(3);

      // === Phase 3: Client A syncs and gets B's changes ===
      const syncA2 = await clientA.sync(server);
      expect(syncA2.downloaded).toBe(3);

      // === Verify final state ===
      const serverOps = server.getAllOps();
      expect(serverOps.length).toBe(8);

      // Count by entity type
      const byType = serverOps.reduce(
        (acc, op) => {
          acc[op.op.entityType] = (acc[op.op.entityType] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      expect(byType['PROJECT']).toBe(1);
      expect(byType['TASK']).toBe(3); // 2 creates + 1 update
      expect(byType['TAG']).toBe(2); // 1 create + 1 update
      expect(byType['NOTE']).toBe(1);
      expect(byType['GLOBAL_CONFIG']).toBe(1);

      // Verify cross-entity references are intact
      const noteOp = serverOps.find((o) => o.op.entityType === 'NOTE');
      expect((noteOp!.op.payload as any).projectId).toBe('proj-1');

      const tagUpdate = serverOps.find(
        (o) => o.op.entityType === 'TAG' && o.op.opType === OpType.Update,
      );
      expect((tagUpdate!.op.payload as any).taskIds).toContain('task-1');
      expect((tagUpdate!.op.payload as any).taskIds).toContain('task-2');
    });
  });
});
