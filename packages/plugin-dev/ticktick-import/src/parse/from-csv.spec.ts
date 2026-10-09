import { parseTickTickCsv } from './from-csv';

const HEADER =
  '"Folder Name","List Name","Title","Kind","Tags","Content","Is Check list",' +
  '"Start Date","Due Date","Reminder","Repeat","Priority","Status","Created Time",' +
  '"Completed Time","Order","Timezone","Is All Day","Is Floating","Column Name",' +
  '"Column Order","View Mode","taskId","parentId"';

// the preamble shape real exports start with, including the multi-line legend
const PREAMBLE =
  '"Date: 2026-10-01+0000"\n"Version: 7.1"\n"Status: \n0 Normal\n1 Completed\n2 Archived"';

interface RowInput {
  folder?: string;
  list?: string;
  title?: string;
  tags?: string;
  content?: string;
  checklist?: boolean;
  due?: string;
  reminder?: string;
  repeat?: string;
  priority?: string;
  status?: string;
  order?: string;
  timezone?: string;
  allDay?: boolean;
  column?: string;
  id?: string;
  parent?: string;
}

const quote = (v: string): string => `"${v.replace(/"/g, '""')}"`;

const row = (r: RowInput): string =>
  [
    r.folder ?? '',
    r.list ?? 'Work',
    r.title ?? 'task',
    r.checklist ? 'CHECKLIST' : 'TEXT',
    r.tags ?? '',
    r.content ?? '',
    r.checklist ? 'Y' : 'N',
    '',
    r.due ?? '',
    r.reminder ?? '',
    r.repeat ?? '',
    r.priority ?? '0',
    r.status ?? '0',
    '2026-09-01T10:00:00+0000',
    '',
    r.order ?? '0',
    r.timezone ?? 'Europe/Berlin',
    r.allDay ? 'true' : 'false',
    'false',
    r.column ?? '',
    '',
    'list',
    r.id ?? '',
    r.parent ?? '',
  ]
    .map(quote)
    .join(',');

const csv = (...rows: RowInput[]): string =>
  [PREAMBLE, HEADER, ...rows.map(row)].join('\n');

describe('parseTickTickCsv', () => {
  it('returns null for a file that is not a TickTick backup', () => {
    expect(parseTickTickCsv('a,b,c\n1,2,3')).toBeNull();
  });

  it('finds the header after the multi-line preamble and groups tasks by list', () => {
    const model = parseTickTickCsv(
      csv({ list: 'Work', title: 'A', id: 'a' }, { list: 'Home', title: 'B', id: 'b' }),
    );
    expect(model?.projects.map((p) => p.title)).toEqual(['Work', 'Home']);
    expect(model?.tasks.map((t) => t.title)).toEqual(['A', 'B']);
  });

  it('skips completed, archived and won’t-do tasks and counts them', () => {
    const model = parseTickTickCsv(
      csv(
        { title: 'open', id: 'a' },
        { title: 'done', id: 'b', status: '1' },
        { title: 'archived', id: 'c', status: '2' },
        { title: 'wont', id: 'd', status: '-1' },
      ),
    );
    expect(model?.tasks.map((t) => t.title)).toEqual(['open']);
    expect(model?.skippedClosedCount).toBe(3);
  });

  it('counts lists that hold only closed tasks instead of dropping them silently', () => {
    const model = parseTickTickCsv(
      csv(
        { list: 'Work', id: 'a' },
        { list: 'Done list', id: 'b', status: '1' },
        { list: 'Done list', id: 'c', status: '2' },
        { folder: 'Old', list: 'Work', id: 'd', status: '1' },
      ),
    );
    expect(model?.projects.map((p) => p.title)).toEqual(['Work']);
    expect(model?.skippedListCount).toBe(2);
  });

  it('keeps multi-line content with commas and quotes as notes', () => {
    const content = 'line 1, with "quotes"\nline 2';
    const model = parseTickTickCsv(csv({ id: 'a', content }));
    expect(model?.tasks[0].notes).toBe(content);
  });

  it('reads all-day due dates in the task time zone', () => {
    // midnight Berlin (CEST) = 22:00 UTC the previous day
    const model = parseTickTickCsv(
      csv({ id: 'a', due: '2026-10-14T22:00:00+0000', allDay: true }),
    );
    expect(model?.tasks[0].dueDay).toBe('2026-10-15');
    expect(model?.tasks[0].dueWithTime).toBeNull();
  });

  it('keeps timed due dates as instants', () => {
    const model = parseTickTickCsv(csv({ id: 'a', due: '2026-10-15T08:30:00+0000' }));
    expect(model?.tasks[0].dueWithTime).toBe(Date.UTC(2026, 9, 15, 8, 30));
    expect(model?.tasks[0].dueDay).toBeNull();
  });

  it('turns checklist items on root tasks into sub-tasks and keeps the description', () => {
    const model = parseTickTickCsv(
      csv({
        id: 'a',
        checklist: true,
        content: 'Bring these\n▫Milk\n▪Bread',
      }),
    );
    const [root, milk, bread] = model?.tasks || [];
    expect(root.notes).toBe('Bring these');
    expect([milk.title, milk.isDone, milk.parentExtId]).toEqual(['Milk', false, 'a']);
    expect([bread.title, bread.isDone]).toEqual(['Bread', true]);
  });

  it('keeps a sub-task checklist as markdown notes (sub-tasks cannot nest)', () => {
    const model = parseTickTickCsv(
      csv(
        { id: 'a', title: 'root' },
        { id: 'b', parent: 'a', checklist: true, content: '▫Milk\n▪Bread' },
      ),
    );
    expect(model?.tasks.length).toBe(2);
    expect(model?.tasks[1].notes).toBe('- [ ] Milk\n- [x] Bread');
  });

  it('flattens deep sub-tasks to the root and orders parents before children', () => {
    const model = parseTickTickCsv(
      csv(
        { id: 'c', parent: 'b', title: 'grandchild' },
        { id: 'b', parent: 'a', title: 'child' },
        { id: 'a', title: 'root' },
      ),
    );
    expect(model?.tasks.map((t) => [t.title, t.parentExtId, t.wasDemoted])).toEqual([
      ['root', null, false],
      ['child', 'a', false],
      ['grandchild', 'a', true],
    ]);
  });

  it('imports a task whose parent is completed as a root', () => {
    const model = parseTickTickCsv(
      csv({ id: 'a', status: '1' }, { id: 'b', parent: 'a', title: 'orphan' }),
    );
    expect(model?.tasks.map((t) => [t.title, t.parentExtId])).toEqual([['orphan', null]]);
  });

  it('imports tasks in a parent cycle as roots instead of dropping them', () => {
    const model = parseTickTickCsv(
      csv({ id: 'a', parent: 'b', title: 'A' }, { id: 'b', parent: 'a', title: 'B' }),
    );
    expect(model?.tasks.map((t) => [t.title, t.parentExtId])).toEqual([
      ['A', null],
      ['B', null],
    ]);
  });

  it('sorts tasks by TickTick order', () => {
    const model = parseTickTickCsv(
      csv(
        { id: 'a', title: 'second', order: '10' },
        { id: 'b', title: 'first', order: '-5' },
      ),
    );
    expect(model?.tasks.map((t) => t.title)).toEqual(['first', 'second']);
  });

  it('falls back to row ids when task ids are missing or duplicated', () => {
    const model = parseTickTickCsv(
      csv({ id: 'x', title: 'A' }, { id: 'x', title: 'B' }, { title: 'C' }),
    );
    const ids = model?.tasks.map((t) => t.extId) || [];
    expect(new Set(ids).size).toBe(3);
  });

  it('maps tags, priority, repeat and reminder flags', () => {
    const model = parseTickTickCsv(
      csv({
        id: 'a',
        tags: 'work, #errand, Work',
        priority: '5',
        repeat: 'RRULE:FREQ=WEEKLY;INTERVAL=1',
        reminder: 'TRIGGER:PT0S',
      }),
    );
    const task = model?.tasks[0];
    expect(task?.tags).toEqual(['work', 'errand']);
    expect(task?.priority).toBe(5);
    expect(task?.isRecurring).toBe(true);
    expect(task?.notes).toBe('Repeats: RRULE:FREQ=WEEKLY;INTERVAL=1');
    expect(task?.hasReminder).toBe(true);
  });

  it('separates same-named lists in different folders and marks the inbox', () => {
    const model = parseTickTickCsv(
      csv(
        { folder: 'Job', list: 'Ideas', id: 'a', column: 'Doing' },
        { folder: 'Private', list: 'Ideas', id: 'b' },
        { list: 'Inbox', id: 'c' },
      ),
    );
    expect(model?.projects.map((p) => [p.folderTitle, p.title, p.isInbox])).toEqual([
      ['Job', 'Ideas', false],
      ['Private', 'Ideas', false],
      ['', 'Inbox', true],
    ]);
    expect(model?.projects[0].columnCount).toBe(1);
  });

  it('strips a UTF-8 BOM and accepts CRLF line endings', () => {
    const text = `﻿${csv({ id: 'a', title: 'A' }).replace(/\n/g, '\r\n')}`;
    expect(parseTickTickCsv(text)?.tasks.map((t) => t.title)).toEqual(['A']);
  });
});
