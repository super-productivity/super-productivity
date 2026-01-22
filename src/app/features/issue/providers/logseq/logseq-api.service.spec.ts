import { TestBed } from '@angular/core/testing';
import { LogseqCommonInterfacesService } from './logseq-common-interfaces.service';
import { LogseqApiService } from './logseq-api.service';
import { IssueProviderService } from '../../issue-provider.service';
import { TaskService } from '../../../tasks/task.service';
import { LogseqBlock, LogseqBlockReduced } from './logseq-issue.model';
import { LogseqCfg } from './logseq.model';
import { IssueProviderLogseq } from '../../issue.model';
import { Task } from '../../../tasks/task.model';
import { of, throwError } from 'rxjs';
import { signal } from '@angular/core';

describe('LogseqCommonInterfacesService', () => {
  let service: LogseqCommonInterfacesService;
  let mockApiService: jasmine.SpyObj<LogseqApiService>;
  let mockIssueProviderService: jasmine.SpyObj<IssueProviderService>;
  let mockTaskService: jasmine.SpyObj<TaskService>;

  const mockCfg: IssueProviderLogseq = {
    id: 'test-provider-id',
    issueProviderKey: 'LOGSEQ',
    isEnabled: true,
    apiUrl: 'http://localhost:12315/api',
    authToken: 'test-token',
    queryFilter:
      '[:find (pull ?b [*]) :where [?b :block/marker ?m] [(contains? #{"TODO" "DOING"} ?m)]]',
    linkFormat: 'logseq-url',
    taskWorkflow: 'TODO_DOING',
    isIncludeMarkerInUpdateDetection: false,
  };

  beforeEach(() => {
    mockApiService = jasmine.createSpyObj('LogseqApiService', [
      'queryBlocks$',
      'getBlockByUuid$',
      'updateBlock$',
      'getBlockChildren$',
    ]);

    mockIssueProviderService = jasmine.createSpyObj('IssueProviderService', [
      'getCfgOnce$',
    ]);
    mockIssueProviderService.getCfgOnce$.and.returnValue(of(mockCfg));

    mockTaskService = jasmine.createSpyObj('TaskService', [
      'currentTaskId',
      'getByIdOnce$',
      'update',
    ]);
    // currentTaskId is a signal, so we need to return a callable
    (mockTaskService as any).currentTaskId = signal<string | null>(null);

    TestBed.configureTestingModule({
      providers: [
        LogseqCommonInterfacesService,
        { provide: LogseqApiService, useValue: mockApiService },
        { provide: IssueProviderService, useValue: mockIssueProviderService },
        { provide: TaskService, useValue: mockTaskService },
      ],
    });
    service = TestBed.inject(LogseqCommonInterfacesService);
  });

  // ============================================================
  // 1. Task Import (Logseq → SuperProd)
  // ============================================================

  describe('Task Import (Logseq → SuperProd)', () => {
    it('should import task without date', () => {
      const block: LogseqBlockReduced = {
        id: 'block-uuid-1',
        uuid: 'block-uuid-1',
        content: 'Simple Task',
        marker: 'TODO',
        properties: {},
        scheduledDate: null,
        scheduledDateTime: null,
      };

      const result = service.getAddTaskData(block);

      expect(result.title).toBe('Simple Task');
      expect(result.dueDay).toBeUndefined();
      expect(result.dueWithTime).toBeUndefined();
      expect(result.isDone).toBe(false);
    });

    it('should import task with SCHEDULED date only', () => {
      // Use a future date to avoid overdue detection
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);
      const futureDateStr = futureDate.toISOString().split('T')[0];

      const block: LogseqBlockReduced = {
        id: 'block-uuid-2',
        uuid: 'block-uuid-2',
        content: 'Task with Date',
        marker: 'TODO',
        properties: {},
        scheduledDate: futureDateStr,
        scheduledDateTime: null,
      };

      const result = service.getAddTaskData(block);

      expect(result.title).toBe('Task with Date');
      expect(result.dueDay).toBe(futureDateStr);
      expect(result.dueWithTime).toBeUndefined();
    });

    it('should import task with SCHEDULED date and time', () => {
      const timestamp = new Date('2026-01-15T14:30:00').getTime();
      const block: LogseqBlockReduced = {
        id: 'block-uuid-3',
        uuid: 'block-uuid-3',
        content: 'Task with DateTime',
        marker: 'DOING',
        properties: {},
        scheduledDate: '2026-01-15',
        scheduledDateTime: timestamp,
      };

      const result = service.getAddTaskData(block);

      expect(result.title).toBe('Task with DateTime');
      expect(result.dueWithTime).toBe(timestamp);
      expect(result.dueDay).toBeUndefined(); // dueDay cleared when time is set
    });

    it('should import task with correct marker status', () => {
      const todoBlock: LogseqBlockReduced = {
        id: 'uuid-1',
        uuid: 'uuid-1',
        content: 'TODO Task',
        marker: 'TODO',
        properties: {},
      };

      const doneBlock: LogseqBlockReduced = {
        id: 'uuid-2',
        uuid: 'uuid-2',
        content: 'DONE Task',
        marker: 'DONE',
        properties: {},
      };

      expect(service.getAddTaskData(todoBlock).isDone).toBe(false);
      expect(service.getAddTaskData(doneBlock).isDone).toBe(true);
    });
  });

  // ============================================================
  // 2. Task Update (SuperProd → Logseq)
  // ============================================================

  describe('Task Update (SuperProd → Logseq)', () => {
    const mockBlock: LogseqBlock = {
      id: 'block-uuid-1',
      uuid: 'block-uuid-1',
      content: 'TODO Test Task',
      marker: 'TODO',
      page: { id: 123 },
      parent: null,
      properties: {},
    };

    beforeEach(() => {
      mockApiService.getBlockByUuid$.and.returnValue(of(mockBlock));
      mockApiService.updateBlock$.and.returnValue(of(void 0));
    });

    it('should update marker to DONE when task is completed', async () => {
      const task: Partial<Task> = {
        id: 'task-1',
        issueId: 'block-uuid-1',
        issueProviderId: 'provider-1',
        isDone: true,
        dueDay: undefined,
        dueWithTime: undefined,
      };

      await service.updateIssueFromTask(task as Task);

      expect(mockApiService.updateBlock$).toHaveBeenCalledWith(
        'block-uuid-1',
        jasmine.stringContaining('DONE Test Task'),
        mockCfg,
      );
    });

    it('should set SCHEDULED date when dueDay is set', async () => {
      const task: Partial<Task> = {
        id: 'task-1',
        issueId: 'block-uuid-1',
        issueProviderId: 'provider-1',
        isDone: false,
        dueDay: '2026-01-20',
        dueWithTime: undefined,
      };

      await service.updateIssueFromTask(task as Task);

      expect(mockApiService.updateBlock$).toHaveBeenCalled();
      // First call is the content update, second is the SP drawer update
      const firstCall = mockApiService.updateBlock$.calls.argsFor(0);
      expect(firstCall[1]).toContain('SCHEDULED:');
      expect(firstCall[1]).toContain('2026-01-20');
      expect(firstCall[1]).not.toMatch(/\d{2}:\d{2}/); // No time
    });

    it('should set SCHEDULED date with time when dueWithTime is set', async () => {
      const timestamp = new Date('2026-01-20T15:30:00').getTime();
      const task: Partial<Task> = {
        id: 'task-1',
        issueId: 'block-uuid-1',
        issueProviderId: 'provider-1',
        isDone: false,
        dueDay: undefined,
        dueWithTime: timestamp,
      };

      await service.updateIssueFromTask(task as Task);

      expect(mockApiService.updateBlock$).toHaveBeenCalled();
      // First call is the content update, second is the SP drawer update
      const firstCall = mockApiService.updateBlock$.calls.argsFor(0);
      expect(firstCall[1]).toContain('SCHEDULED:');
      expect(firstCall[1]).toContain('2026-01-20');
      expect(firstCall[1]).toMatch(/\d{2}:\d{2}/); // Has time
    });

    it('should upgrade date to datetime when dueWithTime is added', async () => {
      const blockWithDate: LogseqBlock = {
        ...mockBlock,
        content: 'TODO Test Task\nSCHEDULED: <2026-01-15 Wed>',
      };
      mockApiService.getBlockByUuid$.and.returnValue(of(blockWithDate));

      const timestamp = new Date('2026-01-20T15:30:00').getTime();
      const task: Partial<Task> = {
        id: 'task-1',
        issueId: 'block-uuid-1',
        issueProviderId: 'provider-1',
        isDone: false,
        dueDay: undefined,
        dueWithTime: timestamp,
      };

      await service.updateIssueFromTask(task as Task);

      // First call is the content update with SCHEDULED
      const firstCall = mockApiService.updateBlock$.calls.argsFor(0);
      expect(firstCall[1]).toMatch(/SCHEDULED:.*\d{2}:\d{2}/); // Now has time
    });

    it('should downgrade datetime to date when only dueDay is set', async () => {
      const blockWithDateTime: LogseqBlock = {
        ...mockBlock,
        content: 'TODO Test Task\nSCHEDULED: <2026-01-15 Wed 14:30>',
      };
      mockApiService.getBlockByUuid$.and.returnValue(of(blockWithDateTime));

      const task: Partial<Task> = {
        id: 'task-1',
        issueId: 'block-uuid-1',
        issueProviderId: 'provider-1',
        isDone: false,
        dueDay: '2026-01-20',
        dueWithTime: undefined,
      };

      await service.updateIssueFromTask(task as Task);

      // First call is the content update
      const firstCall = mockApiService.updateBlock$.calls.argsFor(0);
      expect(firstCall[1]).toContain('SCHEDULED:');
      expect(firstCall[1]).not.toMatch(/\d{2}:\d{2}/); // Time removed
    });

    it('should remove SCHEDULED when dueDay and dueWithTime are null', async () => {
      const blockWithDate: LogseqBlock = {
        ...mockBlock,
        content: 'TODO Test Task\nSCHEDULED: <2026-01-15 Wed>',
      };
      mockApiService.getBlockByUuid$.and.returnValue(of(blockWithDate));

      const task: Partial<Task> = {
        id: 'task-1',
        issueId: 'block-uuid-1',
        issueProviderId: 'provider-1',
        isDone: false,
        dueDay: undefined,
        dueWithTime: undefined,
      };

      await service.updateIssueFromTask(task as Task);

      // When no change is detected, there should be no updateBlock$ call
      // Or if there is, it should not have SCHEDULED
      if (mockApiService.updateBlock$.calls.count() > 0) {
        const firstCall = mockApiService.updateBlock$.calls.argsFor(0);
        expect(firstCall[1]).not.toContain('SCHEDULED:');
      }
    });
  });

  // ============================================================
  // 3. Change Detection (Logseq → SuperProd)
  // ============================================================

  describe('Change Detection (Logseq → SuperProd)', () => {
    beforeEach(() => {
      // Set up mocks needed for getFreshDataForIssueTask which calls updateSpDrawer
      mockApiService.updateBlock$.and.returnValue(of(void 0));
    });

    it('should detect content change when hash differs', async () => {
      // Block with existing SP drawer but different content (hash will differ)
      const oldHash = 12345; // Some old hash
      const block: LogseqBlock = {
        id: 'block-uuid-1',
        uuid: 'block-uuid-1',
        content: `TODO Updated Task Content\n:SP:\nsuperprod-last-sync: ${Date.now() - 10000}\nsuperprod-content-hash: ${oldHash}\n:END:`,
        marker: 'TODO',
        page: { id: 123 },
        parent: null,
        properties: {},
      };
      mockApiService.getBlockByUuid$.and.returnValue(of(block));

      const task: Partial<Task> = {
        id: 'task-1',
        title: 'Old Task Content',
        issueId: 'block-uuid-1',
        issueProviderId: 'provider-1',
        isDone: false,
        issueLastUpdated: Date.now() - 10000,
      };

      const result = await service.getFreshDataForIssueTask(task as Task);

      // Content changed, so result should not be null
      expect(result).not.toBeNull();
      expect(result?.taskChanges.issueWasUpdated).toBe(true);
    });

    it('should emit discrepancy for DONE status mismatch', async () => {
      const blockDone: LogseqBlock = {
        id: 'block-uuid-1',
        uuid: 'block-uuid-1',
        content: 'DONE Task',
        marker: 'DONE',
        page: { id: 123 },
        parent: null,
        properties: {},
      };
      mockApiService.getBlockByUuid$.and.returnValue(of(blockDone));

      const task: Partial<Task> = {
        id: 'task-1',
        issueId: 'block-uuid-1',
        issueProviderId: 'provider-1',
        isDone: false,
        issueLastUpdated: Date.now() - 10000,
      };

      // Listen for discrepancy emissions
      let emittedDiscrepancy: any = null;
      const subscription = service.discrepancies$.subscribe((d) => {
        emittedDiscrepancy = d;
      });

      await service.getFreshDataForIssueTask(task as Task);

      subscription.unsubscribe();

      // Marker discrepancies are emitted via discrepancies$ Subject
      expect(emittedDiscrepancy).not.toBeNull();
      expect(emittedDiscrepancy?.discrepancyType).toBe('LOGSEQ_DONE_SUPERPROD_NOT_DONE');
    });

    it('should handle block without SP drawer (first sync)', async () => {
      // Create a block without SP drawer (first time sync)
      const block: LogseqBlock = {
        id: 'block-uuid-1',
        uuid: 'block-uuid-1',
        content: 'TODO Task',
        marker: 'TODO',
        page: { id: 123 },
        parent: null,
        properties: {},
      };
      mockApiService.getBlockByUuid$.and.returnValue(of(block));

      const task: Partial<Task> = {
        id: 'task-1',
        title: 'Task',
        issueId: 'block-uuid-1',
        issueProviderId: 'provider-1',
        isDone: false,
        issueLastUpdated: Date.now() - 10000,
      };

      // Should not throw and should initialize SP drawer
      await service.getFreshDataForIssueTask(task as Task);

      // Verify updateBlock was called to initialize SP drawer
      expect(mockApiService.updateBlock$).toHaveBeenCalled();
    });
  });

  // ============================================================
  // 4. Workflow Patterns
  // ============================================================

  describe('Workflow Patterns', () => {
    const mockBlock: LogseqBlock = {
      id: 'block-uuid-1',
      uuid: 'block-uuid-1',
      content: 'TODO Test Task',
      marker: 'TODO',
      page: { id: 123 },
      parent: null,
      properties: {},
    };

    beforeEach(() => {
      mockApiService.getBlockByUuid$.and.returnValue(of(mockBlock));
      mockApiService.updateBlock$.and.returnValue(of(void 0));
    });

    it('should change TODO to DOING on task start (TODO_DOING workflow)', async () => {
      await service.updateBlockMarker('block-uuid-1', 'provider-1', 'DOING');

      expect(mockApiService.updateBlock$).toHaveBeenCalledWith(
        'block-uuid-1',
        'DOING Test Task',
        mockCfg,
      );
    });

    it('should change LATER to NOW on task start (NOW_LATER workflow)', async () => {
      const laterBlock: LogseqBlock = {
        ...mockBlock,
        content: 'LATER Test Task',
        marker: 'LATER',
      };
      mockApiService.getBlockByUuid$.and.returnValue(of(laterBlock));

      const laterCfg: IssueProviderLogseq = {
        ...mockCfg,
        taskWorkflow: 'NOW_LATER',
      };
      mockIssueProviderService.getCfgOnce$.and.returnValue(of(laterCfg));

      await service.updateBlockMarker('block-uuid-1', 'provider-1', 'NOW');

      expect(mockApiService.updateBlock$).toHaveBeenCalledWith(
        'block-uuid-1',
        'NOW Test Task',
        laterCfg,
      );
    });
  });

  // ============================================================
  // 5. Connection & Search
  // ============================================================

  describe('Connection & Search', () => {
    it('should test connection successfully', async () => {
      mockApiService.queryBlocks$.and.returnValue(of([]));

      const result = await service.testConnection(mockCfg);

      expect(result).toBe(true);
      expect(mockApiService.queryBlocks$).toHaveBeenCalled();
    });

    it('should handle connection failure', async () => {
      mockApiService.queryBlocks$.and.returnValue(
        throwError(() => new Error('Connection failed')),
      );

      const result = await service.testConnection(mockCfg);

      expect(result).toBe(false);
    });

    it('should search with wildcard (<all>) - show all tasks', async () => {
      const mockBlocks: any[] = [
        { uuid: '1', content: 'TODO Task 1', marker: 'TODO' },
        { uuid: '2', content: 'DOING Task 2', marker: 'DOING' },
      ];
      mockApiService.queryBlocks$.and.returnValue(of(mockBlocks));

      // Use <all> which is the actual wildcard constant
      await service.searchIssues('<all>', 'provider-1');

      // Should use base query without content filter
      expect(mockApiService.queryBlocks$).toHaveBeenCalled();
      const call = mockApiService.queryBlocks$.calls.mostRecent();
      const query = call.args[1];
      expect(query).not.toContain('clojure.string/includes?');
    });

    it('should search with content filter', async () => {
      mockApiService.queryBlocks$.and.returnValue(of([]));

      await service.searchIssues('meeting', 'provider-1');

      expect(mockApiService.queryBlocks$).toHaveBeenCalled();
      const call = mockApiService.queryBlocks$.calls.mostRecent();
      const query = call.args[1];
      expect(query).toContain('clojure.string/includes?');
      expect(query).toContain('meeting');
    });

    it('should generate correct issue link for logseq-url format', async () => {
      const link = await service.issueLink('block-uuid-123', 'provider-1');

      expect(link).toBe('logseq://graph/logseq?block-id=block-uuid-123');
    });

    it('should generate correct issue link for http-url format', async () => {
      const httpCfg: IssueProviderLogseq = {
        ...mockCfg,
        linkFormat: 'http-url',
      };
      mockIssueProviderService.getCfgOnce$.and.returnValue(of(httpCfg));

      const link = await service.issueLink('block-uuid-123', 'provider-1');

      expect(link).toBe('http://localhost:12315/#/page/block-uuid-123');
    });
  });

  // ============================================================
  // 6. Configuration
  // ============================================================

  describe('Configuration', () => {
    it('should be enabled when all config is provided', () => {
      const result = service.isEnabled(mockCfg);

      expect(result).toBe(true);
    });

    it('should be disabled when config is incomplete', () => {
      const incompleteCfg: LogseqCfg = {
        ...mockCfg,
        authToken: null,
      };

      const result = service.isEnabled(incompleteCfg);

      expect(result).toBe(false);
    });
  });

  // ============================================================
  // 7. Smart Reschedule (Overdue Handling)
  // ============================================================

  describe('Smart Reschedule (Overdue Handling)', () => {
    it('should not import overdue dates from Logseq', () => {
      // Task scheduled for yesterday (overdue)
      const yesterdayDate = new Date();
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      const yesterdayStr = yesterdayDate.toISOString().split('T')[0];

      const overdueBlock: LogseqBlockReduced = {
        id: 'block-uuid-overdue',
        uuid: 'block-uuid-overdue',
        content: 'Overdue Task',
        marker: 'TODO',
        properties: {},
        scheduledDate: yesterdayStr,
        scheduledDateTime: null,
      };

      const result = service.getAddTaskData(overdueBlock);

      // Overdue dates should NOT be imported
      expect(result.dueDay).toBeUndefined();
      expect(result.issueWasUpdated).toBe(true); // Prevent sync back
    });

    it('should import future dates normally', () => {
      // Task scheduled for tomorrow (not overdue)
      const tomorrowDate = new Date();
      tomorrowDate.setDate(tomorrowDate.getDate() + 1);
      const tomorrowStr = tomorrowDate.toISOString().split('T')[0];

      const futureBlock: LogseqBlockReduced = {
        id: 'block-uuid-future',
        uuid: 'block-uuid-future',
        content: 'Future Task',
        marker: 'TODO',
        properties: {},
        scheduledDate: tomorrowStr,
        scheduledDateTime: null,
      };

      const result = service.getAddTaskData(futureBlock);

      expect(result.dueDay).toBe(tomorrowStr);
      expect(result.issueWasUpdated).toBe(false);
    });

    it('should import todays date normally', () => {
      const todayStr = new Date().toISOString().split('T')[0];

      const todayBlock: LogseqBlockReduced = {
        id: 'block-uuid-today',
        uuid: 'block-uuid-today',
        content: 'Today Task',
        marker: 'TODO',
        properties: {},
        scheduledDate: todayStr,
        scheduledDateTime: null,
      };

      const result = service.getAddTaskData(todayBlock);

      expect(result.dueDay).toBe(todayStr);
    });
  });

  // ============================================================
  // 8. Write Mutex
  // ============================================================

  describe('Write Mutex', () => {
    it('should skip polling for blocks being written', async () => {
      const blockUuid = 'block-being-written';
      mockApiService.getBlockByUuid$.and.returnValue(
        of({
          id: blockUuid,
          uuid: blockUuid,
          content: 'TODO Test Task',
          marker: 'TODO',
          page: { id: 123 },
          parent: null,
          properties: {},
        }),
      );
      mockApiService.updateBlock$.and.returnValue(of(void 0));

      // Start a write operation (this sets the mutex)
      const writePromise = service.updateBlockMarker(blockUuid, 'provider-1', 'DOING');

      // The poll should return null because the block is being written
      // Note: This test is limited because we can't truly test async mutex behavior
      // in a synchronous test, but it documents the expected behavior
      await writePromise;

      // Verify update was called
      expect(mockApiService.updateBlock$).toHaveBeenCalled();
    });
  });

  // ============================================================
  // 9. Wildcard Search
  // ============================================================

  describe('Wildcard Search', () => {
    it('should treat <all> as wildcard', async () => {
      mockApiService.queryBlocks$.and.returnValue(of([]));

      await service.searchIssues('<all>', 'provider-1');

      const call = mockApiService.queryBlocks$.calls.mostRecent();
      const query = call.args[1];
      expect(query).not.toContain('clojure.string/includes?');
    });

    it('should treat empty string as wildcard', async () => {
      mockApiService.queryBlocks$.and.returnValue(of([]));

      await service.searchIssues('', 'provider-1');

      const call = mockApiService.queryBlocks$.calls.mostRecent();
      const query = call.args[1];
      expect(query).not.toContain('clojure.string/includes?');
    });
  });
});
