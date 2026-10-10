import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { UiHelperService } from './ui-helper.service';
import { IS_ELECTRON_TOKEN } from '../../app.constants';

describe('UiHelperService focusAppAfterNotification', () => {
  let service: UiHelperService;
  let showOrFocusSpy: jasmine.Spy;
  let originalEa: typeof window.ea;
  let input: HTMLInputElement;

  const setup = (isElectron: boolean): void => {
    TestBed.configureTestingModule({
      providers: [{ provide: IS_ELECTRON_TOKEN, useValue: isElectron }],
    });
    service = TestBed.inject(UiHelperService);
  };

  beforeEach(() => {
    originalEa = window.ea;
    showOrFocusSpy = jasmine.createSpy('showOrFocus');
    window.ea = { showOrFocus: showOrFocusSpy } as unknown as typeof window.ea;
    input = document.createElement('input');
    document.body.appendChild(input);
  });

  afterEach(() => {
    window.ea = originalEa;
    input.remove();
  });

  it('forwards the reminder flag to the main process after the delay (#10410)', fakeAsync(() => {
    setup(true);
    service.focusAppAfterNotification({ isReminder: true });

    tick(1499);
    expect(showOrFocusSpy).not.toHaveBeenCalled();

    tick(1);
    expect(showOrFocusSpy).toHaveBeenCalledOnceWith({ isReminder: true });
    tick(100);
  }));

  it('blurs the focused element after focusing so stray keystrokes do nothing (#5762)', fakeAsync(() => {
    setup(true);
    service.focusAppAfterNotification({ isReminder: true });

    tick(1500);
    input.focus();
    expect(document.activeElement).toBe(input);

    tick(100);
    expect(document.activeElement).not.toBe(input);
  }));

  it('does nothing outside Electron', fakeAsync(() => {
    setup(false);
    service.focusAppAfterNotification({ isReminder: true });

    tick(1600);
    expect(showOrFocusSpy).not.toHaveBeenCalled();
  }));
});
