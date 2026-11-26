import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { LS } from '../../core/persistence/storage-keys.const';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';
import { GlobalConfigService } from '../config/global-config.service';
import { OnboardingHintService } from '../onboarding/onboarding-hint.service';
import { QuickTourService } from '../onboarding/quick-tour.service';
import { TaskService } from '../tasks/task.service';
import { WorkContextService } from '../work-context/work-context.service';
import { ShepherdService } from './shepherd.service';
import { TourId } from './shepherd-steps.const';

describe('ShepherdService', () => {
  let service: ShepherdService;
  let onboardingHintService: jasmine.SpyObj<OnboardingHintService>;
  let quickTourService: jasmine.SpyObj<QuickTourService>;
  const ONBOARDING_KEYS = [LS.ONBOARDING_HINTS_DONE, LS.IS_SKIP_TOUR];
  let savedLs: Record<string, string | null>;

  beforeEach(() => {
    savedLs = {};
    for (const key of ONBOARDING_KEYS) {
      savedLs[key] = localStorage.getItem(key);
      localStorage.removeItem(key);
    }
    onboardingHintService = jasmine.createSpyObj<OnboardingHintService>(
      'OnboardingHintService',
      ['skip'],
    );
    quickTourService = jasmine.createSpyObj<QuickTourService>('QuickTourService', [
      'end',
    ]);
    TestBed.configureTestingModule({
      providers: [
        ShepherdService,
        { provide: LayoutService, useValue: {} },
        { provide: TaskService, useValue: {} },
        { provide: LOCAL_ACTIONS, useValue: new Subject() },
        { provide: GlobalConfigService, useValue: {} },
        { provide: WorkContextService, useValue: {} },
        { provide: OnboardingHintService, useValue: onboardingHintService },
        { provide: QuickTourService, useValue: quickTourService },
        {
          provide: Router,
          useValue: jasmine.createSpyObj<Router>('Router', {
            navigateByUrl: Promise.resolve(true),
          }),
        },
      ],
    });
    service = TestBed.inject(ShepherdService);
    // The tour library itself is not under test.
    spyOn(service, 'init').and.resolveTo();
  });

  afterEach(() => {
    for (const key of ONBOARDING_KEYS) {
      const value = savedLs[key];
      if (value === null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, value);
      }
    }
  });

  it('ends the first-run hints when a tour starts, so both never show at once', async () => {
    await service.show(TourId.CreateTask);
    expect(onboardingHintService.skip).toHaveBeenCalledTimes(1);
    expect(service.isActive).toBeTrue();
  });

  it('ends a running quick tour when a Help tour starts', async () => {
    await service.show(TourId.KeyboardNav);
    expect(quickTourService.end).toHaveBeenCalledTimes(1);
  });

  it('leaves finished onboarding alone', async () => {
    localStorage.setItem(LS.ONBOARDING_HINTS_DONE, 'true');
    await service.show(TourId.KeyboardNav);
    expect(onboardingHintService.skip).not.toHaveBeenCalled();
  });
});
