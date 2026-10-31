import { TestBed } from '@angular/core/testing';
import { ExecBeforeCloseService } from './exec-before-close.service';

describe('ExecBeforeCloseService in the browser', () => {
  it('reports unsupported without invoking or retaining the callback', () => {
    const service = TestBed.inject(ExecBeforeCloseService);
    const callback = jasmine.createSpy('cleanup');
    expect(service.registerPluginFinalizer('plugin', 'background', callback)).toBeFalse();
    expect(service.registerPluginFinalizer('plugin', 'background', null)).toBeFalse();
    service.unregisterPluginFinalizers('plugin');
    expect(callback).not.toHaveBeenCalled();
  });
});
