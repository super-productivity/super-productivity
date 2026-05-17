import { TestBed } from '@angular/core/testing';
import { ReplaySubject, Subject } from 'rxjs';
import { take } from 'rxjs/operators';
import { JiraApiService } from './jira-api.service';
import { ChromeExtensionInterfaceService } from '../../../../core/chrome-extension-interface/chrome-extension-interface.service';
import { SnackService } from '../../../../core/snack/snack.service';
import { GlobalProgressBarService } from '../../../../core-ui/global-progress-bar/global-progress-bar.service';
import { BannerService } from '../../../../core/banner/banner.service';
import { MatDialog } from '@angular/material/dialog';
import { DEFAULT_JIRA_CFG } from './jira.const';
import { JiraCfg } from './jira.model';
import { formatJiraDate } from '../../../../util/format-jira-date';

const makeMockExtensionService = (
  onReady$: Subject<boolean> | ReplaySubject<boolean>,
): Partial<ChromeExtensionInterfaceService> => ({
  onReady$: onReady$.asObservable(),
  addEventListener: jasmine.createSpy('addEventListener'),
  dispatchEvent: jasmine.createSpy('dispatchEvent'),
});

const setupService = (
  extensionReady$: Subject<boolean> | ReplaySubject<boolean>,
): JiraApiService => {
  TestBed.configureTestingModule({
    providers: [
      JiraApiService,
      {
        provide: ChromeExtensionInterfaceService,
        useValue: makeMockExtensionService(extensionReady$),
      },
      {
        provide: SnackService,
        useValue: jasmine.createSpyObj('SnackService', ['open']),
      },
      {
        provide: GlobalProgressBarService,
        useValue: jasmine.createSpyObj('GlobalProgressBarService', [
          'countUp',
          'countDown',
        ]),
      },
      {
        provide: BannerService,
        useValue: jasmine.createSpyObj('BannerService', ['open']),
      },
      { provide: MatDialog, useValue: {} },
    ],
  });
  return TestBed.inject(JiraApiService);
};

const baseCfg: JiraCfg = {
  ...DEFAULT_JIRA_CFG,
  host: 'https://jira.example.com',
  userName: 'user',
  password: 'pass',
};

describe('JiraApiService', () => {
  describe('addWorklog$ date formatting', () => {
    it('should format date correctly using formatJiraDate', () => {
      const testDate = '2024-01-15T10:30:00.000Z';
      const result = formatJiraDate(testDate);

      // JIRA format: YYYY-MM-DDTHH:mm:ss.SSZZ produces timezone without colon
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{2}[+-]\d{4}$/);
    });

    it('should understand the Jira format ZZ (timezone without colon)', () => {
      const testDate = '2024-01-15T10:30:00.000Z';
      const result = formatJiraDate(testDate);

      expect(result).toMatch(/[+-]\d{4}$/); // Ends with +0100 format (no colon)
    });

    it('should format date for Jira worklog', () => {
      const testDate = '2024-01-15T10:30:00.000Z';
      const result = formatJiraDate(testDate);
      const date = new Date(testDate);

      // Build the format that matches the expected output with ZZ (no colon in timezone)
      const pad = (num: number, length = 2): string => String(num).padStart(length, '0');
      const year = date.getFullYear();
      const month = pad(date.getMonth() + 1);
      const day = pad(date.getDate());
      const hours = pad(date.getHours());
      const minutes = pad(date.getMinutes());
      const seconds = pad(date.getSeconds());
      const milliseconds = String(date.getMilliseconds())
        .padStart(3, '0')
        .substring(0, 2); // Jira uses 2 digits

      // Timezone offset without colon (to match ZZ format)
      const offsetMinutes = date.getTimezoneOffset();
      const offsetHours = Math.abs(Math.floor(offsetMinutes / 60));
      const offsetMinPart = Math.abs(offsetMinutes % 60);
      const offsetSign = offsetMinutes <= 0 ? '+' : '-';
      const offsetFormatted = `${offsetSign}${pad(offsetHours)}${pad(offsetMinPart)}`;

      const expectedResult = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}${offsetFormatted}`;

      expect(result).toBe(expectedResult);
    });
  });

  describe('_isMinimalSettings (browser, no extension)', () => {
    let service: JiraApiService;

    beforeEach(() => {
      service = setupService(new Subject<boolean>());
    });

    it('returns false when allowFetchFallback is false and extension is not ready', () => {
      expect((service as any)._isMinimalSettings(baseCfg)).toBe(false);
    });

    it('returns true when allowFetchFallback is true', () => {
      expect(
        (service as any)._isMinimalSettings({ ...baseCfg, allowFetchFallback: true }),
      ).toBe(true);
    });

    it('returns true when extension has confirmed ready', () => {
      (service as any)._isExtension = true;
      expect((service as any)._isMinimalSettings(baseCfg)).toBe(true);
    });

    it('returns false when host is missing even if allowFetchFallback is true', () => {
      expect(
        (service as any)._isMinimalSettings({
          ...baseCfg,
          host: null,
          allowFetchFallback: true,
        }),
      ).toBe(false);
    });

    it('returns false when userName is missing even if allowFetchFallback is true', () => {
      expect(
        (service as any)._isMinimalSettings({
          ...baseCfg,
          userName: null,
          allowFetchFallback: true,
        }),
      ).toBe(false);
    });

    it('returns false when password is missing even if allowFetchFallback is true', () => {
      expect(
        (service as any)._isMinimalSettings({
          ...baseCfg,
          password: null,
          allowFetchFallback: true,
        }),
      ).toBe(false);
    });
  });

  describe('_isInterfacesReadyIfNeeded$', () => {
    // jasmine.clock() freezes real timers so 500 ms timeoutWith does not leak
    // across specs and cause spurious "done called twice" failures.
    beforeEach(() => jasmine.clock().install());
    afterEach(() => jasmine.clock().uninstall());

    it('emits true immediately when allowFetchFallback is true', (done) => {
      const service = setupService(new Subject<boolean>());
      (service as any)
        ._isInterfacesReadyIfNeeded$({ ...baseCfg, allowFetchFallback: true })
        .subscribe({
          next: (val: boolean) => {
            expect(val).toBe(true);
            done();
          },
          error: () => done.fail('expected true, got error'),
        });
    });

    // The production ChromeExtensionInterfaceService exposes onReady$ backed by a
    // ReplaySubject(1), so values emitted before _extensionReady$ is first subscribed
    // are buffered and replayed. We mirror that with ReplaySubject here.
    it('emits true when extension fired before the first request (replay cache)', (done) => {
      const replay = new ReplaySubject<boolean>(1);
      replay.next(true); // extension ready before any request is made
      const service = setupService(replay);

      (service as any)._isInterfacesReadyIfNeeded$(baseCfg).subscribe({
        next: (val: boolean) => {
          expect(val).toBe(true);
          done();
        },
        error: () => done.fail('expected true, got error'),
      });
    });

    it('emits true when extension fires after subscription starts', (done) => {
      const subject = new Subject<boolean>();
      const service = setupService(subject);

      (service as any)
        ._isInterfacesReadyIfNeeded$(baseCfg)
        .pipe(take(1))
        .subscribe({
          next: (val: boolean) => {
            expect(val).toBe(true);
            done();
          },
          error: () => done.fail('expected true, got error'),
        });

      subject.next(true);
    });

    it('errors when no extension is available and no fallback is configured', (done) => {
      const service = setupService(new Subject<boolean>());
      (service as any)._isInterfacesReadyIfNeeded$(baseCfg).subscribe({
        next: () => done.fail('expected error, got value'),
        error: (err: unknown) => {
          expect(err).toBeTruthy();
          done();
        },
      });
      jasmine.clock().tick(600);
    });
  });

  describe('_sendRequestToExecutor$ fetch fallback path', () => {
    let service: JiraApiService;
    let fetchSpy: jasmine.Spy;

    beforeEach(() => {
      service = setupService(new Subject<boolean>());
      fetchSpy = spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(new Response(JSON.stringify({ issues: [] }), { status: 200 })),
      );
    });

    it('calls fetch() when allowFetchFallback is true and no extension/Electron', (done) => {
      const cfg = { ...baseCfg, allowFetchFallback: true };
      (service as any)
        ._sendRequestToExecutor$(
          'test-id',
          'https://jira.example.com/rest/api/latest/issue/picker',
          { method: 'GET', headers: {} },
          undefined,
          cfg,
          true,
        )
        .subscribe({
          next: () => {
            expect(fetchSpy).toHaveBeenCalledOnceWith(
              'https://jira.example.com/rest/api/latest/issue/picker',
              jasmine.objectContaining({ method: 'GET' }),
            );
            done();
          },
          error: done.fail,
        });
    });

    it('does NOT call fetch() when extension is active (dispatches via extension instead)', () => {
      (service as any)._isExtension = true;
      const cfg = { ...baseCfg, allowFetchFallback: true };

      (service as any)._sendRequestToExecutor$(
        'test-id',
        'https://jira.example.com/rest/api/latest/issue/picker',
        { method: 'GET', headers: {} },
        undefined,
        cfg,
        true,
      );

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
