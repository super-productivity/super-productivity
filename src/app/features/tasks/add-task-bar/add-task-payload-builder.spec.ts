import { TaskReminderOptionId } from '../task.model';
import { INITIAL_ADD_TASK_BAR_STATE } from './add-task-bar.const';
import { buildAddTaskPayload } from './add-task-payload-builder';

describe('buildAddTaskPayload', () => {
  it('builds due date with planned time from the shared add-bar state', () => {
    const payload = buildAddTaskPayload({
      title: 'Timed task',
      state: {
        ...INITIAL_ADD_TASK_BAR_STATE,
        projectId: 'p1',
        tagIds: ['t1'],
        date: '2026-06-19',
        time: '09:30',
      },
      note: '',
      isAddToBacklog: false,
      isAddToBottom: true,
      todayStr: '2026-06-19',
      defaultRemindOption: TaskReminderOptionId.AtStart,
    });

    expect(payload.taskData).toEqual(
      jasmine.objectContaining({
        projectId: 'p1',
        tagIds: ['t1'],
        dueWithTime: new Date(2026, 5, 19, 9, 30, 0, 0).getTime(),
        hasPlannedTime: true,
      }),
    );
    expect(payload.taskData.dueDay).toBeUndefined();
  });

  it('builds deadline reminder and merges tags from text plus new tag titles', () => {
    const payload = buildAddTaskPayload({
      title: 'Deadline task',
      state: {
        ...INITIAL_ADD_TASK_BAR_STATE,
        projectId: 'p1',
        tagIds: ['t1'],
        tagIdsFromTxt: ['t2'],
        deadlineDate: '2026-06-20',
        deadlineTime: '14:00',
        deadlineRemindOption: TaskReminderOptionId.m30,
      },
      note: 'Details',
      isAddToBacklog: false,
      isAddToBottom: false,
      todayStr: '2026-06-19',
      defaultRemindOption: TaskReminderOptionId.AtStart,
      newTagTitles: ['New Tag'],
    });

    const deadlineWithTime = new Date(2026, 5, 20, 14, 0, 0, 0).getTime();
    const reminderOffset = 30 * (60 * 1000);
    const deadlineRemindAt = deadlineWithTime - reminderOffset;
    expect(payload.taskData).toEqual(
      jasmine.objectContaining({
        notes: 'Details',
        tagIds: ['t1', 't2'],
        deadlineWithTime,
        deadlineRemindAt,
      }),
    );
    expect(payload.newTagTitles).toEqual(['New Tag']);
  });

  it('builds repeat preset config and uses today as due day when no date is set', () => {
    const payload = buildAddTaskPayload({
      title: 'Daily task',
      state: {
        ...INITIAL_ADD_TASK_BAR_STATE,
        projectId: 'p1',
        tagIds: ['t1'],
        estimate: 15 * 60 * 1000,
        repeatQuickSetting: 'DAILY',
      },
      note: '',
      isAddToBacklog: false,
      isAddToBottom: false,
      todayStr: '2026-06-19',
      defaultRemindOption: TaskReminderOptionId.AtStart,
    });

    expect(payload.taskData.dueDay).toBe('2026-06-19');
    expect(payload.repeatCfg).toEqual(
      jasmine.objectContaining({
        title: 'Daily task',
        quickSetting: 'DAILY',
        startDate: '2026-06-19',
        tagIds: ['t1'],
        defaultEstimate: 15 * 60 * 1000,
      }),
    );
  });
});
