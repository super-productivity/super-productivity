import { performHapticFeedback } from './haptic-feedback';

describe('performHapticFeedback', () => {
  const win = window as { SUPAndroid?: unknown };
  let original: unknown;

  beforeEach(() => {
    original = win.SUPAndroid;
  });

  afterEach(() => {
    win.SUPAndroid = original;
  });

  it('forwards the type to the native bridge', () => {
    const spy = jasmine.createSpy('performHapticFeedback');
    win.SUPAndroid = { performHapticFeedback: spy };

    performHapticFeedback('confirm');

    expect(spy).toHaveBeenCalledWith('confirm');
  });

  it('is a no-op outside the Android app', () => {
    win.SUPAndroid = undefined;

    expect(() => performHapticFeedback('threshold')).not.toThrow();
  });

  it('is a no-op on an older APK without the method', () => {
    win.SUPAndroid = {};

    expect(() => performHapticFeedback('longPress')).not.toThrow();
  });

  it('swallows bridge errors', () => {
    win.SUPAndroid = {
      performHapticFeedback: () => {
        throw new Error('bridge gone');
      },
    };

    expect(() => performHapticFeedback('confirm')).not.toThrow();
  });
});
