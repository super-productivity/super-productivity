import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'keys',
})
export class KeysPipe implements PipeTransform {
  transform(
    value: Record<string, unknown> | null | undefined,
    sort: boolean | 'reverse',
    filterOutKeys?: string | string[],
  ): string[] | null {
    if (value && value === Object(value)) {
      const keys = Object.keys(value);

      if (typeof filterOutKeys === 'string') {
        const index = keys.indexOf(filterOutKeys);
        if (index > -1) {
          keys.splice(index, 1);
        }
      } else if (Array.isArray(filterOutKeys)) {
        filterOutKeys.forEach((key) => {
          const index = keys.indexOf(key);
          if (index > -1) {
            keys.splice(index, 1);
          }
        });
      }

      if (sort) {
        keys.sort();
      }

      if (sort === 'reverse') {
        keys.reverse();
      }

      return keys;
    }

    return null;
  }
}
