import { TestBed } from '@angular/core/testing';
import { TaskShortcutService } from './task-shortcut.service';
import { TaskFocusService } from './task-focus.service';
import { TaskService } from './task.service';
import { GlobalConfigService } from '../config/global-config.service';
import { signal } from '@angular/core';

describe('TaskShortcutService', () => {
  let service: TaskShortcutService;
  let mockTaskFocusService: {
    focusedTaskId: ReturnType<typeof signal<string | null>>;
    lastFocusedTaskComponent: ReturnType<typeof signal<any>>;
  };
  let mockTaskService: jasmine.SpyObj<TaskService> & {
    selectedTaskId: ReturnType<typeof signal<string | null>>;
    currentTaskId: ReturnType<typeof signal<string | null>>;
  };
  let mockConfigService: {
    cfg: ReturnType<typeof signal<any>>;
    appFeatures: ReturnType<typeof signal<any>>;
  };

  const defaultKeyboardConfig = {
    togglePlay: 'Y',
    taskEditTitle: 'Enter',
    taskToggleDetailPanelOpen: 'I',
    taskOpenNotesPanel: 'N',
    taskOpenNotesFullscreen: 'Shift+N',
    taskOpenEstimationDialog: 'T',
    taskSchedule: 'S',
    taskToggleDone: 'D',
    taskAddSubTask: 'A',
    taskAddAttachment: null,
    taskDelete: 'Backspace',
    taskMoveToProject: 'P',
    taskEditTags: 'G',
    taskOpenContextMenu: null,
    moveToBacklog: 'B',
    moveToTodaysTasks: 'F',
    selectPreviousTask: 'K',
    selectNextTask: 'J',
    collapseSubTasks: 'H',
    expandSubTasks: 'L',
    moveTaskUp: null,
    moveTaskDown: null,
    moveTaskToTop: null,
    moveTaskToBottom: null,
  };

  const createKeyboardEvent = (key: string, code?: string): KeyboardEvent => {
    return new KeyboardEvent('keydown', {
      key,
      code: code || (key.length === 1 ? `Key${key.toUpperCase()}` : key),
      bubbles: true,
      cancelable: true,
    });
  };

  beforeEach(() => {
    // Create signal-based mocks
    mockTaskFocusService = {
      focusedTaskId: signal<string | null>(null),
      lastFocusedTaskComponent: signal<any>(null),
    };

    mockTaskService = {
      selectedTaskId: signal<string | null>(null),
      currentTaskId: signal<string | null>(null),
      setCurrentId: jasmine.createSpy('setCurrentId'),
      toggleStartTask: jasmine.createSpy('toggleStartTask'),
    } as any;

    mockConfigService = {
      cfg: signal({
        keyboard: defaultKeyboardConfig,
        appFeatures: {
          isTimeTrackingEnabled: true,
        },
      }),
      appFeatures: signal({
        isTimeTrackingEnabled: true,
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        TaskShortcutService,
        { provide: TaskFocusService, useValue: mockTaskFocusService },
        { provide: TaskService, useValue: mockTaskService },
        { provide: GlobalConfigService, useValue: mockConfigService },
      ],
    });

    service = TestBed.inject(TaskShortcutService);
  });

  describe('handleTaskShortcuts - togglePlay (Y key)', () => {
    describe('when focused task exists', () => {
      it('should delegate to focused task component togglePlayPause method', () => {
        // Arrange
        const mockTaskComponent = {
          task: () => ({ id: 'focused-task-1' }),
          togglePlayPause: jasmine.createSpy('togglePlayPause'),
          taskContextMenu: () => undefined, // No context menu open
        };
        mockTaskFocusService.focusedTaskId.set('focused-task-1');
        mockTaskFocusService.lastFocusedTaskComponent.set(mockTaskComponent);

        const event = createKeyboardEvent('Y');
        spyOn(event, 'preventDefault');

        // Act
        const result = service.handleTaskShortcuts(event);

        // Assert
        expect(result).toBe(true);
        expect(event.preventDefault).toHaveBeenCalled();
        expect(mockTaskComponent.togglePlayPause).toHaveBeenCalled();
        expect(mockTaskService.setCurrentId).not.toHaveBeenCalled();
        expect(mockTaskService.toggleStartTask).not.toHaveBeenCalled();
      });
    });

    describe('when no focused task but selected task exists', () => {
      it('should start tracking selected task when not currently tracking it', () => {
        // Arrange
        mockTaskFocusService.focusedTaskId.set(null);
        mockTaskService.selectedTaskId.set('selected-task-1');
        mockTaskService.currentTaskId.set(null);

        const event = createKeyboardEvent('Y');
        spyOn(event, 'preventDefault');

        // Act
        const result = service.handleTaskShortcuts(event);

        // Assert
        expect(result).toBe(true);
        expect(event.preventDefault).toHaveBeenCalled();
        expect(mockTaskService.setCurrentId).toHaveBeenCalledWith('selected-task-1');
        expect(mockTaskService.toggleStartTask).not.toHaveBeenCalled();
      });

      it('should start tracking selected task when tracking a different task', () => {
        // Arrange
        mockTaskFocusService.focusedTaskId.set(null);
        mockTaskService.selectedTaskId.set('selected-task-1');
        mockTaskService.currentTaskId.set('other-task');

        const event = createKeyboardEvent('Y');
        spyOn(event, 'preventDefault');

        // Act
        const result = service.handleTaskShortcuts(event);

        // Assert
        expect(result).toBe(true);
        expect(event.preventDefault).toHaveBeenCalled();
        expect(mockTaskService.setCurrentId).toHaveBeenCalledWith('selected-task-1');
      });

      it('should stop tracking when selected task is already being tracked', () => {
        // Arrange
        mockTaskFocusService.focusedTaskId.set(null);
        mockTaskService.selectedTaskId.set('selected-task-1');
        mockTaskService.currentTaskId.set('selected-task-1');

        const event = createKeyboardEvent('Y');
        spyOn(event, 'preventDefault');

        // Act
        const result = service.handleTaskShortcuts(event);

        // Assert
        expect(result).toBe(true);
        expect(event.preventDefault).toHaveBeenCalled();
        expect(mockTaskService.setCurrentId).toHaveBeenCalledWith(null);
      });
    });

    describe('when neither focused nor selected task exists', () => {
      it('should use global toggle behavior', () => {
        // Arrange
        mockTaskFocusService.focusedTaskId.set(null);
        mockTaskService.selectedTaskId.set(null);

        const event = createKeyboardEvent('Y');
        spyOn(event, 'preventDefault');

        // Act
        const result = service.handleTaskShortcuts(event);

        // Assert
        expect(result).toBe(true);
        expect(event.preventDefault).toHaveBeenCalled();
        expect(mockTaskService.toggleStartTask).toHaveBeenCalled();
        expect(mockTaskService.setCurrentId).not.toHaveBeenCalled();
      });
    });

    describe('when time tracking is disabled', () => {
      it('should not handle Y key when time tracking is disabled', () => {
        // Arrange
        mockConfigService.cfg.set({
          keyboard: defaultKeyboardConfig,
          appFeatures: {
            isTimeTrackingEnabled: false,
          },
        });
        mockConfigService.appFeatures.set({
          isTimeTrackingEnabled: false,
        });
        mockTaskFocusService.focusedTaskId.set(null);
        mockTaskService.selectedTaskId.set('selected-task-1');

        const event = createKeyboardEvent('Y');
        spyOn(event, 'preventDefault');

        // Act
        const result = service.handleTaskShortcuts(event);

        // Assert
        expect(result).toBe(false);
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(mockTaskService.setCurrentId).not.toHaveBeenCalled();
        expect(mockTaskService.toggleStartTask).not.toHaveBeenCalled();
      });
    });

    describe('priority: focused task takes priority over selected task', () => {
      it('should use focused task even when selected task is different', () => {
        // Arrange
        const mockTaskComponent = {
          task: () => ({ id: 'focused-task-1' }),
          togglePlayPause: jasmine.createSpy('togglePlayPause'),
          taskContextMenu: () => undefined, // No context menu open
        };
        mockTaskFocusService.focusedTaskId.set('focused-task-1');
        mockTaskFocusService.lastFocusedTaskComponent.set(mockTaskComponent);
        mockTaskService.selectedTaskId.set('selected-task-2'); // Different task selected

        const event = createKeyboardEvent('Y');
        spyOn(event, 'preventDefault');

        // Act
        const result = service.handleTaskShortcuts(event);

        // Assert
        expect(result).toBe(true);
        expect(mockTaskComponent.togglePlayPause).toHaveBeenCalled();
        expect(mockTaskService.setCurrentId).not.toHaveBeenCalled();
      });
    });
  });

  describe('other shortcuts require focused task', () => {
    it('should delegate taskOpenNotesPanel shortcut to focused task component', () => {
      const mockTaskComponent = {
        task: () => ({ id: 'focused-task-1' }),
        openNotesPanel: jasmine.createSpy('openNotesPanel'),
        taskContextMenu: () => undefined,
      };
      mockTaskFocusService.focusedTaskId.set('focused-task-1');
      mockTaskFocusService.lastFocusedTaskComponent.set(mockTaskComponent);

      const event = createKeyboardEvent('N');
      spyOn(event, 'preventDefault');

      const result = service.handleTaskShortcuts(event);

      expect(result).toBe(true);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockTaskComponent.openNotesPanel).toHaveBeenCalled();
    });

    it('should return false for non-togglePlay shortcuts when no focused task', () => {
      // Arrange
      mockTaskFocusService.focusedTaskId.set(null);

      // Various other shortcut keys
      const otherKeys = ['D', 'Enter', 'ArrowUp', 'ArrowDown'];

      for (const key of otherKeys) {
        const event = createKeyboardEvent(key);
        spyOn(event, 'preventDefault');

        // Act
        const result = service.handleTaskShortcuts(event);

        // Assert
        expect(result).toBe(false);
      }
    });
  });

  describe('focusedTaskId recovery from active element', () => {
    /**
     * Regression: a `focusout` from a textarea inside a task can clear
     * focusedTaskId without a paired focusin firing on the task host (e.g.
     * after addSubtask's title-commit refocuses the host that was already
     * the implicit focus target). The shortcut handler must recover the
     * id from document.activeElement so keystrokes don't silently drop.
     *
     * Tests stub `document.activeElement` directly rather than calling
     * `el.focus()` — headless Chrome only updates activeElement when the
     * test iframe has window focus, which is not guaranteed inside a
     * large suite (other tests can steal/drop focus).
     */
    let taskEl: HTMLElement;
    let activeElementStubbed = false;

    const stubActiveElement = (el: Element | null): void => {
      Object.defineProperty(document, 'activeElement', {
        configurable: true,
        get: () => el,
      });
      activeElementStubbed = true;
    };

    afterEach(() => {
      if (activeElementStubbed) {
        delete (document as unknown as { activeElement?: unknown }).activeElement;
        activeElementStubbed = false;
      }
      taskEl?.remove();
    });

    const createTaskEl = (taskId: string): HTMLElement => {
      const el = document.createElement('task');
      el.setAttribute('data-task-id', taskId);
      document.body.appendChild(el);
      return el;
    };

    it('recovers focusedTaskId from document.activeElement and dispatches the shortcut', () => {
      taskEl = createTaskEl('recovered-task');
      stubActiveElement(taskEl);

      const mockTaskComponent = {
        task: () => ({ id: 'recovered-task' }),
        toggleDoneKeyboard: jasmine.createSpy('toggleDoneKeyboard'),
        taskContextMenu: () => undefined,
      };
      mockTaskFocusService.focusedTaskId.set(null); // simulate the bug
      mockTaskFocusService.lastFocusedTaskComponent.set(mockTaskComponent);

      const event = createKeyboardEvent('D');
      spyOn(event, 'preventDefault');

      const result = service.handleTaskShortcuts(event);

      expect(result).toBe(true);
      expect(mockTaskComponent.toggleDoneKeyboard).toHaveBeenCalled();
    });

    it('skips delegation when active element id does not match lastFocusedTaskComponent', () => {
      // active element is a different task than lastFocusedTaskComponent
      taskEl = createTaskEl('other-task');
      stubActiveElement(taskEl);

      const mockTaskComponent = {
        task: () => ({ id: 'stale-task' }),
        toggleDoneKeyboard: jasmine.createSpy('toggleDoneKeyboard'),
        taskContextMenu: () => undefined,
      };
      mockTaskFocusService.focusedTaskId.set(null);
      mockTaskFocusService.lastFocusedTaskComponent.set(mockTaskComponent);

      const event = createKeyboardEvent('D');

      const result = service.handleTaskShortcuts(event);

      // Recovery picks up 'other-task' from DOM, but lastFocusedTaskComponent
      // points at 'stale-task' — guard prevents delegating to wrong component.
      expect(result).toBe(true); // shortcut matched, just didn't delegate
      expect(mockTaskComponent.toggleDoneKeyboard).not.toHaveBeenCalled();
    });

    it('returns false when active element is outside any task', () => {
      // body is the active element (not inside a <task>)
      stubActiveElement(document.body);
      mockTaskFocusService.focusedTaskId.set(null);
      mockTaskFocusService.lastFocusedTaskComponent.set(null);

      const event = createKeyboardEvent('D');

      const result = service.handleTaskShortcuts(event);

      expect(result).toBe(false);
    });

    it('recovers when active element is a descendant of <task> (e.g. button inside)', () => {
      // Real-world shape: a focused button inside a task host. closest('task')
      // walks up to the host so recovery still resolves the id.
      taskEl = createTaskEl('host-with-child-focus');
      const innerBtn = document.createElement('button');
      taskEl.appendChild(innerBtn);
      stubActiveElement(innerBtn);

      const mockTaskComponent = {
        task: () => ({ id: 'host-with-child-focus' }),
        toggleDoneKeyboard: jasmine.createSpy('toggleDoneKeyboard'),
        taskContextMenu: () => undefined,
      };
      mockTaskFocusService.focusedTaskId.set(null);
      mockTaskFocusService.lastFocusedTaskComponent.set(mockTaskComponent);

      const event = createKeyboardEvent('D');
      const result = service.handleTaskShortcuts(event);

      expect(result).toBe(true);
      expect(mockTaskComponent.toggleDoneKeyboard).toHaveBeenCalled();
    });
  });
});
