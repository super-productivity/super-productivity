import { computed } from '@angular/core';
import { deviceType } from 'detect-it';
import { _inputIntentSignal } from '../core/input-intent/input-intent.service';
import { DRAG_DELAY_FOR_TOUCH } from '../app.constants';

export const isTouchActive = computed(() => {
  if (deviceType === 'mouseOnly') {
    return false;
  }
  return _inputIntentSignal() === 'touch';
});

export const dragDelayForTouch = computed(() =>
  isTouchActive() ? DRAG_DELAY_FOR_TOUCH : 0,
);
