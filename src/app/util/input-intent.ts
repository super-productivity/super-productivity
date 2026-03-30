import { computed } from '@angular/core';
import { deviceType } from 'detect-it';
import { IS_TOUCH_ONLY } from './is-touch-only';
import { _inputIntentSignal } from '../core/input-intent/input-intent.service';

export const isTouchActive = computed(() => {
  if (deviceType !== 'hybrid') {
    return IS_TOUCH_ONLY;
  }
  return _inputIntentSignal() === 'touch';
});
