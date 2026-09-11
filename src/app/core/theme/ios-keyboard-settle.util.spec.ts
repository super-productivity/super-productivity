import { fakeAsync, tick } from '@angular/core/testing';
import { createOneShotSettle } from './ios-keyboard-settle.util';

const TIMEOUT = 400;

describe('createOneShotSettle()', () => {
  let action: jasmine.Spy;

  beforeEach(() => (action = jasmine.createSpy('action')));

  it('runs the armed action when the did event arrives', () => {
    const settle = createOneShotSettle(TIMEOUT);
    settle.arm(action);

    settle.run();

    expect(action).toHaveBeenCalledTimes(1);
  });

  // The whole point: iOS drops the did event, and the released code then left
  // the fixed bar behind the keyboard for the rest of the session (#9779).
  it('runs it on the timeout when the did event never arrives', fakeAsync(() => {
    const settle = createOneShotSettle(TIMEOUT);
    settle.arm(action);

    expect(action).not.toHaveBeenCalled();

    tick(TIMEOUT);

    expect(action).toHaveBeenCalledTimes(1);
  }));

  it('runs it once when the did event arrives late', fakeAsync(() => {
    const settle = createOneShotSettle(TIMEOUT);
    settle.arm(action);
    tick(TIMEOUT);

    settle.run();

    expect(action).toHaveBeenCalledTimes(1);
  }));

  it('does not run it again on the timeout after the did event', fakeAsync(() => {
    const settle = createOneShotSettle(TIMEOUT);
    settle.arm(action);
    settle.run();

    tick(TIMEOUT);

    expect(action).toHaveBeenCalledTimes(1);
  }));

  it('drops a cancelled action, timeout included', fakeAsync(() => {
    const settle = createOneShotSettle(TIMEOUT);
    settle.arm(action);

    settle.cancel();
    tick(TIMEOUT);
    settle.run();

    expect(action).not.toHaveBeenCalled();
  }));

  it('replaces an action that is armed again before it ran', fakeAsync(() => {
    const settle = createOneShotSettle(TIMEOUT);
    const replacement = jasmine.createSpy('replacement');
    settle.arm(action);

    settle.arm(replacement);
    tick(TIMEOUT);

    expect(action).not.toHaveBeenCalled();
    expect(replacement).toHaveBeenCalledTimes(1);
  }));

  it('does nothing when nothing is armed', fakeAsync(() => {
    const settle = createOneShotSettle(TIMEOUT);

    expect(() => {
      settle.run();
      settle.cancel();
      tick(TIMEOUT);
    }).not.toThrow();
  }));
});
