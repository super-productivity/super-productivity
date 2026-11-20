import {
  BatchTaskCreate,
  BatchUpdateRequest,
  Tag,
  Task,
} from '@super-productivity/plugin-api';
import { MsTodoImportModel, MsTodoTask } from '../parse/normalized-model';
import { planImport } from './plan-import';
import { runImport } from './run-import';

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

const model = (tasks: MsTodoTask[]): MsTodoImportModel => ({
  projects: [{ extId: 'p1', title: 'Work', isDefault: false, isFlaggedEmails: false }],
  tasks,
});

/** In-memory fake of the PluginAPI subset the executor uses. */
const createFakeApi = (
  opts: {
    existingTags?: Partial<Tag>[];
    failNthBatch?: number;
    failNthTag?: number;
    failGetTasks?: boolean;
    rejectRepeatFor?: string;
  } = {},
): {
  api: Parameters<typeof runImport>[0];
  sentBatches: BatchUpdateRequest[];
  updates: { taskId: string; changes: Partial<Task> }[];
  createdTags: string[];
  /** every updateTask and addTaskRepeatCfg call, in order */
  calls: string[];
} => {
  const sentBatches: BatchUpdateRequest[] = [];
  const updates: { taskId: string; changes: Partial<Task> }[] = [];
  const calls: string[] = [];
  const createdTags: string[] = [];
  const createdTasks: Task[] = [];
  let idCounter = 0;
  let batchCounter = 0;
  let tagCounter = 0;

  const api: Parameters<typeof runImport>[0] = {
    getAllTags: async () => (opts.existingTags || []) as Tag[],
    addTag: async (tagData) => {
      tagCounter++;
      if (opts.failNthTag === tagCounter) {
        throw new Error('tag failed');
      }
      createdTags.push(tagData.title as string);
      return `tag-${createdTags.length}`;
    },
    addProject: async () => `project-${++idCounter}`,
    batchUpdateForProject: async (request) => {
      batchCounter++;
      if (opts.failNthBatch === batchCounter) {
        throw new Error('batch failed');
      }
      sentBatches.push(request);
      const createdTaskIds: Record<string, string> = {};
      for (const op of request.operations) {
        if (op.type === 'create') {
          const realId = `real-${op.tempId}`;
          createdTaskIds[op.tempId] = realId;
          const parentId = op.data.parentId || null;
          createdTasks.push({
            id: realId,
            title: op.data.title,
            projectId: request.projectId,
            // mirror the host: an unresolved temp- parent would orphan-delete
            parentId: parentId && parentId.startsWith('temp-') ? undefined : parentId,
            tagIds: [],
            subTaskIds: [],
            timeEstimate: 0,
            timeSpent: 0,
            isDone: false,
            created: 1,
          } as Task);
        }
      }
      return { success: true, createdTaskIds };
    },
    updateTask: async (taskId, changes) => {
      updates.push({ taskId, changes });
      calls.push(`update ${taskId} ${Object.keys(changes).join(',')}`);
    },
    addTaskRepeatCfg: async (taskId, schedule) => {
      if (opts.rejectRepeatFor === taskId) {
        throw new Error('INVALID_INPUT: rejected');
      }
      calls.push(`repeat ${taskId} ${schedule?.quickSetting}`);
      return `cfg-${taskId}`;
    },
    getTasks: async () => {
      if (opts.failGetTasks) {
        throw new Error('getTasks failed');
      }
      return createdTasks;
    },
  };
  return { api, sentBatches, updates, createdTags, calls };
};

describe('runImport', () => {
  it('rewrites temp- parent refs to real IDs when a family straddles a chunk boundary', async () => {
    // 49 filler roots + 1 root at index 49 whose 3 subtasks land in chunk 2
    const tasks: MsTodoTask[] = [];
    for (let i = 0; i < 49; i++) {
      tasks.push(task({ extId: `filler-${i}` }));
    }
    tasks.push(task({ extId: 'family-root' }));
    for (let i = 0; i < 3; i++) {
      tasks.push(task({ extId: `family-sub-${i}`, parentExtId: 'family-root' }));
    }
    const plan = planImport(model(tasks), { isTagImportant: false });
    expect(plan.projects[0].batchChunks.length).toBe(2);

    const { api, sentBatches } = createFakeApi();
    const result = await runImport(api, plan, () => {});

    // the second SENT chunk must reference the parent's REAL id, not temp-
    const secondChunkCreates = sentBatches[1].operations as BatchTaskCreate[];
    for (const op of secondChunkCreates) {
      expect(op.data.parentId).toBe('real-temp-family-root');
    }
    // and nothing was lost: 53 planned, 53 landed
    expect(result.imported[0].landedTaskCount).toBe(50);
    expect(result.imported[0].landedSubTaskCount).toBe(3);
    expect(result.errorMessage).toBeNull();
  });

  it('keeps temp- parent refs within the same chunk (bridge resolves those)', async () => {
    const plan = planImport(
      model([task({ extId: 'a' }), task({ extId: 'b', parentExtId: 'a' })]),
      { isTagImportant: false },
    );
    const { api, sentBatches } = createFakeApi();
    await runImport(api, plan, () => {});
    const ops = sentBatches[0].operations as BatchTaskCreate[];
    expect(ops[1].data.parentId).toBe('temp-a');
  });

  it('never maps a category onto the virtual TODAY tag', async () => {
    const plan = planImport(model([task({ extId: 'a', categories: ['Today'] })]), {
      isTagImportant: false,
    });
    const { api, updates, createdTags } = createFakeApi({
      existingTags: [{ id: 'TODAY', title: 'Today' }],
    });
    await runImport(api, plan, () => {});
    expect(createdTags).toEqual(['Today']);
    expect(updates[0].changes.tagIds).toEqual(['tag-1']);
  });

  it('reuses existing tags by title, case-insensitively', async () => {
    const plan = planImport(model([task({ extId: 'a', categories: ['Errand'] })]), {
      isTagImportant: false,
    });
    const { api, updates, createdTags } = createFakeApi({
      existingTags: [{ id: 'tag-existing', title: 'errand' }],
    });
    await runImport(api, plan, () => {});
    expect(createdTags).toEqual([]);
    expect(updates[0].changes.tagIds).toEqual(['tag-existing']);
  });

  describe('the built-in important tag', () => {
    const starredPlan = () =>
      planImport(model([task({ extId: 'a', isImportant: true })]), {
        isTagImportant: true,
      });

    it('reuses it by id even after the user renamed it', async () => {
      const { api, updates, createdTags } = createFakeApi({
        existingTags: [
          { id: 'EM_IMPORTANT', title: 'Wichtig' },
          // a user tag carrying the old title must not win over the built-in one
          { id: 'tag-user', title: 'important' },
        ],
      });
      await runImport(api, starredPlan(), () => {});
      expect(createdTags).toEqual([]);
      expect(updates[0].changes.tagIds).toEqual(['EM_IMPORTANT']);
    });

    it('falls back to a tag titled "important" when the built-in one is gone', async () => {
      const { api, updates, createdTags } = createFakeApi({
        existingTags: [{ id: 'tag-user', title: 'Important' }],
      });
      await runImport(api, starredPlan(), () => {});
      expect(createdTags).toEqual([]);
      expect(updates[0].changes.tagIds).toEqual(['tag-user']);
    });

    it('creates the tag when neither exists', async () => {
      const { api, updates, createdTags } = createFakeApi();
      await runImport(api, starredPlan(), () => {});
      expect(createdTags).toEqual(['important']);
      expect(updates[0].changes.tagIds).toEqual(['tag-1']);
    });
  });

  it('reports tags created before a later tag creation fails', async () => {
    const plan = planImport(
      model([task({ extId: 'a', categories: ['first', 'second'] })]),
      {
        isTagImportant: false,
      },
    );
    const { api } = createFakeApi({ failNthTag: 2 });

    const result = await runImport(api, plan, () => {});

    expect(result.createdTagTitles).toEqual(['first']);
    expect(result.errorMessage).toBe('tag failed');
  });

  it('records the failed project as partial and keeps earlier projects', async () => {
    const m: MsTodoImportModel = {
      projects: [
        { extId: 'p1', title: 'A', isDefault: false, isFlaggedEmails: false },
        { extId: 'p2', title: 'B', isDefault: false, isFlaggedEmails: false },
      ],
      tasks: [
        task({ extId: 'a', projectExtId: 'p1' }),
        task({ extId: 'b', projectExtId: 'p2' }),
      ],
    };
    const plan = planImport(m, { isTagImportant: false });
    const { api } = createFakeApi({ failNthBatch: 2 });
    const result = await runImport(api, plan, () => {});
    expect(result.imported.map((p) => p.title)).toEqual(['A']);
    expect(result.failedProjectTitle).toBe('B');
    expect(result.errorMessage).toBe('batch failed');
  });

  it('does not let a failed recount mask a successful import', async () => {
    const plan = planImport(model([task({ extId: 'a' })]), {
      isTagImportant: false,
    });
    const { api } = createFakeApi({ failGetTasks: true });
    const result = await runImport(api, plan, () => {});
    expect(result.errorMessage).toBeNull();
    expect(result.isCountUnverified).toBe(true);
    expect(result.imported.length).toBe(1);
  });

  describe('repeats', () => {
    const repeating = (extId: string): MsTodoTask =>
      task({
        extId,
        dueDay: '2026-07-15',
        notes: 'desc',
        isRecurring: true,
        repeat: {
          schedule: { quickSetting: 'DAILY' },
          notesWithRule: 'desc\n\nRepeats: every day',
        },
      });
    const planFor = (tasks: MsTodoTask[]) =>
      planImport(model(tasks), { isTagImportant: false });

    it('sets up the repeat after the due date it starts from', async () => {
      const { api, calls } = createFakeApi();
      const result = await runImport(api, planFor([repeating('a')]), () => {});
      expect(calls).toEqual(['update real-temp-a dueDay', 'repeat real-temp-a DAILY']);
      expect(result.failedRepeatCount).toBe(0);
    });

    it('puts the rule back into the notes when the repeat is rejected', async () => {
      const { api, calls, updates } = createFakeApi({ rejectRepeatFor: 'real-temp-a' });
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const result = await runImport(
        api,
        planFor([repeating('a'), repeating('b')]),
        () => {},
      );
      warn.mockRestore();
      expect(calls).toEqual([
        'update real-temp-a dueDay',
        'update real-temp-a notes',
        'update real-temp-b dueDay',
        'repeat real-temp-b DAILY',
      ]);
      expect(updates[1].changes).toEqual({ notes: 'desc\n\nRepeats: every day' });
      expect(result.failedRepeatCount).toBe(1);
      expect(result.errorMessage).toBeNull();
    });
  });

  it('reports detail progress during follow-ups', async () => {
    const tasks: MsTodoTask[] = [];
    for (let i = 0; i < 30; i++) {
      tasks.push(task({ extId: `t-${i}`, dueDay: '2026-07-15' }));
    }
    const plan = planImport(model(tasks), { isTagImportant: false });
    const { api } = createFakeApi();
    const detailReports: (number | undefined)[] = [];
    await runImport(api, plan, (p) => {
      if (p.phase === 'details') {
        detailReports.push(p.detailIndex);
      }
    });
    expect(detailReports).toEqual([0, 25]);
  });
});
