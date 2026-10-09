import { BatchTaskCreate } from '@super-productivity/plugin-api';
import { TickTickImportModel, TickTickTask } from '../parse/normalized-model';
import { buildProjectTitles, planImport } from './plan-import';

const task = (overrides: Partial<TickTickTask>): TickTickTask => ({
  extId: 't1',
  projectExtId: 'p1',
  parentExtId: null,
  title: 'task',
  notes: '',
  isDone: false,
  tags: [],
  priority: 0,
  dueDay: null,
  dueWithTime: null,
  isRecurring: false,
  hasReminder: false,
  wasDemoted: false,
  ...overrides,
});

const project = (
  extId: string,
  title: string,
  extra: Partial<TickTickImportModel['projects'][number]> = {},
): TickTickImportModel['projects'][number] => ({
  extId,
  title,
  folderTitle: '',
  isInbox: false,
  columnCount: 0,
  ...extra,
});

const model = (
  tasks: TickTickTask[],
  projects = [project('p1', 'Work')],
): TickTickImportModel => ({
  projects,
  tasks,
  skippedClosedCount: 0,
  skippedListCount: 0,
});

describe('planImport', () => {
  it('creates sub-tasks with temp- parent refs and carries done checklist items', () => {
    const plan = planImport(
      model([
        task({ extId: 'a' }),
        task({ extId: 'a#check-0', parentExtId: 'a', isDone: true }),
      ]),
      { priorityMapping: 'none' },
    );
    const ops = plan.projects[0].batchChunks[0] as BatchTaskCreate[];
    expect(ops[0].tempId).toBe('temp-a');
    expect(ops[1].data.parentId).toBe('temp-a');
    expect(ops[1].data.isDone).toBe(true);
    expect(plan.projects[0].taskCount).toBe(1);
    expect(plan.projects[0].subTaskCount).toBe(1);
  });

  it('chunks operations in batches of 50', () => {
    const tasks = Array.from({ length: 101 }, (_, i) => task({ extId: `t${i}` }));
    const plan = planImport(model(tasks), { priorityMapping: 'none' });
    expect(plan.projects[0].batchChunks.map((c) => c.length)).toEqual([50, 50, 1]);
  });

  it('puts due dates and tags in follow-ups, never tags on sub-tasks', () => {
    const plan = planImport(
      model([
        task({ extId: 'a', dueDay: '2026-10-15', tags: ['errand'], priority: 5 }),
        task({ extId: 'b', parentExtId: 'a', tags: ['ignored'], priority: 5 }),
      ]),
      { priorityMapping: 'priorityTags' },
    );
    expect(plan.projects[0].followUps).toEqual([
      { tempId: 'temp-a', dueDay: '2026-10-15', tagTitles: ['errand', 'p1'] },
    ]);
    expect(plan.tagTitles).toEqual(['errand', 'p1']);
  });

  it('maps priorities onto the Eisenhower tags when chosen', () => {
    const plan = planImport(
      model([
        task({ extId: 'h', priority: 5 }),
        task({ extId: 'm', priority: 3 }),
        task({ extId: 'l', priority: 1 }),
        task({ extId: 'n', priority: 0 }),
      ]),
      { priorityMapping: 'eisenhower' },
    );
    expect(plan.projects[0].followUps.map((f) => [f.tempId, f.tagTitles])).toEqual([
      ['temp-h', ['urgent', 'important']],
      ['temp-m', ['important']],
      ['temp-l', ['urgent']],
    ]);
  });

  it('only plans selected projects', () => {
    const plan = planImport(
      model(
        [task({ extId: 'a' }), task({ extId: 'b', projectExtId: 'p2' })],
        [project('p1', 'Work'), project('p2', 'Home')],
      ),
      { priorityMapping: 'none', selectedProjectExtIds: new Set(['p2']) },
    );
    expect(plan.projects.map((p) => p.title)).toEqual(['Home']);
  });
});

describe('buildProjectTitles', () => {
  it('renames the inbox, prefixes colliding lists with their folder and suffixes the rest', () => {
    const titles = buildProjectTitles(
      model(
        [],
        [
          project('inbox', 'Inbox', { isInbox: true }),
          project('a', 'Ideas', { folderTitle: 'Job' }),
          project('b', 'Ideas', { folderTitle: 'Private' }),
          project('c', 'Notes'),
          project('d', 'notes'),
        ],
      ),
    );
    expect([...titles.values()]).toEqual([
      'Inbox (TickTick)',
      'Job / Ideas',
      'Private / Ideas',
      'Notes',
      'notes (2)',
    ]);
  });
});
