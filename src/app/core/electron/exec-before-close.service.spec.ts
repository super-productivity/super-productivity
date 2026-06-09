import {
  ExecBeforeCloseService,
  getBeforeCloseIdsFromIpcEvent,
} from './exec-before-close.service';

describe('getBeforeCloseIdsFromIpcEvent()', () => {
  it('extracts before-close ids from the ipc event payload', () => {
    expect(getBeforeCloseIdsFromIpcEvent([{}, ['SYNC', 'FINISH_DAY']])).toEqual([
      'SYNC',
      'FINISH_DAY',
    ]);
  });

  it('rejects malformed ipc payloads', () => {
    expect(getBeforeCloseIdsFromIpcEvent(undefined)).toBeNull();
    expect(getBeforeCloseIdsFromIpcEvent([{}, undefined])).toBeNull();
    expect(getBeforeCloseIdsFromIpcEvent([{}, ['SYNC', 1]])).toBeNull();
    expect(getBeforeCloseIdsFromIpcEvent([{}, 'SYNC'])).toBeNull();
  });
});

describe('ExecBeforeCloseService', () => {
  const originalEa = Object.getOwnPropertyDescriptor(window, 'ea');

  const setElectronApi = (ea: Partial<typeof window.ea> | undefined): void => {
    Object.defineProperty(window, 'ea', {
      value: ea,
      configurable: true,
      writable: true,
    });
  };

  afterEach(() => {
    if (originalEa) {
      Object.defineProperty(window, 'ea', originalEa);
    } else {
      delete (window as unknown as { ea?: typeof window.ea }).ea;
    }
  });

  it('throws when the Electron bridge is missing', () => {
    setElectronApi(undefined);
    const service = new ExecBeforeCloseService();

    expect(() => service.schedule('SYNC')).toThrowError(
      'Electron API bridge is not available',
    );
    expect(() => service.unschedule('SYNC')).toThrowError(
      'Electron API bridge is not available',
    );
    expect(() => service.setDone('SYNC')).toThrowError(
      'Electron API bridge is not available',
    );
  });

  it('delegates before-close calls to the Electron bridge when available', () => {
    const electronApi = {
      scheduleRegisterBeforeClose: jasmine.createSpy('scheduleRegisterBeforeClose'),
      unscheduleRegisterBeforeClose: jasmine.createSpy('unscheduleRegisterBeforeClose'),
      setDoneRegisterBeforeClose: jasmine.createSpy('setDoneRegisterBeforeClose'),
    };
    setElectronApi(electronApi);
    const service = new ExecBeforeCloseService();

    service.schedule('SYNC');
    service.unschedule('FINISH_DAY');
    service.setDone('SYNC');

    expect(electronApi.scheduleRegisterBeforeClose).toHaveBeenCalledOnceWith('SYNC');
    expect(electronApi.unscheduleRegisterBeforeClose).toHaveBeenCalledOnceWith(
      'FINISH_DAY',
    );
    expect(electronApi.setDoneRegisterBeforeClose).toHaveBeenCalledOnceWith('SYNC');
  });
});
