import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { DialogSimpleCounterEditSettingsComponent } from './dialog-simple-counter-edit-settings.component';
import { SimpleCounterService } from '../simple-counter.service';
import { DateService } from '../../../core/date/date.service';
import { SimpleCounterCopy, SimpleCounterType } from '../simple-counter.model';

describe('DialogSimpleCounterEditSettingsComponent avoid start marker', () => {
  const TODAY = '2026-01-29';
  const PAST_DAY = '2026-01-20';
  let simpleCounterService: jasmine.SpyObj<SimpleCounterService>;

  const createAndSave = (simpleCounter: Partial<SimpleCounterCopy>): void => {
    TestBed.configureTestingModule({
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { simpleCounter } },
        {
          provide: MatDialogRef,
          useValue: jasmine.createSpyObj('MatDialogRef', ['close']),
        },
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        { provide: SimpleCounterService, useValue: simpleCounterService },
        { provide: DateService, useValue: { todayStr: () => TODAY } },
      ],
    });
    const component = TestBed.runInInjectionContext(
      () => new DialogSimpleCounterEditSettingsComponent(),
    );
    component.save();
  };

  const avoidCounter = (
    extra: Partial<SimpleCounterCopy>,
  ): Partial<SimpleCounterCopy> => ({
    title: 'No smoking',
    type: SimpleCounterType.ClickCounter,
    isEnabled: true,
    isTrackStreaks: true,
    streakDirection: 'avoid',
    streakMinValue: 1,
    countOnDay: {},
    ...extra,
  });

  beforeEach(() => {
    simpleCounterService = jasmine.createSpyObj('SimpleCounterService', [
      'addSimpleCounter',
      'updateSimpleCounter',
      'setCounterToday',
    ]);
  });

  it('should add a new avoid habit with a 0 for today', () => {
    createAndSave(avoidCounter({}));
    const added = simpleCounterService.addSimpleCounter.calls.mostRecent().args[0];
    expect(added.countOnDay).toEqual({ [TODAY]: 0 });
  });

  it('should mark today when an existing habit without history switches to avoid', () => {
    createAndSave(avoidCounter({ id: 'sc1' }));
    expect(simpleCounterService.updateSimpleCounter).toHaveBeenCalled();
    expect(simpleCounterService.setCounterToday).toHaveBeenCalledWith('sc1', 0);
  });

  it('should not add a marker when the habit already has history', () => {
    createAndSave(avoidCounter({ id: 'sc1', countOnDay: { [PAST_DAY]: 2 } }));
    expect(simpleCounterService.setCounterToday).not.toHaveBeenCalled();
  });

  it('should not add a marker for a build habit', () => {
    createAndSave(avoidCounter({ streakDirection: undefined }));
    const added = simpleCounterService.addSimpleCounter.calls.mostRecent().args[0];
    expect(added.countOnDay).toEqual({});
  });
});
