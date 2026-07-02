import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import { RatePromptService, WIN_PROMPT_DELAY_MS } from './rate-prompt.service';
import { selectTodayProgress } from '../work-context/store/work-context.selectors';
import { LS } from '../../core/persistence/storage-keys.const';
import { getDbDateStr } from '../../util/get-db-date-str';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { BannerService } from '../../core/banner/banner.service';
import { Banner } from '../../core/banner/banner.model';

// The prompt fires a beat after the win, not on the same tick — tick past the
// delay to flush the delayed emission.
const WIN_DELAY = WIN_PROMPT_DELAY_MS;

// Note: IS_ANDROID_WEB_VIEW / IS_IOS_NATIVE are false in jsdom, so _promptNow
// always takes the web-banner branch here. The native Play/iOS card paths (and
// their cadence save) are not exercisable in unit tests — they need e2e/native.
describe('RatePromptService', () => {
  let service: RatePromptService;
  let matDialog: jasmine.SpyObj<MatDialog>;
  let bannerService: jasmine.SpyObj<BannerService>;
  let store: MockStore;

  beforeEach(() => {
    const storageMock: { [key: string]: string } = {};
    spyOn(localStorage, 'getItem').and.callFake((k: string) => storageMock[k] ?? null);
    spyOn(localStorage, 'setItem').and.callFake((k: string, v: string) => {
      storageMock[k] = v;
    });

    matDialog = jasmine.createSpyObj('MatDialog', ['open']);
    matDialog.open.and.returnValue({ afterClosed: () => of(undefined) } as never);
    bannerService = jasmine.createSpyObj('BannerService', ['open', 'dismiss']);

    TestBed.configureTestingModule({
      providers: [
        RatePromptService,
        { provide: MatDialog, useValue: matDialog },
        { provide: BannerService, useValue: bannerService },
        {
          provide: DataInitStateService,
          useValue: { isAllDataLoadedInitially$: of(true) },
        },
        provideMockStore({
          selectors: [{ selector: selectTodayProgress, value: { done: 0, total: 10 } }],
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

  const setProgress = (done: number, total = 10): void => {
    store.overrideSelector(selectTodayProgress, { done, total });
    store.refreshState();
  };

  const lastBanner = (): Banner => bannerService.open.calls.mostRecent().args[0];

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
    it('arms but does NOT prompt on startup — it waits for a productive win', fakeAsync(() => {
      setEligible();
      service.init();
      tick(WIN_DELAY);
      expect(bannerService.open).not.toHaveBeenCalled();
    }));

    it('shows the banner a beat AFTER a productive win, not on the same tick', fakeAsync(() => {
      setEligible();
      service.init(); // baseline done = 0
      setProgress(8); // done = 8 → absolute-win threshold
      expect(bannerService.open).not.toHaveBeenCalled(); // delayed, not immediate
      tick(WIN_DELAY);
      expect(bannerService.open).toHaveBeenCalledTimes(1);
    }));

    it('does NOT prompt when the win is already true at arm time (baseline guard)', fakeAsync(() => {
      setProgress(8); // 8 done before we ever arm — a disguised cold-launch win
      setEligible();
      service.init();
      tick(WIN_DELAY);
      expect(bannerService.open).not.toHaveBeenCalled();

      // ...but a genuine further completion this session still fires.
      setProgress(9);
      tick(WIN_DELAY);
      expect(bannerService.open).toHaveBeenCalledTimes(1);
    }));

    it('prompts at most once per session even on further wins', fakeAsync(() => {
      setEligible();
      service.init();
      setProgress(8);
      setProgress(9);
      setProgress(10);
      tick(WIN_DELAY);
      expect(bannerService.open).toHaveBeenCalledTimes(1);
    }));

    it('advances the prompt cadence when the banner is shown', fakeAsync(() => {
      setEligible();
      service.init();
      setProgress(8);
      tick(WIN_DELAY);
      expect(localStorage.setItem).toHaveBeenCalledWith(
        LS.RATE_DIALOG_STATE,
        jasmine.stringMatching('"lastShownAppStartDay":32'),
      );
    }));

    it('does not prompt for progress below the win threshold', fakeAsync(() => {
      setEligible();
      service.init();
      setProgress(2); // below the floor of 3
      tick(WIN_DELAY);
      expect(bannerService.open).not.toHaveBeenCalled();
    }));

    it('does not prompt when the user has permanently opted out', fakeAsync(() => {
      (localStorage.getItem as jasmine.Spy).and.callFake((key: string) => {
        if (key === LS.APP_START_COUNT) return '31';
        if (key === LS.APP_START_COUNT_LAST_START_DAY) return '2020-01-01';
        if (key === LS.RATE_DIALOG_STATE)
          return JSON.stringify({ lastShownAppStartDay: 0, permanentOptOut: true });
        return null;
      });

      service.init();
      setProgress(10); // a clear win — but opted out
      tick(WIN_DELAY);
      expect(bannerService.open).not.toHaveBeenCalled();
    }));

    it('does not prompt when not yet at an eligible tier', fakeAsync(() => {
      (localStorage.getItem as jasmine.Spy).and.callFake((key: string) => {
        if (key === LS.APP_START_COUNT) return '5';
        if (key === LS.APP_START_COUNT_LAST_START_DAY) return '2020-01-01';
        return null;
      });

      service.init();
      setProgress(10);
      tick(WIN_DELAY);
      expect(bannerService.open).not.toHaveBeenCalled();
    }));

    it('does NOT prompt if a critical error is recorded after arming (crash suppression re-checked at fire time)', fakeAsync(() => {
      setEligible();
      service.init(); // eligible + armed while no error existed (baseline done = 0)

      // A crash / data-damage happens this session, AFTER arming.
      (localStorage.getItem as jasmine.Spy).and.callFake((key: string) => {
        if (key === LS.APP_START_COUNT) return '31';
        if (key === LS.APP_START_COUNT_LAST_START_DAY) return '2020-01-01';
        if (key === LS.LAST_CRITICAL_ERROR_TIME) return Date.now().toString();
        return null;
      });

      setProgress(8); // a genuine win — but the fresh crash must hold the prompt
      tick(WIN_DELAY);
      expect(bannerService.open).not.toHaveBeenCalled();
    }));
  });

  describe('banner → dialog hand-off', () => {
    const showBannerViaWin = (): void => {
      setEligible();
      service.init();
      setProgress(8);
      tick(WIN_DELAY);
    };

    it('the banner action opens the full rate/feedback dialog', fakeAsync(() => {
      showBannerViaWin();
      matDialog.open.calls.reset();

      lastBanner().action!.fn();

      expect(matDialog.open).toHaveBeenCalledTimes(1);
    }));

    it('choosing "rate" in that dialog permanently opts the user out', fakeAsync(() => {
      matDialog.open.and.returnValue({ afterClosed: () => of('rate') } as never);
      showBannerViaWin();

      lastBanner().action!.fn();

      expect(localStorage.setItem).toHaveBeenCalledWith(
        LS.RATE_DIALOG_STATE,
        jasmine.stringMatching('"permanentOptOut":true'),
      );
    }));
  });
});
