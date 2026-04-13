import { computePushDecisions } from './compute-push-decisions';
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
      reason: 'provider changed (provider wins)',
    });
  });
});
