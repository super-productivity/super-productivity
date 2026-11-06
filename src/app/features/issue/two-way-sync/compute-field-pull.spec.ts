import { Task } from '../../tasks/task.model';
import {
  computeFieldPullChanges,
  computePendingLocalChanges,
  FieldPullInput,
  hasRemoteFieldChange,
} from './compute-field-pull';
import { FieldMapping, FieldSyncConfig } from './issue-sync.model';

const identity = (v: unknown): unknown => v;

const MAPPINGS: FieldMapping[] = [
  {
    taskField: 'isDone',
    issueField: 'done',
    defaultDirection: 'both',
    toIssueValue: (v) => !!v,
    toTaskValue: (v) => !!v,
  },
  {
    taskField: 'title',
    issueField: 'summary',
    defaultDirection: 'both',
    toIssueValue: (v) => v ?? '',
    toTaskValue: (v) => v ?? '',
  },
  {
    taskField: 'notes',
    issueField: 'description',
    defaultDirection: 'pullOnly',
    toIssueValue: identity,
    toTaskValue: identity,
  },
  {
    taskField: 'timeEstimate',
    issueField: 'estimate',
    defaultDirection: 'pushOnly',
    toIssueValue: identity,
    toTaskValue: identity,
  },
];

const BASELINE = { done: false, summary: 'Old', description: 'D', estimate: 1 };

const task = (changes: Partial<Task> = {}): Task =>
  ({
    id: 'sp-1',
    title: 'Old',
    isDone: false,
    notes: 'D',
    timeEstimate: 1,
    issueLastSyncedValues: BASELINE,
    ...changes,
  }) as Task;

const input = (overrides: Partial<FieldPullInput>): FieldPullInput => ({
  task: task(),
  issueValues: BASELINE,
  wasUpdated: true,
  addTaskData: { issueLastUpdated: 2, issueLastSyncedValues: BASELINE },
  fieldMappings: MAPPINGS,
  syncConfig: {},
  ctx: { issueId: 'i-1' },
  isPullOnlyAuthoritative: false,
  ...overrides,
});

describe('computeFieldPullChanges', () => {
  describe('per field (Plainspace)', () => {
    it('pulls only the field whose remote value left its baseline', () => {
      const changes = computeFieldPullChanges(
        input({
          task: task({ title: 'Local rename' }),
          issueValues: { ...BASELINE, done: true },
          addTaskData: { issueLastUpdated: 2, title: 'Old', isDone: true },
        }),
      );
      expect(changes).toEqual({ issueLastUpdated: 2, isDone: true });
    });

    it('lets the remote win a field changed on both sides', () => {
      const changes = computeFieldPullChanges(
        input({
          task: task({ title: 'Local' }),
          issueValues: { ...BASELINE, summary: 'Remote' },
        }),
      );
      expect(changes?.title).toBe('Remote');
    });

    it('treats a pull-only field like any other: no pull while unchanged', () => {
      const changes = computeFieldPullChanges(
        input({
          task: task({ notes: 'Local notes' }),
          addTaskData: { notes: 'D' },
        }),
      );
      expect(changes).toEqual({});
    });

    it('pulls a field without a baseline', () => {
      const changes = computeFieldPullChanges(
        input({
          task: task({ issueLastSyncedValues: { done: false } }),
          issueValues: { ...BASELINE, summary: 'Remote' },
        }),
      );
      expect(changes?.title).toBe('Remote');
      expect(changes?.notes).toBe('D');
    });

    it('never pulls a push-only field', () => {
      const changes = computeFieldPullChanges(
        input({
          issueValues: { ...BASELINE, estimate: 5 },
          addTaskData: { timeEstimate: 5 },
        }),
      );
      expect(changes).toEqual({});
    });

    it('returns null while the marker is unchanged', () => {
      expect(
        computeFieldPullChanges(
          input({ wasUpdated: false, issueValues: { ...BASELINE, summary: 'Remote' } }),
        ),
      ).toBeNull();
    });
  });

  describe('pull-only authoritative (CalDAV)', () => {
    it('always takes a pull-only field when the marker moved', () => {
      const changes = computeFieldPullChanges(
        input({
          task: task({ notes: 'Local notes' }),
          isPullOnlyAuthoritative: true,
        }),
      );
      expect(changes?.notes).toBe('D');
    });

    it('keeps a pending "both" edit while that remote field is unchanged', () => {
      const changes = computeFieldPullChanges(
        input({
          task: task({ title: 'Local' }),
          addTaskData: { title: 'Old' },
          isPullOnlyAuthoritative: true,
        }),
      );
      expect('title' in changes!).toBeFalse();
    });

    it('heals a pull-only mismatch while the marker is unchanged', () => {
      const changes = computeFieldPullChanges(
        input({
          task: task({ notes: 'Stale' }),
          wasUpdated: false,
          isPullOnlyAuthoritative: true,
        }),
      );
      expect(changes).toEqual({ notes: 'D' });
    });
  });
});

describe('computePendingLocalChanges', () => {
  const pending = (
    t: Task,
    issueValues?: Record<string, unknown>,
    syncConfig: FieldSyncConfig = {},
  ): Partial<Task> =>
    computePendingLocalChanges(t, MAPPINGS, syncConfig, { issueId: 'i-1' }, issueValues);

  it('lists pushable fields whose local value left the baseline', () => {
    expect(pending(task({ title: 'New', isDone: true, timeEstimate: 3 }))).toEqual({
      title: 'New',
      isDone: true,
      timeEstimate: 3,
    });
  });

  it('skips pull-only fields and fields without a baseline', () => {
    expect(pending(task({ notes: 'Local' }))).toEqual({});
    expect(
      pending(task({ title: 'New', issueLastSyncedValues: { done: false } })),
    ).toEqual({});
    expect(pending(task({ title: 'New', issueLastSyncedValues: undefined }))).toEqual({});
  });

  it('respects a narrowed sync config', () => {
    expect(pending(task({ title: 'New' }), undefined, { title: 'pullOnly' })).toEqual({});
  });

  it('with a fresh remote item, only fields the remote still has at baseline', () => {
    expect(
      pending(task({ title: 'New', isDone: true }), { ...BASELINE, summary: 'Remote' }),
    ).toEqual({ isDone: true });
  });

  it('is empty when the local values equal the baseline', () => {
    expect(pending(task(), BASELINE)).toEqual({});
  });

  it('decides a remote field once, by its first mapping', () => {
    // A time and a day-only plan map onto one remote field (Plainspace's
    // scheduledAt); the day mapping always means "no time".
    const timeMappings: FieldMapping[] = [
      {
        taskField: 'dueWithTime',
        issueField: 'scheduledAt',
        defaultDirection: 'both',
        toIssueValue: (v) => (typeof v === 'number' ? new Date(v).toISOString() : null),
        toTaskValue: identity,
      },
      {
        taskField: 'dueDay',
        issueField: 'scheduledAt',
        defaultDirection: 'pushOnly',
        toIssueValue: () => null,
        toTaskValue: () => undefined,
      },
    ];
    const at = Date.UTC(2026, 0, 2, 9);
    const timed = task({
      dueWithTime: at,
      dueDay: undefined,
      issueLastSyncedValues: { scheduledAt: new Date(at).toISOString() },
    });
    expect(
      computePendingLocalChanges(timed, timeMappings, {}, { issueId: 'i-1' }),
    ).toEqual({});
    const planned = task({
      dueWithTime: undefined,
      dueDay: '2026-01-03',
      issueLastSyncedValues: { scheduledAt: new Date(at).toISOString() },
    });
    expect(
      computePendingLocalChanges(planned, timeMappings, {}, { issueId: 'i-1' }),
    ).toEqual({ dueWithTime: undefined });
  });
});

describe('hasRemoteFieldChange', () => {
  const changed = (t: Task, issueValues: Record<string, unknown>): boolean =>
    hasRemoteFieldChange(t, issueValues, MAPPINGS, {});

  it('is false while every pullable field equals its baseline', () => {
    expect(changed(task({ title: 'Local edit' }), BASELINE)).toBeFalse();
  });

  it('is true when a pullable field left its baseline', () => {
    expect(changed(task(), { ...BASELINE, summary: 'Remote' })).toBeTrue();
    expect(changed(task(), { ...BASELINE, description: 'Remote' })).toBeTrue();
  });

  it('leaves a task without any baseline to the marker', () => {
    expect(changed(task({ issueLastSyncedValues: undefined }), BASELINE)).toBeFalse();
  });

  it('ignores push-only fields', () => {
    expect(changed(task(), { ...BASELINE, estimate: 9 })).toBeFalse();
  });

  it('counts a field without a baseline only when the remote has a value', () => {
    const t = task({ issueLastSyncedValues: { done: false, summary: 'Old' } });
    expect(changed(t, { done: false, summary: 'Old' })).toBeFalse();
    expect(changed(t, { done: false, summary: 'Old', description: 'D' })).toBeTrue();
  });
});
