import { TestBed } from '@angular/core/testing';
import { LogseqCommonInterfacesService } from './logseq-common-interfaces.service';
import { LogseqApiService } from './logseq-api.service';
import { IssueProviderService } from '../../issue-provider.service';
import { LogseqBlock, LogseqBlockReduced } from './logseq-issue.model';
import { LogseqCfg } from './logseq.model';
import { IssueProviderLogseq } from '../../issue.model';
import { Task } from '../../../tasks/task.model';
import { of, throwError } from 'rxjs';

describe('LogseqCommonInterfacesService', () => {
  let service: LogseqCommonInterfacesService;
  let mockApiService: jasmine.SpyObj<LogseqApiService>;
  let mockIssueProviderService: jasmine.SpyObj<IssueProviderService>;

  const mockCfg: IssueProviderLogseq = {
    id: 'test-provider-id',
    issueProviderKey: 'LOGSEQ',
    isEnabled: true,
    apiUrl: 'http://localhost:12315/api',
    authToken: 'test-token',
    queryFilter:
      '[:find (pull ?b [*]) :where [?b :block/marker ?m] [(contains? #{"TODO" "DOING"} ?m)]]',
    isUpdateBlockOnTaskDone: true,
    linkFormat: 'logseq-url',
    taskWorkflow: 'TODO_DOING',
    superProdReferenceMode: 'property',
    superProdReferenceProperty: 'superProductivity',
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

    TestBed.configureTestingModule({
      providers: [
        LogseqCommonInterfacesService,
        { provide: LogseqApiService, useValue: mockApiService },
        { provide: IssueProviderService, useValue: mockIssueProviderService },
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
        updatedAt: Date.now(),
        properties: {},
        scheduledDate: null,
        scheduledDateTime: null,
      };

      const result = service.getAddTaskData(block);

      expect(result.title).toBe('Simple Task');
      expect(result.dueDay).toBeUndefined();
      expect(result.dueWithTime).toBeUndefined();
      expect(result.isDone).toBe(false);
      expect(result.issueMarker).toBe('TODO');
    });

    it('should import task with SCHEDULED date only', () => {
      const block: LogseqBlockReduced = {
        id: 'block-uuid-2',
        uuid: 'block-uuid-2',
        content: 'Task with Date',
        marker: 'TODO',
        updatedAt: Date.now(),
        properties: {},
        scheduledDate: '2026-01-15',
        scheduledDateTime: null,
      };

      const result = service.getAddTaskData(block);

      expect(result.title).toBe('Task with Date');
      expect(result.dueDay).toBe('2026-01-15');
      expect(result.dueWithTime).toBeUndefined();
    });

    it('should import task with SCHEDULED date and time', () => {
      const timestamp = new Date('2026-01-15T14:30:00').getTime();
      const block: LogseqBlockReduced = {
        id: 'block-uuid-3',
        uuid: 'block-uuid-3',
        content: 'Task with DateTime',
        marker: 'DOING',
        updatedAt: Date.now(),
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
        updatedAt: Date.now(),
        properties: {},
      };

      const doneBlock: LogseqBlockReduced = {
        id: 'uuid-2',
        uuid: 'uuid-2',
        content: 'DONE Task',
        marker: 'DONE',
        updatedAt: Date.now(),
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
      createdAt: Date.now(),
      updatedAt: Date.now(),
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
      const call = mockApiService.updateBlock$.calls.mostRecent();
      expect(call.args[1]).toContain('SCHEDULED:');
      expect(call.args[1]).toContain('2026-01-20');
      expect(call.args[1]).not.toMatch(/\d{2}:\d{2}/); // No time
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
      const call = mockApiService.updateBlock$.calls.mostRecent();
      expect(call.args[1]).toContain('SCHEDULED:');
      expect(call.args[1]).toContain('2026-01-20');
      expect(call.args[1]).toMatch(/\d{2}:\d{2}/); // Has time
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

      const call = mockApiService.updateBlock$.calls.mostRecent();
      expect(call.args[1]).toMatch(/SCHEDULED:.*\d{2}:\d{2}/); // Now has time
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

      const call = mockApiService.updateBlock$.calls.mostRecent();
      expect(call.args[1]).toContain('SCHEDULED:');
      expect(call.args[1]).not.toMatch(/\d{2}:\d{2}/); // Time removed
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

      const call = mockApiService.updateBlock$.calls.mostRecent();
      expect(call.args[1]).not.toContain('SCHEDULED:');
    });
  });

  // ============================================================
  // 3. Change Detection (Logseq → SuperProd)
  // ============================================================

  describe('Change Detection (Logseq → SuperProd)', () => {
    it('should detect date change in Logseq', async () => {
      const blockWithNewDate: LogseqBlock = {
        id: 'block-uuid-1',
        uuid: 'block-uuid-1',
        content: 'TODO Task\nSCHEDULED: <2026-01-20 Mon>',
        marker: 'TODO',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        page: { id: 123 },
        parent: null,
        properties: {},
      };
      mockApiService.getBlockByUuid$.and.returnValue(of(blockWithNewDate));

      const task: Partial<Task> = {
        id: 'task-1',
        issueId: 'block-uuid-1',
        issueProviderId: 'provider-1',
        dueDay: '2026-01-15', // Old date
        issueLastUpdated: Date.now() - 10000,
      };

      const result = await service.getFreshDataForIssueTask(task as Task);

      expect(result).not.toBeNull();
      expect(result?.taskChanges.dueDay).toBe('2026-01-20');
    });

    it('should detect time change in Logseq', async () => {
      const newTimestamp = new Date('2026-01-15T16:30:00').getTime();
      const blockWithNewTime: LogseqBlock = {
        id: 'block-uuid-1',
        uuid: 'block-uuid-1',
        content: 'TODO Task\nSCHEDULED: <2026-01-15 Wed 16:30>',
        marker: 'TODO',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        page: { id: 123 },
        parent: null,
        properties: {},
      };
      mockApiService.getBlockByUuid$.and.returnValue(of(blockWithNewTime));

      const oldTimestamp = new Date('2026-01-15T14:00:00').getTime();
      const task: Partial<Task> = {
        id: 'task-1',
        issueId: 'block-uuid-1',
        issueProviderId: 'provider-1',
        dueWithTime: oldTimestamp,
        issueLastUpdated: Date.now() - 10000,
      };

      const result = await service.getFreshDataForIssueTask(task as Task);

      expect(result).not.toBeNull();
      expect(result?.taskChanges.dueWithTime).toBe(newTimestamp);
    });

    it('should detect status change in Logseq', async () => {
      const blockDone: LogseqBlock = {
        id: 'block-uuid-1',
        uuid: 'block-uuid-1',
        content: 'DONE Task',
        marker: 'DONE',
        createdAt: Date.now(),
        updatedAt: Date.now(),
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
        issueMarker: 'TODO',
        issueLastUpdated: Date.now() - 10000,
      };

      const result = await service.getFreshDataForIssueTask(task as Task);

      expect(result).not.toBeNull();
      expect(result?.taskChanges.isDone).toBe(true);
    });

    it('should return null when no changes detected', async () => {
      const block: LogseqBlock = {
        id: 'block-uuid-1',
        uuid: 'block-uuid-1',
        content: 'TODO Task\nSCHEDULED: <2026-01-15 Wed>',
        marker: 'TODO',
        createdAt: Date.now() - 20000,
        updatedAt: Date.now() - 20000,
        page: { id: 123 },
        parent: null,
        properties: {},
      };
      mockApiService.getBlockByUuid$.and.returnValue(of(block));

      const task: Partial<Task> = {
        id: 'task-1',
        issueId: 'block-uuid-1',
        issueProviderId: 'provider-1',
        dueDay: '2026-01-15',
        isDone: false,
        issueMarker: 'TODO',
        issueLastUpdated: Date.now() - 10000,
      };

      const result = await service.getFreshDataForIssueTask(task as Task);

      expect(result).toBeNull();
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
      createdAt: Date.now(),
      updatedAt: Date.now(),
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

    it('should search with wildcard (*) - show all tasks', async () => {
      const mockBlocks: any[] = [
        { uuid: '1', content: 'TODO Task 1', marker: 'TODO' },
        { uuid: '2', content: 'DOING Task 2', marker: 'DOING' },
      ];
      mockApiService.queryBlocks$.and.returnValue(of(mockBlocks));

      await service.searchIssues('*', 'provider-1');

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
    it('should respect isUpdateBlockOnTaskDone setting', async () => {
      const disabledCfg: IssueProviderLogseq = {
        ...mockCfg,
        isUpdateBlockOnTaskDone: false,
      };
      mockIssueProviderService.getCfgOnce$.and.returnValue(of(disabledCfg));

      const block: LogseqBlock = {
        id: 'block-uuid-1',
        uuid: 'block-uuid-1',
        content: 'TODO Test Task',
        marker: 'TODO',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        page: { id: 123 },
        parent: null,
        properties: {},
      };
      mockApiService.getBlockByUuid$.and.returnValue(of(block));
      mockApiService.updateBlock$.and.returnValue(of(void 0));

      const task: Partial<Task> = {
        id: 'task-1',
        issueId: 'block-uuid-1',
        issueProviderId: 'provider-1',
        isDone: true,
      };

      await service.updateIssueFromTask(task as Task);

      // Should NOT update marker to DONE when setting is disabled
      expect(mockApiService.updateBlock$).not.toHaveBeenCalled();
    });

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
});
