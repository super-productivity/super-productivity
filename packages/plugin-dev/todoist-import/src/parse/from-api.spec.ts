import { mergeSyncResponses, parseSyncResponse, RawSyncResponse } from './from-api';

const baseFixture = (): RawSyncResponse => ({
  projects: [
    { id: 'p1', name: 'Work', child_order: 1 },
    { id: 'p2', name: 'Home', child_order: 2 },
  ],
  items: [],
  sections: [],
  notes: [],
});

describe('mergeSyncResponses', () => {
  it('applies incremental additions, replacements, and tombstones to a full sync', () => {
    const full: RawSyncResponse = {
      sync_token: 'full-token',
      projects: [
        { id: 'p1', name: 'Old name' },
        { id: 'p2', name: 'Deleted later' },
        { id: 'p4', name: 'Unchanged project' },
      ],
      items: [{ id: 't1', project_id: 'p1', content: 'Old task title' }],
      sections: [],
      notes: [],
    };
    const incremental: RawSyncResponse = {
      sync_token: 'incremental-token',
      projects: [
        { id: 'p1', name: 'New name' },
        { id: 'p2', is_deleted: true },
        { id: 'p3', name: 'New project' },
      ],
      items: [{ id: 't1', project_id: 'p1', content: 'New task title' }],
    };

    const merged = mergeSyncResponses(full, incremental);

    expect(merged.sync_token).toBe('incremental-token');
    expect(merged.projects).toEqual([
      ...incremental.projects!,
      { id: 'p4', name: 'Unchanged project' },
    ]);
    expect(merged.items).toEqual(incremental.items);
    expect(parseSyncResponse(merged).projects.map((project) => project.extId)).toEqual([
      'p1',
      'p3',
      'p4',
    ]);
    expect(parseSyncResponse(merged).tasks[0].title).toBe('New task title');
  });
});

describe('parseSyncResponse', () => {
  it('skips archived and deleted projects and their items', () => {
    const raw = baseFixture();
    raw.projects!.push(
      { id: 'p3', name: 'Old', is_archived: true },
      { id: 'p4', name: 'Gone', is_deleted: 1 },
    );
    raw.items = [
      { id: 't1', project_id: 'p3', content: 'in archived' },
      { id: 't2', project_id: 'p4', content: 'in deleted' },
      { id: 't3', project_id: 'p1', content: 'kept' },
    ];
    const model = parseSyncResponse(raw);
    expect(model.projects.map((p) => p.extId)).toEqual(['p1', 'p2']);
    expect(model.tasks.map((t) => t.extId)).toEqual(['t3']);
  });

  it('skips completed and deleted items', () => {
    const raw = baseFixture();
    raw.items = [
      { id: 't1', project_id: 'p1', content: 'done', checked: true },
      { id: 't2', project_id: 'p1', content: 'deleted', is_deleted: true },
      { id: 't3', project_id: 'p1', content: 'open' },
    ];
    const model = parseSyncResponse(raw);
    expect(model.tasks.map((t) => t.extId)).toEqual(['t3']);
  });

  it('marks the inbox project', () => {
    const raw = baseFixture();
    raw.projects!.unshift({
      id: 'p0',
      name: 'Inbox',
      inbox_project: true,
      child_order: 0,
    });
    const model = parseSyncResponse(raw);
    expect(model.projects[0]).toEqual(
      expect.objectContaining({ extId: 'p0', isInbox: true }),
    );
  });

  describe('due dates', () => {
    it('parses all-day dates as dueDay', () => {
      const raw = baseFixture();
      raw.items = [
        { id: 't1', project_id: 'p1', content: 'a', due: { date: '2026-07-15' } },
      ];
      const [task] = parseSyncResponse(raw).tasks;
      expect(task.dueDay).toBe('2026-07-15');
      expect(task.dueWithTime).toBeNull();
    });

    it('parses floating datetimes as local time', () => {
      const raw = baseFixture();
      raw.items = [
        {
          id: 't1',
          project_id: 'p1',
          content: 'a',
          due: { date: '2026-07-15T09:30:00' },
        },
      ];
      const [task] = parseSyncResponse(raw).tasks;
      expect(task.dueDay).toBeNull();
      expect(task.dueWithTime).toBe(new Date(2026, 6, 15, 9, 30, 0).getTime());
    });

    it('parses fixed-timezone datetimes (trailing Z) as UTC instants', () => {
      const raw = baseFixture();
      raw.items = [
        {
          id: 't1',
          project_id: 'p1',
          content: 'a',
          due: { date: '2026-07-15T09:30:00Z', timezone: 'Europe/Berlin' },
        },
      ];
      const [task] = parseSyncResponse(raw).tasks;
      expect(task.dueWithTime).toBe(Date.UTC(2026, 6, 15, 9, 30, 0));
    });

    it('uses the deadline as dueDay when there is no due date', () => {
      const raw = baseFixture();
      raw.items = [
        { id: 't1', project_id: 'p1', content: 'a', deadline: { date: '2026-08-01' } },
      ];
      const [task] = parseSyncResponse(raw).tasks;
      expect(task.dueDay).toBe('2026-08-01');
      expect(task.notes).not.toContain('Deadline:');
    });

    it('keeps the deadline as a notes line when a due date exists', () => {
      const raw = baseFixture();
      raw.items = [
        {
          id: 't1',
          project_id: 'p1',
          content: 'a',
          due: { date: '2026-07-15' },
          deadline: { date: '2026-08-01' },
        },
      ];
      const [task] = parseSyncResponse(raw).tasks;
      expect(task.dueDay).toBe('2026-07-15');
      expect(task.notes).toContain('Deadline: 2026-08-01');
    });
  });

  describe('recurring', () => {
    it('flags recurring tasks and appends the verbatim rule to notes', () => {
      const raw = baseFixture();
      raw.items = [
        {
          id: 't1',
          project_id: 'p1',
          content: 'water plants',
          description: 'living room only',
          due: { date: '2026-07-15', is_recurring: true, string: 'every! 3 days' },
        },
      ];
      const [task] = parseSyncResponse(raw).tasks;
      expect(task.isRecurring).toBe(true);
      expect(task.notes).toBe('living room only\n\nRepeats: every! 3 days');
    });
  });

  describe('durations', () => {
    it('converts minute durations to a ms time estimate', () => {
      const raw = baseFixture();
      raw.items = [
        {
          id: 't1',
          project_id: 'p1',
          content: 'a',
          duration: { amount: 45, unit: 'minute' },
        },
      ];
      const [task] = parseSyncResponse(raw).tasks;
      expect(task.timeEstimate).toBe(45 * 60_000);
      expect(task.isDayDurationSkipped).toBe(false);
    });

    it('skips day durations and flags them', () => {
      const raw = baseFixture();
      raw.items = [
        {
          id: 't1',
          project_id: 'p1',
          content: 'a',
          duration: { amount: 1, unit: 'day' },
        },
      ];
      const [task] = parseSyncResponse(raw).tasks;
      expect(task.timeEstimate).toBeNull();
      expect(task.isDayDurationSkipped).toBe(true);
    });
  });

  describe('nesting', () => {
    it('keeps level-1 sub-tasks under their parent', () => {
      const raw = baseFixture();
      raw.items = [
        { id: 'root', project_id: 'p1', content: 'root', child_order: 1 },
        { id: 'sub', project_id: 'p1', content: 'sub', parent_id: 'root' },
      ];
      const model = parseSyncResponse(raw);
      expect(model.tasks.map((t) => [t.extId, t.parentExtId, t.wasDemoted])).toEqual([
        ['root', null, false],
        ['sub', 'root', false],
      ]);
    });

    it('re-parents depth ≥ 2 to the root ancestor in DFS order and flags demotion', () => {
      const raw = baseFixture();
      raw.items = [
        { id: 'a', project_id: 'p1', content: 'a', child_order: 1 },
        { id: 'b', project_id: 'p1', content: 'b', parent_id: 'a', child_order: 1 },
        { id: 'c', project_id: 'p1', content: 'c', parent_id: 'b', child_order: 1 },
        { id: 'd', project_id: 'p1', content: 'd', parent_id: 'c', child_order: 1 },
        { id: 'b2', project_id: 'p1', content: 'b2', parent_id: 'a', child_order: 2 },
      ];
      const model = parseSyncResponse(raw);
      expect(model.tasks.map((t) => [t.extId, t.parentExtId, t.wasDemoted])).toEqual([
        ['a', null, false],
        ['b', 'a', false],
        ['c', 'a', true],
        ['d', 'a', true],
        ['b2', 'a', false],
      ]);
    });

    it('treats items with a missing parent as roots', () => {
      const raw = baseFixture();
      raw.items = [
        { id: 'orphan', project_id: 'p1', content: 'x', parent_id: 'completed-parent' },
      ];
      const model = parseSyncResponse(raw);
      expect(model.tasks[0].parentExtId).toBeNull();
    });
  });

  describe('ordering', () => {
    it('orders roots by section order then child order; section-less first', () => {
      const raw = baseFixture();
      raw.sections = [
        { id: 's2', project_id: 'p1', name: 'Later', section_order: 2 },
        { id: 's1', project_id: 'p1', name: 'Now', section_order: 1 },
      ];
      raw.items = [
        { id: 'in-s2', project_id: 'p1', section_id: 's2', content: 'x', child_order: 1 },
        { id: 'no-sec-2', project_id: 'p1', content: 'x', child_order: 2 },
        { id: 'in-s1', project_id: 'p1', section_id: 's1', content: 'x', child_order: 1 },
        { id: 'no-sec-1', project_id: 'p1', content: 'x', child_order: 1 },
      ];
      const model = parseSyncResponse(raw);
      expect(model.tasks.map((t) => t.extId)).toEqual([
        'no-sec-1',
        'no-sec-2',
        'in-s1',
        'in-s2',
      ]);
    });

    it('groups tasks by project in project order', () => {
      const raw = baseFixture();
      raw.items = [
        { id: 'h1', project_id: 'p2', content: 'x', child_order: 1 },
        { id: 'w1', project_id: 'p1', content: 'x', child_order: 1 },
      ];
      const model = parseSyncResponse(raw);
      expect(model.tasks.map((t) => t.extId)).toEqual(['w1', 'h1']);
    });
  });

  describe('comments', () => {
    it('appends comments to notes and counts attachments', () => {
      const raw = baseFixture();
      raw.items = [{ id: 't1', project_id: 'p1', content: 'a', description: 'desc' }];
      raw.notes = [
        { id: 'n1', item_id: 't1', content: 'first comment' },
        {
          id: 'n2',
          item_id: 't1',
          content: 'see file',
          file_attachment: { file_name: 'report.pdf', file_url: 'https://x/report.pdf' },
        },
        { id: 'n3', item_id: 't1', content: 'deleted', is_deleted: true },
      ];
      const [task] = parseSyncResponse(raw).tasks;
      expect(task.notes).toBe(
        'desc\n\nComments:\n- first comment\n- see file report.pdf: https://x/report.pdf',
      );
      expect(task.attachmentCount).toBe(1);
    });

    it('uses caller-provided strings for text added to imported notes', () => {
      const raw = baseFixture();
      raw.items = [
        {
          id: 't1',
          project_id: 'p1',
          content: '',
          due: { date: '2026-07-15', is_recurring: true, string: 'every day' },
          deadline: { date: '2026-08-01' },
        },
      ];
      raw.notes = [
        {
          id: 'n1',
          item_id: 't1',
          content: 'attachment',
          file_attachment: { file_url: 'https://x/file' },
        },
      ];

      const [taskParsed] = parseSyncResponse(raw, {
        untitledProject: 'Projekt ohne Titel',
        untitledTask: 'Aufgabe ohne Titel',
        repeats: (rule) => `Wiederholt: ${rule}`,
        deadline: (date) => `Frist: ${date}`,
        comments: 'Kommentare:',
        file: 'Datei',
      }).tasks;

      expect(taskParsed.title).toBe('Aufgabe ohne Titel');
      expect(taskParsed.notes).toBe(
        'Wiederholt: every day\nFrist: 2026-08-01\n\nKommentare:\n- attachment Datei: https://x/file',
      );
    });
  });

  describe('hostile / malformed payloads', () => {
    it('rejects shape-valid but impossible calendar dates', () => {
      const raw = baseFixture();
      raw.items = [
        { id: 't1', project_id: 'p1', content: 'a', due: { date: '2026-99-99' } },
        { id: 't2', project_id: 'p1', content: 'b', deadline: { date: '0000-00-00' } },
      ];
      const [t1, t2] = parseSyncResponse(raw).tasks;
      expect(t1.dueDay).toBeNull();
      expect(t2.dueDay).toBeNull();
    });

    it('treats a parent in another project as missing (child becomes root)', () => {
      const raw = baseFixture();
      raw.items = [
        { id: 'other', project_id: 'p2', content: 'x' },
        { id: 'child', project_id: 'p1', content: 'y', parent_id: 'other' },
      ];
      const child = parseSyncResponse(raw).tasks.find((t) => t.extId === 'child');
      expect(child?.parentExtId).toBeNull();
    });

    it('drops unsafe or malformed attachment URLs from notes', () => {
      const raw = baseFixture();
      raw.items = [{ id: 't1', project_id: 'p1', content: 'a' }];
      raw.notes = [
        {
          id: 'n1',
          item_id: 't1',
          content: 'evil',
          file_attachment: { file_name: 'x', file_url: 'javascript:alert(1)' },
        },
        {
          id: 'n2',
          item_id: 't1',
          content: 'malformed',
          file_attachment: {
            file_name: 'x',
            file_url: 'https://files.example/x\n[bad](javascript:alert(1))',
          },
        },
      ];
      const [taskParsed] = parseSyncResponse(raw).tasks;
      expect(taskParsed.notes).toBe('Comments:\n- evil\n- malformed');
      expect(taskParsed.attachmentCount).toBe(0);
    });

    it('rejects non-finite or absurd durations', () => {
      const raw = baseFixture();
      raw.items = [
        {
          id: 't1',
          project_id: 'p1',
          content: 'a',
          duration: { amount: Infinity, unit: 'minute' },
        },
        {
          id: 't2',
          project_id: 'p1',
          content: 'b',
          duration: { amount: 9_999_999, unit: 'minute' },
        },
      ];
      const [t1, t2] = parseSyncResponse(raw).tasks;
      expect(t1.timeEstimate).toBeNull();
      expect(t2.timeEstimate).toBeNull();
    });

    it('clamps oversized titles and notes', () => {
      const raw = baseFixture();
      raw.projects![0].name = 'p'.repeat(5000);
      raw.items = [
        {
          id: 't1',
          project_id: 'p1',
          content: 'x'.repeat(5000),
          description: 'y'.repeat(100_000),
        },
      ];
      const parsed = parseSyncResponse(raw);
      const [taskParsed] = parsed.tasks;
      expect(parsed.projects[0].truncatedFieldCount).toBe(1);
      expect(taskParsed.title.length).toBeLessThanOrEqual(1001);
      expect(taskParsed.notes.length).toBeLessThanOrEqual(50_001);
      expect(taskParsed.truncatedFieldCount).toBe(2);
    });
  });

  it('orders nested projects parent-first (children directly after their parent)', () => {
    const raw = baseFixture();
    // child_order is per-parent in Todoist: a flat sort would interleave
    raw.projects = [
      { id: 'a', name: 'A', child_order: 1 },
      { id: 'b', name: 'B', child_order: 2 },
      { id: 'a1', name: 'A1', parent_id: 'a', child_order: 1 },
      { id: 'b1', name: 'B1', parent_id: 'b', child_order: 1 },
    ];
    const model = parseSyncResponse(raw);
    expect(model.projects.map((p) => p.extId)).toEqual(['a', 'a1', 'b', 'b1']);
  });

  it('captures labels and assignee flag', () => {
    const raw = baseFixture();
    raw.items = [
      {
        id: 't1',
        project_id: 'p1',
        content: 'a',
        labels: ['errand', 'urgent'],
        responsible_uid: 'user-2',
        priority: 4,
      },
    ];
    const [task] = parseSyncResponse(raw).tasks;
    expect(task.labels).toEqual(['errand', 'urgent']);
    expect(task.hasAssignee).toBe(true);
    expect(task.apiPriority).toBe(4);
  });
});
