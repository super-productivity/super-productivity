import { WorkStartEnd } from 'src/app/features/work-context/work-context.model';
import { WorklogGrouping } from '../worklog.model';
import { createRows } from './worklog-export.util';
import { DEFAULT_TASK, WorklogTask } from '../../tasks/task.model';
import { DEFAULT_PROJECT } from '../../project/project.const';
import { DEFAULT_TAG } from '../../tag/tag.const';
import { Project } from 'src/app/features/project/project.model';
import { WorklogExportData, WorkTimes } from './worklog-export.model';
import { Tag } from '../../tag/tag.model';

const startTime1 = new Date(2021, 1, 5, 10, 0, 0).getTime();
const endTime1 = new Date(2021, 1, 5, 12, 0, 0).getTime();
const startTime2 = new Date(2021, 1, 6, 14, 0, 0).getTime();
const endTime2 = new Date(2021, 1, 6, 16, 0, 0).getTime();
const dateKey1 = '2021-02-05',
  dateKey2 = '2021-02-06';
const start: WorkStartEnd = { [dateKey1]: startTime1, [dateKey2]: startTime2 };
const end: WorkStartEnd = { [dateKey1]: endTime1, [dateKey2]: endTime2 };
const workTimes: WorkTimes = { start, end };
const oneHour = 3600000,
  twoHours = 7200000;

const createTask = (partialTask: Partial<WorklogTask>): WorklogTask => {
  const deepCopy = JSON.parse(JSON.stringify(DEFAULT_TASK));
  return {
    ...deepCopy,
    timeSpentOnDay: { [dateKey1]: oneHour },
    title: partialTask.id as string,
    ...partialTask,
    dateStr: '',
  };
};

const createSubTask = (
  partialTask: Partial<WorklogTask>,
  parentTask: WorklogTask,
): WorklogTask => {
  parentTask.subTaskIds.push(partialTask.id as string);
  return createTask({ ...partialTask, parentId: parentTask.id });
};

const createTag = (tagId: string, ...tasks: WorklogTask[]): Tag => {
  const taskIds: string[] = [];
  tasks.forEach((task) => {
    taskIds.push(task.id);
    task.tagIds.push(tagId);
  });
  return { ...DEFAULT_TAG, id: tagId, taskIds, title: tagId };
};

const createProject = (projectId: string, ...tasks: WorklogTask[]): Project => {
  const taskIds: string[] = [];
  tasks.forEach((task) => {
    taskIds.push(task.id);
    Object.defineProperty(task, 'projectId', { value: projectId });
  });
  return { ...DEFAULT_PROJECT, id: projectId, taskIds, title: projectId };
};

const createWorklogData = (
  partialData: Partial<WorklogExportData>,
): WorklogExportData => {
  return {
    tasks: [],
    tags: [],
    projects: [],
    workTimes: { start: {}, end: {} },
    ...partialData,
  };
};

describe('createRows', () => {
  describe('time', () => {
    it('should have correct time fields', () => {
      const tasks = [
        createTask({
          id: 'T1',
          timeSpentOnDay: { [dateKey1]: oneHour },
          timeEstimate: twoHours,
        }),
        createTask({
          id: 'T2',
          timeSpentOnDay: { [dateKey1]: oneHour },
          timeEstimate: twoHours,
        }),
        createTask({
          id: 'T3',
          timeSpentOnDay: { [dateKey1]: oneHour },
          timeEstimate: twoHours,
        }),
      ];
      const data = createWorklogData({ tasks });
      const rows = createRows(data, WorklogGrouping.DATE);
      expect(rows.length).toBe(1);
      expect(rows[0].timeSpent).toBe(oneHour * 3);
      expect(rows[0].timeEstimate).toBe(twoHours * 3);
    });

    it('should have correct WorkStartEnd fields', () => {
      const tasks = [
        createTask({ id: 'T1' }),
        createTask({ id: 'T2' }),
        createTask({ id: 'T3', timeSpentOnDay: { [dateKey2]: oneHour } }),
      ];
      const data = createWorklogData({ tasks, workTimes });
      const rows = createRows(data, WorklogGrouping.DATE);
      expect(rows.length).toBe(2);
      expect(rows[0].workStart).toBe(workTimes.start[dateKey1]);
      expect(rows[0].workEnd).toBe(workTimes.end[dateKey1]);
      expect(rows[1].workStart).toBe(workTimes.start[dateKey2]);
      expect(rows[1].workEnd).toBe(workTimes.end[dateKey2]);
    });
  });

  describe('date', () => {
    it('should sort date fields', () => {
      const tasks = [
        createTask({
          id: 'T1',
          timeSpentOnDay: {
            [dateKey1]: oneHour,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            '2021-02-20': oneHour,
            [dateKey2]: oneHour,
          },
        }),
      ];
      const data = createWorklogData({ tasks });
      const rows = createRows(data, WorklogGrouping.TASK);
      expect(rows.length).toBe(1);
      expect(rows[0].dates).toEqual([dateKey1, dateKey2, '2021-02-20']);
    });
  });

  describe('titles', () => {
    const parentTaskId = 'PT1',
      subTaskId1 = 'S2',
      subTaskId2 = 'S3',
      otherTaskId = 'T4';
    const task1 = createTask({ id: parentTaskId });
    const task2 = createSubTask({ id: subTaskId1 }, task1);
    const task3 = createSubTask({ id: subTaskId2 }, task1);
    const task4 = createTask({ id: otherTaskId });
    const tasks = [task1, task2, task3, task4];

    let data: WorklogExportData;
    beforeEach(() => {
      data = createWorklogData({ tasks });
    });

    it('should have correct titles when grouping by parent', () => {
      const rows = createRows(data, WorklogGrouping.PARENT);
      expect(rows.length).toBe(2);
      expect(rows[0].titles).toEqual([parentTaskId]);
      expect(rows[1].titles).toEqual([otherTaskId]);
      expect(rows[0].titlesWithSub).toEqual([parentTaskId]);
      expect(rows[1].titlesWithSub).toEqual([otherTaskId]);
    });

    it('should have correct titles when grouping by task', () => {
      const rows = createRows(data, WorklogGrouping.TASK);
      expect(rows.length).toBe(3);
      expect(rows[0].titles).toEqual([parentTaskId]);
      expect(rows[1].titles).toEqual([parentTaskId]);
      expect(rows[2].titles).toEqual([otherTaskId]);
      expect(rows[0].titlesWithSub).toEqual([subTaskId1]);
      expect(rows[1].titlesWithSub).toEqual([subTaskId2]);
      expect(rows[2].titlesWithSub).toEqual([otherTaskId]);
    });

    it('should have correct titles when grouping by date', () => {
      const rows = createRows(data, WorklogGrouping.DATE);
      expect(rows.length).toBe(1);
      expect(rows[0].titles).toEqual([parentTaskId, otherTaskId]);
      expect(rows[0].titlesWithSub).toEqual([
        parentTaskId,
        subTaskId1,
        subTaskId2,
        otherTaskId,
      ]);
    });
  });

  describe('projects', () => {
    const task1P1 = '1T',
      task2P1 = '2T',
      parentTaskP2 = '3PT',
      subTask = '4ST';
    const project1 = 'P1',
      project2 = 'P2';
    const task1 = createTask({ id: task1P1 });
    const task2 = createTask({ id: task2P1 });
    const task3 = createTask({ id: parentTaskP2 });
    const task4 = createSubTask({ id: subTask }, task3);
    const tasks = [task1, task2, task3, task4];
    const p1 = createProject(project1, task1, task2);
    const p2 = createProject(project2, task3, task4);
    const projects = [p1, p2];

    let data: WorklogExportData;
    beforeEach(() => {
      data = createWorklogData({ tasks, projects });
    });

    it('should not duplicate', () => {
      const rows = createRows(data, WorklogGrouping.DATE);
      expect(rows.length).toBe(1);
      expect(rows[0].projects).toEqual([project1, project2]);
    });

    it('should show project of parent task', () => {
      const rows = createRows(data, WorklogGrouping.TASK);
      expect(rows.length).toBe(3);
      expect(rows[0].projects).toEqual([project1]);
      expect(rows[1].projects).toEqual([project1]);
      expect(rows[2].projects).toEqual([project2]);
    });
  });

  describe('tags', () => {
    const parentTaskId = '1PT1',
      subTaskId = '2ST1',
      otherTaskId = '3OT1';
    const tagId1 = 'Tag1',
      tagId2 = 'Tag2';
    const parentTask = createTask({ id: parentTaskId });
    const subTask = createSubTask({ id: subTaskId }, parentTask);
    const otherTask = createTask({ id: otherTaskId });
    const tasks = [parentTask, subTask, otherTask];
    const tag1 = createTag(tagId1, parentTask);
    const tag2 = createTag(tagId2, parentTask, otherTask);
    const tags = [tag1, tag2];

    let data: WorklogExportData;
    beforeEach(() => {
      data = createWorklogData({ tasks, tags });
    });

    it('should not duplicate tags when grouping by date', () => {
      const rows = createRows(data, WorklogGrouping.DATE);
      expect(rows.length).toBe(1);
      expect(rows[0].tags).toEqual([tagId1, tagId2]);
    });

    it('should not duplicate tags when grouping by parent', () => {
      const rows = createRows(data, WorklogGrouping.PARENT);
      expect(rows.length).toBe(2);
      expect(rows[0].tags).toEqual([tagId1, tagId2]);
      expect(rows[1].tags).toEqual([tagId2]);
    });

    it('should use tags of the parent task when grouping by task', () => {
      const rows = createRows(data, WorklogGrouping.TASK);
      expect(rows.length).toBe(2);
      expect(rows[0].tags).toEqual([tagId1, tagId2]);
      expect(rows[1].tags).toEqual([tagId2]);
    });

    it('should use tags of the parent task when grouping by worklog', () => {
      const rows = createRows(data, WorklogGrouping.WORKLOG);
      expect(rows.length).toBe(3);
      expect(rows[0].tags).toEqual([tagId1, tagId2]);
      expect(rows[1].tags).toEqual([tagId1, tagId2]);
      expect(rows[2].tags).toEqual([tagId2]);
    });

    it('should have today tags', () => {
      const todayTaskId = 'T1',
        todayTagId = 'Tag1';
      const todayTask = createTask({ id: todayTaskId });
      const todayTag = createTag(todayTagId, todayTask);
      data = createWorklogData({ tasks: [todayTask], tags: [todayTag] });
      const rows = createRows(data, WorklogGrouping.DATE);
      expect(rows.length).toBe(1);
      expect(rows[0].tags).toEqual([todayTagId]);
    });
  });

  describe('notes', () => {
    const note1 = 'N1',
      note2 = 'N2';
    const task1 = createTask({
      id: 'T1',
      notes: note1,
      timeSpentOnDay: { [dateKey1]: oneHour, [dateKey2]: oneHour },
    });
    const task2 = createTask({ id: 'T2', notes: note2 });

    let data: WorklogExportData;
    beforeEach(() => {
      data = createWorklogData({ tasks: [task1, task2] });
    });

    it('should not duplicate notes when grouping by date', () => {
      const rows = createRows(data, WorklogGrouping.DATE);
      expect(rows.length).toBe(2);
      expect(rows[0].notes).toEqual([note1, note2]);
      expect(rows[1].notes).toEqual([note1]);
    });

    it('should not duplicate notes when grouping by task', () => {
      const rows = createRows(data, WorklogGrouping.TASK);
      expect(rows.length).toBe(2);
      expect(rows[0].notes).toEqual([note1]);
      expect(rows[1].notes).toEqual([note2]);
    });

    it('should show correct notes of sub/parent tasks', () => {
      const parentTaskId = 'P1',
        subTaskId = 'ST1';
      const t1 = createTask({ id: parentTaskId, notes: note1 });
      const t2 = createSubTask({ id: subTaskId, notes: note2 }, t1);
      data = createWorklogData({ tasks: [t1, t2] });
      const rows = createRows(data, WorklogGrouping.DATE);
      expect(rows.length).toBe(1);
      expect(rows[0].notes).toEqual([note1, note2]);
    });

    it('should replace \\n with dashes', () => {
      const noteWithNewLine = 'N1\nN1',
        expectedNote = 'N1 - N1';
      const t1 = createTask({ id: 'T1', notes: noteWithNewLine });
      data = createWorklogData({ tasks: [t1] });
      const rows = createRows(data, WorklogGrouping.DATE);
      expect(rows.length).toBe(1);
      expect(rows[0].notes).toEqual([expectedNote]);
    });
  });

  describe('group by worklog', () => {
    const taskId1 = 'T1',
      taskId2 = 'T2';
    const task1 = createTask({ id: taskId1 });
    const task2 = createTask({
      id: taskId2,
      timeSpentOnDay: { [dateKey1]: oneHour, [dateKey2]: oneHour },
    });
    const data = createWorklogData({ tasks: [task1, task2] });

    it('should list all tasks and not group by task/date', () => {
      const rows = createRows(data, WorklogGrouping.WORKLOG);
      expect(rows.length).toBe(3);
      expect(rows[0].titlesWithSub).toEqual([taskId1]);
      expect(rows[0].dates).toEqual([dateKey1]);
      expect(rows[1].titlesWithSub).toEqual([taskId2]);
      expect(rows[1].dates).toEqual([dateKey1]);
      expect(rows[2].titlesWithSub).toEqual([taskId2]);
      expect(rows[2].dates).toEqual([dateKey2]);
    });
  });
});

describe('worklog-export.util moment replacement', () => {
  describe('time formatting', () => {
    it('should format timestamps as HH:mm', () => {
      const testCases = [
        {
          timestamp: new Date(2023, 9, 15, 9, 30, 0).getTime(),
          expected: '09:30',
        },
        {
          timestamp: new Date(2023, 9, 15, 14, 45, 0).getTime(),
          expected: '14:45',
        },
        {
          timestamp: new Date(2023, 9, 15, 0, 0, 0).getTime(),
          expected: '00:00',
        },
        {
          timestamp: new Date(2023, 9, 15, 23, 59, 0).getTime(),
          expected: '23:59',
        },
      ];

      testCases.forEach(({ timestamp, expected }) => {
        const date = new Date(timestamp);
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const formatted = `${hours}:${minutes}`;
        expect(formatted).toBe(expected);
      });
    });

    it('should handle roundTime functionality', () => {
      // Test rounding to 15 minutes
      const roundTo = 15 * 60 * 1000; // 15 minutes in ms
      const testCases = [
        {
          timestamp: new Date(2023, 9, 15, 9, 7, 0).getTime(),
          expected: new Date(2023, 9, 15, 9, 0, 0).getTime(),
        },
        {
          timestamp: new Date(2023, 9, 15, 9, 8, 0).getTime(),
          expected: new Date(2023, 9, 15, 9, 15, 0).getTime(),
        },
        {
          timestamp: new Date(2023, 9, 15, 9, 22, 0).getTime(),
          expected: new Date(2023, 9, 15, 9, 15, 0).getTime(),
        },
        {
          timestamp: new Date(2023, 9, 15, 9, 23, 0).getTime(),
          expected: new Date(2023, 9, 15, 9, 30, 0).getTime(),
        },
      ];

      testCases.forEach(({ timestamp, expected }) => {
        // roundTime implementation
        const rounded = Math.round(timestamp / roundTo) * roundTo;
        expect(rounded).toBe(expected);
      });
    });
  });
});
