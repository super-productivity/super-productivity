import { fromFallBehindChoice, toFallBehindChoice } from './fall-behind-choice';

describe('fall-behind choice', () => {
  it('maps every stored combination to what the user sees', () => {
    expect(toFallBehindChoice({ waitForCompletion: false, skipOverdue: false })).toBe(
      'KEEP',
    );
    expect(toFallBehindChoice({})).toBe('KEEP');
    expect(toFallBehindChoice({ waitForCompletion: false, skipOverdue: true })).toBe(
      'LATEST',
    );
    expect(toFallBehindChoice({ waitForCompletion: true, skipOverdue: false })).toBe(
      'WAIT',
    );
    // waiting is checked first when copies are created
    expect(toFallBehindChoice({ waitForCompletion: true, skipOverdue: true })).toBe(
      'WAIT',
    );
  });

  it('writes each choice as exactly one behaviour', () => {
    expect(fromFallBehindChoice('KEEP')).toEqual({
      waitForCompletion: false,
      skipOverdue: false,
    });
    expect(fromFallBehindChoice('LATEST')).toEqual({
      waitForCompletion: false,
      skipOverdue: true,
    });
    expect(fromFallBehindChoice('WAIT')).toEqual({
      waitForCompletion: true,
      skipOverdue: false,
    });
  });

  it('round-trips every choice', () => {
    (['KEEP', 'LATEST', 'WAIT'] as const).forEach((choice) => {
      expect(toFallBehindChoice(fromFallBehindChoice(choice))).toBe(choice);
    });
  });
});
