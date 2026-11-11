import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { T } from '../../../t.const';
import { AppFeaturesConfig } from '../../config/global-config.model';
import { GlobalConfigService } from '../../config/global-config.service';
import { QuickTourService } from '../quick-tour.service';
import { QuickTourCardComponent } from './quick-tour-card.component';

const ALL_ON: Partial<AppFeaturesConfig> = {
  isBoardsEnabled: true,
  isSchedulerEnabled: true,
  isHabitsEnabled: true,
  isFocusModeEnabled: true,
  isFinishDayEnabled: true,
  isIssuesPanelEnabled: true,
};

describe('QuickTourCardComponent', () => {
  let fixture: ComponentFixture<QuickTourCardComponent>;
  let appFeatures: WritableSignal<Partial<AppFeaturesConfig>>;
  let sync: WritableSignal<{ isEnabled: boolean }>;

  const render = (): HTMLElement => {
    fixture = TestBed.createComponent(QuickTourCardComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  const featureLabels = (el: HTMLElement): string[] =>
    Array.from(el.querySelectorAll('.features li span')).map(
      (span) => span.textContent?.trim() ?? '',
    );

  beforeEach(() => {
    appFeatures = signal({ ...ALL_ON });
    sync = signal({ isEnabled: false });
    TestBed.configureTestingModule({
      imports: [QuickTourCardComponent, TranslateModule.forRoot()],
      providers: [
        { provide: GlobalConfigService, useValue: { appFeatures, sync } },
        { provide: LayoutService, useValue: { isShowMobileBottomNav: signal(false) } },
        {
          provide: QuickTourService,
          useValue: jasmine.createSpyObj<QuickTourService>('QuickTourService', [
            'end',
            'openSettings',
          ]),
        },
      ],
    });
  });

  it('lists only the features that are still off, by their Settings labels', () => {
    appFeatures.set({ ...ALL_ON, isHabitsEnabled: false, isFocusModeEnabled: false });
    const el = render();
    expect(featureLabels(el)).toEqual([
      T.GCF.APP_FEATURES.HABITS,
      T.GCF.APP_FEATURES.FOCUS_MODE,
    ]);
  });

  it('leaves out the feature list when every feature is on', () => {
    const el = render();
    expect(el.querySelector('.features')).toBeNull();
    expect(el.querySelector('.intro')).toBeNull();
    expect(el.textContent).toContain(T.ONBOARDING.WANT_MORE.SYNC);
  });

  it('leaves out the sync line once sync is set up', () => {
    appFeatures.set({ ...ALL_ON, isBoardsEnabled: false });
    sync.set({ isEnabled: true });
    const el = render();
    expect(featureLabels(el)).toEqual([T.GCF.APP_FEATURES.BOARDS]);
    expect(el.textContent).not.toContain(T.ONBOARDING.WANT_MORE.SYNC);
  });
});
