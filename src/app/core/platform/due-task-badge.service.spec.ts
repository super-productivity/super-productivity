import { TestBed } from '@angular/core/testing';
import {
  DUE_TASK_BADGE_PLUGIN,
  DueTaskBadgePlugin,
  DueTaskBadgeService,
} from './due-task-badge.service';

describe('DueTaskBadgeService', () => {
  let service: DueTaskBadgeService;
  let plugin: jasmine.SpyObj<DueTaskBadgePlugin>;

  beforeEach(() => {
    plugin = jasmine.createSpyObj('DueTaskBadgePlugin', ['setCount']);
    plugin.setCount.and.resolveTo();
    TestBed.configureTestingModule({
      providers: [
        DueTaskBadgeService,
        { provide: DUE_TASK_BADGE_PLUGIN, useValue: plugin },
      ],
    });
    service = TestBed.inject(DueTaskBadgeService);
  });

  it('forwards a floored non-negative count to the Capacitor plugin', async () => {
    await service.setCount(3.9);
    expect(plugin.setCount).toHaveBeenCalledWith({ count: 3 });
    await service.setCount(-2);
    expect(plugin.setCount).toHaveBeenCalledWith({ count: 0 });
  });

  it('swallows plugin failures so badge sync cannot break the UI', async () => {
    plugin.setCount.and.rejectWith(new Error('native fail'));
    await expectAsync(service.setCount(1)).toBeResolved();
  });
});
