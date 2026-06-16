import { toPaddedClockStr } from './to-padded-clock-str';

describe('toPaddedClockStr', () => {
  it('zero-pads a single-digit hour', () => {
    expect(toPaddedClockStr('9:00')).toBe('09:00');
  });

  it('leaves an already-padded value unchanged', () => {
    expect(toPaddedClockStr('17:05')).toBe('17:05');
  });

  it('zero-pads a single-digit minute', () => {
    expect(toPaddedClockStr('9:5')).toBe('09:05');
  });

  it('drops a stray seconds segment', () => {
    expect(toPaddedClockStr('13:30:00')).toBe('13:30');
  });

  it('trims surrounding whitespace', () => {
    expect(toPaddedClockStr('  8:30 ')).toBe('08:30');
  });

  it('handles midnight', () => {
    expect(toPaddedClockStr('0:00')).toBe('00:00');
  });

  it('handles the last minute of the day', () => {
    expect(toPaddedClockStr('23:59')).toBe('23:59');
  });

  describe('invalid input → empty string', () => {
    [
      undefined,
      null,
      '',
      'abc',
      '25:00',
      '24:00',
      '13:60',
      '12',
      ':30',
      '9:',
      '9.5:00',
    ].forEach((v) => {
      it(`returns '' for ${JSON.stringify(v)}`, () => {
        expect(toPaddedClockStr(v)).toBe('');
      });
    });
  });
});
