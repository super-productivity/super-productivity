import { SimpleCounterCfgFields } from './simple-counter.model';

const FIELDS_TO_COMPARE: (keyof SimpleCounterCfgFields)[] = [
  'id',
  'title',
  'isEnabled',
  'icon',
  'type',
  'countdownDuration',
];

export const isEqualSimpleCounterCfg = (
  a: SimpleCounterCfgFields[] | unknown,
  b: SimpleCounterCfgFields[] | unknown,
): boolean => {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; ++i) {
      if (a[i] !== b[i]) {
        for (let j = 0; j < FIELDS_TO_COMPARE.length; j++) {
          const field = FIELDS_TO_COMPARE[j];
          if (a[field] !== b[field]) {
            return false;
          }
        }
      }
    }
    return true;
  } else {
    return a === b;
  }
};
