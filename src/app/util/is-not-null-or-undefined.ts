import { Observable } from 'rxjs';
import { filter } from 'rxjs/operators';

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
export function inputIsNotNullOrUndefined<T>(input: null | undefined | T): input is T {
  return input !== null && input !== undefined;
}

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
export function isNotNullOrUndefined<T>() {
  return (source$: Observable<null | undefined | T>) =>
    source$.pipe(filter(inputIsNotNullOrUndefined));
}
