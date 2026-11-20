import { BatchTaskCreate } from '@super-productivity/plugin-api';
import { MsTodoImportModel, MsTodoList, MsTodoTask } from '../parse/normalized-model';
import { BATCH_CHUNK_SIZE, buildProjectTitles, planImport } from './plan-import';

const task = (overrides: Partial<MsTodoTask>): MsTodoTask => ({
  extId: 't1',
  projectExtId: 'p1',
  parentExtId: null,
  title: 'task',
  notes: '',
  isDone: false,
  categories: [],
  isImportant: false,
  dueDay: null,
  isRecurring: false,
  repeat: null,
  hasReminder: false,
  hasAttachments: false,
  ...overrides,
});

const list = (overrides: Partial<MsTodoList>): MsTodoList => ({
  extId: 'p1',
  title: 'Work',
  isDefault: false,
  isFlaggedEmails: false,
  ...overrides,
});

const model = (overrides: Partial<MsTodoImportModel> = {}): MsTodoImportModel => ({
  projects: [list({})],
  tasks: [],
  ...overrides,
});

const NO_TAG = { isTagImportant: false };

describe('planImport', () => {
  it('creates temp- prefixed IDs and parent references, keeping checked steps done', () => {
    const plan = planImport(
      model({
        tasks: [
          task({ extId: 'a' }),
          task({ extId: 'b', parentExtId: 'a', title: 'open step' }),
          task({ extId: 'c', parentExtId: 'a', title: 'checked step', isDone: true }),
        ],
      }),
      NO_TAG,
    );
    const ops = plan.projects[0].batchChunks[0] as BatchTaskCreate[];
    expect(ops.map((o) => [o.tempId, o.data.parentId, o.data.isDone])).toEqual([
      ['temp-a', undefined, undefined],
      ['temp-b', 'temp-a', undefined],
      ['temp-c', 'temp-a', true],
    ]);
  });

  it('chunks operations at the batch limit, keeping parents before children', () => {
    const tasks: MsTodoTask[] = [];
    for (let i = 0; i < 60; i++) {
      tasks.push(task({ extId: `root-${i}`, title: `t${i}` }));
      tasks.push(task({ extId: `sub-${i}`, parentExtId: `root-${i}`, title: `s${i}` }));
    }
    const plan = planImport(model({ tasks }), NO_TAG);
    const chunks = plan.projects[0].batchChunks;
    expect(chunks.length).toBe(3);
    chunks.forEach((chunk) => expect(chunk.length).toBeLessThanOrEqual(BATCH_CHUNK_SIZE));
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

  it('emits follow-ups only for tasks with a due day, tags or a repeat', () => {
    const repeat = {
      schedule: { quickSetting: 'DAILY' as const },
      notesWithRule: 'Repeats: every day',
    };
    const plan = planImport(
      model({
        tasks: [
          task({ extId: 'plain' }),
          task({ extId: 'due', dueDay: '2026-12-01' }),
          task({ extId: 'rep', dueDay: '2026-12-02', repeat }),
        ],
      }),
      NO_TAG,
    );
    expect(plan.projects[0].followUps).toEqual([
      { tempId: 'temp-due', dueDay: '2026-12-01' },
      { tempId: 'temp-rep', dueDay: '2026-12-02', repeat },
    ]);
  });

  it('tags tasks with their categories but never steps', () => {
    const plan = planImport(
      model({
        tasks: [
          task({ extId: 'a', categories: ['Red category', 'Errand'] }),
          task({ extId: 'b', parentExtId: 'a', categories: ['Ignored'] }),
        ],
      }),
      NO_TAG,
    );
    expect(plan.projects[0].followUps).toEqual([
      { tempId: 'temp-a', tagTitles: ['Red category', 'Errand'] },
    ]);
    expect(plan.tagTitles).toEqual(['Red category', 'Errand']);
  });

  describe('important (starred) tasks', () => {
    const starred = model({
      tasks: [
        task({ extId: 'a', isImportant: true, categories: ['Important'] }),
        task({ extId: 'b', isImportant: true }),
        task({ extId: 'c' }),
      ],
    });

    it('adds the important tag once when opted in', () => {
      const plan = planImport(starred, { isTagImportant: true });
      expect(plan.projects[0].followUps).toEqual([
        { tempId: 'temp-a', tagTitles: ['Important'] },
        { tempId: 'temp-b', tagTitles: ['important'] },
      ]);
    });

    it('adds no tag when opted out', () => {
      const plan = planImport(starred, NO_TAG);
      expect(plan.projects[0].followUps).toEqual([
        { tempId: 'temp-a', tagTitles: ['Important'] },
      ]);
    });
  });

  describe('project selection and titles', () => {
    it('only plans selected projects', () => {
      const plan = planImport(
        model({
          projects: [list({ extId: 'p1' }), list({ extId: 'p2', title: 'Home' })],
        }),
        { ...NO_TAG, selectedProjectExtIds: new Set(['p2']) },
      );
      expect(plan.projects.map((p) => p.title)).toEqual(['Home']);
    });

    it('renames the default list and suffixes duplicate titles', () => {
      const titles = buildProjectTitles(
        model({
          projects: [
            list({ extId: 'd', title: 'Tasks', isDefault: true }),
            list({ extId: 'a', title: 'Groceries' }),
            list({ extId: 'b', title: 'groceries' }),
            list({ extId: 'c', title: 'Groceries (2)' }),
          ],
        }),
      );
      expect([...titles.values()]).toEqual([
        'Tasks (Microsoft To Do)',
        'Groceries',
        'groceries (3)',
        'Groceries (2)',
      ]);
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
      NO_TAG,
    );
    expect(plan.projects[0].taskCount).toBe(2);
    expect(plan.projects[0].subTaskCount).toBe(1);
  });
});
