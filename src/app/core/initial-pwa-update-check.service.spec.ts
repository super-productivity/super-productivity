import { fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import { InitialPwaUpdateCheckService } from './initial-pwa-update-check.service';
import { SwUpdate } from '@angular/service-worker';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { Log } from './log';

const INITIAL_PWA_UPDATE_CHECK_TIMEOUT_MS = 8000;

describe('InitialPwaUpdateCheckService', () => {
  let originalOnLineDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalOnLineDescriptor = Object.getOwnPropertyDescriptor(navigator, 'onLine');
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true,
    });
  });

  afterEach(() => {
    restoreNavigatorOnLine(originalOnLineDescriptor);
    TestBed.resetTestingModule();
  });

  it('should defer the update check until subscribed', () => {
    const { service, swUpdate } = setup(Promise.resolve(false));

    expect(swUpdate.checkForUpdate).not.toHaveBeenCalled();

    const sub = service.afterInitialUpdateCheck$.subscribe();

    expect(swUpdate.checkForUpdate).toHaveBeenCalledTimes(1);
    sub.unsubscribe();
  });

  it('should emit when no update is available', async () => {
    const { service } = setup(Promise.resolve(false));

    const result = await firstValueFrom(service.afterInitialUpdateCheck$);

    expect(result).toBeUndefined();
  });

  it('should share the initial update check result', async () => {
    const { service, swUpdate } = setup(Promise.resolve(false));

    await firstValueFrom(service.afterInitialUpdateCheck$);
    await firstValueFrom(service.afterInitialUpdateCheck$);

    expect(swUpdate.checkForUpdate).toHaveBeenCalledTimes(1);
  });

  it('should emit when the update check rejects', async () => {
    spyOn(Log, 'warn');
    const { service } = setup(Promise.reject(new Error('network failed')));

    const result = await firstValueFrom(service.afterInitialUpdateCheck$);

    expect(result).toBeUndefined();
    expect(Log.warn).toHaveBeenCalled();
  });

  it('should emit when the update check stalls', fakeAsync(() => {
    spyOn(Log, 'warn');
    const { service } = setup(new Promise<boolean>(() => undefined));
    let didEmit = false;

    service.afterInitialUpdateCheck$.subscribe(() => {
      didEmit = true;
    });
    tick(INITIAL_PWA_UPDATE_CHECK_TIMEOUT_MS);
    flushMicrotasks();

    expect(didEmit).toBeTrue();
    expect(Log.warn).toHaveBeenCalled();
  }));

  it('should skip the update check when service worker updates are disabled', async () => {
    const { service, swUpdate } = setup(Promise.resolve(false), false);

    const result = await firstValueFrom(service.afterInitialUpdateCheck$);

    expect(result).toBeUndefined();
    expect(swUpdate.checkForUpdate).not.toHaveBeenCalled();
  });
});

const setup = (
  checkForUpdateResult: Promise<boolean>,
  isEnabled: boolean = true,
): {
  service: InitialPwaUpdateCheckService;
  swUpdate: jasmine.SpyObj<SwUpdate>;
} => {
  const swUpdate = jasmine.createSpyObj<SwUpdate>('SwUpdate', ['checkForUpdate']);
  Object.defineProperty(swUpdate, 'isEnabled', {
    value: isEnabled,
    configurable: true,
  });
  swUpdate.checkForUpdate.and.returnValue(checkForUpdateResult);

  const translateService = jasmine.createSpyObj<TranslateService>('TranslateService', [
    'instant',
  ]);
  translateService.instant.and.returnValue('Update?');

  TestBed.configureTestingModule({
    providers: [
      InitialPwaUpdateCheckService,
      { provide: SwUpdate, useValue: swUpdate },
      { provide: TranslateService, useValue: translateService },
    ],
  });

  return {
    service: TestBed.inject(InitialPwaUpdateCheckService),
    swUpdate,
  };
};

const restoreNavigatorOnLine = (descriptor: PropertyDescriptor | undefined): void => {
  if (descriptor) {
    Object.defineProperty(navigator, 'onLine', descriptor);
  } else {
    delete (navigator as { onLine?: boolean }).onLine;
  }
};
