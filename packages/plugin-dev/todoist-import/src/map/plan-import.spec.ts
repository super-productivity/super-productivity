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
      { priorityMapping: 'none' },
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
    const plan = planImport(model({ tasks }), { priorityMapping: 'none' });
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
      { priorityMapping: 'none' },
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
      { priorityMapping: 'none' },
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
        { priorityMapping: 'priorityTags' },
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
        priorityMapping: 'none',
      });
      expect(plan.tagTitles).toEqual([]);
    });
  });

  describe('eisenhower priority mapping (opt-in)', () => {
    it('maps 4→urgent+important, 3→important, 2→urgent, leaving default 1 untagged', () => {
      const plan = planImport(
        model({
          tasks: [
            task({ extId: 'p1', apiPriority: 4 }),
            task({ extId: 'p2', apiPriority: 3 }),
            task({ extId: 'p3', apiPriority: 2 }),
            task({ extId: 'p4', apiPriority: 1 }),
          ],
        }),
        { priorityMapping: 'eisenhower' },
      );
      // reused by title → lands in SP's existing EM_URGENT / EM_IMPORTANT tags
      expect(plan.tagTitles.sort()).toEqual(['important', 'urgent']);
      expect(plan.projects[0].followUps).toEqual([
        { tempId: 'temp-p1', tagTitles: ['urgent', 'important'] },
        { tempId: 'temp-p2', tagTitles: ['important'] },
        { tempId: 'temp-p3', tagTitles: ['urgent'] },
      ]);
    });

    it('merges the matrix tags after existing labels and never tags sub-tasks', () => {
      const plan = planImport(
        model({
          tasks: [
            task({ extId: 'root', apiPriority: 4, labels: ['errand'] }),
            task({ extId: 'sub', parentExtId: 'root', apiPriority: 4, labels: ['x'] }),
          ],
        }),
        { priorityMapping: 'eisenhower' },
      );
      expect(plan.projects[0].followUps).toEqual([
        { tempId: 'temp-root', tagTitles: ['errand', 'urgent', 'important'] },
      ]);
    });

    it('does not duplicate matrix tags already present as Todoist labels', () => {
      const plan = planImport(
        model({
          tasks: [
            task({
              extId: 'root',
              apiPriority: 4,
              labels: ['Urgent', 'important'],
            }),
          ],
        }),
        { priorityMapping: 'eisenhower' },
      );

      expect(plan.projects[0].followUps).toEqual([
        { tempId: 'temp-root', tagTitles: ['Urgent', 'important'] },
      ]);
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
        { priorityMapping: 'none', selectedProjectExtIds: new Set(['p2']) },
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
        { priorityMapping: 'none' },
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
        { priorityMapping: 'none' },
      );
      expect(plan.projects.map((p) => p.title)).toEqual(['X', 'X (2)']);
    });

    it('never generates a suffix that collides with another project title', () => {
      const plan = planImport(
        model({
          projects: [
            { extId: 'a', title: 'X', parentExtId: null, isInbox: false, childOrder: 1 },
            { extId: 'b', title: 'X', parentExtId: null, isInbox: false, childOrder: 2 },
            {
              extId: 'c',
              title: 'X (2)',
              parentExtId: null,
              isInbox: false,
              childOrder: 3,
            },
          ],
        }),
        { priorityMapping: 'none' },
      );

      expect(plan.projects.map((p) => p.title)).toEqual(['X', 'X (3)', 'X (2)']);
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
      { priorityMapping: 'none' },
    );
    expect(plan.projects[0].taskCount).toBe(2);
    expect(plan.projects[0].subTaskCount).toBe(1);
  });
});
