import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatMenuTrigger } from '@angular/material/menu';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService, TranslateStore } from '@ngx-translate/core';
import { of } from 'rxjs';
import { AddTaskBarActionsComponent } from './add-task-bar-actions.component';
import { AddTaskBarStateService } from '../add-task-bar-state.service';
import { AddTaskBarParserService } from '../add-task-bar-parser.service';
import { ProjectService } from '../../../project/project.service';
import { TagService } from '../../../tag/tag.service';
import { DialogScheduleTaskComponent } from '../../../planner/dialog-schedule-task/dialog-schedule-task.component';
import { Project } from '../../../project/project.model';
import { Tag } from '../../../tag/tag.model';
import { signal } from '@angular/core';
import { getDbDateStr } from '../../../../util/get-db-date-str';
import { DateTimeFormatService } from 'src/app/core/date-time-format/date-time-format.service';
import { Store } from '@ngrx/store';
import { GlobalConfigService } from 'src/app/features/config/global-config.service';
import { DateTimeLocale, DateTimeLocales } from 'src/app/core/locale.constants';

describe('AddTaskBarActionsComponent', () => {
  let component: AddTaskBarActionsComponent;
  let fixture: ComponentFixture<AddTaskBarActionsComponent>;
  let mockStateService: jasmine.SpyObj<AddTaskBarStateService>;
  let mockParserService: jasmine.SpyObj<AddTaskBarParserService>;
  let mockProjectService: jasmine.SpyObj<ProjectService>;
  let mockTagService: jasmine.SpyObj<TagService>;
  let mockMatDialog: jasmine.SpyObj<MatDialog>;
  let mockDialogRef: jasmine.SpyObj<MatDialogRef<DialogScheduleTaskComponent>>;

  const mockProject: Project = {
    id: '1',
    title: 'Test Project',
    isArchived: false,
    isHiddenFromMenu: false,
    theme: {
      primary: '#007bff',
    },
    icon: 'folder',
  } as Project;

  const mockTag: Tag = {
    id: '1',
    title: 'urgent',
    theme: {
      primary: '#ff0000',
    },
  } as Tag;

  const mockState = {
    projectId: mockProject.id, // Use mock project id by default
    tagIds: [],
    tagIdsFromTxt: [],
    newTagTitles: [],
    date: null,
    time: null,
    estimate: null,
    cleanText: null,
  };

  const mockStore = jasmine.createSpyObj('Store', ['select', 'dispatch']);
  const mockConfigService = (locale: DateTimeLocale): GlobalConfigService => {
    return jasmine.createSpyObj('GlobalConfigService', [], {
      localization: () => ({ timeLocale: locale }),
    });
  };
  const mockDateTimeFormatService = jasmine.createSpyObj('DateTimeFormatService', ['-'], {
    currentLocale: 'en-US',
  });

  beforeEach(async () => {
    // Create proper signal mocks
    const mockStateSignal = signal(mockState);
    const mockAutoDetectedSignal = signal(false);
    const mockInputTxtSignal = signal('');

    mockStateService = jasmine.createSpyObj('AddTaskBarStateService', [
      'updateDate',
      'updateEstimate',
      'updateRemindOption',
      'clearDate',
      'clearTags',
      'clearEstimate',
      'toggleTag',
    ]);

    // Set up signal properties
    Object.defineProperty(mockStateService, 'state', {
      value: mockStateSignal.asReadonly(),
      writable: false,
    });
    Object.defineProperty(mockStateService, 'isAutoDetected', {
      value: mockAutoDetectedSignal.asReadonly(),
      writable: false,
    });
    Object.defineProperty(mockStateService, 'inputTxt', {
      value: mockInputTxtSignal.asReadonly(),
      writable: false,
    });

    // Store references to update signals in tests
    (mockStateService as any)._mockStateSignal = mockStateSignal;
    (mockStateService as any)._mockAutoDetectedSignal = mockAutoDetectedSignal;
    (mockStateService as any)._mockInputTxtSignal = mockInputTxtSignal;

    mockParserService = jasmine.createSpyObj('AddTaskBarParserService', [
      'removeShortSyntaxFromInput',
    ]);

    mockProjectService = jasmine.createSpyObj('ProjectService', [], {
      list$: of([mockProject]),
      listSortedForUI: signal([mockProject]),
      listSorted: signal([mockProject]),
    });

    mockTagService = jasmine.createSpyObj('TagService', [], {
      tags$: of([mockTag]),
      tagsNoMyDayAndNoList$: of([mockTag]),
      tagsNoMyDayAndNoListSorted: signal([mockTag]),
    });

    mockDialogRef = jasmine.createSpyObj('MatDialogRef', ['afterClosed']);
    mockDialogRef.afterClosed.and.returnValue(of(false));

    mockMatDialog = jasmine.createSpyObj('MatDialog', ['open']);
    mockMatDialog.open.and.returnValue(mockDialogRef);

    await TestBed.configureTestingModule({
      imports: [
        AddTaskBarActionsComponent,
        BrowserAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        { provide: AddTaskBarStateService, useValue: mockStateService },
        { provide: AddTaskBarParserService, useValue: mockParserService },
        { provide: DateTimeFormatService, useValue: mockDateTimeFormatService },
        {
          provide: GlobalConfigService,
          useValue: mockConfigService(DateTimeLocales.en_us),
        },
        { provide: Store, useValue: mockStore },
        { provide: ProjectService, useValue: mockProjectService },
        { provide: TagService, useValue: mockTagService },
        { provide: MatDialog, useValue: mockMatDialog },
        TranslateService,
        TranslateStore,
      ],
    }).compileComponents();

    // Set up translations
    const translateService = TestBed.inject(TranslateService);
    translateService.setTranslation('en', {
      F: {
        TASK: {
          ADD_TASK_BAR: {
            TODAY: 'Today',
            TOMORROW: 'Tomorrow',
          },
        },
      },
    });
    translateService.use('en');

    fixture = TestBed.createComponent(AddTaskBarActionsComponent);
    component = fixture.componentInstance;
    spyOn(component.refocus, 'emit');
    fixture.detectChanges();
  });

  describe('Component Creation', () => {
    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should initialize with correct signals', () => {
      expect(component.allProjects()).toEqual([mockProject]);
      expect(component.allTags()).toEqual([mockTag]);
    });

    it('should expose constants', () => {
      expect(component.ESTIMATE_OPTIONS).toBeDefined();
    });

    it('should handle input properties', () => {
      // Test default values
      expect(component.isHideDueBtn()).toBe(false);
      expect(component.isHideTagBtn()).toBe(false);

      // Create new fixture with input values
      fixture = TestBed.createComponent(AddTaskBarActionsComponent);
      fixture.componentRef.setInput('isHideDueBtn', true);
      fixture.componentRef.setInput('isHideTagBtn', true);
      fixture.detectChanges();

      expect(fixture.componentInstance.isHideDueBtn()).toBe(true);
      expect(fixture.componentInstance.isHideTagBtn()).toBe(true);
    });
  });

  describe('Computed Properties', () => {
    it('should compute hasNewTags correctly', () => {
      const stateWithNewTags = {
        ...mockState,
        newTagTitles: ['new-tag'],
      };
      (mockStateService as any)._mockStateSignal.set(stateWithNewTags);

      fixture.detectChanges();
      expect(component.hasNewTags()).toBe(true);
    });

    it('should compute dateDisplay for today', () => {
      const today = getDbDateStr(new Date());
      const stateWithToday = {
        ...mockState,
        date: today,
        time: null,
      };
      (mockStateService as any)._mockStateSignal.set(stateWithToday);

      fixture.detectChanges();
      expect(component.dateDisplay()).toBe('Today');
    });

    it('should compute dateDisplay for today with time', () => {
      const today = getDbDateStr(new Date());
      const time = '14:30';
      const stateWithTime = {
        ...mockState,
        date: today,
        time,
      };
      (mockStateService as any)._mockStateSignal.set(stateWithTime);

      fixture.detectChanges();
      // When today has a time, it shows the time instead of "Today"
      expect(component.dateDisplay()).toBe('14:30');
    });

    it('should compute dateDisplay for tomorrow', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = getDbDateStr(tomorrow);
      const stateWithTomorrow = {
        ...mockState,
        date: tomorrowStr,
        time: null,
      };
      (mockStateService as any)._mockStateSignal.set(stateWithTomorrow);

      fixture.detectChanges();
      expect(component.dateDisplay()).toBe('Tomorrow');
    });

    it('should compute dateDisplay for other dates', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);
      const futureDateStr = getDbDateStr(futureDate);
      const stateWithFutureDate = {
        ...mockState,
        date: futureDateStr,
        time: null,
      };
      (mockStateService as any)._mockStateSignal.set(stateWithFutureDate);

      fixture.detectChanges();
      const result = component.dateDisplay();
      // Check that result contains the day
      expect(result).toContain(futureDate.getDate().toString());
    });

    it('should compute estimateDisplay correctly', () => {
      const estimate = 1800000; // 30 minutes
      const stateWithEstimate = {
        ...mockState,
        estimate,
      };
      (mockStateService as any)._mockStateSignal.set(stateWithEstimate);

      fixture.detectChanges();
      expect(component.estimateDisplay()).toBeTruthy();
    });

    it('should return null for dateDisplay when no date', () => {
      expect(component.dateDisplay()).toBe(null);
    });

    it('should return null for estimateDisplay when no estimate', () => {
      expect(component.estimateDisplay()).toBe(null);
    });

    it('should handle dateDisplay edge cases', () => {
      // Test with date but no time for a future date with time component
      const dateWithTime = new Date();
      dateWithTime.setDate(dateWithTime.getDate() + 5);
      const dateStr = getDbDateStr(dateWithTime);

      const stateWithTimeInDate = {
        ...mockState,
        date: dateStr,
        time: '10:00',
      };
      (mockStateService as any)._mockStateSignal.set(stateWithTimeInDate);
      fixture.detectChanges();

      const result = component.dateDisplay();
      expect(result).toContain('10:00');
    });

    it('should handle auto-detected state correctly', () => {
      (mockStateService as any)._mockAutoDetectedSignal.set(true);
      const stateWithProject = {
        ...mockState,
        projectId: mockProject.id,
      };
      (mockStateService as any)._mockStateSignal.set(stateWithProject);
      fixture.detectChanges();

      expect(component.isAutoDetected()).toBe(true);
    });

    it('should format dates according to locale', () => {
      // Test with a German locale
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [
          AddTaskBarActionsComponent,
          BrowserAnimationsModule,
          TranslateModule.forRoot(),
        ],
        providers: [
          {
            provide: DateTimeFormatService,
            useValue: jasmine.createSpyObj('DateTimeFormatService', ['-'], {
              currentLocale: 'de-de',
            }),
          },
          {
            provide: GlobalConfigService,
            useValue: mockConfigService(DateTimeLocales.de_de),
          },
          { provide: Store, useValue: mockStore },
          { provide: AddTaskBarStateService, useValue: mockStateService },
          { provide: AddTaskBarParserService, useValue: mockParserService },
          { provide: ProjectService, useValue: mockProjectService },
          { provide: TagService, useValue: mockTagService },
          { provide: MatDialog, useValue: mockMatDialog },
          TranslateService,
          TranslateStore,
        ],
      });

      // Set up translations for German locale test
      const deTranslateService = TestBed.inject(TranslateService);
      deTranslateService.setTranslation('de', {
        F: {
          TASK: {
            ADD_TASK_BAR: {
              TODAY: 'Heute',
              TOMORROW: 'Morgen',
            },
          },
        },
      });
      deTranslateService.use('de');

      const deFixture = TestBed.createComponent(AddTaskBarActionsComponent);
      const deComponent = deFixture.componentInstance;

      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);
      const futureDateStr = getDbDateStr(futureDate);
      const stateWithDate = {
        ...mockState,
        date: futureDateStr,
        time: null,
      };
      (mockStateService as any)._mockStateSignal.set(stateWithDate);
      deFixture.detectChanges();

      const result = deComponent.dateDisplay();
      // German locale should format differently than en-US
      expect(result).toBeTruthy();
      expect(result).toContain(futureDate.getDate().toString());
    });

    it('should handle tomorrow with time correctly', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = getDbDateStr(tomorrow);
      const stateWithTomorrowAndTime = {
        ...mockState,
        date: tomorrowStr,
        time: '15:30',
      };
      (mockStateService as any)._mockStateSignal.set(stateWithTomorrowAndTime);

      fixture.detectChanges();
      // With time, it should show the formatted date with time, not just "Tomorrow"
      const result = component.dateDisplay();
      expect(result).toContain('15:30');
    });
  });

  describe('Schedule Dialog', () => {
    it('should open schedule dialog with correct data', () => {
      const testDateStr = '2024-01-15';
      const stateWithDate = {
        ...mockState,
        date: testDateStr,
        time: '10:30',
      };
      (mockStateService as any)._mockStateSignal.set(stateWithDate);
      fixture.detectChanges();

      component.openScheduleDialog();

      expect(mockMatDialog.open).toHaveBeenCalledWith(DialogScheduleTaskComponent, {
        data: {
          isSelectDueOnly: true,
          targetDay: testDateStr,
          targetTime: '10:30',
        },
      });
    });

    it('should open schedule dialog without targetDay when no date', () => {
      component.openScheduleDialog();

      expect(mockMatDialog.open).toHaveBeenCalledWith(DialogScheduleTaskComponent, {
        data: {
          isSelectDueOnly: true,
          targetDay: undefined,
          targetTime: undefined,
        },
      });
    });

    it('should handle dialog result with date and time', () => {
      const resultDate = new Date('2024-01-15');
      const resultTime = '14:30';
      const mockResult = { date: resultDate, time: resultTime };
      mockDialogRef.afterClosed.and.returnValue(of(mockResult));

      component.openScheduleDialog();

      expect(mockStateService.updateDate).toHaveBeenCalledWith(
        getDbDateStr(resultDate),
        resultTime,
      );
    });

    it('should handle dialog cancellation', () => {
      mockDialogRef.afterClosed.and.returnValue(of(false));
      const currentState = {
        ...mockState,
        date: getDbDateStr(new Date()),
        time: '10:00',
      };
      (mockStateService as any)._mockStateSignal.set(currentState);
      fixture.detectChanges();

      component.openScheduleDialog();

      expect(mockStateService.updateDate).not.toHaveBeenCalled();
      expect(component.refocus.emit).toHaveBeenCalled();
    });

    it('should handle dialog result without proper data', () => {
      mockDialogRef.afterClosed.and.returnValue(of('invalid'));
      const currentState = {
        ...mockState,
        date: getDbDateStr(new Date()),
        time: '10:00',
      };
      (mockStateService as any)._mockStateSignal.set(currentState);
      fixture.detectChanges();

      component.openScheduleDialog();

      expect(mockStateService.updateDate).not.toHaveBeenCalled();
      expect(component.refocus.emit).toHaveBeenCalled();
    });

    it('should pass time to dialog even when no date is selected', () => {
      const stateWithTimeOnly = {
        ...mockState,
        date: null,
        time: '09:00',
      };
      (mockStateService as any)._mockStateSignal.set(stateWithTimeOnly);
      fixture.detectChanges();

      component.openScheduleDialog();

      expect(mockMatDialog.open).toHaveBeenCalledWith(DialogScheduleTaskComponent, {
        data: {
          isSelectDueOnly: true,
          targetDay: undefined,
          targetTime: '09:00',
        },
      });
    });

    it('should always set isSelectDueOnly to true', () => {
      // Test with various states to ensure isSelectDueOnly is always true
      const states = [
        { ...mockState },
        { ...mockState, date: '2024-01-15' },
        { ...mockState, time: '10:00' },
        { ...mockState, date: '2024-01-15', time: '10:00' },
      ];

      states.forEach((state) => {
        (mockStateService as any)._mockStateSignal.set(state);
        fixture.detectChanges();
        component.openScheduleDialog();
      });

      // All calls should have isSelectDueOnly: true
      expect(mockMatDialog.open).toHaveBeenCalledTimes(states.length);
      mockMatDialog.open.calls.all().forEach((call) => {
        const dialogConfig = call.args[1] as any;
        expect(dialogConfig?.data?.isSelectDueOnly).toBe(true);
      });
    });

    it('should emit dialog open state changes', async () => {
      const emitSpy = spyOn(component.scheduleDialogOpenChange, 'emit');
      component.openScheduleDialog();

      expect(emitSpy).toHaveBeenCalledWith(true);

      await new Promise((resolve) => setTimeout(resolve));
      expect(emitSpy).toHaveBeenCalledWith(false);
    });
  });

  describe('Tag Operations', () => {
    it('should check if tag is selected', () => {
      const stateWithTags = {
        ...mockState,
        tagIds: [mockTag.id],
      };
      (mockStateService as any)._mockStateSignal.set(stateWithTags);
      fixture.detectChanges();

      expect(component.hasSelectedTag(mockTag.id)).toBe(true);
    });

    it('should return false for unselected tag', () => {
      expect(component.hasSelectedTag('nonexistent')).toBe(false);
    });

    it('should toggle tag with syntax removal when removing', () => {
      const stateWithTags = {
        ...mockState,
        tagIds: [mockTag.id],
      };
      (mockStateService as any)._mockStateSignal.set(stateWithTags);
      (mockStateService as any)._mockInputTxtSignal.set('Task #urgent');
      mockParserService.removeShortSyntaxFromInput.and.returnValue('Task');
      fixture.detectChanges();

      component.toggleTagWithSyntax(mockTag);

      expect(mockParserService.removeShortSyntaxFromInput).toHaveBeenCalledWith(
        'Task #urgent',
        'tags',
        mockTag.title,
      );
      expect(mockStateService.toggleTag).toHaveBeenCalledWith(mockTag, 'Task');
    });

    it('should toggle tag without syntax modification when adding', () => {
      const stateWithoutTag = {
        ...mockState,
        tagIds: [], // Tag not present
      };
      (mockStateService as any)._mockStateSignal.set(stateWithoutTag);
      fixture.detectChanges();

      component.toggleTagWithSyntax(mockTag);

      expect(mockParserService.removeShortSyntaxFromInput).not.toHaveBeenCalled();
      expect(mockStateService.toggleTag).toHaveBeenCalledWith(mockTag);
    });

    it('should clear tags with syntax', () => {
      (mockStateService as any)._mockInputTxtSignal.set('Task #urgent #important');
      mockParserService.removeShortSyntaxFromInput.and.returnValue('Task');
      fixture.detectChanges();

      component.clearTagsWithSyntax();

      expect(mockParserService.removeShortSyntaxFromInput).toHaveBeenCalledWith(
        'Task #urgent #important',
        'tags',
      );
      expect(mockStateService.clearTags).toHaveBeenCalledWith('Task');
    });

    it('should handle multiple tag selection correctly', () => {
      const mockTag2: Tag = {
        id: '2',
        title: 'important',
        theme: {
          primary: '#00ff00',
        },
      } as Tag;
      const stateWithMultipleTags = {
        ...mockState,
        tagIds: [mockTag.id, mockTag2.id],
      };
      (mockStateService as any)._mockStateSignal.set(stateWithMultipleTags);
      fixture.detectChanges();

      expect(component.hasSelectedTag(mockTag.id)).toBe(true);
      expect(component.hasSelectedTag(mockTag2.id)).toBe(true);
      expect(component.hasSelectedTag('nonexistent')).toBe(false);
    });

    it('should handle empty input text for syntax operations', () => {
      (mockStateService as any)._mockInputTxtSignal.set('');
      mockParserService.removeShortSyntaxFromInput.and.returnValue('');
      fixture.detectChanges();

      component.clearTagsWithSyntax();

      expect(mockParserService.removeShortSyntaxFromInput).toHaveBeenCalledWith(
        '',
        'tags',
      );
      expect(mockStateService.clearTags).toHaveBeenCalledWith('');
    });
  });

  describe('Date Operations', () => {
    it('should clear date with syntax', () => {
      (mockStateService as any)._mockInputTxtSignal.set('Task @today');
      mockParserService.removeShortSyntaxFromInput.and.returnValue('Task');
      fixture.detectChanges();

      component.clearDateWithSyntax();

      expect(mockParserService.removeShortSyntaxFromInput).toHaveBeenCalledWith(
        'Task @today',
        'date',
      );
      expect(mockStateService.clearDate).toHaveBeenCalledWith('Task');
    });
  });

  describe('Estimate Operations', () => {
    it('should handle estimate input with valid value', () => {
      spyOn(component.estimateChanged, 'emit');
      const testValue = '30m'; // This should result in 1800000ms (30 minutes)

      component.onEstimateInput(testValue);

      expect(mockStateService.updateEstimate).toHaveBeenCalledWith(1800000);
      expect(component.estimateChanged.emit).toHaveBeenCalledWith(testValue);
    });

    it('should not update estimate for invalid input', () => {
      spyOn(component.estimateChanged, 'emit');

      component.onEstimateInput('invalid');

      expect(mockStateService.updateEstimate).not.toHaveBeenCalled();
      expect(component.estimateChanged.emit).not.toHaveBeenCalled();
    });

    it('should clear estimate with syntax', () => {
      (mockStateService as any)._mockInputTxtSignal.set('Task t30m');
      mockParserService.removeShortSyntaxFromInput.and.returnValue('Task');
      fixture.detectChanges();

      component.clearEstimateWithSyntax();

      expect(mockParserService.removeShortSyntaxFromInput).toHaveBeenCalledWith(
        'Task t30m',
        'estimate',
      );
      expect(mockStateService.clearEstimate).toHaveBeenCalledWith('Task');
    });

    it('should handle various time formats in estimate input', () => {
      const emitSpy = spyOn(component.estimateChanged, 'emit');

      // Test hours
      component.onEstimateInput('2h');
      expect(mockStateService.updateEstimate).toHaveBeenCalledWith(7200000); // 2 hours in ms
      expect(emitSpy).toHaveBeenCalledWith('2h');

      mockStateService.updateEstimate.calls.reset();
      emitSpy.calls.reset();

      // Test decimal hours
      component.onEstimateInput('1.5h');
      expect(mockStateService.updateEstimate).toHaveBeenCalledWith(5400000); // 1.5 hours in ms
      expect(emitSpy).toHaveBeenCalledWith('1.5h');
    });

    it('should not emit estimate changed for zero values', () => {
      spyOn(component.estimateChanged, 'emit');

      // Test empty string (should return 0 from stringToMs)
      component.onEstimateInput('');
      expect(mockStateService.updateEstimate).not.toHaveBeenCalled();
      expect(component.estimateChanged.emit).not.toHaveBeenCalled();

      // Test zero value
      component.onEstimateInput('0m');
      expect(mockStateService.updateEstimate).not.toHaveBeenCalled();
      expect(component.estimateChanged.emit).not.toHaveBeenCalled();
    });
  });

  describe('Menu Operations', () => {
    let mockMenuTrigger: jasmine.SpyObj<MatMenuTrigger>;

    beforeEach(() => {
      mockMenuTrigger = jasmine.createSpyObj('MatMenuTrigger', ['openMenu'], {
        menuClosed: of(undefined),
      });
    });

    it('should handle project menu click', () => {
      component.onProjectMenuClick();

      expect(component.isProjectMenuOpen()).toBe(true);
    });

    it('should handle tags menu click', () => {
      component.onTagsMenuClick();

      expect(component.isTagsMenuOpen()).toBe(true);
    });

    it('should handle estimate menu click', () => {
      component.onEstimateMenuClick();

      expect(component.isEstimateMenuOpen()).toBe(true);
    });

    it('should open project menu programmatically', () => {
      // Ensure the signal starts as false
      expect(component.isProjectMenuOpen()).toBe(false);

      // Spy on the signal's set method
      const setOpenSpy = spyOn(component.isProjectMenuOpen, 'set');

      // Mock the viewChild signal
      Object.defineProperty(component, 'projectMenuTrigger', {
        value: () => mockMenuTrigger,
        writable: true,
      });

      // Call the method
      component.openProjectMenu();

      // Verify the set method was called with true
      expect(setOpenSpy).toHaveBeenCalledWith(true);
      expect(mockMenuTrigger.openMenu).toHaveBeenCalled();
    });

    it('should handle null menu trigger in openProjectMenu', () => {
      // Mock the viewChild signal to return null
      Object.defineProperty(component, 'projectMenuTrigger', {
        value: () => null,
        writable: true,
      });

      expect(() => component.openProjectMenu()).not.toThrow();
    });
  });

  describe('Private Helper Methods', () => {
    it('should correctly identify same dates', () => {
      const date1 = new Date('2024-01-15T10:30:00');
      const date2 = new Date('2024-01-15T15:45:00'); // Different time, same date

      const result = (component as any).isSameDate(date1, date2);

      expect(result).toBe(true);
    });

    it('should correctly identify different dates', () => {
      const date1 = new Date('2024-01-15');
      const date2 = new Date('2024-01-16');

      const result = (component as any).isSameDate(date1, date2);

      expect(result).toBe(false);
    });
  });

  describe('Integration', () => {
    it('should filter archived projects from allProjects signal', () => {
      const archivedProject = { ...mockProject, id: '2', isArchived: true };
      mockProjectService.list$ = of([mockProject, archivedProject]);

      // Recreate component to pick up new observable
      fixture = TestBed.createComponent(AddTaskBarActionsComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();

      expect(component.allProjects()).toEqual([mockProject]);
      expect(component.allProjects()).not.toContain(archivedProject);
    });

    it('should filter hidden projects from allProjects signal', () => {
      const hiddenProject = { ...mockProject, id: '2', isHiddenFromMenu: true };
      mockProjectService.list$ = of([mockProject, hiddenProject]);

      // Recreate component to pick up new observable
      fixture = TestBed.createComponent(AddTaskBarActionsComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();

      expect(component.allProjects()).toEqual([mockProject]);
      expect(component.allProjects()).not.toContain(hiddenProject);
    });
  });

  describe('Cross-Timezone Date Display', () => {
    it('should correctly identify today across timezones', () => {
      // Get today's date string in local timezone
      const today = getDbDateStr(new Date());

      const stateWithToday = {
        ...mockState,
        date: today,
        time: null,
      };
      (mockStateService as any)._mockStateSignal.set(stateWithToday);
      fixture.detectChanges();

      const result = component.dateDisplay();
      expect(result).toBe('Today');
    });

    it('should handle date display near midnight in different timezones', () => {
      // Create a date that would be "tomorrow" if interpreted as UTC
      // but is still "today" in local timezone
      const now = new Date();

      // Create a date at 23:45 local time
      const lateTonight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        23,
        45,
      );
      const lateTonightStr = getDbDateStr(lateTonight);

      const stateWithLateTime = {
        ...mockState,
        date: lateTonightStr,
        time: '23:45',
      };
      (mockStateService as any)._mockStateSignal.set(stateWithLateTime);
      fixture.detectChanges();

      // Should still be today if the date string represents today
      const result = component.dateDisplay();
      if (lateTonightStr === getDbDateStr(new Date())) {
        expect(result).toBe('23:45'); // Shows time when it's today with time
      } else {
        expect(result).toContain('23:45'); // Shows date with time
      }
    });

    it('should correctly identify tomorrow across DST transitions', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = getDbDateStr(tomorrow);

      const stateWithTomorrow = {
        ...mockState,
        date: tomorrowStr,
        time: null,
      };
      (mockStateService as any)._mockStateSignal.set(stateWithTomorrow);
      fixture.detectChanges();

      const result = component.dateDisplay();
      expect(result).toBe('Tomorrow');
    });

    it('should handle dates near year boundaries correctly', () => {
      // Test a date near year boundary that's not today or tomorrow
      // Use next year's New Year's Eve to avoid collision with current date
      const today = new Date();
      const nextYear = today.getFullYear() + 1;
      const newYearEve = `${nextYear}-12-31`;
      const stateWithNewYearEve = {
        ...mockState,
        date: newYearEve,
        time: '23:30',
      };
      (mockStateService as any)._mockStateSignal.set(stateWithNewYearEve);
      fixture.detectChanges();

      const result = component.dateDisplay();
      expect(result).toContain('Dec'); // Should show month
      expect(result).toContain('31'); // Should show day
      expect(result).toContain('23:30'); // Should show time
    });

    it('should format dates consistently regardless of timezone', () => {
      // Test a specific date that could be interpreted differently in different timezones
      const testDate = '2025-06-15'; // Mid-year date
      const testTime = '12:00';

      const stateWithSpecificDate = {
        ...mockState,
        date: testDate,
        time: testTime,
      };
      (mockStateService as any)._mockStateSignal.set(stateWithSpecificDate);
      fixture.detectChanges();

      const result = component.dateDisplay();
      expect(result).toContain('Jun'); // Month should be June
      expect(result).toContain('15'); // Day should be 15
      expect(result).toContain('12:00'); // Time should be preserved
    });
  });

  describe('Schedule Dialog Timezone Handling', () => {
    it('should handle dialog results with dates from different timezones', () => {
      // Simulate a dialog result with a Date object that might come from a date picker
      const selectedDate = new Date(2025, 2, 15, 10, 30, 0); // March 15, 2025 at 10:30 AM
      const mockResult = {
        date: selectedDate,
        time: '15:00', // User changed time to 3 PM
      };
      mockDialogRef.afterClosed.and.returnValue(of(mockResult));

      component.openScheduleDialog();

      // Should convert the Date to string format for consistency
      expect(mockStateService.updateDate).toHaveBeenCalledWith(
        '2025-03-15', // Date converted to string format
        '15:00', // Time preserved
      );
    });

    it('should preserve date consistency when opening dialog with existing date', () => {
      // Set a date in the state
      const existingDate = '2025-07-20';
      const existingTime = '09:15';

      const stateWithDate = {
        ...mockState,
        date: existingDate,
        time: existingTime,
      };
      (mockStateService as any)._mockStateSignal.set(stateWithDate);
      fixture.detectChanges();

      component.openScheduleDialog();

      // Dialog should be opened with the string date, not converted to Date object
      expect(mockMatDialog.open).toHaveBeenCalledWith(
        jasmine.any(Function), // DialogScheduleTaskComponent
        {
          data: {
            isSelectDueOnly: true,
            targetDay: existingDate, // Should remain as string
            targetTime: existingTime,
          },
        },
      );
    });

    it('should handle midnight times correctly in dialog', () => {
      const midnightResult = {
        date: new Date(2025, 0, 1, 0, 0, 0), // Jan 1, 2025 at midnight
        time: '00:00',
      };
      mockDialogRef.afterClosed.and.returnValue(of(midnightResult));

      component.openScheduleDialog();

      expect(mockStateService.updateDate).toHaveBeenCalledWith('2025-01-01', '00:00');
    });
  });
});
