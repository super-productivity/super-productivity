import { computePushDecisions, pushedValuesToCarry } from './compute-push-decisions';
import { Task } from '../../tasks/task.model';
import { FieldMapping, FieldMappingContext, FieldSyncConfig } from './issue-sync.model';

describe('computePushDecisions', () => {
  const ctx: FieldMappingContext = { issueId: '42', issueNumber: 42 };

  const isDoneMapping: FieldMapping = {
    taskField: 'isDone',
    issueField: 'state',
    defaultDirection: 'pullOnly',
    toIssueValue: (v: unknown) => (v ? 'closed' : 'open'),
    toTaskValue: (v: unknown) => v === 'closed',
  };

  const titleMapping: FieldMapping = {
    taskField: 'title',
    issueField: 'title',
    defaultDirection: 'pullOnly',
    toIssueValue: (v: unknown, c: FieldMappingContext) => {
      const str = v as string;
      const prefix = `#${c.issueNumber} `;
      return str.startsWith(prefix) ? str.slice(prefix.length) : str;
    },
    toTaskValue: (v: unknown, c: FieldMappingContext) => `#${c.issueNumber} ${v}`,
  };

  const dueDayMapping: FieldMapping = {
    taskField: 'dueDay',
    issueField: 'start_date',
    defaultDirection: 'both',
    mutuallyExclusive: ['dueWithTime'],
    toIssueValue: (v: unknown) => v,
    toTaskValue: (v: unknown) => v,
  };

  const dueWithTimeMapping: FieldMapping = {
    taskField: 'dueWithTime',
    issueField: 'start_datetime',
    defaultDirection: 'both',
    mutuallyExclusive: ['dueDay'],
    toIssueValue: (v: unknown) => v,
    toTaskValue: (v: unknown) => v,
  };

  const allMappings: FieldMapping[] = [isDoneMapping, titleMapping];

  const dateMappings: FieldMapping[] = [
    isDoneMapping,
    titleMapping,
    dueDayMapping,
    dueWithTimeMapping,
  ];

  it('should push when provider unchanged and task changed', () => {
    const syncConfig: FieldSyncConfig = { isDone: 'both' };
    const decisions = computePushDecisions(
      { isDone: true },
      allMappings,
      syncConfig,
      { state: 'open', title: 'Fix bug' },
      { state: 'open', title: 'Fix bug' },
      ctx,
    );

    const stateDecision = decisions.find((d) => d.field === 'state');
    expect(stateDecision).toEqual({
      field: 'state',
      action: 'push',
      issueValue: 'closed',
    });
  });

  it('should skip when provider changed (provider wins)', () => {
    const syncConfig: FieldSyncConfig = { isDone: 'both' };
    const decisions = computePushDecisions(
      { isDone: true },
      allMappings,
      syncConfig,
      { state: 'closed', title: 'Fix bug' },
      { state: 'open', title: 'Fix bug' },
      ctx,
    );

    const stateDecision = decisions.find((d) => d.field === 'state');
    expect(stateDecision).toEqual({
      field: 'state',
      action: 'skip',
      reasonCode: 'provider-changed',
      reason: 'provider changed (provider wins)',
    });
  });

  it('should skip when no lastSyncedValues baseline exists', () => {
    const syncConfig: FieldSyncConfig = { isDone: 'both' };
    const decisions = computePushDecisions(
      { isDone: true },
      allMappings,
      syncConfig,
      { state: 'open', title: 'Fix bug' },
      {},
      ctx,
    );

    const stateDecision = decisions.find((d) => d.field === 'state');
    expect(stateDecision).toEqual({
      field: 'state',
      action: 'skip',
      reasonCode: 'no-baseline',
      reason: 'no baseline (first sync)',
    });
  });

  it('should skip when direction is off', () => {
    const syncConfig: FieldSyncConfig = { isDone: 'off' };
    const decisions = computePushDecisions(
      { isDone: true },
      allMappings,
      syncConfig,
      { state: 'open', title: 'Fix bug' },
      { state: 'open', title: 'Fix bug' },
      ctx,
    );

    const stateDecision = decisions.find((d) => d.field === 'state');
    expect(stateDecision).toEqual({
      field: 'state',
      action: 'skip',
      reasonCode: 'direction-skip',
      reason: "direction is 'off'",
    });
  });

  it('should skip when direction is pullOnly', () => {
    const syncConfig: FieldSyncConfig = { isDone: 'pullOnly' };
    const decisions = computePushDecisions(
      { isDone: true },
      allMappings,
      syncConfig,
      { state: 'open', title: 'Fix bug' },
      { state: 'open', title: 'Fix bug' },
      ctx,
    );

    const stateDecision = decisions.find((d) => d.field === 'state');
    expect(stateDecision).toEqual({
      field: 'state',
      action: 'skip',
      reasonCode: 'direction-skip',
      reason: "direction is 'pullOnly'",
    });
  });

  it('should push when direction is pushOnly', () => {
    const syncConfig: FieldSyncConfig = { isDone: 'pushOnly' };
    const decisions = computePushDecisions(
      { isDone: false },
      allMappings,
      syncConfig,
      { state: 'closed', title: 'Fix bug' },
      { state: 'closed', title: 'Fix bug' },
      ctx,
    );

    const stateDecision = decisions.find((d) => d.field === 'state');
    expect(stateDecision).toEqual({
      field: 'state',
      action: 'push',
      issueValue: 'open',
    });
  });

  it('should not include decisions for fields not in changedTaskFields', () => {
    const syncConfig: FieldSyncConfig = { isDone: 'both', title: 'both' };
    const decisions = computePushDecisions(
      { isDone: true },
      allMappings,
      syncConfig,
      { state: 'open', title: 'Fix bug' },
      { state: 'open', title: 'Fix bug' },
      ctx,
    );

    expect(decisions.length).toBe(1);
    expect(decisions[0].field).toBe('state');
  });

  it('should handle multiple fields changing at once', () => {
    const syncConfig: FieldSyncConfig = { isDone: 'both', title: 'both' };
    const decisions = computePushDecisions(
      { isDone: true, title: '#42 Updated title' },
      allMappings,
      syncConfig,
      { state: 'open', title: 'Fix bug' },
      { state: 'open', title: 'Fix bug' },
      ctx,
    );

    expect(decisions.length).toBe(2);
    expect(decisions.find((d) => d.field === 'state')).toEqual({
      field: 'state',
      action: 'push',
      issueValue: 'closed',
    });
    expect(decisions.find((d) => d.field === 'title')).toEqual({
      field: 'title',
      action: 'push',
      issueValue: 'Updated title',
    });
  });

  it('should use defaultDirection when syncConfig has no entry for field', () => {
    const syncConfig: FieldSyncConfig = {};
    const decisions = computePushDecisions(
      { isDone: true },
      allMappings,
      syncConfig,
      { state: 'open', title: 'Fix bug' },
      { state: 'open', title: 'Fix bug' },
      ctx,
    );

    const stateDecision = decisions.find((d) => d.field === 'state');
    expect(stateDecision).toEqual({
      field: 'state',
      action: 'skip',
      reasonCode: 'direction-skip',
      reason: "direction is 'pullOnly'",
    });
  });

  it('should correctly transform isDone true to closed', () => {
    const syncConfig: FieldSyncConfig = { isDone: 'both' };
    const decisions = computePushDecisions(
      { isDone: true },
      [isDoneMapping],
      syncConfig,
      { state: 'open' },
      { state: 'open' },
      ctx,
    );

    expect(decisions[0].issueValue).toBe('closed');
  });

  it('should correctly transform isDone false to open', () => {
    const syncConfig: FieldSyncConfig = { isDone: 'both' };
    const decisions = computePushDecisions(
      { isDone: false },
      [isDoneMapping],
      syncConfig,
      { state: 'closed' },
      { state: 'closed' },
      ctx,
    );

    expect(decisions[0].issueValue).toBe('open');
  });

  it('should strip issue number prefix from title on push', () => {
    const syncConfig: FieldSyncConfig = { title: 'both' };
    const decisions = computePushDecisions(
      { title: '#42 New title' },
      [titleMapping],
      syncConfig,
      { title: 'Old title' },
      { title: 'Old title' },
      ctx,
    );

    expect(decisions[0].issueValue).toBe('New title');
  });

  it('should push dueDay change when direction is both', () => {
    const syncConfig: FieldSyncConfig = { dueDay: 'both' };
    const decisions = computePushDecisions(
      { dueDay: '2026-04-01' },
      dateMappings,
      syncConfig,
      { start_date: '2026-03-15' },
      { start_date: '2026-03-15' },
      ctx,
    );

    const dueDayDecision = decisions.find((d) => d.field === 'start_date');
    expect(dueDayDecision).toEqual({
      field: 'start_date',
      action: 'push',
      issueValue: '2026-04-01',
    });
  });

  it('should push dueWithTime change when direction is both', () => {
    const syncConfig: FieldSyncConfig = { dueWithTime: 'both' };
    const decisions = computePushDecisions(
      { dueWithTime: 1743508800000 },
      dateMappings,
      syncConfig,
      { start_datetime: 1743422400000 },
      { start_datetime: 1743422400000 },
      ctx,
    );

    const dueWithTimeDecision = decisions.find((d) => d.field === 'start_datetime');
    expect(dueWithTimeDecision).toEqual({
      field: 'start_datetime',
      action: 'push',
      issueValue: 1743508800000,
    });
  });

  it('should push clear for mutually exclusive field when dueWithTime is pushed', () => {
    const syncConfig: FieldSyncConfig = { dueWithTime: 'both', dueDay: 'both' };
    const decisions = computePushDecisions(
      { dueWithTime: 1743508800000 },
      dateMappings,
      syncConfig,
      { start_datetime: 1743422400000, start_date: '2026-03-15' },
      { start_datetime: 1743422400000, start_date: '2026-03-15' },
      ctx,
    );

    const dueWithTimeDecision = decisions.find((d) => d.field === 'start_datetime');
    expect(dueWithTimeDecision).toEqual({
      field: 'start_datetime',
      action: 'push',
      issueValue: 1743508800000,
    });

    const dueDayDecision = decisions.find((d) => d.field === 'start_date');
    expect(dueDayDecision).toEqual({
      field: 'start_date',
      action: 'push',
      issueValue: undefined,
    });
  });

  it('should push clear for mutually exclusive field when dueDay is pushed', () => {
    const syncConfig: FieldSyncConfig = { dueDay: 'both', dueWithTime: 'both' };
    const decisions = computePushDecisions(
      { dueDay: '2026-04-01' },
      dateMappings,
      syncConfig,
      { start_date: '2026-03-15', start_datetime: 1743422400000 },
      { start_date: '2026-03-15', start_datetime: 1743422400000 },
      ctx,
    );

    const dueDayDecision = decisions.find((d) => d.field === 'start_date');
    expect(dueDayDecision).toEqual({
      field: 'start_date',
      action: 'push',
      issueValue: '2026-04-01',
    });

    const dueWithTimeDecision = decisions.find((d) => d.field === 'start_datetime');
    expect(dueWithTimeDecision).toEqual({
      field: 'start_datetime',
      action: 'push',
      issueValue: undefined,
    });
  });

  it('should not duplicate decision when both exclusive fields are changed', () => {
    const syncConfig: FieldSyncConfig = { dueDay: 'both', dueWithTime: 'both' };
    const decisions = computePushDecisions(
      { dueDay: '2026-04-01', dueWithTime: 1743508800000 },
      dateMappings,
      syncConfig,
      { start_date: '2026-03-15', start_datetime: 1743422400000 },
      { start_date: '2026-03-15', start_datetime: 1743422400000 },
      ctx,
    );

    const dueDayDecisions = decisions.filter((d) => d.field === 'start_date');
    const dueWithTimeDecisions = decisions.filter((d) => d.field === 'start_datetime');
    expect(dueDayDecisions.length).toBe(1);
    expect(dueWithTimeDecisions.length).toBe(1);
  });

  it('lets a changed exclusive field push its own value instead of clearing it', () => {
    // Day-only short syntax on a timed item: the time is cleared, the day set.
    const decisions = computePushDecisions(
      { dueWithTime: undefined, dueDay: '2026-04-01' },
      [dueWithTimeMapping, dueDayMapping],
      { dueDay: 'both', dueWithTime: 'both' },
      { start_datetime: 1743422400000, start_date: undefined },
      { start_datetime: 1743422400000, start_date: undefined },
      ctx,
    );

    expect(decisions).toEqual([
      { field: 'start_datetime', action: 'push', issueValue: undefined },
      { field: 'start_date', action: 'push', issueValue: '2026-04-01' },
    ]);
  });

  // Review finding (R2-3): a timed event's baseline holds `start_date:
  // undefined`, which JSON drops on its way to my other devices. There, a
  // day-only plan skipped the day as "no baseline" and pushed the cleared time
  // alone, which the calendar plugins read as an all-day event today.
  it('reads a baseline key JSON dropped as undefined', () => {
    const baseline = JSON.parse(
      JSON.stringify({ start_datetime: 1743422400000, start_date: undefined }),
    );
    expect('start_date' in baseline).toBeFalse();

    const decisions = computePushDecisions(
      { dueWithTime: undefined, dueDay: '2026-04-01' },
      [dueWithTimeMapping, dueDayMapping],
      { dueDay: 'both', dueWithTime: 'both' },
      { start_datetime: 1743422400000, start_date: undefined },
      baseline,
      ctx,
    );

    expect(decisions).toEqual([
      { field: 'start_datetime', action: 'push', issueValue: undefined },
      { field: 'start_date', action: 'push', issueValue: '2026-04-01' },
    ]);
  });

  it('still lets the provider win for a key missing from a baseline', () => {
    const decisions = computePushDecisions(
      { dueDay: '2026-04-01' },
      [dueDayMapping],
      { dueDay: 'both' },
      { start_date: '2026-03-20' },
      { title: 'Fix bug' },
      ctx,
    );

    expect(decisions).toEqual([
      jasmine.objectContaining({
        field: 'start_date',
        action: 'skip',
        reasonCode: 'provider-changed',
      }),
    ]);
  });

  it('should skip exclusive field clear when its direction is pullOnly', () => {
    const syncConfig: FieldSyncConfig = { dueWithTime: 'both', dueDay: 'pullOnly' };
    const decisions = computePushDecisions(
      { dueWithTime: 1743508800000 },
      dateMappings,
      syncConfig,
      { start_datetime: 1743422400000, start_date: '2026-03-15' },
      { start_datetime: 1743422400000, start_date: '2026-03-15' },
      ctx,
    );

    const dueDayDecision = decisions.find((d) => d.field === 'start_date');
    expect(dueDayDecision).toBeUndefined();
  });

  it('should skip dueDay push when provider changed', () => {
    const syncConfig: FieldSyncConfig = { dueDay: 'both' };
    const decisions = computePushDecisions(
      { dueDay: '2026-04-01' },
      dateMappings,
      syncConfig,
      { start_date: '2026-03-20' },
      { start_date: '2026-03-15' },
      ctx,
    );

    const dueDayDecision = decisions.find((d) => d.field === 'start_date');
    expect(dueDayDecision).toEqual({
      field: 'start_date',
      action: 'skip',
      reasonCode: 'provider-changed',
      reason: 'provider changed (provider wins)',
    });
  });

  it('should push tagIds when fresh and last synced arrays have same contents (different references)', () => {
    const tagIdsMapping: FieldMapping = {
      taskField: 'tagIds',
      issueField: 'labels',
      defaultDirection: 'both',
      toIssueValue: (v: unknown) => (v as string[])?.slice().sort(),
      toTaskValue: (v: unknown) => v,
    };
    const syncConfig: FieldSyncConfig = { tagIds: 'both' };
    const freshLabels = ['bug', 'feature'];
    const lastLabels = ['bug', 'feature'];
    const decisions = computePushDecisions(
      { tagIds: ['feature', 'bug', 'urgent'] },
      [tagIdsMapping],
      syncConfig,
      { labels: freshLabels },
      { labels: lastLabels },
      ctx,
    );

    const labelDecision = decisions.find((d) => d.field === 'labels');
    expect(labelDecision?.action).toBe('push');
    expect(labelDecision?.issueValue).toEqual(['bug', 'feature', 'urgent']);
  });

  it('should skip a field the provider already has', () => {
    const decisions = computePushDecisions(
      { title: 'Same' },
      [titleMapping],
      { title: 'both' },
      { title: 'Same' },
      { title: 'Same' },
      ctx,
    );
    expect(decisions).toEqual([
      jasmine.objectContaining({
        field: 'title',
        action: 'skip',
        reasonCode: 'unchanged',
      }),
    ]);
  });

  it('reaches "unchanged" only while the remote is at the baseline', () => {
    // So the baseline already is the shared value: nothing stays pending. A
    // remote that moved to the local value is "provider-changed", and the next
    // poll's pull rewrites the baseline.
    const decisions = computePushDecisions(
      { title: 'Same' },
      [titleMapping],
      { title: 'both' },
      { title: 'Same' },
      { title: 'Old' },
      ctx,
    );
    expect(decisions).toEqual([
      jasmine.objectContaining({ action: 'skip', reasonCode: 'provider-changed' }),
    ]);
  });

  it('should skip tagIds when fresh and last synced arrays have different contents', () => {
    const tagIdsMapping: FieldMapping = {
      taskField: 'tagIds',
      issueField: 'labels',
      defaultDirection: 'both',
      toIssueValue: (v: unknown) => (v as string[])?.slice().sort(),
      toTaskValue: (v: unknown) => v,
    };
    const syncConfig: FieldSyncConfig = { tagIds: 'both' };
    const decisions = computePushDecisions(
      { tagIds: ['tag-1'] },
      [tagIdsMapping],
      syncConfig,
      { labels: ['bug', 'feature'] },
      { labels: ['bug'] },
      ctx,
    );

    const labelDecision = decisions.find((d) => d.field === 'labels');
    expect(labelDecision).toEqual({
      field: 'labels',
      action: 'skip',
      reasonCode: 'provider-changed',
      reason: 'provider changed (provider wins)',
    });
  });
});

describe('pushedValuesToCarry', () => {
  const ctx: FieldMappingContext = { issueId: '42', issueNumber: 42 };
  const identity = (v: unknown): unknown => v;
  const mapping = (taskField: keyof Task, issueField: string): FieldMapping => ({
    taskField,
    issueField,
    defaultDirection: 'both',
    toIssueValue: identity,
    toTaskValue: identity,
  });
  const mappings = [
    mapping('title', 'title'),
    mapping('notes', 'body'),
    mapping('isDone', 'done'),
    mapping('dueDay', 'due'),
  ];
  const task = {
    id: 't1',
    title: 'Mine',
    notes: 'n',
    isDone: true,
    dueDay: '2026-10-22',
  } as Task;

  it('carries a pushed field whose value still maps to what was pushed', () => {
    expect(
      pushedValuesToCarry(task, { title: 'Mine', body: 'n' }, mappings, ctx),
    ).toEqual({ title: 'Mine', notes: 'n' });
  });

  it('leaves out a field edited again since the push', () => {
    expect(pushedValuesToCarry(task, { title: 'Older' }, mappings, ctx)).toEqual({});
  });

  it('leaves out fields that were not pushed', () => {
    expect(pushedValuesToCarry(task, { body: 'n' }, mappings, ctx)).toEqual({
      notes: 'n',
    });
  });

  it('carries a pushed done state with its completion date', () => {
    expect(
      pushedValuesToCarry({ ...task, doneOn: 1234 }, { done: true }, mappings, ctx),
    ).toEqual({ isDone: true, doneOn: 1234 });
  });

  it('carries a pushed reopen with its cleared completion date', () => {
    const carried = pushedValuesToCarry(
      { ...task, isDone: false, doneOn: undefined },
      { done: false },
      mappings,
      ctx,
    );
    expect(carried).toEqual({ isDone: false, doneOn: undefined });
    expect('doneOn' in carried).toBe(true);
  });

  it('never carries fields whose lists the task meta-reducers keep', () => {
    expect(pushedValuesToCarry(task, { due: '2026-10-22' }, mappings, ctx)).toEqual({});
  });

  it('compares through the mapping', () => {
    const prefixed: FieldMapping = {
      ...mapping('title', 'title'),
      toIssueValue: (v: unknown) => (v as string).replace(/^#42 /, ''),
    };
    expect(
      pushedValuesToCarry(
        { ...task, title: '#42 Mine' },
        { title: 'Mine' },
        [prefixed],
        ctx,
      ),
    ).toEqual({ title: '#42 Mine' });
  });

  it('carries nothing for a task that is gone', () => {
    expect(pushedValuesToCarry(undefined, { title: 'Mine' }, mappings, ctx)).toEqual({});
  });
});
