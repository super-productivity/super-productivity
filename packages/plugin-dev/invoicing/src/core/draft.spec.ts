import {
  Draft,
  DraftInput,
  initialProjectId,
  issueBlocker,
  newDraft,
  projectDefaults,
  resumeDraft,
  toInvoice,
} from './draft';
import { TaskLike } from './lines';
import { DEFAULT_SETTINGS } from './settings';
import { Invoice } from './types';

const H = 3_600_000;
const TODAY = new Date(2026, 10, 18); // 18 Nov 2026 → drafts default to October

const task = (id: string, timeSpentOnDay: Record<string, number>): TaskLike => ({
  id,
  title: `Task ${id}`,
  projectId: 'p1',
  parentId: null,
  timeSpentOnDay,
});

const issued = (overrides: Partial<Invoice>): Invoice => ({
  id: 'old',
  seq: 1,
  number: '001',
  projectId: 'p1',
  issueDate: '2026-10-01',
  dueDate: '2026-10-15',
  periodFrom: '2026-09-01',
  periodTo: '2026-09-30',
  seller: '',
  client: '',
  paymentNote: '',
  currency: 'EUR',
  taxRatePct: 0,
  lines: [],
  billedMs: {},
  ...overrides,
});

const input = (overrides: Partial<DraftInput> = {}): DraftInput => ({
  settings: {
    ...DEFAULT_SETTINGS,
    projects: { p1: { rate: 80, client: 'ACME' } },
  },
  locale: 'de-DE',
  invoices: [],
  projects: [{ id: 'p1' }, { id: 'p2' }],
  tasks: [task('a', { '2026-10-02': 2 * H }), task('b', { '2026-10-05': H })],
  ...overrides,
});

describe('initialProjectId', () => {
  it('picks the project of the newest invoice', () => {
    expect(initialProjectId(input({ invoices: [issued({ projectId: 'p2' })] }))).toBe(
      'p2',
    );
  });

  it('falls back to the first project when there is no invoice', () => {
    expect(initialProjectId(input())).toBe('p1');
  });

  it('falls back to the first project when the invoiced project was deleted', () => {
    expect(initialProjectId(input({ invoices: [issued({ projectId: 'gone' })] }))).toBe(
      'p1',
    );
  });
});

describe('newDraft', () => {
  it('starts with last month, the remembered rate and client, and all lines ticked', () => {
    const draft = newDraft(input(), TODAY);
    expect(draft).toMatchObject({
      projectId: 'p1',
      from: '2026-10-01',
      to: '2026-10-31',
      rate: 80,
      client: 'ACME',
      language: 'de',
      number: null,
      issueDate: '2026-11-18',
    });
    expect(draft.lines.map((l) => [l.taskId, l.hours, l.include])).toEqual([
      ['a', 2, true],
      ['b', 1, true],
    ]);
  });
});

describe('projectDefaults', () => {
  it('uses the language remembered for the project', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      projects: { p1: { rate: 80, client: 'ACME', language: 'fr' } },
    };
    expect(projectDefaults({ settings, locale: 'de' }, 'p1').language).toBe('fr');
  });

  it('falls back to the app language, then English', () => {
    const settings = DEFAULT_SETTINGS;
    expect(projectDefaults({ settings, locale: 'pt-BR' }, 'p9')).toEqual({
      rate: 0,
      client: '',
      language: 'pt-br',
    });
    expect(projectDefaults({ settings, locale: 'xx' }, 'p9').language).toBe('en');
  });
});

describe('resumeDraft', () => {
  const edited = (): Draft => {
    const draft = newDraft(input(), TODAY);
    draft.rate = 95;
    draft.number = 'X-1';
    draft.lines[0] = { ...draft.lines[0], title: 'Design work', hours: 1.25 };
    draft.lines[1] = { ...draft.lines[1], include: false };
    return draft;
  };

  it('keeps the form fields and line edits after a reload', () => {
    const draft = resumeDraft(input(), edited(), TODAY);
    expect(draft).toMatchObject({ rate: 95, number: 'X-1', client: 'ACME' });
    expect(draft.lines.map((l) => [l.title, l.hours, l.include])).toEqual([
      ['Design work', 1.25, true],
      ['Task b', 1, false],
    ]);
  });

  it('re-rounds hours the user did not change when the rounding setting changes', () => {
    const tasks = [
      task('a', { '2026-10-02': 2 * H }),
      task('b', { '2026-10-05': H + 60_000 }),
    ];
    const prev = resumeDraft(input({ tasks }), edited(), TODAY);
    const settings = { ...input().settings, roundingMin: 30 };
    const draft = resumeDraft(input({ tasks, settings }), prev, TODAY);
    // a keeps the edited 1.25 h; b goes from 1.02 h to 1.5 h.
    expect(draft.lines.map((l) => l.hours)).toEqual([1.25, 1.5]);
  });

  it('drops lines whose time is gone and adds new ones ticked', () => {
    const tasks = [task('a', { '2026-10-02': 2 * H }), task('c', { '2026-10-09': H })];
    const draft = resumeDraft(input({ tasks }), edited(), TODAY);
    expect(draft.lines.map((l) => [l.taskId, l.title, l.hours, l.include])).toEqual([
      ['a', 'Design work', 1.25, true],
      ['c', 'Task c', 1, true],
    ]);
  });

  it('starts over when the draft project was deleted', () => {
    const prev = { ...edited(), projectId: 'gone' };
    expect(resumeDraft(input(), prev, TODAY)).toMatchObject({
      projectId: 'p1',
      rate: 80,
    });
  });
});

describe('issueBlocker', () => {
  const ready = (): Draft => newDraft(input(), TODAY);

  it('allows a complete draft', () => {
    expect(issueBlocker(input(), ready())).toBeNull();
  });

  it.each<[string, (d: Draft) => void, string]>([
    ['the period is missing', (d) => (d.to = ''), 'NEW.BLOCK.PERIOD'],
    ['From is after To', (d) => (d.from = '2026-11-01'), 'NEW.BLOCK.PERIOD'],
    [
      'no line is ticked',
      (d) => d.lines.forEach((l) => (l.include = false)),
      'NEW.BLOCK.LINES',
    ],
    [
      'ticked lines have 0 h',
      (d) => d.lines.forEach((l) => (l.hours = 0)),
      'NEW.BLOCK.LINES',
    ],
    ['the rate is 0', (d) => (d.rate = 0), 'NEW.BLOCK.RATE'],
    ['the number is blank', (d) => (d.number = '  '), 'NEW.BLOCK.NUMBER'],
    ['the date is missing', (d) => (d.issueDate = ''), 'NEW.BLOCK.DATE'],
  ])('blocks when %s', (_name, change, key) => {
    const draft = ready();
    change(draft);
    expect(issueBlocker(input(), draft)).toBe(key);
  });

  it('blocks a number that an issued invoice already has', () => {
    const data = input({ invoices: [issued({ number: '2026-001' })] });
    const draft = { ...newDraft(data, TODAY), number: ' 2026-001 ' };
    expect(issueBlocker(data, draft)).toBe('NEW.BLOCK.NUMBER_USED');
  });
});

describe('toInvoice', () => {
  it('freezes the draft, the current settings and the billed time', () => {
    const data = input({
      settings: {
        ...input().settings,
        seller: 'Me',
        paymentNote: 'IBAN X',
        currency: 'USD',
        taxRatePct: 19,
        paymentDays: 30,
        numberPrefix: '2026-',
      },
      invoices: [issued({ seq: 4, number: '2026-004' })],
    });
    const draft = newDraft(data, TODAY);
    draft.lines[0].title = '  Design  ';
    draft.lines[1].include = false;

    expect(toInvoice({ input: data, draft, id: 'new' })).toEqual({
      id: 'new',
      seq: 5,
      number: '2026-005',
      projectId: 'p1',
      issueDate: '2026-11-18',
      dueDate: '2026-12-18',
      periodFrom: '2026-10-01',
      periodTo: '2026-10-31',
      seller: 'Me',
      client: 'ACME',
      paymentNote: 'IBAN X',
      currency: 'USD',
      taxRatePct: 19,
      lines: [{ title: 'Design', hours: 2, rate: 80 }],
      billedMs: { a: { '2026-10-02': 2 * H } },
      language: 'de',
    });
  });

  it('bills a ticked line lowered to 0 h without printing it', () => {
    const draft = newDraft(input(), TODAY);
    draft.lines[1].hours = 0;
    const invoice = toInvoice({ input: input(), draft, id: 'new' });
    expect(invoice.lines.map((l) => l.title)).toEqual(['Task a']);
    expect(Object.keys(invoice.billedMs)).toEqual(['a', 'b']);
  });
});
