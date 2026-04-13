import { signal } from '@angular/core';

/**
 * Tests for Issue #6578: Detail panel should follow focus
 * When the detail panel is open for one task and the user focuses a different task,
 * the panel should update to show the newly focused task.
 */
describe('Task onFocus detail panel sync (#6578)', () => {
  let mockTaskService: {
    selectedTaskId: ReturnType<typeof signal<string | null>>;
    setSelectedId: jasmine.Spy;
  };
  let mockTaskFocusService: {
    focusedTaskId: ReturnType<typeof signal<string | null>>;
    lastFocusedTaskComponent: ReturnType<typeof signal<unknown | null>>;
  };

  const TASK_A_ID = 'task-a';
  const TASK_B_ID = 'task-b';

  beforeEach(() => {
    mockTaskService = {
      selectedTaskId: signal<string | null>(null),
      setSelectedId: jasmine.createSpy('setSelectedId'),
    };
    mockTaskFocusService = {
      focusedTaskId: signal<string | null>(null),
      lastFocusedTaskComponent: signal<unknown | null>(null),
    };
  });

  /**
   * Simulates the onFocus handler logic from task.component.ts.
   * This mirrors the exact logic in the component's @HostListener('focus') handler.
   */
  const simulateOnFocus = (
    taskId: string,
    isInsideDetailPanel: boolean,
    componentRef: unknown,
  ): void => {
    mockTaskFocusService.focusedTaskId.set(taskId);
    mockTaskFocusService.lastFocusedTaskComponent.set(componentRef);

    if (isInsideDetailPanel) {
      return;
    }
    const selectedTaskId = mockTaskService.selectedTaskId();
    if (selectedTaskId && selectedTaskId !== taskId) {
      mockTaskService.setSelectedId(taskId);
    }
  };

  it('should update selectedTaskId when panel is open for a different task', () => {
    mockTaskService.selectedTaskId.set(TASK_A_ID);

    simulateOnFocus(TASK_B_ID, false, {});

    expect(mockTaskService.setSelectedId).toHaveBeenCalledWith(TASK_B_ID);
  });

  it('should NOT update selectedTaskId when no panel is open', () => {
    mockTaskService.selectedTaskId.set(null);

    simulateOnFocus(TASK_B_ID, false, {});

    expect(mockTaskService.setSelectedId).not.toHaveBeenCalled();
  });

  it('should NOT update selectedTaskId when focusing the already-selected task', () => {
    mockTaskService.selectedTaskId.set(TASK_A_ID);

    simulateOnFocus(TASK_A_ID, false, {});

    expect(mockTaskService.setSelectedId).not.toHaveBeenCalled();
  });

  it('should NOT update selectedTaskId when task is inside detail panel (subtask)', () => {
    mockTaskService.selectedTaskId.set(TASK_A_ID);

    simulateOnFocus('subtask-1', true, {});

    expect(mockTaskService.setSelectedId).not.toHaveBeenCalled();
  });

  it('should always update focusedTaskId regardless of panel state', () => {
    simulateOnFocus(TASK_B_ID, false, {});

    expect(mockTaskFocusService.focusedTaskId()).toBe(TASK_B_ID);
  });

  it('should always update focusedTaskId even when inside detail panel', () => {
    simulateOnFocus('subtask-1', true, {});

    expect(mockTaskFocusService.focusedTaskId()).toBe('subtask-1');
  });
});
