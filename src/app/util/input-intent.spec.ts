import { _inputIntentSignal } from '../core/input-intent/input-intent.service';
import { isTouchActive } from './input-intent';

describe('isTouchActive', () => {
  beforeEach(() => {
    _inputIntentSignal.set('mouse');
  });

  it('should return false in test environment (mouseOnly)', () => {
    // In JSDOM, detect-it reports deviceType as mouseOnly
    // so isTouchActive always returns the static IS_TOUCH_ONLY (false)
    expect(isTouchActive()).toBeFalse();
  });

  it('should be a function', () => {
    expect(typeof isTouchActive).toBe('function');
  });
});
