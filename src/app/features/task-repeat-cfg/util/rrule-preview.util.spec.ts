import { getRRulePreview } from './rrule-preview.util';

describe('getRRulePreview', () => {
  it('humanizes a valid rrule and echoes the body', () => {
    const p = getRRulePreview('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO');
    expect(p).not.toBeNull();
    expect(p!.rrule).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO');
    expect(p!.human.toLowerCase()).toContain('week');
  });

  it('capitalizes the human reading', () => {
    const p = getRRulePreview('FREQ=DAILY');
    expect(p).not.toBeNull();
    expect(p!.human.charAt(0)).toBe(p!.human.charAt(0).toUpperCase());
  });

  it('compresses consecutive month ranges in the human reading', () => {
    const p = getRRulePreview('FREQ=YEARLY;BYMONTH=3,4,5,6,7,8,9,10,11;BYDAY=SA');
    expect(p).not.toBeNull();
    expect(p!.human).toContain('March to November');
    expect(p!.human).not.toContain('April');
  });

  it('leaves non-consecutive months as a list', () => {
    const p = getRRulePreview('FREQ=YEARLY;BYMONTH=3,6,9');
    expect(p!.human).not.toContain(' to ');
  });

  it('returns null for empty / whitespace / garbage / undefined', () => {
    expect(getRRulePreview('')).toBeNull();
    expect(getRRulePreview('   ')).toBeNull();
    expect(getRRulePreview('not an rrule')).toBeNull();
    expect(getRRulePreview(undefined)).toBeNull();
  });

  it('lists upcoming occurrences anchored at the start date', () => {
    // Future start date → deterministic regardless of "now".
    const p = getRRulePreview('FREQ=DAILY', '2099-01-05');
    expect(p!.upcoming.length).toBe(3);
    expect(p!.upcoming[0].getFullYear()).toBe(2099);
    expect(p!.upcoming[0].getMonth()).toBe(0);
    expect(p!.upcoming[0].getDate()).toBe(5);
    expect(p!.upcoming[1].getDate()).toBe(6);
    expect(p!.upcoming[2].getDate()).toBe(7);
  });

  it('respects the interval in upcoming dates', () => {
    const p = getRRulePreview('FREQ=DAILY;INTERVAL=3', '2099-01-05');
    expect(p!.upcoming.map((d) => d.getDate())).toEqual([5, 8, 11]);
  });

  it('completion example re-anchors to the completion day', () => {
    const p = getRRulePreview('FREQ=DAILY;INTERVAL=3', '2099-01-05');
    expect(p!.completionExample).not.toBeNull();
    expect(p!.completionExample!.done.getDate()).toBe(5);
    expect(p!.completionExample!.next.getDate()).toBe(8); // 3 days after completion
  });

  it('bounds upcoming by COUNT', () => {
    const p = getRRulePreview('FREQ=DAILY;COUNT=2', '2099-01-05');
    expect(p!.upcoming.length).toBe(2);
  });

  it('localizes the human reading via humanize opts', () => {
    const vocab: Record<string, string> = {
      every: 'cada',
      week: 'semana',
      weeks: 'semanas',
      on: 'en',
    };
    const p = getRRulePreview('FREQ=WEEKLY;BYDAY=MO', undefined, {
      gettext: (id) => vocab[id] ?? id,
      language: {
        dayNames: [
          'Domingo',
          'Lunes',
          'Martes',
          'Miércoles',
          'Jueves',
          'Viernes',
          'Sábado',
        ],
        monthNames: [
          'Enero',
          'Febrero',
          'Marzo',
          'Abril',
          'Mayo',
          'Junio',
          'Julio',
          'Agosto',
          'Septiembre',
          'Octubre',
          'Noviembre',
          'Diciembre',
        ],
        tokens: {},
      },
      andWord: 'y',
      toWord: 'a',
    });
    expect(p!.human.toLowerCase()).toContain('semana'); // "week" → localized
    expect(p!.human).toContain('Lunes'); // Monday → localized
  });
});
