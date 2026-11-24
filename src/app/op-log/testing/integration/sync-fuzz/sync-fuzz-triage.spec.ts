import { FuzzStep } from './sync-fuzz-actions';
import { isOrderOnlyDiff } from './sync-fuzz-runner';
import {
  distinctTraces,
  formatShrunk,
  formatTriage,
  pinHints,
  shapeOf,
  triage,
  TriagePin,
} from './sync-fuzz-triage';

describe('sync fuzz triage', () => {
  describe('isOrderOnlyDiff', () => {
    it('is true for one list in two orders', () => {
      const a = { task: { ids: ['t1', 't2', 't3'] } };
      const b = { task: { ids: ['t3', 't1', 't2'] } };
      expect(isOrderOnlyDiff(a, b, ['task', 'ids', '0'])).toBeTrue();
    });

    it('is false when the lists hold different members', () => {
      const a = { task: { ids: ['t1', 't2'] } };
      const b = { task: { ids: ['t1', 't9'] } };
      expect(isOrderOnlyDiff(a, b, ['task', 'ids', '1'])).toBeFalse();
    });

    it('is false when one list repeats a member the other holds once', () => {
      const a = { task: { ids: ['t1', 't1', 't2'] } };
      const b = { task: { ids: ['t1', 't2', 't2'] } };
      expect(isOrderOnlyDiff(a, b, ['task', 'ids', '1'])).toBeFalse();
    });

    it('is false for a field that is not in a list', () => {
      const a = { task: { entities: { t1: { title: 'a' } } } };
      const b = { task: { entities: { t1: { title: 'b' } } } };
      expect(isOrderOnlyDiff(a, b, ['task', 'entities', 't1', 'title'])).toBeFalse();
    });
  });

  describe('triage', () => {
    const rows = triage([
      {
        transport: 'supersync',
        name: 'all:1',
        failures: [
          { signature: 'field-reverted:note.isLock' },
          { signature: 'divergence:.task.ids.*', orderOnly: true },
          { signature: 'divergence:.tag.entities.*.taskIds.*', orderOnly: true },
        ],
      },
      {
        transport: 'file',
        name: 'all:1',
        failures: [
          { signature: 'field-reverted:note.isLock' },
          { signature: 'divergence:.task.ids.*', orderOnly: true },
        ],
      },
      {
        transport: 'file',
        name: 'all:3',
        failures: [{ signature: 'divergence:.task.ids.*', orderOnly: false }],
      },
    ]);

    it('puts the signatures some run shows as more than order first', () => {
      expect(rows.map((r) => r.signature)).toEqual([
        'divergence:.task.ids.*',
        'field-reverted:note.isLock',
        'divergence:.tag.entities.*.taskIds.*',
      ]);
    });

    it('counts the runs showing a list signature as more than order', () => {
      expect(rows[0]).toEqual({
        signature: 'divergence:.task.ids.*',
        seeds: { supersync: ['all:1'], file: ['all:1', 'all:3'] },
        runs: 3,
        beyondOrder: 1,
        first: { transport: 'file', name: 'all:3' },
      });
    });

    it('names no run to shrink for a signature that is order-only in every run', () => {
      expect(rows[2]).toEqual({
        signature: 'divergence:.tag.entities.*.taskIds.*',
        seeds: { supersync: ['all:1'] },
        runs: 1,
        beyondOrder: 0,
      });
    });

    it('formats one line per signature and the totals', () => {
      expect(formatTriage(rows, ['supersync', 'file'])).toEqual([
        'CANDIDATE   supersync=1 file=2  divergence:.task.ids.*  more-than-order=1/3  first=file all:3',
        'CANDIDATE   supersync=1 file=1  field-reverted:note.isLock  first=supersync all:1',
        'ORDER-ONLY  supersync=1 file=0  divergence:.tag.entities.*.taskIds.*',
        'signatures: candidate=2 order-only=1',
      ]);
    });
  });

  const LOCK: FuzzStep[] = [
    { d: 'A', a: ['editNote', 'n1', 'isLock', true] },
    { d: 'B', a: ['editNote', 'n1', 'content', 'x'], s: 1 },
    { d: 'A', s: 1 },
  ];
  const PINS: TriagePin[] = [
    {
      class: 'whole-entity-lww-drops-fields',
      ref: '#10379',
      steps: [
        { d: 'C', a: ['editNote', 'n2', 'content', 'y'] },
        { d: 'A', a: ['editNote', 'n2', 'isLock', false], s: 1 },
      ],
      signatures: ['field-reverted:note.isLock'],
    },
    {
      class: 'time-delta-crossing',
      ref: 'fixed by #10340 (regression pin)',
      steps: [
        { d: 'A', a: ['renameTask', 't1', 'a'] },
        { d: 'B', a: ['track', 't1', 5] },
      ],
      signatures: [],
    },
    {
      class: 'coverage',
      ref: 'coverage trace',
      steps: [{ d: 'A', s: 1 }],
      signatures: [],
    },
  ];

  describe('shapeOf', () => {
    it('is the sorted action kinds, with the field of a whole-entity edit', () => {
      expect(shapeOf(LOCK)).toBe('editNote:content+editNote:isLock');
    });
  });

  describe('pinHints', () => {
    it('names a failing pin with the same action kinds', () => {
      expect(pinHints(PINS, LOCK)).toEqual([
        'failing pin whole-entity-lww-drops-fields (#10379)',
      ]);
    });

    it('says when the pin with the same kinds expects a clean run', () => {
      const steps: FuzzStep[] = [
        { d: 'C', a: ['track', 't2', 9], s: 1 },
        { d: 'A', a: ['renameTask', 't2', 'b'], s: 1 },
      ];
      expect(pinHints(PINS, steps)).toEqual([
        'clean pin time-delta-crossing (fixed by #10340 (regression pin))',
      ]);
    });

    it('gives no hint for other kinds, a subset of them, or a trace without actions', () => {
      expect(pinHints(PINS, [{ d: 'A', a: ['track', 't1', 5] }])).toEqual([]);
      expect(pinHints(PINS, [{ d: 'A', a: ['editNote', 'n1', 'isLock', true] }])).toEqual(
        [],
      );
      expect(pinHints(PINS, [{ d: 'B', s: 1 }])).toEqual([]);
    });
  });

  describe('shrunk traces', () => {
    const traces = distinctTraces([
      { signature: 'field-reverted:note.isLock', steps: LOCK },
      { signature: 'lost-entity:note', steps: [{ d: 'A', a: ['deleteNote', 'n1'] }] },
      { signature: 'divergence:.note.entities.*.isLock', steps: [...LOCK] },
    ]);

    it('lists the signatures that shrank to the same steps under one trace', () => {
      expect(traces.map((t) => t.signatures)).toEqual([
        ['field-reverted:note.isLock', 'divergence:.note.entities.*.isLock'],
        ['lost-entity:note'],
      ]);
    });

    it('formats what every transport showed, the pin hints and the trace', () => {
      const line = formatShrunk(
        traces[0],
        {
          supersync: [
            ['field-reverted:note.isLock', 'divergence:.note.ids.* (order)'],
            ['field-reverted:note.isLock'],
          ],
          file: [[], []],
        },
        PINS,
      );
      expect(line).toBe(
        'SHRUNK shape=editNote:content+editNote:isLock ' +
          'for=[field-reverted:note.isLock; divergence:.note.entities.*.isLock] ' +
          'supersync=[divergence:.note.ids.* (order) 1/2; field-reverted:note.isLock 2/2] ' +
          'file=[no failure] ' +
          'same-kinds=[failing pin whole-entity-lww-drops-fields (#10379)] ' +
          `trace=${JSON.stringify(LOCK)}`,
      );
    });
  });
});
