import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MAT_TOOLTIP_DEFAULT_OPTIONS } from '@angular/material/tooltip';
import { TranslateService } from '@ngx-translate/core';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from '../task-repeat-cfg.model';
import { RepeatCfgPreviewComponent } from './repeat-cfg-preview.component';
import { TagListComponent } from '../../tag/tag-list/tag-list.component';

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

@Component({ selector: 'tag-list', template: '' })
class TagListStubComponent {
  readonly task = input<unknown>();
}

describe('RepeatCfgPreviewComponent touch scrolling (#11100)', () => {
  it('does not block panning when a swipe starts on the row', () => {
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
          useValue: {
            currentLocale: (): string => 'en-US',
            textLocale: (): string => 'en-US',
          },
        },
        // emulate a touch-only device so MatTooltip takes its touch path
        {
          provide: MAT_TOOLTIP_DEFAULT_OPTIONS,
          useValue: { detectHoverCapability: (): boolean => false },
        },
      ],
    }).overrideComponent(RepeatCfgPreviewComponent, {
      remove: { imports: [TagListComponent] },
      add: { imports: [TagListStubComponent] },
    });
    const fixture = TestBed.createComponent(RepeatCfgPreviewComponent);
    fixture.componentRef.setInput('repeatCfg', {
      ...DEFAULT_TASK_REPEAT_CFG,
      id: 'cfg',
      title: 'Daily',
      repeatCycle: 'DAILY',
      repeatEvery: 1,
      startDate: '2026-06-01',
    });
    fixture.detectChanges();

    const row: HTMLElement = fixture.nativeElement.querySelector('div');
    expect(row.style.touchAction).not.toBe('none');
  });
});
