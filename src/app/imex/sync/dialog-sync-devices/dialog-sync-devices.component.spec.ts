import { DatePipe, registerLocaleData } from '@angular/common';
import localeDe from '@angular/common/locales/de';
import localeEn from '@angular/common/locales/en';
import localeJa from '@angular/common/locales/ja';
import localeSv from '@angular/common/locales/sv';
import localeZh from '@angular/common/locales/zh';
import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { SnackService } from '../../../core/snack/snack.service';
import { SuperSyncDevicesService } from '../super-sync-devices.service';
import { DialogSyncDevicesComponent } from './dialog-sync-devices.component';
import { T } from '../../../t.const';

describe('DialogSyncDevicesComponent last seen date', () => {
  const textLocale = signal('en');
  const currentLocale = signal('sv');
  const isoTextLocale = computed(() => (currentLocale() === 'sv' ? textLocale() : null));
  let fixture: ComponentFixture<DialogSyncDevicesComponent>;
  const lastSeen = (): string =>
    fixture.nativeElement.querySelector('.device-meta').textContent;

  beforeEach(async () => {
    registerLocaleData(localeSv);
    registerLocaleData(localeEn, 'en-US');
    registerLocaleData(localeDe);
    registerLocaleData(localeJa);
    registerLocaleData(localeZh);
    currentLocale.set('sv');
    textLocale.set('en');
    await TestBed.configureTestingModule({
      imports: [DialogSyncDevicesComponent, TranslateModule.forRoot()],
      providers: [
        { provide: SuperSyncDevicesService, useValue: { getDevices: async () => [] } },
        { provide: MatDialog, useValue: {} },
        { provide: MatDialogRef, useValue: {} },
        { provide: SnackService, useValue: {} },
        {
          provide: DateTimeFormatService,
          useValue: { currentLocale, textLocale, isoTextLocale },
        },
      ],
    }).compileComponents();
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {
      [T.F.SYNC.D_DEVICES.LAST_SEEN]: 'Last seen {{date}}',
    });
    translate.use('en');
    fixture = TestBed.createComponent(DialogSyncDevicesComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.devices.set([
      {
        clientId: 'B-test',
        platform: 'B',
        lastSeenAt: new Date(2026, 9, 25, 14, 3).getTime(),
        isCurrentDevice: false,
        icon: 'public',
        label: 'Browser',
      },
    ]);
    fixture.detectChanges();
  });

  for (const locale of ['en', 'sv', 'de', 'ja', 'zh']) {
    it(`uses a numeric ISO timestamp with the ${locale} UI language`, () => {
      textLocale.set(locale);
      fixture.detectChanges();
      expect(lastSeen().trim()).toBe('Last seen 2026-10-25 14:03:00');
    });
  }

  it('keeps the ISO timestamp when the UI language changes', () => {
    expect(lastSeen().trim()).toBe('Last seen 2026-10-25 14:03:00');

    textLocale.set('sv');
    fixture.detectChanges();
    expect(lastSeen().trim()).toBe('Last seen 2026-10-25 14:03:00');
  });

  it('zero-pads the numeric ISO date and clock fields', () => {
    fixture.componentInstance.devices.update((devices) =>
      devices.map((device) => ({
        ...device,
        lastSeenAt: new Date(2026, 0, 5, 4, 3, 9).getTime(),
      })),
    );
    fixture.detectChanges();
    expect(lastSeen().trim()).toBe('Last seen 2026-01-05 04:03:09');
  });

  it('keeps the configured medium timestamp when changing non-ISO locales', () => {
    currentLocale.set('en-US');
    textLocale.set('en-US');
    fixture.detectChanges();
    expect(lastSeen()).toContain(
      new DatePipe('en-US').transform(new Date(2026, 9, 25, 14, 3).getTime(), 'medium')!,
    );

    currentLocale.set('de');
    textLocale.set('de');
    fixture.detectChanges();
    expect(lastSeen()).toContain(
      new DatePipe('de').transform(new Date(2026, 9, 25, 14, 3).getTime(), 'medium')!,
    );
  });
});
