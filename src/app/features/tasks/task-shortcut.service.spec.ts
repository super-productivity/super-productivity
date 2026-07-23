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
    taskScheduleDeadline: 'Shift+S',
    taskToggleDone: 'D',
    taskAddSubTask: 'A',
    taskAddAttachment: null,
    taskDelete: 'Backspace',
    taskMoveToProject: 'P',
    taskEditTags: 'G',
    taskOpenContextMenu: null,
    moveToBacklog: 'B',
    taskScheduleToday: 'F',
    selectPreviousTask: 'K',
    selectNextTask: 'J',
    collapseSubTasks: 'H',
    expandSubTasks: 'L',
    moveTaskUp: null,
    moveTaskDown: null,
    moveTaskToTop: null,
    moveTaskToBottom: null,
  };

  const createKeyboardEvent = (
    key: string,
    code?: string,
    init: KeyboardEventInit = {},
  ): KeyboardEvent => {
    return new KeyboardEvent('keydown', {
      key,
      code: code || (key.length === 1 ? `Key${key.toUpperCase()}` : key),
      bubbles: true,
      cancelable: true,
      ...init,
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
      scheduleForTodayById: jasmine.createSpy('scheduleForTodayById'),
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

  // The shortcut handler now treats the DOM as authoritative for task focus
  // (#8851): a task shortcut only fires when document.activeElement is inside
  // the <task> matching focusedTaskId. Helper stubs both so "a task is focused"
  // tests reflect real focus. activeElement is stubbed directly rather than via
  // el.focus() — headless Chrome only updates activeElement when the test iframe
  // has window focus, which is not guaranteed inside a large suite.
  let focusedTaskEl: HTMLElement | null = null;
  let activeElementStubbed = false;

  const stubActiveElement = (el: Element | null): void => {
    Object.defineProperty(document, 'activeElement', {
      configurable: true,
      get: () => el,
    });
    activeElementStubbed = true;
  };

  const setFocusedTask = (id: string): HTMLElement => {
    focusedTaskEl = document.createElement('task');
    focusedTaskEl.setAttribute('data-task-id', id);
    document.body.appendChild(focusedTaskEl);
    stubActiveElement(focusedTaskEl);
    mockTaskFocusService.focusedTaskId.set(id);
    return focusedTaskEl;
  };

  afterEach(() => {
    focusedTaskEl?.remove();
    focusedTaskEl = null;
    if (activeElementStubbed) {
      delete (document as unknown as { activeElement?: unknown }).activeElement;
      activeElementStubbed = false;
    }
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
        setFocusedTask('focused-task-1');
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
      it('should return false (delegating to ShortcutService fallback)', () => {
        // Arrange
        mockTaskFocusService.focusedTaskId.set(null);
        mockTaskService.selectedTaskId.set('selected-task-1');
        mockTaskService.currentTaskId.set(null);

        const event = createKeyboardEvent('Y');
        spyOn(event, 'preventDefault');

        // Act
        const result = service.handleTaskShortcuts(event);

        // Assert
        expect(result).toBe(false);
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(mockTaskService.setCurrentId).not.toHaveBeenCalled();
      });
    });

    describe('when neither focused nor selected task exists', () => {
      it('should return false (delegating to ShortcutService fallback)', () => {
        // Arrange
        mockTaskFocusService.focusedTaskId.set(null);
        mockTaskService.selectedTaskId.set(null);

        const event = createKeyboardEvent('Y');
        spyOn(event, 'preventDefault');

        // Act
        const result = service.handleTaskShortcuts(event);

        // Assert
        expect(result).toBe(false);
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(mockTaskService.toggleStartTask).not.toHaveBeenCalled();
      });
    });

    describe('handleTogglePlayFallback', () => {
      it('should start tracking selected task when not currently tracking it', () => {
        // Arrange
        mockTaskService.selectedTaskId.set('selected-task-1');
        mockTaskService.currentTaskId.set(null);

        const event = createKeyboardEvent('Y');
        spyOn(event, 'preventDefault');

        // Act
        const result = service.handleTogglePlayFallback(event);

        // Assert
        expect(result).toBe(true);
        expect(event.preventDefault).toHaveBeenCalled();
        expect(mockTaskService.setCurrentId).toHaveBeenCalledWith('selected-task-1');
      });

      it('should stop tracking when selected task is already being tracked', () => {
        // Arrange
        mockTaskService.selectedTaskId.set('selected-task-1');
        mockTaskService.currentTaskId.set('selected-task-1');

        const event = createKeyboardEvent('Y');
        spyOn(event, 'preventDefault');

        // Act
        const result = service.handleTogglePlayFallback(event);

        // Assert
        expect(result).toBe(true);
        expect(event.preventDefault).toHaveBeenCalled();
        expect(mockTaskService.setCurrentId).toHaveBeenCalledWith(null);
      });

      it('should use global toggle behavior when no task is selected', () => {
        // Arrange
        mockTaskService.selectedTaskId.set(null);

        const event = createKeyboardEvent('Y');
        spyOn(event, 'preventDefault');

        // Act
        const result = service.handleTogglePlayFallback(event);

        // Assert
        expect(result).toBe(true);
        expect(event.preventDefault).toHaveBeenCalled();
        expect(mockTaskService.toggleStartTask).toHaveBeenCalled();
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
        setFocusedTask('focused-task-1');
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
    it('should close an open context menu through its inner component', () => {
      const innerMenu = {
        onClose: jasmine.createSpy('onClose'),
      };
      const contextMenu = {
        isOpen: signal(true),
        taskContextMenuInner: () => innerMenu,
      };
      const mockTaskComponent = {
        task: () => ({ id: 'focused-task-1' }),
        openNotesPanel: jasmine.createSpy('openNotesPanel'),
        taskContextMenu: () => contextMenu,
      };
      setFocusedTask('focused-task-1');
      mockTaskFocusService.lastFocusedTaskComponent.set(mockTaskComponent);

      const result = service.handleTaskShortcuts(createKeyboardEvent('N'));

      expect(result).toBe(true);
      expect(innerMenu.onClose).toHaveBeenCalledTimes(1);
      expect(mockTaskComponent.openNotesPanel).toHaveBeenCalled();
    });

    it('should delegate taskOpenNotesPanel shortcut to focused task component', () => {
      const mockTaskComponent = {
        task: () => ({ id: 'focused-task-1' }),
        openNotesPanel: jasmine.createSpy('openNotesPanel'),
        taskContextMenu: () => undefined,
      };
      setFocusedTask('focused-task-1');
      mockTaskFocusService.lastFocusedTaskComponent.set(mockTaskComponent);

      const event = createKeyboardEvent('N');
      spyOn(event, 'preventDefault');

      const result = service.handleTaskShortcuts(event);

      expect(result).toBe(true);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockTaskComponent.openNotesPanel).toHaveBeenCalled();
    });

    it('should delegate taskScheduleDeadline shortcut to focused task component', () => {
      const mockTaskComponent = {
        task: () => ({ id: 'focused-task-1' }),
        openDeadlineDialog: jasmine.createSpy('openDeadlineDialog'),
        taskContextMenu: () => undefined,
      };
      setFocusedTask('focused-task-1');
      mockTaskFocusService.lastFocusedTaskComponent.set(mockTaskComponent);

      const event = createKeyboardEvent('S', 'KeyS', { shiftKey: true });
      spyOn(event, 'preventDefault');

      const result = service.handleTaskShortcuts(event);

      expect(result).toBe(true);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockTaskComponent.openDeadlineDialog).toHaveBeenCalled();
    });

    it('should open the task context menu when the native Menu key is pressed', () => {
      const mockTaskComponent = {
        task: () => ({ id: 'focused-task-1' }),
        openContextMenu: jasmine.createSpy('openContextMenu'),
        taskContextMenu: () => undefined,
      };
      setFocusedTask('focused-task-1');
      mockTaskFocusService.lastFocusedTaskComponent.set(mockTaskComponent);

      const event = createKeyboardEvent('ContextMenu', 'ContextMenu');
      spyOn(event, 'preventDefault');

      const result = service.handleTaskShortcuts(event);

      expect(result).toBe(true);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockTaskComponent.openContextMenu).toHaveBeenCalledWith(event);
    });

    it('should recognize Linux Menu key events by physical ContextMenu code', () => {
      const mockTaskComponent = {
        task: () => ({ id: 'focused-task-1' }),
        openContextMenu: jasmine.createSpy('openContextMenu'),
        taskContextMenu: () => undefined,
      };
      setFocusedTask('focused-task-1');
      mockTaskFocusService.lastFocusedTaskComponent.set(mockTaskComponent);

      const event = createKeyboardEvent('Unidentified', 'ContextMenu');
      spyOn(event, 'preventDefault');

      const result = service.handleTaskShortcuts(event);

      expect(result).toBe(true);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockTaskComponent.openContextMenu).toHaveBeenCalledWith(event);
    });

    it('should not treat modified Menu key presses as the native context menu key', () => {
      const mockTaskComponent = {
        task: () => ({ id: 'focused-task-1' }),
        openContextMenu: jasmine.createSpy('openContextMenu'),
        taskContextMenu: () => undefined,
      };
      setFocusedTask('focused-task-1');
      mockTaskFocusService.lastFocusedTaskComponent.set(mockTaskComponent);

      const event = createKeyboardEvent('ContextMenu', 'ContextMenu', {
        ctrlKey: true,
      });

      const result = service.handleTaskShortcuts(event);

      expect(result).toBe(false);
      expect(mockTaskComponent.openContextMenu).not.toHaveBeenCalled();
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

  describe('copy focused task title shortcut', () => {
    let originalClipboardDescriptor: PropertyDescriptor | undefined;
    let writeText: jasmine.Spy;

    beforeEach(() => {
      writeText = jasmine.createSpy('writeText').and.returnValue(Promise.resolve());
      originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
        navigator,
        'clipboard',
      );
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      });
      setFocusedTask('focused-task-1');
      mockTaskFocusService.lastFocusedTaskComponent.set({
        task: () => ({ id: 'focused-task-1', title: 'Task title to copy' }),
        taskContextMenu: () => undefined,
      });
    });

    afterEach(() => {
      if (originalClipboardDescriptor) {
        Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor);
      } else {
        delete (navigator as { clipboard?: Clipboard }).clipboard;
      }
      originalClipboardDescriptor = undefined;
    });

    it('should copy the focused task title on Ctrl+C', () => {
      const event = createKeyboardEvent('c', 'KeyC', { ctrlKey: true });
      spyOn(event, 'preventDefault');

      const result = service.handleTaskShortcuts(event);

      expect(result).toBe(true);
      expect(writeText).toHaveBeenCalledWith('Task title to copy');
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('should copy the focused task title on Cmd+C', () => {
      const event = createKeyboardEvent('c', 'KeyC', { metaKey: true });
      spyOn(event, 'preventDefault');

      const result = service.handleTaskShortcuts(event);

      expect(result).toBe(true);
      expect(writeText).toHaveBeenCalledWith('Task title to copy');
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('should fire on non-Latin keyboard layouts (key=Cyrillic, code=KeyC)', () => {
      // Cyrillic 'с' (U+0441) — what the physical KeyC produces on a
      // Russian layout. The shortcut must still trigger so behavior matches
      // the browser's native Ctrl+C, which binds on physical position.
      const event = createKeyboardEvent('с', 'KeyC', { ctrlKey: true });
      spyOn(event, 'preventDefault');

      const result = service.handleTaskShortcuts(event);

      expect(result).toBe(true);
      expect(writeText).toHaveBeenCalledWith('Task title to copy');
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('should not override native copy when the event target is an input', () => {
      const input = document.createElement('input');
      const event = createKeyboardEvent('c', 'KeyC', { metaKey: true });
      Object.defineProperty(event, 'target', { configurable: true, value: input });
      spyOn(event, 'preventDefault');

      const result = service.handleTaskShortcuts(event);

      expect(result).toBe(false);
      expect(writeText).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('should not override native copy when text is selected', () => {
      spyOn(window, 'getSelection').and.returnValue({
        toString: () => 'selected text',
      } as unknown as Selection);
      const event = createKeyboardEvent('c', 'KeyC', { ctrlKey: true });
      spyOn(event, 'preventDefault');

      const result = service.handleTaskShortcuts(event);

      expect(result).toBe(false);
      expect(writeText).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
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
    // Reuses the outer stubActiveElement helper (and its afterEach cleanup).
    let taskEl: HTMLElement;

    afterEach(() => {
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
      // We should still return true to prevent fall-through to global shortcuts
      // when we are clearly focused inside a task.
      expect(result).toBe(true);
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

  describe('stale-focus guard (#8851)', () => {
    let taskEl: HTMLElement;

    afterEach(() => {
      taskEl?.remove();
    });

    it('drops a task shortcut when focus has left all <task> elements', () => {
      // focusedTaskId still points at a task, but the DOM contradicts it:
      // the active element is <body>, i.e. focus left every <task> (e.g. after
      // navigating to a view with no live <task>). The shortcut must not fire.
      stubActiveElement(document.body);
      const mockTaskComponent = {
        task: () => ({ id: 'stale-task' }),
        toggleDoneKeyboard: jasmine.createSpy('toggleDoneKeyboard'),
        taskContextMenu: () => undefined,
      };
      mockTaskFocusService.focusedTaskId.set('stale-task');
      mockTaskFocusService.lastFocusedTaskComponent.set(mockTaskComponent);

      const result = service.handleTaskShortcuts(createKeyboardEvent('D'));

      expect(result).toBe(false);
      expect(mockTaskComponent.toggleDoneKeyboard).not.toHaveBeenCalled();
    });

    it('uses the <task> containing focus over a mismatched focusedTaskId', () => {
      // Active element is inside a different <task> than focusedTaskId claims —
      // the DOM wins, so delegation targets the DOM task, not the stale id.
      taskEl = document.createElement('task');
      taskEl.setAttribute('data-task-id', 'dom-task');
      document.body.appendChild(taskEl);
      stubActiveElement(taskEl);

      const mockTaskComponent = {
        task: () => ({ id: 'dom-task' }),
        toggleDoneKeyboard: jasmine.createSpy('toggleDoneKeyboard'),
        taskContextMenu: () => undefined,
      };
      mockTaskFocusService.focusedTaskId.set('stale-task');
      mockTaskFocusService.lastFocusedTaskComponent.set(mockTaskComponent);

      const result = service.handleTaskShortcuts(createKeyboardEvent('D'));

      expect(result).toBe(true);
      expect(mockTaskComponent.toggleDoneKeyboard).toHaveBeenCalled();
    });
  });

  describe('schedule-today shortcut (#8851)', () => {
    let hostEl: HTMLElement;

    afterEach(() => {
      hostEl?.remove();
    });

    it('delegates to the focused <task> component (preserves overdue/backlog branching)', () => {
      const taskComponent = {
        task: () => ({ id: 'focused-task-1' }),
        moveToTodayWithFocus: jasmine.createSpy('moveToTodayWithFocus'),
        taskContextMenu: () => undefined,
      };
      setFocusedTask('focused-task-1');
      mockTaskFocusService.lastFocusedTaskComponent.set(taskComponent);

      const event = createKeyboardEvent('F');
      spyOn(event, 'preventDefault');

      const result = service.handleTaskShortcuts(event);

      expect(result).toBe(true);
      expect(taskComponent.moveToTodayWithFocus).toHaveBeenCalled();
      expect(mockTaskService.scheduleForTodayById).not.toHaveBeenCalled();
    });

    it('schedules by id from a focused <planner-task> without a live <task>', () => {
      // The Planner overdue list renders <planner-task>, which is not a
      // TaskComponent and never registers focus. It carries data-task-id and is
      // focusable, so Shift+T resolves the id from the DOM and dispatches
      // planTasksForToday by id instead of delegating to a stale <task>.
      hostEl = document.createElement('planner-task');
      hostEl.setAttribute('data-task-id', 'overdue-planner-task');
      document.body.appendChild(hostEl);
      stubActiveElement(hostEl);
      mockTaskFocusService.focusedTaskId.set(null);

      const event = createKeyboardEvent('F');
      spyOn(event, 'preventDefault');

      const result = service.handleTaskShortcuts(event);

      expect(result).toBe(true);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockTaskService.scheduleForTodayById).toHaveBeenCalledWith(
        'overdue-planner-task',
      );
    });

    it('does nothing when no task can be resolved from focus', () => {
      stubActiveElement(document.body);
      mockTaskFocusService.focusedTaskId.set(null);

      const result = service.handleTaskShortcuts(createKeyboardEvent('F'));

      expect(result).toBe(false);
      expect(mockTaskService.scheduleForTodayById).not.toHaveBeenCalled();
    });

    it('schedules the focused planner-task, not a stale focusedTaskId (literal #8851 repro)', () => {
      // The exact reported shape: focusedTaskId still points at a <task> from a
      // previously-visited view, while a <planner-task> in the overdue list
      // actually holds DOM focus. Shift+T must act on the planner task's id and
      // never touch the stale component (which produced the stray sync write).
      hostEl = document.createElement('planner-task');
      hostEl.setAttribute('data-task-id', 'overdue-planner-task');
      document.body.appendChild(hostEl);
      stubActiveElement(hostEl);

      const staleComponent = {
        task: () => ({ id: 'stale-task-elsewhere' }),
        moveToTodayWithFocus: jasmine.createSpy('moveToTodayWithFocus'),
        taskContextMenu: () => undefined,
      };
      mockTaskFocusService.focusedTaskId.set('stale-task-elsewhere');
      mockTaskFocusService.lastFocusedTaskComponent.set(staleComponent);

      const result = service.handleTaskShortcuts(createKeyboardEvent('F'));

      expect(result).toBe(true);
      expect(mockTaskService.scheduleForTodayById).toHaveBeenCalledWith(
        'overdue-planner-task',
      );
      expect(mockTaskService.scheduleForTodayById).toHaveBeenCalledTimes(1);
      expect(staleComponent.moveToTodayWithFocus).not.toHaveBeenCalled();
    });
  });
});
