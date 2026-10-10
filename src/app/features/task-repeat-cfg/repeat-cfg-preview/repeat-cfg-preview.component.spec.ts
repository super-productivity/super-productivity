import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from '../task-repeat-cfg.model';
import { RepeatCfgPreviewComponent } from './repeat-cfg-preview.component';

describe('RepeatCfgPreviewComponent next tooltip', () => {
  const dailyCfg = (deletedInstanceDates: string[]): TaskRepeatCfg => ({
    ...DEFAULT_TASK_REPEAT_CFG,
    id: 'cfg',
    title: 'Daily',
    repeatCycle: 'DAILY',
    repeatEvery: 1,
    startDate: '2026-06-01',
    lastTaskCreationDay: '2026-06-09',
    deletedInstanceDates,
  });

  const tooltipFor = (deletedInstanceDates: string[]): string => {
    const fixture = TestBed.createComponent(RepeatCfgPreviewComponent);
    fixture.componentRef.setInput('repeatCfg', dailyCfg(deletedInstanceDates));
    return fixture.componentInstance.nextDueTooltip();
  };

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(2026, 5, 9, 10, 0, 0));
    TestBed.configureTestingModule({
      imports: [RepeatCfgPreviewComponent],
      providers: [
        { provide: MatDialog, useValue: { open: (): void => undefined } },
        {
          provide: TranslateService,
          useValue: { instant: (key: string): string => key },
        },
        {
          provide: DateTimeFormatService,
          useValue: { currentLocale: (): string => 'en-US' },
        },
      ],
    }).overrideComponent(RepeatCfgPreviewComponent, { set: { template: '' } });
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  it('names the next day when nothing is skipped', () => {
    expect(tooltipFor([])).toBe('SCHEDULE.NEXT 6/10');
  });

  it('skips a deleted instance', () => {
    expect(tooltipFor(['2026-06-10'])).toBe('SCHEDULE.NEXT 6/11');
  });
});
