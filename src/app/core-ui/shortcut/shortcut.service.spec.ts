import { TestBed } from '@angular/core/testing';
import { ShortcutService } from './shortcut.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { Router } from '@angular/router';
import { LayoutService } from '../layout/layout.service';
import { MatDialog } from '@angular/material/dialog';
import { TaskService } from '../../features/tasks/task.service';
import { WorkContextService } from '../../features/work-context/work-context.service';
import { ActivatedRoute } from '@angular/router';
import { UiHelperService } from '../../features/ui-helper/ui-helper.service';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { Store } from '@ngrx/store';
import { PluginBridgeService } from '../../plugins/plugin-bridge.service';
import { TaskShortcutService } from '../../features/tasks/task-shortcut.service';
import { TaskRepeatCfgService } from '../../features/task-repeat-cfg/task-repeat-cfg.service';
import { OverlayContainer } from '@angular/cdk/overlay';
import { SnackService } from '../../core/snack/snack.service';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { TaskReminderOptionId } from '../../features/tasks/task.model';

describe('ShortcutService', () => {
  let service: ShortcutService;
  let mockTaskShortcutService: any;
  let mockRouter: any;
  let mockConfigService: any;
  let mockTaskService: any;
  let mockTaskRepeatCfgService: any;
  let onAddTaskViaIpcListener: (payload: any) => void;

  beforeEach(() => {
    mockTaskShortcutService = {
      handleTaskShortcuts: jasmine
        .createSpy('handleTaskShortcuts')
        .and.returnValue(false),
      handleTogglePlayFallback: jasmine
        .createSpy('handleTogglePlayFallback')
        .and.returnValue(false),
    };
    mockRouter = {
      navigate: jasmine.createSpy('navigate'),
      url: '/',
    };
    mockConfigService = {
      cfg: signal({
        keyboard: {
          goToScheduledView: 'Shift+S',
        },
      }),
      appFeatures: signal({
        isFocusModeEnabled: true,
      }),
    };
    mockTaskService = {
      currentTaskId: signal(null),
      add: jasmine.createSpy('add').and.returnValue('TASK_ID'),
      getByIdOnce$: jasmine
        .createSpy('getByIdOnce$')
        .and.returnValue(of({ id: 'TASK_ID' })),
      scheduleTask: jasmine.createSpy('scheduleTask'),
    };
    mockTaskRepeatCfgService = {
      addTaskRepeatCfgToTask: jasmine.createSpy('addTaskRepeatCfgToTask'),
    };

    (window as any).ea = {
      on: jasmine.createSpy('on'),
      onAddTaskViaIpc: jasmine.createSpy('onAddTaskViaIpc').and.callFake((listener) => {
        onAddTaskViaIpcListener = listener;
      }),
      showOrFocus: jasmine.createSpy('showOrFocus'),
    };

    TestBed.configureTestingModule({
      providers: [
        ShortcutService,
        { provide: TaskShortcutService, useValue: mockTaskShortcutService },
        { provide: Router, useValue: mockRouter },
        { provide: GlobalConfigService, useValue: mockConfigService },
        { provide: LayoutService, useValue: { isNavOpen: signal(false) } },
        { provide: MatDialog, useValue: { openDialogs: [] } },
        { provide: TaskService, useValue: mockTaskService },
        { provide: WorkContextService, useValue: { activeWorkContext$: signal({}) } },
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
        { provide: UiHelperService, useValue: {} },
        { provide: SyncWrapperService, useValue: {} },
        { provide: Store, useValue: { dispatch: jasmine.createSpy('dispatch') } },
        { provide: PluginBridgeService, useValue: { shortcuts: signal([]) } },
        { provide: TaskRepeatCfgService, useValue: mockTaskRepeatCfgService },
        { provide: SnackService, useValue: { open: jasmine.createSpy('open') } },
        {
          provide: OverlayContainer,
          useValue: {
            getContainerElement: () => ({
              querySelector: () => null,
              children: [],
            }),
          },
        },
      ],
    });

    service = TestBed.inject(ShortcutService);
  });

  describe('handleKeyDown', () => {
    it('should NOT navigate to schedule if TaskShortcutService handled Shift+S', () => {
      mockTaskShortcutService.handleTaskShortcuts.and.returnValue(true);
      const ev = new KeyboardEvent('keydown', {
        code: 'KeyS',
        shiftKey: true,
      });
      Object.defineProperty(ev, 'target', { value: document.body });

      service.handleKeyDown(ev);

      expect(mockTaskShortcutService.handleTaskShortcuts).toHaveBeenCalledWith(ev);
      expect(mockRouter.navigate).not.toHaveBeenCalled();
    });

    it('should navigate to schedule if TaskShortcutService did NOT handle Shift+S', () => {
      mockTaskShortcutService.handleTaskShortcuts.and.returnValue(false);
      const ev = new KeyboardEvent('keydown', {
        code: 'KeyS',
        shiftKey: true,
      });
      Object.defineProperty(ev, 'target', { value: document.body });

      service.handleKeyDown(ev);

      expect(mockTaskShortcutService.handleTaskShortcuts).toHaveBeenCalledWith(ev);
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/schedule']);
    });
  });

  describe('onAddTaskViaIpc', () => {
    it('should add a task when receiving IPC event', () => {
      const payload = {
        title: 'Test Task',
        isAddToBacklog: false,
        taskData: { projectId: 'P_ID' },
        isAddToBottom: true,
      };

      onAddTaskViaIpcListener(payload);

      expect(mockTaskService.add).toHaveBeenCalledWith(
        'Test Task',
        false,
        { projectId: 'P_ID' },
        true,
      );
    });

    it('should schedule task if dueWithTime is provided', () => {
      const payload = {
        title: 'Timed Task',
        isAddToBacklog: false,
        taskData: {
          projectId: 'P_ID',
          dueWithTime: 123456789,
        },
        isAddToBottom: false,
        remindOption: TaskReminderOptionId.AtStart,
      };

      onAddTaskViaIpcListener(payload);

      expect(mockTaskService.scheduleTask).toHaveBeenCalledWith(
        { id: 'TASK_ID' },
        123456789,
        TaskReminderOptionId.AtStart,
        false,
      );
    });

    it('should add repeat config if provided', () => {
      const payload = {
        title: 'Repeat Task',
        isAddToBacklog: false,
        taskData: { projectId: 'P_ID' },
        isAddToBottom: false,
        repeatQuickSetting: 'DAILY',
        repeatCfg: { some: 'config' },
      };

      onAddTaskViaIpcListener(payload);

      expect(mockTaskRepeatCfgService.addTaskRepeatCfgToTask).toHaveBeenCalledWith(
        'TASK_ID',
        'P_ID',
        { some: 'config' },
      );
    });
  });
});
