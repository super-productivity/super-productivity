import { BatchTaskCreate } from '@super-productivity/plugin-api';
import { TodoistImportModel, TodoistTask } from '../parse/normalized-model';
import { BATCH_CHUNK_SIZE, planImport } from './plan-import';

const task = (overrides: Partial<TodoistTask>): TodoistTask => ({
  extId: 't1',
  projectExtId: 'p1',
  parentExtId: null,
  title: 'task',
  notes: '',
  labels: [],
  apiPriority: 1,
  dueDay: null,
  dueWithTime: null,
  timeEstimate: null,
  isRecurring: false,
  wasDemoted: false,
  isDayDurationSkipped: false,
  hasAssignee: false,
  attachmentCount: 0,
  ...overrides,
});

const model = (overrides: Partial<TodoistImportModel> = {}): TodoistImportModel => ({
  projects: [
    { extId: 'p1', title: 'Work', parentExtId: null, isInbox: false, childOrder: 1 },
  ],
  sections: [],
  tasks: [],
  ...overrides,
});

describe('planImport', () => {
  it('creates temp- prefixed IDs and parent references', () => {
    const plan = planImport(
      model({
        tasks: [
          task({ extId: 'a' }),
          task({ extId: 'b', parentExtId: 'a', title: 'sub' }),
        ],
      }),
      { isMapPriorityToTags: false },
    );
    const ops = plan.projects[0].batchChunks[0] as BatchTaskCreate[];
    expect(ops.map((o) => [o.tempId, o.data.parentId])).toEqual([
      ['temp-a', undefined],
      ['temp-b', 'temp-a'],
    ]);
  });

  it('chunks operations at the batch limit, keeping parents before children', () => {
    const tasks: TodoistTask[] = [];
    for (let i = 0; i < 60; i++) {
      tasks.push(task({ extId: `root-${i}`, title: `t${i}` }));
      tasks.push(task({ extId: `sub-${i}`, parentExtId: `root-${i}`, title: `s${i}` }));
    }
    const plan = planImport(model({ tasks }), { isMapPriorityToTags: false });
    const chunks = plan.projects[0].batchChunks;
    expect(chunks.length).toBe(Math.ceil(120 / BATCH_CHUNK_SIZE));
    chunks.forEach((chunk) => expect(chunk.length).toBeLessThanOrEqual(BATCH_CHUNK_SIZE));
    // a parent is always at a lower global index than its child
    const flat = chunks.flat() as BatchTaskCreate[];
    const indexByTempId = new Map(flat.map((op, i) => [op.tempId, i]));
    for (const op of flat) {
      if (op.data.parentId) {
        expect(indexByTempId.get(op.data.parentId)).toBeLessThan(
          indexByTempId.get(op.tempId) as number,
        );
      }
    }
  });

  it('emits follow-ups only for tasks that need them, with due exclusivity', () => {
    const plan = planImport(
      model({
        tasks: [
          task({ extId: 'plain' }),
          task({ extId: 'dated', dueDay: '2026-07-15' }),
          task({ extId: 'timed', dueWithTime: 123456, dueDay: null }),
        ],
      }),
      { isMapPriorityToTags: false },
    );
    expect(plan.projects[0].followUps).toEqual([
      { tempId: 'temp-dated', dueDay: '2026-07-15' },
      { tempId: 'temp-timed', dueWithTime: 123456 },
    ]);
  });

  it('collects label tags for root tasks but never for sub-tasks', () => {
    const plan = planImport(
      model({
        tasks: [
          task({ extId: 'a', labels: ['errand'] }),
          task({ extId: 'b', parentExtId: 'a', labels: ['dropped'] }),
        ],
      }),
      { isMapPriorityToTags: false },
    );
    expect(plan.tagTitles).toEqual(['errand']);
    expect(plan.projects[0].followUps).toEqual([
      { tempId: 'temp-a', tagTitles: ['errand'] },
    ]);
  });

  describe('priority tags (opt-in)', () => {
    it('maps API 4→p1, 3→p2, 2→p3 and never tags the default priority 1', () => {
      const plan = planImport(
        model({
          tasks: [
            task({ extId: 'highest', apiPriority: 4 }),
            task({ extId: 'mid', apiPriority: 3 }),
            task({ extId: 'low', apiPriority: 2 }),
            task({ extId: 'default', apiPriority: 1 }),
          ],
        }),
        { isMapPriorityToTags: true },
      );
      expect(plan.tagTitles.sort()).toEqual(['p1', 'p2', 'p3']);
      expect(plan.projects[0].followUps).toEqual([
        { tempId: 'temp-highest', tagTitles: ['p1'] },
        { tempId: 'temp-mid', tagTitles: ['p2'] },
        { tempId: 'temp-low', tagTitles: ['p3'] },
      ]);
    });

    it('is off by default', () => {
      const plan = planImport(model({ tasks: [task({ extId: 'a', apiPriority: 4 })] }), {
        isMapPriorityToTags: false,
      });
      expect(plan.tagTitles).toEqual([]);
    });
  });

  describe('project selection and titles', () => {
    it('only plans selected projects', () => {
      const plan = planImport(
        model({
          projects: [
            { extId: 'p1', title: 'A', parentExtId: null, isInbox: false, childOrder: 1 },
            { extId: 'p2', title: 'B', parentExtId: null, isInbox: false, childOrder: 2 },
          ],
          tasks: [task({ extId: 'a', projectExtId: 'p2' })],
        }),
        { isMapPriorityToTags: false, selectedProjectExtIds: new Set(['p2']) },
      );
      expect(plan.projects.map((p) => p.extId)).toEqual(['p2']);
    });

    it('renames the inbox and disambiguates colliding nested titles', () => {
      const plan = planImport(
        model({
          projects: [
            {
              extId: 'inbox',
              title: 'Inbox',
              parentExtId: null,
              isInbox: true,
              childOrder: 0,
            },
            {
              extId: 'work',
              title: 'Work',
              parentExtId: null,
              isInbox: false,
              childOrder: 1,
            },
            {
              extId: 'misc1',
              title: 'Misc',
              parentExtId: 'work',
              isInbox: false,
              childOrder: 2,
            },
            {
              extId: 'home',
              title: 'Home',
              parentExtId: null,
              isInbox: false,
              childOrder: 3,
            },
            {
              extId: 'misc2',
              title: 'Misc',
              parentExtId: 'home',
              isInbox: false,
              childOrder: 4,
            },
          ],
        }),
        { isMapPriorityToTags: false },
      );
      expect(plan.projects.map((p) => p.title)).toEqual([
        'Inbox (Todoist)',
        'Work',
        'Work / Misc',
        'Home',
        'Home / Misc',
      ]);
    });

    it('suffixes titles that still collide after prefixing', () => {
      const plan = planImport(
        model({
          projects: [
            { extId: 'a', title: 'X', parentExtId: null, isInbox: false, childOrder: 1 },
            { extId: 'b', title: 'X', parentExtId: null, isInbox: false, childOrder: 2 },
          ],
        }),
        { isMapPriorityToTags: false },
      );
      expect(plan.projects.map((p) => p.title)).toEqual(['X', 'X (2)']);
    });
  });

  it('reports task and sub-task counts per project', () => {
    const plan = planImport(
      model({
        tasks: [
          task({ extId: 'a' }),
          task({ extId: 'b', parentExtId: 'a' }),
          task({ extId: 'c' }),
        ],
      }),
      { isMapPriorityToTags: false },
    );
    expect(plan.projects[0].taskCount).toBe(2);
    expect(plan.projects[0].subTaskCount).toBe(1);
  });
});
