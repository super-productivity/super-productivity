import { TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { map } from 'rxjs/operators';
import { cold } from 'jasmine-marbles';

describe('GlobalTrackingIntervalService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideMockStore({ initialState: {} })],
    });
  });

  it('should provide a steady interval', () => {
    const values = { a: 1, b: 2, c: 3, x: 2, y: 3, z: 4 };
    const source = cold('-a-b-c-|', values);
    const expected = cold('-x-y-z-|', values);

    const result = source.pipe(map((x) => x + 1));
    expect(result).toBeObservable(expected);
  });
});
