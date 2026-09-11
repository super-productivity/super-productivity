import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { DesktopPanelButtonsComponent } from './desktop-panel-buttons.component';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { LayoutService } from '../../layout/layout.service';
import { DEFAULT_GLOBAL_CONFIG } from '../../../features/config/default-global-config.const';
import { AppFeaturesConfig } from '../../../features/config/global-config.model';

/**
 * Each panel toggle is gated on its own app feature, and the mobile bottom
 * nav's panels menu mirrors these three exactly (`mobile-bottom-nav.component`).
 * A button added here without a matching entry there is how a panel ends up
 * with no home below 600px.
 */
describe('DesktopPanelButtonsComponent', () => {
  let appFeatures: ReturnType<typeof signal<AppFeaturesConfig>>;

  const render = async (
    over: Partial<AppFeaturesConfig>,
  ): Promise<ComponentFixture<DesktopPanelButtonsComponent>> => {
    appFeatures = signal({ ...DEFAULT_GLOBAL_CONFIG.appFeatures, ...over });

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), DesktopPanelButtonsComponent],
      providers: [
        { provide: GlobalConfigService, useValue: { appFeatures } },
        { provide: LayoutService, useValue: {} },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    const fixture = TestBed.createComponent(DesktopPanelButtonsComponent);
    fixture.componentRef.setInput('isShowScheduleDayPanel', false);
    fixture.componentRef.setInput('isShowIssuePanel', false);
    fixture.componentRef.setInput('isShowNotes', false);
    fixture.detectChanges();
    return fixture;
  };

  const NONE: Partial<AppFeaturesConfig> = {
    isScheduleDayPanelEnabled: false,
    isIssuesPanelEnabled: false,
    isProjectNotesEnabled: false,
  };

  const cases: Array<[string, Partial<AppFeaturesConfig>, string[]]> = [
    [
      'all three enabled',
      {},
      [
        'e2e-toggle-schedule-day-panel',
        'e2e-toggle-issue-provider-panel',
        'e2e-toggle-notes-btn',
      ],
    ],
    ['none enabled', NONE, []],
    [
      'only schedule',
      { ...NONE, isScheduleDayPanelEnabled: true },
      ['e2e-toggle-schedule-day-panel'],
    ],
    [
      'only issues',
      { ...NONE, isIssuesPanelEnabled: true },
      ['e2e-toggle-issue-provider-panel'],
    ],
    ['only notes', { ...NONE, isProjectNotesEnabled: true }, ['e2e-toggle-notes-btn']],
    [
      'schedule and notes',
      { isIssuesPanelEnabled: false },
      ['e2e-toggle-schedule-day-panel', 'e2e-toggle-notes-btn'],
    ],
  ];

  cases.forEach(([name, over, expected]) => {
    it(`renders exactly the enabled panels — ${name}`, async () => {
      const fixture = await render(over);
      const rendered = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('button.panel-btn'),
      ).map((b) => Array.from(b.classList).find((c) => c.startsWith('e2e-'))!);

      expect(rendered).toEqual(expected);
    });
  });
});
