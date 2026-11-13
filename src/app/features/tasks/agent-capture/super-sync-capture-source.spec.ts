import type {
  SuperSyncCaptureClaimResult,
  SuperSyncProvider,
} from '@sp/sync-providers/super-sync';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { INBOX_PROJECT } from '../../project/project.const';
import {
  AgentCapture,
  AgentCaptureRun,
  CaptureUnsupportedError,
  createSuperSyncCaptureSource,
  findCaptureProjectId,
  neutralizeAutoloadMedia,
  toCaptureTask,
} from './super-sync-capture-source';
import { TaskReminderOptionId } from '../task.model';
import { addTaskRepeatCfgToTask } from '../../task-repeat-cfg/store/task-repeat-cfg.actions';

/**
 * The key and item are the vector pinned in sync-core's capture-open.spec.ts
 * and the server's capture-seal.spec.ts: user key 0x01 × 32, item "item-1",
 * payload { v: 1, title: 'Buy milk', createdAt: 1, client: 'Claude' }.
 */
const KEY = {
  v: 1,
  privateKeyPkcs8:
    'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQGhRANCAARv8DuUkkHOHa3UNRnmlg4KhbQaaaBcMoEDqivOFZTKFjxPdTpVvwHcU/bAsMfu54tAxv99JaluIoK5ic73HBRK',
  publicKeySpki:
    'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEb/A7lJJBzh2t1DUZ5pYOCoW0GmmgXDKBA6orzhWUyhY8T3U6Vb8B3FP2wLDH7ueLQMb/fSWpbiKCuYnO9xwUSg==',
} as const;
const SEALED =
  'AQRVD0cQA/Pfl8PfUGrHl/ZyH7Gh+3uPb4PSJEmKZciOJBNgk9cBLlCac3FcvQsAo8wP9LXAGz/6GWqx+zJwNrjmAwMDAwMDAwMDAwMDVvPcrvop4zkadZl48K6FngoPEOmueJnbVQpq/L3kuXad+gVrd8UPZvLd5bkSyJANaDo07JGPJM67pw7l2yyLylKJEyur+1ke1Pc=';
const ITEM = { itemId: 'item-1', taskId: 'task-1', ciphertext: SEALED, createdAt: 5 };

describe('createSuperSyncCaptureSource', () => {
  let provider: jasmine.SpyObj<SuperSyncProvider>;
  let dispatch: jasmine.Spy;
  let isCurrent: boolean;
  let run: AgentCaptureRun | null;

  const ok = (items = [ITEM]): SuperSyncCaptureClaimResult => ({ status: 'ok', items });
  const source = (): ReturnType<typeof createSuperSyncCaptureSource> =>
    createSuperSyncCaptureSource({ startRun: () => run, dispatch });

  beforeEach(() => {
    provider = jasmine.createSpyObj<SuperSyncProvider>('SuperSyncProvider', [
      'claimCaptures',
      'registerCaptureKey',
      'ackCaptures',
    ]);
    provider.ackCaptures.and.resolveTo();
    dispatch = jasmine.createSpy('dispatch');
    isCurrent = true;
    run = {
      provider,
      key: KEY,
      deviceId: 'dev-1',
      defaultEstimate: 0,
      defaultRemindOption: TaskReminderOptionId.AtStart,
      todayStr: '2026-10-15',
      getTargetProjects: () => [{ id: 'p-work', title: 'Work' }],
      assertUnchanged: (context) => {
        if (!isCurrent) throw new Error(`changed at ${context}`);
      },
    };
  });

  it('opens claimed items into Inbox tasks keyed by the server task id', async () => {
    provider.claimCaptures.and.resolveTo(ok());
    const src = source();

    const [capture] = await src.getPending();
    expect(capture).toEqual({
      id: 'task-1',
      task: { title: 'Buy milk', createdAt: 1 },
    });
    expect(src.isValid(capture)).toBeTrue();

    src.createTask(capture);
    const action = dispatch.calls.mostRecent().args[0] as ReturnType<
      typeof TaskSharedActions.addTask
    >;
    expect(action.type).toBe(TaskSharedActions.addTask.type);
    expect(action.task).toEqual(
      jasmine.objectContaining({
        id: 'task-1',
        title: 'Buy milk',
        projectId: INBOX_PROJECT.id,
        created: 1,
      }),
    );
    expect(action.isIgnoreShortSyntax).toBeTrue();
    expect(action.task.timeEstimate).toBe(0);

    await src.acknowledge('task-1');
    expect(provider.ackCaptures).toHaveBeenCalledWith('dev-1', [
      { itemId: 'item-1', taskId: 'task-1' },
    ]);
  });

  it('puts the default estimate into the addTask itself (one op)', async () => {
    provider.claimCaptures.and.resolveTo(ok());
    run = { ...(run as AgentCaptureRun), defaultEstimate: 1500 };
    const src = source();
    const [capture] = await src.getPending();
    src.createTask(capture);
    const action = dispatch.calls.mostRecent().args[0] as ReturnType<
      typeof TaskSharedActions.addTask
    >;
    expect(action.task.timeEstimate).toBe(1500);
  });

  it('schedules a day without a time as dueDay, in the addTask itself', async () => {
    provider.claimCaptures.and.resolveTo(ok());
    const src = source();
    await src.getPending();
    src.createTask({
      id: 'task-1',
      task: { title: 'Dentist', createdAt: 1, dueDay: '2026-10-16' },
    });
    const action = dispatch.calls.mostRecent().args[0] as ReturnType<
      typeof TaskSharedActions.addTask
    >;
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(action.task.dueDay).toBe('2026-10-16');
    expect(action.task.dueWithTime).toBeUndefined();
    expect(action.task.remindAt).toBeUndefined();
  });

  it('schedules a day and time in local time with the default reminder', async () => {
    provider.claimCaptures.and.resolveTo(ok());
    run = {
      ...(run as AgentCaptureRun),
      defaultRemindOption: TaskReminderOptionId.m10,
    };
    const src = source();
    await src.getPending();
    src.createTask({
      id: 'task-1',
      task: { title: 'Dentist', createdAt: 1, dueDay: '2026-10-16', dueTime: [9, 30] },
    });
    const action = dispatch.calls.mostRecent().args[0] as ReturnType<
      typeof TaskSharedActions.addTask
    >;
    const due = new Date(2026, 9, 16, 9, 30).getTime();
    const tenMinutes = 10 * 60 * 1000;
    expect(action.task).toEqual(
      jasmine.objectContaining({
        dueDay: undefined,
        dueWithTime: due,
        hasPlannedTime: true,
        remindAt: due - tenMinutes,
      }),
    );
  });

  it('dispatches no repeat config for a one-off capture', async () => {
    provider.claimCaptures.and.resolveTo(ok());
    const src = source();
    const [capture] = await src.getPending();
    src.createTask(capture);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('makes a recurring capture repeatable right after its addTask', async () => {
    provider.claimCaptures.and.resolveTo(ok());
    const src = source();
    await src.getPending();
    src.createTask({
      id: 'task-1',
      task: {
        title: 'Standup',
        createdAt: 1,
        dueDay: '2026-10-19',
        dueTime: [9, 5],
        repeat: { cycle: 'WEEKLY', every: 1, weekdays: [1, 2, 3, 4, 5] },
      },
    });
    expect(dispatch).toHaveBeenCalledTimes(2);
    const [[addTask], [addRepeat]] = dispatch.calls.allArgs() as [
      [ReturnType<typeof TaskSharedActions.addTask>],
      [ReturnType<typeof addTaskRepeatCfgToTask>],
    ];
    expect(addTask.type).toBe(TaskSharedActions.addTask.type);
    expect(addRepeat.type).toBe(addTaskRepeatCfgToTask.type);
    expect(addRepeat.taskId).toBe('task-1');
    expect(addRepeat.startTime).toBe('09:05');
    expect(addRepeat.remindAt).toBe(TaskReminderOptionId.AtStart);
    expect(addRepeat.taskRepeatCfg).toEqual(
      jasmine.objectContaining({
        title: 'Standup',
        projectId: INBOX_PROJECT.id,
        repeatCycle: 'WEEKLY',
        startDate: '2026-10-19',
        monday: true,
        friday: true,
        saturday: false,
      }),
    );
  });

  it('adds a capture and its repeat to the named project', async () => {
    provider.claimCaptures.and.resolveTo(ok());
    const src = source();
    await src.getPending();
    src.createTask({
      id: 'task-1',
      task: {
        title: 'Review',
        createdAt: 1,
        project: 'work',
        repeat: { cycle: 'DAILY', every: 1 },
      },
    });
    const [[addTask], [addRepeat]] = dispatch.calls.allArgs() as [
      [ReturnType<typeof TaskSharedActions.addTask>],
      [ReturnType<typeof addTaskRepeatCfgToTask>],
    ];
    expect(addTask.task.projectId).toBe('p-work');
    expect(addTask.workContextId).toBe('p-work');
    expect(addRepeat.taskRepeatCfg.projectId).toBe('p-work');
  });

  it('uses the Inbox when the named project is gone at create time', async () => {
    provider.claimCaptures.and.resolveTo(ok());
    const src = source();
    await src.getPending();
    // Deleted after the claim: the source holds this run and reads it lazily.
    (run as AgentCaptureRun).getTargetProjects = () => [];
    src.createTask({
      id: 'task-1',
      task: { title: 'Review', createdAt: 1, project: 'Work' },
    });
    const action = dispatch.calls.mostRecent().args[0] as ReturnType<
      typeof TaskSharedActions.addTask
    >;
    expect(action.task.projectId).toBe(INBOX_PROJECT.id);
    expect(action.workContextId).toBe(INBOX_PROJECT.id);
  });

  it("starts an undated series on this device's today", async () => {
    provider.claimCaptures.and.resolveTo(ok());
    const src = source();
    await src.getPending();
    src.createTask({
      id: 'task-1',
      task: { title: 'Stretch', createdAt: 1, repeat: { cycle: 'DAILY', every: 1 } },
    });
    const addRepeat = dispatch.calls.mostRecent().args[0] as ReturnType<
      typeof addTaskRepeatCfgToTask
    >;
    expect(addRepeat.taskRepeatCfg.startDate).toBe('2026-10-15');
    expect(addRepeat.startTime).toBeUndefined();
    expect(addRepeat.remindAt).toBeUndefined();
  });

  it('adds no reminder when the default is to not remind', async () => {
    provider.claimCaptures.and.resolveTo(ok());
    run = {
      ...(run as AgentCaptureRun),
      defaultRemindOption: TaskReminderOptionId.DoNotRemind,
    };
    const src = source();
    await src.getPending();
    src.createTask({
      id: 'task-1',
      task: { title: 'Dentist', createdAt: 1, dueDay: '2026-10-16', dueTime: [9, 30] },
    });
    const action = dispatch.calls.mostRecent().args[0] as ReturnType<
      typeof TaskSharedActions.addTask
    >;
    expect(action.task.dueWithTime).toBe(new Date(2026, 9, 16, 9, 30).getTime());
    expect('remindAt' in action.task).toBeFalse();
  });

  it('registers the synced key when the server has none, then claims again', async () => {
    provider.claimCaptures.and.returnValues(
      Promise.resolve({ status: 'no_key' }),
      Promise.resolve(ok()),
    );
    provider.registerCaptureKey.and.resolveTo('registered');

    expect((await source().getPending()).length).toBe(1);
    expect(provider.registerCaptureKey).toHaveBeenCalledWith(KEY.publicKeySpki);
  });

  it('imports nothing when the server reports capture switched off', async () => {
    provider.claimCaptures.and.resolveTo({ status: 'key_mismatch' });
    provider.registerCaptureKey.and.resolveTo('disabled');

    expect(await source().getPending()).toEqual([]);
    expect(provider.claimCaptures).toHaveBeenCalledTimes(1);
  });

  it('rejects on a server without capture, so receipts are not pruned', async () => {
    provider.claimCaptures.and.resolveTo({ status: 'unsupported' });

    await expectAsync(source().getPending()).toBeRejectedWithError(
      CaptureUnsupportedError,
    );
    expect(provider.registerCaptureKey).not.toHaveBeenCalled();
  });

  it('rejects when capture disappears between register and re-claim', async () => {
    provider.claimCaptures.and.returnValues(
      Promise.resolve({ status: 'no_key' }),
      Promise.resolve({ status: 'unsupported' }),
    );
    provider.registerCaptureKey.and.resolveTo('registered');

    await expectAsync(source().getPending()).toBeRejectedWithError(
      CaptureUnsupportedError,
    );
  });

  it('keeps an item it cannot open as invalid, never as a task', async () => {
    provider.claimCaptures.and.resolveTo(ok([{ ...ITEM, itemId: 'other-item' }]));
    const src = source();

    const [capture] = await src.getPending();
    expect(capture).toEqual({ id: 'task-1', task: null } as AgentCapture);
    expect(src.isValid(capture)).toBeFalse();
  });

  it('creates and acks nothing once the sync target changed', async () => {
    provider.claimCaptures.and.resolveTo(ok());
    const src = source();
    const [capture] = await src.getPending();
    isCurrent = false;

    expect(() => src.createTask(capture)).toThrowError(/createTask/);
    await expectAsync(src.acknowledge('task-1')).toBeRejectedWithError(/acknowledge/);
    expect(dispatch).not.toHaveBeenCalled();
    expect(provider.ackCaptures).not.toHaveBeenCalled();
  });

  it('skips the run without a request when capture is not active', async () => {
    run = null;
    expect(await source().getPending()).toEqual([]);
    expect(provider.claimCaptures).not.toHaveBeenCalled();
  });
});

describe('toCaptureTask', () => {
  const base = { v: 1, title: 'Dentist', createdAt: 1, client: 'Claude' };

  it('reads an optional due day and time', () => {
    expect(toCaptureTask({ ...base, dueDate: '2026-10-16' })).toEqual({
      title: 'Dentist',
      createdAt: 1,
      dueDay: '2026-10-16',
    });
    expect(toCaptureTask({ ...base, dueDate: '2026-10-16', dueTime: '18:05' })).toEqual({
      title: 'Dentist',
      createdAt: 1,
      dueDay: '2026-10-16',
      dueTime: [18, 5],
    });
  });

  it('reads an optional repeat', () => {
    expect(toCaptureTask({ ...base, repeat: { cycle: 'monthly', every: 3 } })).toEqual({
      title: 'Dentist',
      createdAt: 1,
      repeat: { cycle: 'MONTHLY', every: 3 },
    });
    expect(toCaptureTask({ ...base, repeat: { cycle: 'hourly' } })).toEqual({
      title: 'Dentist',
      createdAt: 1,
    });
  });

  it('drops an invalid due day or time but keeps the task', () => {
    for (const due of [
      { dueDate: '2026-02-30' },
      { dueDate: '0001-01-01' },
      { dueDate: '0500-06-15' },
      { dueDate: '0999-12-31' },
      { dueDate: '2026-10-16T09:30' },
      { dueDate: 1 },
      { dueTime: '09:30' },
    ]) {
      expect(toCaptureTask({ ...base, ...due })).toEqual({
        title: 'Dentist',
        createdAt: 1,
      });
    }
    expect(toCaptureTask({ ...base, dueDate: '2026-10-16', dueTime: '25:00' })).toEqual({
      title: 'Dentist',
      createdAt: 1,
      dueDay: '2026-10-16',
    });
  });
});

describe('toCaptureTask project', () => {
  const base = { v: 1, title: 'Review', createdAt: 1, client: 'Claude' };

  it('keeps a trimmed project title and drops an invalid one', () => {
    expect(toCaptureTask({ ...base, project: '  Work ' })).toEqual({
      title: 'Review',
      createdAt: 1,
      project: 'Work',
    });
    for (const project of ['', '   ', 1, 'x'.repeat(201)]) {
      expect(toCaptureTask({ ...base, project })).toEqual({
        title: 'Review',
        createdAt: 1,
      });
    }
  });
});

describe('findCaptureProjectId', () => {
  const projects = [
    { id: 'p-work', title: 'Work' },
    { id: 'p-home-1', title: 'Home' },
    { id: 'p-home-2', title: 'home ' },
  ];

  it('finds the one project with that title, ignoring case and space', () => {
    expect(findCaptureProjectId('WORK', projects)).toBe('p-work');
    expect(findCaptureProjectId(' work', projects)).toBe('p-work');
  });

  it('falls back to the Inbox for no, a missing or an ambiguous match', () => {
    expect(findCaptureProjectId(undefined, projects)).toBe(INBOX_PROJECT.id);
    expect(findCaptureProjectId('Garden', projects)).toBe(INBOX_PROJECT.id);
    expect(findCaptureProjectId('Home', projects)).toBe(INBOX_PROJECT.id);
  });
});

describe('toCaptureTask link', () => {
  const base = { v: 1, title: 'Article', createdAt: 1, client: 'Android share' };

  it('keeps an http(s) link and drops notes that only repeat it', () => {
    const link = 'https://example.com/a?b=c';
    expect(toCaptureTask({ ...base, notes: link, link })).toEqual({
      title: 'Article',
      createdAt: 1,
      link,
    });
    expect(toCaptureTask({ ...base, notes: 'see this', link })).toEqual({
      title: 'Article',
      notes: 'see this',
      createdAt: 1,
      link,
    });
  });

  it('drops links that are not http(s), malformed or too long', () => {
    for (const link of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,x',
      'https://',
      'not a url',
      `https://example.com/${'a'.repeat(2048)}`,
      42,
    ]) {
      expect(toCaptureTask({ ...base, link })).toEqual({
        title: 'Article',
        createdAt: 1,
      });
    }
  });

  it('keeps more notes when asked to (a share from this device)', () => {
    const notes = 'n'.repeat(9000);
    expect(toCaptureTask({ ...base, notes })?.notes?.length).toBe(8192);
    expect(toCaptureTask({ ...base, notes }, 100_000)?.notes).toBe(notes);
  });
});

describe('neutralizeAutoloadMedia', () => {
  it('turns remote images into links and media tags into text', () => {
    expect(neutralizeAutoloadMedia('see ![x](https://evil.example/p?u=1) ok')).toBe(
      'see [x](https://evil.example/p?u=1) ok',
    );
    expect(neutralizeAutoloadMedia('![a][ref]\n\n[ref]: https://e.example/i')).toBe(
      '[a][ref]\n\n[ref]: https://e.example/i',
    );
    expect(
      neutralizeAutoloadMedia('<img src="https://e.example/i"> <VIDEO poster=x>'),
    ).toBe('&lt;img src="https://e.example/i"> &lt;VIDEO poster=x>');
    // Removing one `!` must not leave another in front of the `[`.
    expect(neutralizeAutoloadMedia('!![x](https://e.example/i)')).toBe(
      '[x](https://e.example/i)',
    );
    // The sanitizer keeps `background` on table parts; browsers load it.
    expect(
      neutralizeAutoloadMedia('<table><tr><td background="https://e.example/i">'),
    ).toBe('&lt;table>&lt;tr>&lt;td background="https://e.example/i">');
  });

  it('keeps links, other markup and comparisons as they are', () => {
    const text = 'Read [docs](https://e.example), **now**; a < b and <b>bold</b>';
    expect(neutralizeAutoloadMedia(text)).toBe(text);
  });
});
