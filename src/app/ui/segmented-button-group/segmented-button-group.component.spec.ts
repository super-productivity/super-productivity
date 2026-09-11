import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  SegmentedButtonGroupComponent,
  SegmentedButtonOption,
} from './segmented-button-group.component';

describe('SegmentedButtonGroupComponent', () => {
  let fixture: ComponentFixture<SegmentedButtonGroupComponent>;

  const longLocalizedOptions: readonly SegmentedButtonOption[] = [
    {
      id: 'flowtime',
      labelKey: 'TEST.FLOWTIME',
    },
    {
      id: 'pomodoro',
      labelKey: 'TEST.POMODORO',
    },
    {
      id: 'countdown',
      labelKey: 'TEST.COUNTDOWN',
    },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        SegmentedButtonGroupComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
    }).compileComponents();

    const translateService = TestBed.inject(TranslateService);
    translateService.setTranslation('de', {
      TEST: {
        FLOWTIME: 'Flexible Konzentrationssitzung',
        POMODORO: 'Pomodoro-Arbeitsintervall',
        COUNTDOWN: 'Individueller Rückwärtszähler',
      },
    });
    translateService.use('de');

    fixture = TestBed.createComponent(SegmentedButtonGroupComponent);
    fixture.componentRef.setInput('options', longLocalizedOptions);
    fixture.componentRef.setInput('selectedId', 'flowtime');
  });

  it('wraps long localized labels inside a 320px-wide group', async () => {
    const host = fixture.nativeElement as HTMLElement;
    host.style.width = '320px';
    document.body.appendChild(host);

    try {
      fixture.detectChanges();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const group = host.querySelector<HTMLElement>('.segmented-button-group');
      const labels = Array.from(host.querySelectorAll<HTMLElement>('.segment-label'));

      expect(group).not.toBeNull();
      expect(labels).toHaveSize(3);
      expect(group!.scrollWidth).toBeLessThanOrEqual(group!.clientWidth);
      expect(labels.every((label) => label.scrollWidth <= label.clientWidth)).toBeTrue();
      expect(
        labels.some((label) => {
          const fontSize = Number.parseFloat(getComputedStyle(label).fontSize);
          return label.getBoundingClientRect().height > fontSize * 1.5;
        }),
      ).toBeTrue();
    } finally {
      document.body.removeChild(host);
    }
  });
});
