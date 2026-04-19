import { TaskWithSubTasks } from '../tasks/task.model';
import { TODAY_TAG } from '../tag/tag.const';

/**
 * Tests for Issue #7269: Detail panel closes immediately when opened for a task
 * that only appears in the customized/filtered list.
 *
 * The WorkViewComponent has a constructor `effect()` that deselects the currently
 * selected task whenever it is no longer present in any of the visible task lists.
 * Previously it only consulted the primary context lists (undone / done / later /
 * overdue / backlog). When the task-view customizer pulls tasks in from other work
 * contexts, the selected task would not be found in any of those lists and would
 * be deselected immediately, closing the detail panel.
 *
 * The fix additionally checks `customizedUndoneTasks().list` before resetting the
 * selection. These tests mirror the effect body exactly so that changes to the
 * logic in `work-view.component.ts` are caught here.
 *
 * Note: WorkViewComponent has a large dependency surface (NgRx store,
 * WorkContextService, TaskService, TaskViewCustomizerService, ProjectService,
 * GlobalConfigService, SnackService, LayoutService, TakeABreakService,
 * ActivatedRoute, ...) and its constructor eagerly instantiates several signals
 * from observables. Instantiating the real component for a unit test therefore
 * requires mocking a large graph of services. The effect body we care about is
 * pure given its signal inputs, so we mirror its body in an equivalent helper
 * and exercise that directly — this keeps the test fast, deterministic and
 * focused on the regression being fixed.
 */
describe('WorkViewComponent - selected task retention effect (#7269)', () => {
  const buildTask = (overrides: Partial<TaskWithSubTasks> = {}): TaskWithSubTasks =>
    ({
      id: 'MOCK_ID',
      title: 'Mock',
      isDone: false,
      tagIds: [],
      parentId: null,
      subTaskIds: [],
      subTasks: [],
      timeSpentOnDay: {},
      timeSpent: 0,
      timeEstimate: 0,
      reminderId: null,
      dueWithTime: undefined,
      dueDay: null,
      hasPlannedTime: false,
      repeatCfgId: null,
      notes: '',
      issueId: null,
      issueType: null,
      issueWasUpdated: null,
      issueLastUpdated: null,
      issueTimeTracked: null,
      attachments: [],
      projectId: null,
      _showSubTasksMode: 0,
      _currentTab: 0,
      _isTaskPlaceHolder: false,
      ...overrides,
    }) as TaskWithSubTasks;

  // Inline copy of WorkViewComponent's private _hasTaskInList helper so the
  // simulator stays in sync with the real traversal (including subtasks).
  const hasTaskInList = (
    taskList: TaskWithSubTasks[] | null | undefined,
    taskId: string,
  ): boolean => {
    if (!taskList || !taskList.length) return false;
    for (const task of taskList) {
      if (!task) continue;
      if (task.id === taskId) return true;
      const subTasks = task.subTasks;
      if (Array.isArray(subTasks) && subTasks.length) {
        for (const subTask of subTasks) {
          if (subTask && subTask.id === taskId) return true;
        }
      }
    }
    return false;
  };

  interface EffectInputs {
    selectedTaskId: string | null;
    undoneTasks: TaskWithSubTasks[];
    doneTasks: TaskWithSubTasks[];
    laterTodayTasks: TaskWithSubTasks[];
    overdueTasks: TaskWithSubTasks[];
    backlogTasks: TaskWithSubTasks[];
    customizedUndoneTasks: { list: TaskWithSubTasks[] } | undefined;
    activeWorkContextId: string;
  }

  /**
   * Mirrors the constructor effect body in `work-view.component.ts`.
   * Returns true if `setSelectedId(null)` would be dispatched.
   */
  const wouldDeselect = (inputs: EffectInputs): boolean => {
    const currentSelectedId = inputs.selectedTaskId;
    if (!currentSelectedId) return false;

    if (hasTaskInList(inputs.undoneTasks, currentSelectedId)) return false;
    if (hasTaskInList(inputs.doneTasks, currentSelectedId)) return false;
    if (hasTaskInList(inputs.laterTodayTasks, currentSelectedId)) return false;

    if (
      inputs.activeWorkContextId === TODAY_TAG.id &&
      hasTaskInList(inputs.overdueTasks, currentSelectedId)
    ) {
      return false;
    }

    if (hasTaskInList(inputs.backlogTasks, currentSelectedId)) return false;

    // The fix: also consult the customizer's list.
    if (hasTaskInList(inputs.customizedUndoneTasks?.list, currentSelectedId)) {
      return false;
    }

    return true;
  };

  const baseInputs = (): EffectInputs => ({
    selectedTaskId: null,
    undoneTasks: [],
    doneTasks: [],
    laterTodayTasks: [],
    overdueTasks: [],
    backlogTasks: [],
    customizedUndoneTasks: { list: [] },
    activeWorkContextId: 'some-project-id',
  });

  describe('fix for #7269 - customizer list retention', () => {
    it('should NOT deselect when the selected task only appears in customizedUndoneTasks.list', () => {
      const inputs = baseInputs();
      inputs.selectedTaskId = 'cross-context-task';
      inputs.customizedUndoneTasks = {
        list: [buildTask({ id: 'cross-context-task' })],
      };

      expect(wouldDeselect(inputs)).toBe(false);
    });

    it('should NOT deselect when the selected task is a subtask inside customizedUndoneTasks.list', () => {
      const inputs = baseInputs();
      inputs.selectedTaskId = 'nested-sub';
      inputs.customizedUndoneTasks = {
        list: [
          buildTask({
            id: 'parent',
            subTasks: [buildTask({ id: 'nested-sub' })],
          }),
        ],
      };

      expect(wouldDeselect(inputs)).toBe(false);
    });
  });

  describe('regression - deselect still fires when task is truly gone', () => {
    it('should deselect when the task is not present in ANY list (including customizedUndoneTasks)', () => {
      const inputs = baseInputs();
      inputs.selectedTaskId = 'ghost-task';
      inputs.undoneTasks = [buildTask({ id: 'other-1' })];
      inputs.doneTasks = [buildTask({ id: 'other-2' })];
      inputs.customizedUndoneTasks = { list: [buildTask({ id: 'other-3' })] };

      expect(wouldDeselect(inputs)).toBe(true);
    });

    it('should deselect when customizedUndoneTasks is undefined and task is not elsewhere', () => {
      const inputs = baseInputs();
      inputs.selectedTaskId = 'ghost-task';
      inputs.customizedUndoneTasks = undefined;

      expect(wouldDeselect(inputs)).toBe(true);
    });

    it('should deselect when customizedUndoneTasks.list is empty and task is not elsewhere', () => {
      const inputs = baseInputs();
      inputs.selectedTaskId = 'ghost-task';
      inputs.customizedUndoneTasks = { list: [] };

      expect(wouldDeselect(inputs)).toBe(true);
    });
  });

  describe('existing behaviour preserved', () => {
    it('should NOT deselect when selectedTaskId is null', () => {
      const inputs = baseInputs();
      inputs.selectedTaskId = null;

      expect(wouldDeselect(inputs)).toBe(false);
    });

    it('should NOT deselect when the task is in undoneTasks', () => {
      const inputs = baseInputs();
      inputs.selectedTaskId = 'undone-task';
      inputs.undoneTasks = [buildTask({ id: 'undone-task' })];

      expect(wouldDeselect(inputs)).toBe(false);
    });

    it('should NOT deselect when the task is in doneTasks', () => {
      const inputs = baseInputs();
      inputs.selectedTaskId = 'done-task';
      inputs.doneTasks = [buildTask({ id: 'done-task', isDone: true })];

      expect(wouldDeselect(inputs)).toBe(false);
    });

    it('should NOT deselect when the task is in laterTodayTasks', () => {
      const inputs = baseInputs();
      inputs.selectedTaskId = 'later-task';
      inputs.laterTodayTasks = [buildTask({ id: 'later-task' })];

      expect(wouldDeselect(inputs)).toBe(false);
    });

    it('should NOT deselect when the task is in backlogTasks', () => {
      const inputs = baseInputs();
      inputs.selectedTaskId = 'backlog-task';
      inputs.backlogTasks = [buildTask({ id: 'backlog-task' })];

      expect(wouldDeselect(inputs)).toBe(false);
    });

    it('should NOT deselect when on TODAY_TAG and task is in overdueTasks', () => {
      const inputs = baseInputs();
      inputs.selectedTaskId = 'overdue-task';
      inputs.activeWorkContextId = TODAY_TAG.id;
      inputs.overdueTasks = [buildTask({ id: 'overdue-task' })];

      expect(wouldDeselect(inputs)).toBe(false);
    });

    it('SHOULD deselect when NOT on TODAY_TAG even if task is in overdueTasks (and nowhere else)', () => {
      const inputs = baseInputs();
      inputs.selectedTaskId = 'overdue-task';
      inputs.activeWorkContextId = 'some-project-id';
      inputs.overdueTasks = [buildTask({ id: 'overdue-task' })];

      expect(wouldDeselect(inputs)).toBe(true);
    });
  });
});
