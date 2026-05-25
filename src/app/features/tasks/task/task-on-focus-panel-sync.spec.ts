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
   * This mirrors the exact logic in the component's @HostListener('focusin') handler,
   * including the innermost-task guard that prevents bubbled events from a nested
   * <task> from being claimed by an ancestor task host.
   */
  const simulateOnFocus = (
    taskId: string,
    isInsideDetailPanel: boolean,
    componentRef: unknown,
    eventTarget: EventTarget | null = null,
    hostEl: HTMLElement | null = null,
  ): void => {
    if (
      hostEl &&
      eventTarget instanceof Element &&
      eventTarget.closest('task') !== hostEl
    ) {
      return;
    }
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

  const simulateOnBlur = (
    hostEl: HTMLElement,
    relatedTarget: EventTarget | null,
    eventTarget: EventTarget | null = hostEl,
  ): void => {
    if (eventTarget instanceof Element && eventTarget.closest('task') !== hostEl) {
      return;
    }
    if (relatedTarget instanceof Node && hostEl.contains(relatedTarget)) {
      return;
    }
    mockTaskFocusService.focusedTaskId.set(null);
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

  it('should keep focusedTaskId when focus moves within the same task', () => {
    const taskEl = document.createElement('task');
    const childEl = document.createElement('button');
    taskEl.appendChild(childEl);
    mockTaskFocusService.focusedTaskId.set(TASK_B_ID);

    simulateOnBlur(taskEl, childEl);

    expect(mockTaskFocusService.focusedTaskId()).toBe(TASK_B_ID);
  });

  it('should clear focusedTaskId when focus leaves the task', () => {
    const taskEl = document.createElement('task');
    const outsideEl = document.createElement('button');
    mockTaskFocusService.focusedTaskId.set(TASK_B_ID);

    simulateOnBlur(taskEl, outsideEl);

    expect(mockTaskFocusService.focusedTaskId()).toBeNull();
  });

  describe('focusin bubbling from nested tasks', () => {
    // Nested DOM:  <task id=parent> <task id=sub> <button> </task> </task>
    // focusin from <button> bubbles to <task id=sub> (innermost) AND <task id=parent>.
    // Only the innermost task should claim focus.
    const buildNested = (): {
      parentEl: HTMLElement;
      subEl: HTMLElement;
      innerBtn: HTMLElement;
    } => {
      const parentEl = document.createElement('task');
      const subEl = document.createElement('task');
      const innerBtn = document.createElement('button');
      subEl.appendChild(innerBtn);
      parentEl.appendChild(subEl);
      return { parentEl, subEl, innerBtn };
    };

    it('should not let parent task overwrite focusedTaskId when subtask is focused', () => {
      const { parentEl, subEl, innerBtn } = buildNested();

      // DOM event order: subtask handler fires first (innermost), then parent.
      simulateOnFocus('sub-id', false, {}, innerBtn, subEl);
      simulateOnFocus('parent-id', false, {}, innerBtn, parentEl);

      expect(mockTaskFocusService.focusedTaskId()).toBe('sub-id');
    });

    it('should not let parent task setSelectedId when subtask child is focused', () => {
      const { parentEl, subEl, innerBtn } = buildNested();
      mockTaskService.selectedTaskId.set('some-other-id');

      simulateOnFocus('sub-id', false, {}, innerBtn, subEl);
      simulateOnFocus('parent-id', false, {}, innerBtn, parentEl);

      expect(mockTaskService.setSelectedId).toHaveBeenCalledWith('sub-id');
      expect(mockTaskService.setSelectedId).not.toHaveBeenCalledWith('parent-id');
    });

    it('should not let parent clear focusedTaskId on bubbled focusout from subtask', () => {
      const { parentEl, subEl, innerBtn } = buildNested();
      mockTaskFocusService.focusedTaskId.set('sub-id');
      const outsideEl = document.createElement('div');

      // focusout from innerBtn bubbles to sub (clears) and to parent.
      // Parent must not run its body — the event didn't originate from the parent's row.
      simulateOnBlur(subEl, outsideEl, innerBtn);
      // After sub clears, parent would re-clear (no-op here, but verify the guard
      // also prevents parent from running when state is non-null):
      mockTaskFocusService.focusedTaskId.set('parent-id');
      simulateOnBlur(parentEl, outsideEl, innerBtn);

      expect(mockTaskFocusService.focusedTaskId()).toBe('parent-id');
    });
  });
});
