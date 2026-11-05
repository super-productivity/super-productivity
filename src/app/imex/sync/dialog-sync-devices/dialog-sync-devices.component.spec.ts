import { DatePipe, registerLocaleData } from '@angular/common';
import localeEn from '@angular/common/locales/en';
import localeSv from '@angular/common/locales/sv';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
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

  beforeEach(async () => {
    registerLocaleData(localeSv);
    registerLocaleData(localeEn, 'en-US');
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
  });

  it('uses the UI language for month names under ISO 8601', async () => {
    const fixture = TestBed.createComponent(DialogSyncDevicesComponent);
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

    const lastSeen = (): string =>
      fixture.nativeElement.querySelector('.device-meta').textContent;
    expect(lastSeen()).toContain('Oct');
    expect(lastSeen()).not.toContain('okt.');
    expect(lastSeen()).toContain('14:03:00');
    expect(lastSeen()).not.toContain('PM');

    textLocale.set('sv');
    fixture.detectChanges();
    expect(lastSeen()).toContain('okt.');

    currentLocale.set('en-US');
    textLocale.set('en-US');
    fixture.detectChanges();
    expect(lastSeen()).toContain(
      new DatePipe('en-US').transform(new Date(2026, 9, 25, 14, 3).getTime(), 'medium')!,
    );
  });
});
