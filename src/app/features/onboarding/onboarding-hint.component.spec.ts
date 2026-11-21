import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { TranslateModule } from '@ngx-translate/core';

import { OnboardingHintComponent } from './onboarding-hint.component';
import { OnboardingHintService } from './onboarding-hint.service';
import { QuickTourService } from './quick-tour.service';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { GlobalConfigService } from '../config/global-config.service';

describe('OnboardingHintComponent', () => {
  let fixture: ComponentFixture<OnboardingHintComponent>;
  let target: HTMLElement;

  const frame = (): Promise<void> =>
    new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

  beforeEach(async () => {
    target = document.createElement('button');
    target.className = 'add-task-button';
    target.style.cssText =
      'position: fixed; left: 20px; top: 20px; width: 44px; height: 44px;';
    document.body.appendChild(target);

    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), OnboardingHintComponent],
      providers: [
        {
          provide: OnboardingHintService,
          useValue: {
            currentStep: signal('create-task'),
            swipeTargetTaskId: signal(null),
            firstTaskId: signal(null),
            skip: jasmine.createSpy('skip'),
          },
        },
        {
          provide: QuickTourService,
          useValue: {
            currentStep: signal(null),
            tourTaskId: signal(null),
            isTimerNoteShown: signal(false),
            isAcknowledging: signal(false),
          },
        },
        {
          provide: GlobalConfigService,
          useValue: {
            cfg: signal(null),
            appFeatures: signal({ isTimeTrackingEnabled: true }),
          },
        },
        { provide: LayoutService, useValue: { isShowMobileBottomNav: signal(true) } },
        { provide: LiveAnnouncer, useValue: { announce: () => Promise.resolve() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OnboardingHintComponent);
    fixture.detectChanges();
    // The step's first positioning attempt runs on a 0ms timeout.
    await tick();
  });

  afterEach(() => {
    fixture.destroy();
    target.remove();
  });

  // #8828: the bottom nav removes its + on views without tasks, and the
  // create-task step waits for it instead of ending.
  it('drops the placement when its target leaves the DOM and re-attaches when it is back', async () => {
    const cmp = fixture.componentInstance;
    expect(cmp.hintPosition()).withContext('attached').not.toBeNull();

    target.remove();
    window.dispatchEvent(new Event('resize'));
    await frame();
    expect(cmp.hintPosition()).withContext('stale placement dropped').toBeNull();

    document.body.appendChild(target);
    window.dispatchEvent(new Event('resize'));
    await frame();
    expect(cmp.hintPosition()).withContext('re-attached').not.toBeNull();
  });
});
