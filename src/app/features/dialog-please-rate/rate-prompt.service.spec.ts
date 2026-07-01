import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import { RatePromptService } from './rate-prompt.service';
import { LS } from '../../core/persistence/storage-keys.const';
import { getDbDateStr } from '../../util/get-db-date-str';
import {
  selectTodayTaskIds,
  selectUndoneTodayTaskIds,
} from '../work-context/store/work-context.selectors';

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `t${i}`);

describe('RatePromptService', () => {
  let service: RatePromptService;
  let matDialog: jasmine.SpyObj<MatDialog>;
  let store: MockStore;

  beforeEach(() => {
    const storageMock: { [key: string]: string } = {};
    spyOn(localStorage, 'getItem').and.callFake((k: string) => storageMock[k] ?? null);
    spyOn(localStorage, 'setItem').and.callFake((k: string, v: string) => {
      storageMock[k] = v;
    });

    matDialog = jasmine.createSpyObj('MatDialog', ['open']);
    matDialog.open.and.returnValue({ afterClosed: () => of(undefined) } as never);

    TestBed.configureTestingModule({
      providers: [
        RatePromptService,
        { provide: MatDialog, useValue: matDialog },
        provideMockStore({
          selectors: [
            { selector: selectTodayTaskIds, value: ids(10) },
            { selector: selectUndoneTodayTaskIds, value: ids(10) }, // done = 0
          ],
        }),
      ],
    });

    service = TestBed.inject(RatePromptService);
    store = TestBed.inject(MockStore);
  });

  const setEligible = (): void => {
    (localStorage.getItem as jasmine.Spy).and.callFake((key: string) => {
      if (key === LS.APP_START_COUNT) return '31'; // → 32, the first tier
      if (key === LS.APP_START_COUNT_LAST_START_DAY) return '2020-01-01';
      return null;
    });
  };

  // Simulate completing tasks: fewer undone → more done.
  const completeDownTo = (undoneCount: number): void => {
    store.overrideSelector(selectUndoneTodayTaskIds, ids(undoneCount));
    store.refreshState();
  };

  describe('app-start cadence counter', () => {
    it('increments the count on a new day', () => {
      (localStorage.getItem as jasmine.Spy).and.callFake((key: string) => {
        if (key === LS.APP_START_COUNT) return '5';
        if (key === LS.APP_START_COUNT_LAST_START_DAY) return '2020-01-01';
        return null;
      });

      service.init();

      expect(localStorage.setItem).toHaveBeenCalledWith(LS.APP_START_COUNT, '6');
    });

    it('does not increment the count on the same day', () => {
      const todayStr = getDbDateStr();
      (localStorage.getItem as jasmine.Spy).and.callFake((key: string) => {
        if (key === LS.APP_START_COUNT) return '10';
        if (key === LS.APP_START_COUNT_LAST_START_DAY) return todayStr;
        return null;
      });

      service.init();

      const countSets = (localStorage.setItem as jasmine.Spy).calls
        .allArgs()
        .filter(([k]) => k === LS.APP_START_COUNT);
      expect(countSets.length).toBe(0);
    });
  });

  describe('arming + win timing', () => {
    it('arms but does NOT prompt on startup — it waits for a productive win', () => {
      setEligible();
      service.init();
      expect(matDialog.open).not.toHaveBeenCalled();
    });

    it('prompts once a productive win is reached this session', () => {
      setEligible();
      service.init(); // baseline done = 0
      completeDownTo(2); // done = 8 → absolute-win threshold
      expect(matDialog.open).toHaveBeenCalledTimes(1);
    });

    it('does not prompt for progress below the win threshold', () => {
      setEligible();
      service.init();
      completeDownTo(8); // done = 2 → below the floor of 3
      expect(matDialog.open).not.toHaveBeenCalled();
    });

    it('does not prompt when the user has permanently opted out', () => {
      (localStorage.getItem as jasmine.Spy).and.callFake((key: string) => {
        if (key === LS.APP_START_COUNT) return '31';
        if (key === LS.APP_START_COUNT_LAST_START_DAY) return '2020-01-01';
        if (key === LS.RATE_DIALOG_STATE)
          return JSON.stringify({ lastShownAppStartDay: 0, permanentOptOut: true });
        return null;
      });

      service.init();
      completeDownTo(0); // done = 10, a clear win — but opted out
      expect(matDialog.open).not.toHaveBeenCalled();
    });

    it('does not prompt when not yet at an eligible tier', () => {
      (localStorage.getItem as jasmine.Spy).and.callFake((key: string) => {
        if (key === LS.APP_START_COUNT) return '5';
        if (key === LS.APP_START_COUNT_LAST_START_DAY) return '2020-01-01';
        return null;
      });

      service.init();
      completeDownTo(0);
      expect(matDialog.open).not.toHaveBeenCalled();
    });
  });
});
