import { TestBed } from '@angular/core/testing';
import { AddTaskBarParserService } from './add-task-bar-parser.service';
import { AddTaskBarStateService } from './add-task-bar-state.service';
import { ShortSyntaxConfig } from '../../config/global-config.model';
import { Project } from '../../project/project.model';
import { Tag } from '../../tag/tag.model';
import { TaskReminderOptionId } from '../task.model';
import { findSpringForwardSunday } from '../dst.test-helper';
import { getDbDateStr } from '../../../util/get-db-date-str';

describe('AddTaskBarParserService', () => {
  let service: AddTaskBarParserService;
  let mockStateService: jasmine.SpyObj<AddTaskBarStateService>;

  beforeEach(() => {
    const mockStateServiceSpy = jasmine.createSpyObj('AddTaskBarStateService', [
      'updateCleanText',
      'setAutoDetectedProjectId',
      'updateProjectId',
      'updateTagIdsFromTxt',
      'updateNewTagTitles',
      'updateSpent',
      'updateEstimate',
      'updateDate',
      'updateAttachments',
      'updateDeadline',
      'updateDeadlineRemindOption',
      'updateRepeatSetting',
      'clearRepeatSetting',
      'updateSyntaxHighlight',
      'updateRemindOption',
      'isAutoDetected',
      'state',
      'inputTxt',
    ]);

    mockStateServiceSpy.isAutoDetected.and.returnValue(false);
    mockStateServiceSpy.inputTxt.and.returnValue('');

    // Default state return value
    const defaultMockState = {
      projectId: null,
      tagIds: [],
      tagIdsFromTxt: [],
      newTagTitles: [],
      date: null,
      time: null,
      estimate: null,
      cleanText: null,
      deadlineDate: null,
      deadlineTime: null,
      deadlineRemindOption: null,
    };
    mockStateServiceSpy.state.and.returnValue(defaultMockState);

    TestBed.configureTestingModule({
      providers: [
        AddTaskBarParserService,
        { provide: AddTaskBarStateService, useValue: mockStateServiceSpy },
      ],
    });

    service = TestBed.inject(AddTaskBarParserService);
    mockStateService = TestBed.inject(
      AddTaskBarStateService,
    ) as jasmine.SpyObj<AddTaskBarStateService>;
  });

  describe('parseAndUpdateText', () => {
    let mockConfig: ShortSyntaxConfig;
    let mockProjects: Project[];
    let mockTags: Tag[];
    let mockDefaultProject: Project;

    beforeEach(() => {
      mockConfig = {
        isEnableProject: true,
        isEnableDue: true,
        isEnableDeadline: true,
        isEnableTag: true,
      } as ShortSyntaxConfig;

      mockDefaultProject = {
        id: 'default-project',
        title: 'Default Project',
        icon: 'folder',
      } as Project;

      mockProjects = [
        mockDefaultProject,
        { id: 'proj-1', title: 'Project One' } as Project,
        { id: 'proj-2', title: 'Project Two' } as Project,
      ];

      mockTags = [
        { id: 'tag-1', title: 'urgent' } as Tag,
        { id: 'tag-2', title: 'important' } as Tag,
      ];

      // Reset all spy calls before each test
      mockStateService.updateCleanText.calls.reset();
      mockStateService.updateDate.calls.reset();
      mockStateService.updateSpent.calls.reset();
      mockStateService.updateEstimate.calls.reset();
      mockStateService.updateTagIdsFromTxt.calls.reset();
      mockStateService.updateNewTagTitles.calls.reset();
      mockStateService.setAutoDetectedProjectId.calls.reset();
      mockStateService.updateProjectId.calls.reset();
      mockStateService.updateAttachments.calls.reset();
      mockStateService.updateDeadline.calls.reset();
      mockStateService.updateDeadlineRemindOption.calls.reset();
    });

    it('should handle empty text', async () => {
      await service.parseAndUpdateText('', null, [], [], null as any);
      expect(mockStateService.updateCleanText).not.toHaveBeenCalled();
    });

    it('should handle null config', async () => {
      await service.parseAndUpdateText('test task', null, [], [], null as any);
      expect(mockStateService.updateCleanText).not.toHaveBeenCalled();
    });

    it('should ignore stale parse results after resetPreviousResult', async () => {
      const parsePromise = service.parseAndUpdateText(
        'stale task',
        mockConfig,
        mockProjects,
        mockTags,
        mockDefaultProject,
      );

      service.resetPreviousResult();
      await parsePromise;

      expect(mockStateService.updateCleanText).not.toHaveBeenCalled();
    });

    describe('Date Parsing', () => {
      it('should handle default date when no date syntax present and no current state', async () => {
        const defaultDate = '2024-01-15';
        const defaultTime = '09:00';

        // Mock state to return no current date/time
        const mockState = {
          projectId: mockDefaultProject.id,
          tagIds: [],
          tagIdsFromTxt: [],
          newTagTitles: [],
          date: null,
          time: null,
          spent: null,
          estimate: null,
          cleanText: null,
          remindOption: null,
          attachments: [],
          repeat: null,
        };
        mockStateService.state.and.returnValue(mockState);

        await service.parseAndUpdateText(
          'Simple task',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
          defaultDate,
          defaultTime,
        );

        expect(mockStateService.updateDate).toHaveBeenCalled();
        const [date, time] = mockStateService.updateDate.calls.mostRecent().args;
        expect(typeof date).toBe('string');
        expect(date).toBe(defaultDate);
        expect(time).toBe(defaultTime);
      });

      it('should preserve current date/time when no syntax present', async () => {
        const currentDate = '2024-02-20';
        const currentTime = '14:30';

        // Mock state to return current user-selected values
        const mockState = {
          projectId: mockDefaultProject.id,
          tagIds: [],
          tagIdsFromTxt: [],
          newTagTitles: [],
          date: currentDate,
          time: currentTime,
          spent: null,
          estimate: null,
          cleanText: null,
          remindOption: null,
          attachments: [],
          repeat: null,
        };
        mockStateService.state.and.returnValue(mockState);

        await service.parseAndUpdateText(
          'Task without date syntax',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        expect(mockStateService.updateDate).toHaveBeenCalled();
        const [date, time] = mockStateService.updateDate.calls.mostRecent().args;
        expect(date).toBe(currentDate);
        expect(time).toBe(currentTime);
      });

      it('should preserve current date but use default time when no current time', async () => {
        const currentDate = '2024-02-20';
        const defaultTime = '09:00';

        // Mock state with date but no time
        const mockState = {
          projectId: mockDefaultProject.id,
          tagIds: [],
          tagIdsFromTxt: [],
          newTagTitles: [],
          date: currentDate,
          time: null,
          spent: null,
          estimate: null,
          cleanText: null,
          remindOption: null,
          attachments: [],
          repeat: null,
        };
        mockStateService.state.and.returnValue(mockState);

        await service.parseAndUpdateText(
          'Task text',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
          undefined, // no default date
          defaultTime,
        );

        expect(mockStateService.updateDate).toHaveBeenCalled();
        const [date, time] = mockStateService.updateDate.calls.mostRecent().args;
        expect(date).toBe(currentDate);
        expect(time).toBe(defaultTime);
      });

      it('should handle no date or default date', async () => {
        await service.parseAndUpdateText(
          'Simple task',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        expect(mockStateService.updateDate).toHaveBeenCalled();
        const [date, time] = mockStateService.updateDate.calls.mostRecent().args;
        expect(date).toBeNull();
        expect(time).toBeNull();
      });

      it('should test date parsing integration with shortSyntax', async () => {
        // Since shortSyntax is complex and depends on external implementation,
        // we'll test the parser's handling of the parsed results
        await service.parseAndUpdateText(
          'Task with date syntax that may or may not be parsed',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        expect(mockStateService.updateDate).toHaveBeenCalled();
        expect(mockStateService.updateCleanText).toHaveBeenCalled();
      });

      it('should handle default date and time when no syntax is found', async () => {
        const defaultDate = '2024-01-15';
        const defaultTime = '09:00';

        await service.parseAndUpdateText(
          'Plain text task',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
          defaultDate,
          defaultTime,
        );

        expect(mockStateService.updateDate).toHaveBeenCalled();
        const [date, time] = mockStateService.updateDate.calls.mostRecent().args;
        expect(typeof date).toBe('string');
        expect(time).toBe(defaultTime);
      });

      it('should keep a cleared default date cleared when no date syntax is present', async () => {
        const defaultDate = '2024-01-15';
        const defaultTime = '09:00';

        mockStateService.state.and.returnValue({
          projectId: mockDefaultProject.id,
          tagIds: [],
          tagIdsFromTxt: [],
          newTagTitles: [],
          date: null,
          time: null,
          isDateExplicitlyCleared: true,
          spent: null,
          estimate: null,
          cleanText: null,
          remindOption: null,
          attachments: [],
          repeat: null,
        });

        await service.parseAndUpdateText(
          'Task after clearing Today',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
          defaultDate,
          defaultTime,
        );

        expect(mockStateService.updateDate).toHaveBeenCalledWith(null, null);
      });

      it('should keep a cleared default date cleared when unrelated syntax is parsed', async () => {
        const defaultDate = '2024-01-15';

        mockStateService.state.and.returnValue({
          projectId: mockDefaultProject.id,
          tagIds: [],
          tagIdsFromTxt: [],
          newTagTitles: [],
          date: null,
          time: null,
          isDateExplicitlyCleared: true,
          spent: null,
          estimate: null,
          cleanText: null,
          remindOption: null,
          attachments: [],
          repeat: null,
        });

        await service.parseAndUpdateText(
          'Task after clearing Today #urgent',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
          defaultDate,
        );

        expect(mockStateService.updateDate).toHaveBeenCalledWith(null, null);
      });
    });

    describe('Deadline Parsing', () => {
      it('should parse deadline date with !friday', async () => {
        const text = 'Do taxes !friday';
        await service.parseAndUpdateText(
          text,
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        expect(mockStateService.updateDeadline).toHaveBeenCalled();
        const [deadlineDate, deadlineTime] =
          mockStateService.updateDeadline.calls.mostRecent().args;
        expect(typeof deadlineDate).toBe('string');
        expect(deadlineTime).toBeNull();
      });

      it('should ignore bare trailing !', async () => {
        const text = 'Task done!';
        await service.parseAndUpdateText(
          text,
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        expect(mockStateService.updateDeadline).toHaveBeenCalledWith(null, null);
      });

      it('should handle simple hour match like !12', async () => {
        const text = 'Meeting !12';
        await service.parseAndUpdateText(
          text,
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        expect(mockStateService.updateDeadline).toHaveBeenCalled();
        const [deadlineDate, deadlineTime] =
          mockStateService.updateDeadline.calls.mostRecent().args;
        expect(typeof deadlineDate).toBe('string');
        expect(deadlineTime).toBe('12:00');
      });

      it('should preserve a manually selected deadline when unrelated syntax is parsed', async () => {
        mockStateService.state.and.returnValue({
          projectId: null,
          tagIds: [],
          tagIdsFromTxt: [],
          newTagTitles: [],
          date: null,
          time: null,
          estimate: null,
          cleanText: null,
          deadlineDate: '2026-06-10',
          deadlineTime: '10:30',
          deadlineRemindOption: TaskReminderOptionId.m15,
        } as any);

        await service.parseAndUpdateText(
          'Prepare report #urgent',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        expect(mockStateService.updateDeadline).toHaveBeenCalledWith(
          '2026-06-10',
          '10:30',
        );
        expect(mockStateService.updateDeadlineRemindOption).toHaveBeenCalledWith(
          TaskReminderOptionId.m15,
        );
      });

      it('should preserve a user deadline added after a parsed deadline was already cleared', async () => {
        // Run 1: parsed deadline syntax populates the deadline.
        await service.parseAndUpdateText(
          'Do taxes !friday',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        // Run 2: user removes the syntax — previousParseResult flips
        // isDeadlineFromSyntax to false, so a manually-set deadline that
        // appears in state on the NEXT run must be preserved.
        mockStateService.updateDeadline.calls.reset();
        mockStateService.updateDeadlineRemindOption.calls.reset();
        mockStateService.state.and.returnValue({
          projectId: null,
          tagIds: [],
          tagIdsFromTxt: [],
          newTagTitles: [],
          date: null,
          time: null,
          estimate: null,
          cleanText: null,
          deadlineDate: null,
          deadlineTime: null,
          deadlineRemindOption: null,
        } as any);
        await service.parseAndUpdateText(
          'Do taxes',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        // Run 3: user has now manually set a deadline via the dialog and
        // adds more text WITHOUT introducing any deadline syntax.
        mockStateService.updateDeadline.calls.reset();
        mockStateService.updateDeadlineRemindOption.calls.reset();
        mockStateService.state.and.returnValue({
          projectId: null,
          tagIds: [],
          tagIdsFromTxt: [],
          newTagTitles: [],
          date: null,
          time: null,
          estimate: null,
          cleanText: null,
          deadlineDate: '2026-07-01',
          deadlineTime: '09:00',
          deadlineRemindOption: TaskReminderOptionId.m15,
        } as any);
        await service.parseAndUpdateText(
          'Do taxes #urgent',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        expect(mockStateService.updateDeadline).toHaveBeenCalledWith(
          '2026-07-01',
          '09:00',
        );
        expect(mockStateService.updateDeadlineRemindOption).toHaveBeenCalledWith(
          TaskReminderOptionId.m15,
        );
      });

      it('should clear a previously parsed deadline when deadline syntax is removed', async () => {
        await service.parseAndUpdateText(
          'Do taxes !friday',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );
        const [parsedDeadlineDate, parsedDeadlineTime] =
          mockStateService.updateDeadline.calls.mostRecent().args;

        mockStateService.updateDeadline.calls.reset();
        mockStateService.updateDeadlineRemindOption.calls.reset();
        mockStateService.state.and.returnValue({
          projectId: null,
          tagIds: [],
          tagIdsFromTxt: [],
          newTagTitles: [],
          date: null,
          time: null,
          estimate: null,
          cleanText: null,
          deadlineDate: parsedDeadlineDate,
          deadlineTime: parsedDeadlineTime,
          deadlineRemindOption: null,
        } as any);

        await service.parseAndUpdateText(
          'Do taxes #urgent',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        expect(mockStateService.updateDeadline).toHaveBeenCalledWith(null, null);
      });

      it('should clear a syntax-owned deadline when the input is cleared', async () => {
        await service.parseAndUpdateText(
          'Do taxes !friday',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        mockStateService.updateDeadline.calls.reset();
        mockStateService.updateDeadlineRemindOption.calls.reset();

        await service.parseAndUpdateText(
          '',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        expect(mockStateService.updateDeadline).toHaveBeenCalledWith(null, null);
        expect(mockStateService.updateDeadlineRemindOption).toHaveBeenCalledWith(null);
      });

      it('should clear a stale reminder option when deadline syntax is removed', async () => {
        await service.parseAndUpdateText(
          'Do taxes !friday',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );
        const [parsedDeadlineDate, parsedDeadlineTime] =
          mockStateService.updateDeadline.calls.mostRecent().args;

        mockStateService.updateDeadline.calls.reset();
        mockStateService.updateDeadlineRemindOption.calls.reset();
        mockStateService.state.and.returnValue({
          projectId: null,
          tagIds: [],
          tagIdsFromTxt: [],
          newTagTitles: [],
          date: null,
          time: null,
          estimate: null,
          cleanText: null,
          deadlineDate: parsedDeadlineDate,
          deadlineTime: parsedDeadlineTime,
          deadlineRemindOption: TaskReminderOptionId.m15,
        } as any);

        await service.parseAndUpdateText(
          'Do taxes #urgent',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        expect(mockStateService.updateDeadline).toHaveBeenCalledWith(null, null);
        expect(mockStateService.updateDeadlineRemindOption).toHaveBeenCalledWith(null);
      });
    });

    describe('Parsing Integration', () => {
      it('should call updateEstimate when text contains estimate syntax', async () => {
        await service.parseAndUpdateText(
          'Task with estimate 30m',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        expect(mockStateService.updateEstimate).toHaveBeenCalled();
      });

      it('should not call updateEstimate for text without estimate on first parse', async () => {
        await service.parseAndUpdateText(
          'Simple task',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        expect(mockStateService.updateEstimate).not.toHaveBeenCalled();
      });

      it('should not call updateEstimate when typing text without estimate syntax for the first time', async () => {
        // Simulates: user sets estimate via dropdown, then types task title.
        // The parser has no previous result (first parse after empty input).
        // Since the parsed estimate is null and there's no previous result to
        // diff against, updateEstimate should NOT be called to avoid wiping
        // out the dropdown-set value.
        await service.parseAndUpdateText(
          'My new task',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        expect(mockStateService.updateEstimate).not.toHaveBeenCalled();
      });

      it('should call updateSpent when parsing text', async () => {
        await service.parseAndUpdateText(
          'Task with potential time spent',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        expect(mockStateService.updateSpent).toHaveBeenCalled();
      });

      it('should handle null time spent', async () => {
        await service.parseAndUpdateText(
          'Simple task',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        expect(mockStateService.updateSpent).toHaveBeenCalledWith(null);
      });
    });

    describe('Basic Parsing Tests', () => {
      it('should update tags when parsing text', async () => {
        await service.parseAndUpdateText(
          'Task with tags',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        expect(mockStateService.updateTagIdsFromTxt).toHaveBeenCalled();
        expect(mockStateService.updateNewTagTitles).toHaveBeenCalled();
      });

      it('should handle auto-detected projects', async () => {
        mockStateService.isAutoDetected.and.returnValue(false);

        await service.parseAndUpdateText(
          'Simple task',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        // Should call update methods
        expect(mockStateService.updateCleanText).toHaveBeenCalled();
        expect(mockStateService.updateDate).toHaveBeenCalled();
      });

      it('should handle text with clean text update', async () => {
        await service.parseAndUpdateText(
          'Task text',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        expect(mockStateService.updateCleanText).toHaveBeenCalledWith('Task text');
      });

      it('should handle edge cases gracefully', async () => {
        const longText = 'Task ' + 'a'.repeat(1000);

        await expectAsync(
          service.parseAndUpdateText(
            longText,
            mockConfig,
            mockProjects,
            mockTags,
            mockDefaultProject,
          ),
        ).not.toBeRejected();
      });

      it('should handle empty arrays for projects and tags', async () => {
        await service.parseAndUpdateText(
          'Task with no matching items',
          mockConfig,
          [],
          [],
          mockDefaultProject,
        );

        expect(mockStateService.updateTagIdsFromTxt).toHaveBeenCalled();
        expect(mockStateService.updateNewTagTitles).toHaveBeenCalled();
      });

      it('should handle special characters in task text', async () => {
        await service.parseAndUpdateText(
          'Task with special chars !@#$%^&*()',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        expect(mockStateService.updateCleanText).toHaveBeenCalled();
      });
    });
  });

  describe('resetPreviousResult', () => {
    it('should reset previous result without error', async () => {
      expect(() => service.resetPreviousResult()).not.toThrow();
    });
  });

  describe('removeShortSyntaxFromInput', () => {
    it('should return same input for empty string', async () => {
      expect(service.removeShortSyntaxFromInput('', 'tags')).toBe('');
    });

    describe('tags removal', () => {
      it('should remove specific tag', async () => {
        const input = 'Task #important #urgent';
        const result = service.removeShortSyntaxFromInput(input, 'tags', 'important');
        expect(result).toBe('Task #urgent');
      });

      it('should remove all tags when no specific tag provided', async () => {
        const input = 'Task #important #urgent #todo';
        const result = service.removeShortSyntaxFromInput(input, 'tags');
        expect(result).toBe('Task');
      });

      it('should handle tag removal case insensitively', async () => {
        const input = 'Task #Important #URGENT';
        const result = service.removeShortSyntaxFromInput(input, 'tags', 'important');
        expect(result).toBe('Task #URGENT');
      });

      it('should handle tags at the beginning of input', async () => {
        const input = '#urgent Task content';
        const result = service.removeShortSyntaxFromInput(input, 'tags', 'urgent');
        expect(result).toBe('Task content');
      });

      it('should handle tags at the end of input', async () => {
        const input = 'Task content #urgent';
        const result = service.removeShortSyntaxFromInput(input, 'tags', 'urgent');
        expect(result).toBe('Task content');
      });
    });

    describe('removal from the ranges the parser consumed', () => {
      const cfg = {
        isEnableProject: true,
        isEnableDue: true,
        isEnableDeadline: true,
        isEnableTag: true,
      } as ShortSyntaxConfig;
      const defaultProject = {
        id: 'default-project',
        title: 'Default Project',
      } as Project;
      const baseState = {
        projectId: 'default-project',
        tagIds: [],
        tagIdsFromTxt: [],
        newTagTitles: [],
        date: null,
        time: null,
        spent: null,
        estimate: null,
        cleanText: null,
        remindOption: null,
        attachments: [],
        repeat: null,
        deadlineDate: null,
        deadlineTime: null,
        deadlineRemindOption: null,
      };

      const parse = async (text: string): Promise<void> => {
        mockStateService.state.and.returnValue(baseState as any);
        await service.parseAndUpdateText(text, cfg, [], [], defaultProject);
      };

      // A whitespace-delimited fallback truncates these, leaving the tail words
      // behind in the task title
      it('should remove a multi-word due token whole', async () => {
        const input = 'Call mom @next friday';
        await parse(input);
        expect(service.removeShortSyntaxFromInput(input, 'date')).toBe('Call mom');
      });

      it('should remove a recurrence phrase whole when clearing the date', async () => {
        const input = 'Water plants @every 2 fridays';
        await parse(input);
        expect(service.removeShortSyntaxFromInput(input, 'date')).toBe('Water plants');
      });

      it('should remove a multi-word deadline token whole', async () => {
        const input = 'Taxes !next friday';
        await parse(input);
        expect(service.removeShortSyntaxFromInput(input, 'deadline')).toBe('Taxes');
      });

      it('should leave the input alone when the parser consumed nothing of that type', async () => {
        const input = 'Water plants @every 2 fridays';
        await parse(input);
        expect(service.removeShortSyntaxFromInput(input, 'deadline')).toBe(input);
      });

      it('should fall back to token removal when the ranges are for other text', async () => {
        await parse('Call mom @next friday');
        // Ranges pinned to the parsed text, so a newer input must not use them
        expect(service.removeShortSyntaxFromInput('Call dad @today', 'date')).toBe(
          'Call dad',
        );
      });

      // Offsets applied to text they were not computed for cut at arbitrary
      // positions — the whitespace collapse hides that in same-length inputs
      it('should not slice an unrelated text with stale ranges', async () => {
        await parse('a @next friday');
        expect(
          service.removeShortSyntaxFromInput('Buy milk and eggs for dinner', 'date'),
        ).toBe('Buy milk and eggs for dinner');
      });

      // An estimate inside a due phrase splits it into two ranges of one type,
      // so the deletions have to run back to front or the second one is shifted
      it('should remove two ranges of the same type without shifting', async () => {
        const input = 'Task @tomorrow 1h evening';
        await parse(input);
        expect(service.removeShortSyntaxFromInput(input, 'date')).toBe('Task 1h');
      });
    });

    describe('date removal', () => {
      it('should remove date syntax', async () => {
        const input = 'Task @today @16:30 @2024-01-15';
        const result = service.removeShortSyntaxFromInput(input, 'date');
        expect(result).toBe('Task');
      });

      it('should handle complex date formats', async () => {
        const input = 'Meeting @tomorrow @next-week @2024-12-25';
        const result = service.removeShortSyntaxFromInput(input, 'date');
        expect(result).toBe('Meeting');
      });

      it('should handle date at beginning', async () => {
        const input = '@today Task content';
        const result = service.removeShortSyntaxFromInput(input, 'date');
        expect(result).toBe('Task content');
      });

      it('should handle date at end', async () => {
        const input = 'Task content @today';
        const result = service.removeShortSyntaxFromInput(input, 'date');
        expect(result).toBe('Task content');
      });
    });

    describe('deadline removal', () => {
      it('should remove deadline syntax', async () => {
        const input = 'Task !today !16:30 !2024-01-15';
        const result = service.removeShortSyntaxFromInput(input, 'deadline');
        expect(result).toBe('Task');
      });

      it('should handle complex date formats', async () => {
        const input = 'Meeting !tomorrow !next-week !2024-12-25';
        const result = service.removeShortSyntaxFromInput(input, 'deadline');
        expect(result).toBe('Meeting');
      });

      it('should handle deadline at beginning', async () => {
        const input = '!today Task content';
        const result = service.removeShortSyntaxFromInput(input, 'deadline');
        expect(result).toBe('Task content');
      });

      it('should handle deadline at end', async () => {
        const input = 'Task content !today';
        const result = service.removeShortSyntaxFromInput(input, 'deadline');
        expect(result).toBe('Task content');
      });
    });

    describe('estimate removal', () => {
      it('should remove various time estimate formats', async () => {
        const testCases = [
          { input: 'Task t30m', expected: 'Task' },
          { input: 'Task 1h', expected: 'Task' },
          { input: 'Task 30m/1h', expected: 'Task' },
          { input: 'Task t1.5h', expected: 'Task' },
          { input: 'Task 45m', expected: 'Task' },
          { input: 'Task t30m other text', expected: 'Task other text' },
          { input: 'Task 1h/', expected: 'Task' },
          { input: 'Task 1h/ between', expected: 'Task between' },
          { input: '1h/ Task', expected: 'Task' },
        ];

        testCases.forEach(({ input, expected }) => {
          const result = service.removeShortSyntaxFromInput(input, 'estimate');
          expect(result).toBe(expected);
        });
      });

      it('should handle multiple time estimates', async () => {
        const input = 'Task t30m another t1h final';
        const result = service.removeShortSyntaxFromInput(input, 'estimate');
        expect(result).toBe('Task another final');
      });

      it('should handle time estimate at beginning', async () => {
        const input = 't30m Task content';
        const result = service.removeShortSyntaxFromInput(input, 'estimate');
        expect(result).toBe('Task content');
      });

      it('should handle time estimate at end', async () => {
        const input = 'Task content t30m';
        const result = service.removeShortSyntaxFromInput(input, 'estimate');
        expect(result).toBe('Task content');
      });

      it('should handle decimal hours', async () => {
        const input = 'Task t2.5h content';
        const result = service.removeShortSyntaxFromInput(input, 'estimate');
        expect(result).toBe('Task content');
      });

      it('should not handle days format (removed unit)', async () => {
        const input = 'Task 3d content';
        const result = service.removeShortSyntaxFromInput(input, 'estimate');
        expect(result).toBe('Task 3d content');
      });
    });

    it('should clean up extra whitespace', async () => {
      const input = 'Task   #tag   @today   t30m   end';
      const result = service.removeShortSyntaxFromInput(input, 'tags');
      expect(result).toBe('Task @today t30m end');
    });

    it('should trim final result', async () => {
      const input = '  #tag Task #another  ';
      const result = service.removeShortSyntaxFromInput(input, 'tags');
      expect(result).toBe('Task');
    });

    it('should handle mixed removal scenarios', async () => {
      // Remove all tags and clean up spacing
      const input = 'Task #urgent #important content #todo';
      const result = service.removeShortSyntaxFromInput(input, 'tags');
      expect(result).toBe('Task content');
    });

    it('should handle empty input after removal', async () => {
      const input = '#tag1 #tag2';
      const result = service.removeShortSyntaxFromInput(input, 'tags');
      expect(result).toBe('');
    });

    it('should handle whitespace-only input after removal', async () => {
      const input = '  #tag1   #tag2  ';
      const result = service.removeShortSyntaxFromInput(input, 'tags');
      expect(result).toBe('');
    });
  });

  describe('Timezone-specific Date Handling', () => {
    let mockConfig: ShortSyntaxConfig;
    let mockProjects: Project[];
    let mockTags: Tag[];
    let mockDefaultProject: Project;

    beforeEach(() => {
      mockConfig = {
        isEnableProject: true,
        isEnableDue: true,
        isEnableTag: true,
      } as ShortSyntaxConfig;

      mockDefaultProject = {
        id: 'default-project',
        title: 'Default Project',
        icon: 'folder',
      } as Project;

      mockProjects = [
        mockDefaultProject,
        { id: 'proj-1', title: 'Project One' } as Project,
        { id: 'proj-2', title: 'Project Two' } as Project,
      ];

      mockTags = [
        { id: 'tag-1', title: 'urgent' } as Tag,
        { id: 'tag-2', title: 'important' } as Tag,
      ];
    });

    it('should handle date strings consistently across timezones', async () => {
      const dateStr = '2025-01-15';
      const timeStr = '14:30';

      // Mock state to return the date and time
      const mockState = {
        projectId: mockDefaultProject.id,
        tagIds: [],
        tagIdsFromTxt: [],
        newTagTitles: [],
        date: dateStr,
        time: timeStr,
        spent: null,
        estimate: null,
        cleanText: null,
        remindOption: null,
        attachments: [],
        repeat: null,
      };
      mockStateService.state.and.returnValue(mockState);

      await service.parseAndUpdateText(
        'Task with date',
        mockConfig,
        mockProjects,
        mockTags,
        mockDefaultProject,
        dateStr,
        timeStr,
      );

      // Should preserve the date string as-is
      expect(mockStateService.updateDate).toHaveBeenCalledWith(dateStr, timeStr);
    });

    it('should handle dates near DST transitions', async () => {
      // Test spring forward (March DST transition in many timezones)
      const springDateStr = '2024-03-10';
      const springTimeStr = '02:30';

      const mockState = {
        projectId: mockDefaultProject.id,
        tagIds: [],
        tagIdsFromTxt: [],
        newTagTitles: [],
        date: null,
        time: null,
        spent: null,
        estimate: null,
        cleanText: null,
        remindOption: null,
        attachments: [],
        repeat: null,
      };
      mockStateService.state.and.returnValue(mockState);

      await service.parseAndUpdateText(
        'DST test task',
        mockConfig,
        mockProjects,
        mockTags,
        mockDefaultProject,
        springDateStr,
        springTimeStr,
      );

      expect(mockStateService.updateDate).toHaveBeenCalledWith(
        springDateStr,
        springTimeStr,
      );
    });

    it('should handle dates at year boundaries', async () => {
      // Test New Year's Eve
      const newYearDateStr = '2024-12-31';
      const newYearTimeStr = '23:59';

      const mockState = {
        projectId: mockDefaultProject.id,
        tagIds: [],
        tagIdsFromTxt: [],
        newTagTitles: [],
        date: null,
        time: null,
        spent: null,
        estimate: null,
        cleanText: null,
        remindOption: null,
        attachments: [],
        repeat: null,
      };
      mockStateService.state.and.returnValue(mockState);

      await service.parseAndUpdateText(
        'New Year task',
        mockConfig,
        mockProjects,
        mockTags,
        mockDefaultProject,
        newYearDateStr,
        newYearTimeStr,
      );

      expect(mockStateService.updateDate).toHaveBeenCalledWith(
        newYearDateStr,
        newYearTimeStr,
      );
    });

    it('should maintain date consistency when parsing date-only strings', async () => {
      const dateStr = '2025-01-01';

      const mockState = {
        projectId: mockDefaultProject.id,
        tagIds: [],
        tagIdsFromTxt: [],
        newTagTitles: [],
        date: null,
        time: null,
        spent: null,
        estimate: null,
        cleanText: null,
        remindOption: null,
        attachments: [],
        repeat: null,
      };
      mockStateService.state.and.returnValue(mockState);

      await service.parseAndUpdateText(
        'Task',
        mockConfig,
        mockProjects,
        mockTags,
        mockDefaultProject,
        dateStr,
        undefined,
      );

      // Date should be passed through without modification
      expect(mockStateService.updateDate).toHaveBeenCalledWith(dateStr, null);
    });

    it('should handle midnight time correctly', async () => {
      const dateStr = '2025-01-15';
      const midnightTime = '00:00';

      const mockState = {
        projectId: mockDefaultProject.id,
        tagIds: [],
        tagIdsFromTxt: [],
        newTagTitles: [],
        date: null,
        time: null,
        spent: null,
        estimate: null,
        cleanText: null,
        remindOption: null,
        attachments: [],
        repeat: null,
      };
      mockStateService.state.and.returnValue(mockState);

      await service.parseAndUpdateText(
        'Midnight task',
        mockConfig,
        mockProjects,
        mockTags,
        mockDefaultProject,
        dateStr,
        midnightTime,
      );

      expect(mockStateService.updateDate).toHaveBeenCalledWith(dateStr, midnightTime);
    });
  });

  describe('private helper methods', () => {
    // Access private methods for testing
    let serviceAny: any;

    beforeEach(() => {
      serviceAny = service as any;
    });

    describe('_arraysEqual', () => {
      it('should return true for equal arrays', async () => {
        expect(serviceAny._arraysEqual(['a', 'b'], ['a', 'b'])).toBe(true);
        expect(serviceAny._arraysEqual([], [])).toBe(true);
        expect(serviceAny._arraysEqual([1, 2, 3], [1, 2, 3])).toBe(true);
      });

      it('should return false for different arrays', async () => {
        expect(serviceAny._arraysEqual(['a', 'b'], ['a', 'c'])).toBe(false);
        expect(serviceAny._arraysEqual(['a'], ['a', 'b'])).toBe(false);
        expect(serviceAny._arraysEqual([1, 2], [2, 1])).toBe(false);
        expect(serviceAny._arraysEqual([1, 2], [])).toBe(false);
        expect(serviceAny._arraysEqual([], [1])).toBe(false);
      });

      it('should handle null and undefined values', async () => {
        expect(serviceAny._arraysEqual([null], [null])).toBe(true);
        expect(serviceAny._arraysEqual([undefined], [undefined])).toBe(true);
        expect(serviceAny._arraysEqual([null], [undefined])).toBe(false);
      });
    });

    describe('_datesEqual', () => {
      it('should return true for equal date strings', async () => {
        const dateStr1 = '2024-01-15';
        const dateStr2 = '2024-01-15';
        expect(serviceAny._datesEqual(dateStr1, dateStr2)).toBe(true);
        expect(serviceAny._datesEqual(null, null)).toBe(true);
      });

      it('should return false for different date strings', async () => {
        const dateStr1 = '2024-01-15';
        const dateStr2 = '2024-01-16';
        expect(serviceAny._datesEqual(dateStr1, dateStr2)).toBe(false);
        expect(serviceAny._datesEqual(dateStr1, null)).toBe(false);
        expect(serviceAny._datesEqual(null, dateStr1)).toBe(false);
      });

      it('should handle same date strings', async () => {
        const dateStr1 = '2024-01-15';
        const dateStr2 = '2024-01-15';
        expect(serviceAny._datesEqual(dateStr1, dateStr2)).toBe(true);
      });

      it('should handle different date strings', async () => {
        const dateStr1 = '2024-01-15';
        const dateStr2 = '2024-01-16';
        expect(serviceAny._datesEqual(dateStr1, dateStr2)).toBe(false);
      });
    });
  });

  describe('URL Attachment Integration', () => {
    let mockConfig: ShortSyntaxConfig;
    let mockProjects: Project[];
    let mockTags: Tag[];
    let mockDefaultProject: Project;

    beforeEach(() => {
      mockConfig = {
        isEnableProject: true,
        isEnableDue: true,
        isEnableTag: true,
        urlBehavior: 'extract',
      } as ShortSyntaxConfig;

      mockDefaultProject = {
        id: 'default-project',
        title: 'Default Project',
      } as Project;

      mockProjects = [mockDefaultProject];
      mockTags = [];

      // Reset all spy calls
      mockStateService.updateCleanText.calls.reset();
      mockStateService.updateAttachments.calls.reset();
    });

    it('should extract single HTTPS URL and update state', async () => {
      const mockState = {
        projectId: 'default-project',
        tagIds: [],
        tagIdsFromTxt: [],
        newTagTitles: [],
        date: null,
        time: null,
        spent: null,
        estimate: null,
        cleanText: null,
        remindOption: null,
        attachments: [],
        repeat: null,
      };
      mockStateService.state.and.returnValue(mockState);

      await service.parseAndUpdateText(
        'Task https://example.com',
        mockConfig,
        mockProjects,
        mockTags,
        mockDefaultProject,
      );

      expect(mockStateService.updateAttachments).toHaveBeenCalledTimes(1);
      const attachments = mockStateService.updateAttachments.calls.mostRecent().args[0];
      expect(attachments.length).toBe(1);
      expect(attachments[0].path).toBe('https://example.com');
      expect(attachments[0].type).toBe('LINK');
      expect(attachments[0].icon).toBe('bookmark');
      expect(mockStateService.updateCleanText).toHaveBeenCalledWith('Task');
    });

    it('should extract file:// URL with FILE type', async () => {
      const mockState = {
        projectId: 'default-project',
        tagIds: [],
        tagIdsFromTxt: [],
        newTagTitles: [],
        date: null,
        time: null,
        spent: null,
        estimate: null,
        cleanText: null,
        remindOption: null,
        attachments: [],
        repeat: null,
      };
      mockStateService.state.and.returnValue(mockState);

      await service.parseAndUpdateText(
        'Document file:///home/user/doc.pdf',
        mockConfig,
        mockProjects,
        mockTags,
        mockDefaultProject,
      );

      expect(mockStateService.updateAttachments).toHaveBeenCalledTimes(1);
      const attachments = mockStateService.updateAttachments.calls.mostRecent().args[0];
      expect(attachments.length).toBe(1);
      expect(attachments[0].path).toBe('file:///home/user/doc.pdf');
      expect(attachments[0].type).toBe('FILE');
      expect(attachments[0].icon).toBe('insert_drive_file');
      expect(mockStateService.updateCleanText).toHaveBeenCalledWith('Document');
    });

    it('should detect image URLs as IMG type', async () => {
      const mockState = {
        projectId: 'default-project',
        tagIds: [],
        tagIdsFromTxt: [],
        newTagTitles: [],
        date: null,
        time: null,
        spent: null,
        estimate: null,
        cleanText: null,
        remindOption: null,
        attachments: [],
        repeat: null,
      };
      mockStateService.state.and.returnValue(mockState);

      await service.parseAndUpdateText(
        'Screenshot https://example.com/image.png',
        mockConfig,
        mockProjects,
        mockTags,
        mockDefaultProject,
      );

      expect(mockStateService.updateAttachments).toHaveBeenCalledTimes(1);
      const attachments = mockStateService.updateAttachments.calls.mostRecent().args[0];
      expect(attachments.length).toBe(1);
      expect(attachments[0].type).toBe('IMG');
      expect(attachments[0].icon).toBe('image');
    });

    it('should extract multiple URLs', async () => {
      const mockState = {
        projectId: 'default-project',
        tagIds: [],
        tagIdsFromTxt: [],
        newTagTitles: [],
        date: null,
        time: null,
        spent: null,
        estimate: null,
        cleanText: null,
        remindOption: null,
        attachments: [],
        repeat: null,
      };
      mockStateService.state.and.returnValue(mockState);

      await service.parseAndUpdateText(
        'Links https://example.com www.test.org',
        mockConfig,
        mockProjects,
        mockTags,
        mockDefaultProject,
      );

      expect(mockStateService.updateAttachments).toHaveBeenCalledTimes(1);
      const attachments = mockStateService.updateAttachments.calls.mostRecent().args[0];
      expect(attachments.length).toBe(2);
      expect(attachments[0].path).toBe('https://example.com');
      expect(attachments[1].path).toBe('//www.test.org');
      expect(mockStateService.updateCleanText).toHaveBeenCalledWith('Links');
    });

    it('should work with combined short syntax (URL + date + tag + estimate)', async () => {
      const mockState = {
        projectId: 'default-project',
        tagIds: [],
        tagIdsFromTxt: [],
        newTagTitles: [],
        date: null,
        time: null,
        spent: null,
        estimate: null,
        cleanText: null,
        remindOption: null,
        attachments: [],
        repeat: null,
      };
      mockStateService.state.and.returnValue(mockState);

      const mockTag = { id: 'urgent-id', title: 'urgent' } as Tag;
      const tagsWithUrgent = [mockTag];

      await service.parseAndUpdateText(
        'Task https://github.com/pr/123 @tomorrow #urgent 30m',
        mockConfig,
        mockProjects,
        tagsWithUrgent,
        mockDefaultProject,
      );

      // Should extract URL
      expect(mockStateService.updateAttachments).toHaveBeenCalledTimes(1);
      const attachments = mockStateService.updateAttachments.calls.mostRecent().args[0];
      expect(attachments.length).toBe(1);
      expect(attachments[0].path).toBe('https://github.com/pr/123');

      // Should clean title
      expect(mockStateService.updateCleanText).toHaveBeenCalledWith('Task');

      // Should parse other syntax
      expect(mockStateService.updateDate).toHaveBeenCalled();
      expect(mockStateService.updateEstimate).toHaveBeenCalledWith(1800000); // 30m in ms
      expect(mockStateService.updateTagIdsFromTxt).toHaveBeenCalledWith(['urgent-id']);
    });

    it('should not extract URLs from empty text', async () => {
      const mockState = {
        projectId: 'default-project',
        tagIds: [],
        tagIdsFromTxt: [],
        newTagTitles: [],
        date: null,
        time: null,
        spent: null,
        estimate: null,
        cleanText: null,
        remindOption: null,
        attachments: [],
        repeat: null,
      };
      mockStateService.state.and.returnValue(mockState);

      await service.parseAndUpdateText(
        '',
        mockConfig,
        mockProjects,
        mockTags,
        mockDefaultProject,
      );

      expect(mockStateService.updateAttachments).not.toHaveBeenCalled();
    });

    it('should update attachments when URL changes', async () => {
      const mockState = {
        projectId: 'default-project',
        tagIds: [],
        tagIdsFromTxt: [],
        newTagTitles: [],
        date: null,
        time: null,
        spent: null,
        estimate: null,
        cleanText: null,
        remindOption: null,
        attachments: [],
        repeat: null,
      };
      mockStateService.state.and.returnValue(mockState);

      // First parse
      await service.parseAndUpdateText(
        'Task https://example.com',
        mockConfig,
        mockProjects,
        mockTags,
        mockDefaultProject,
      );

      expect(mockStateService.updateAttachments).toHaveBeenCalledTimes(1);
      const firstAttachments =
        mockStateService.updateAttachments.calls.mostRecent().args[0];
      expect(firstAttachments.length).toBe(1);
      expect(firstAttachments[0].path).toBe('https://example.com');

      // Change URL
      await service.parseAndUpdateText(
        'Task https://different.com',
        mockConfig,
        mockProjects,
        mockTags,
        mockDefaultProject,
      );

      expect(mockStateService.updateAttachments).toHaveBeenCalledTimes(2);
      const secondAttachments =
        mockStateService.updateAttachments.calls.mostRecent().args[0];
      expect(secondAttachments.length).toBe(1);
      expect(secondAttachments[0].path).toBe('https://different.com');
    });

    it('should clear attachments when URL removed from text', async () => {
      const mockState = {
        projectId: 'default-project',
        tagIds: [],
        tagIdsFromTxt: [],
        newTagTitles: [],
        date: null,
        time: null,
        spent: null,
        estimate: null,
        cleanText: null,
        remindOption: null,
        attachments: [],
        repeat: null,
      };
      mockStateService.state.and.returnValue(mockState);

      // First parse with URL
      await service.parseAndUpdateText(
        'Task https://example.com',
        mockConfig,
        mockProjects,
        mockTags,
        mockDefaultProject,
      );

      expect(mockStateService.updateAttachments).toHaveBeenCalledTimes(1);

      // Remove URL from text
      await service.parseAndUpdateText(
        'Task',
        mockConfig,
        mockProjects,
        mockTags,
        mockDefaultProject,
      );

      expect(mockStateService.updateAttachments).toHaveBeenCalledTimes(2);
      const attachments = mockStateService.updateAttachments.calls.mostRecent().args[0];
      expect(attachments.length).toBe(0);
    });

    it('should handle www URLs correctly', async () => {
      const mockState = {
        projectId: 'default-project',
        tagIds: [],
        tagIdsFromTxt: [],
        newTagTitles: [],
        date: null,
        time: null,
        spent: null,
        estimate: null,
        cleanText: null,
        remindOption: null,
        attachments: [],
        repeat: null,
      };
      mockStateService.state.and.returnValue(mockState);

      await service.parseAndUpdateText(
        'Task www.example.com',
        mockConfig,
        mockProjects,
        mockTags,
        mockDefaultProject,
      );

      expect(mockStateService.updateAttachments).toHaveBeenCalledTimes(1);
      const attachments = mockStateService.updateAttachments.calls.mostRecent().args[0];
      expect(attachments.length).toBe(1);
      expect(attachments[0].path).toBe('//www.example.com');
      expect(attachments[0].type).toBe('LINK');
    });
  });

  describe('repeat short syntax', () => {
    const MENU_PICK = { type: 'PRESET' as const, quickSetting: 'DAILY' as const };
    const cfg = {
      isEnableProject: true,
      isEnableDue: true,
      isEnableTag: true,
    } as ShortSyntaxConfig;
    const defaultProject = { id: 'default-project', title: 'Default Project' } as Project;
    const baseState = {
      projectId: 'default-project',
      tagIds: [],
      tagIdsFromTxt: [],
      newTagTitles: [],
      date: null,
      time: null,
      spent: null,
      estimate: null,
      cleanText: null,
      remindOption: null,
      attachments: [],
      repeat: null,
      deadlineDate: null,
      deadlineTime: null,
      deadlineRemindOption: null,
    };

    it('should publish the typed time when the anchor day springs forward', async () => {
      // Guards the dueTimeStr passthrough: on a DST spring-forward day the
      // typed time does not exist, so deriving the time from the dueWithTime
      // timestamp reads back an hour shifted, and that string becomes the
      // repeat config's startTime. Only a real transition day can tell the
      // passthrough and the timestamp read-back apart.
      const gap = findSpringForwardSunday(2026);
      if (!gap) {
        // Timezone without a spring-forward transition (UTC, Tokyo).
        return;
      }
      const friday = new Date(gap.sunday);
      friday.setDate(friday.getDate() - 2);
      friday.setHours(10, 0, 0, 0);
      jasmine.clock().install();
      jasmine.clock().mockDate(friday);
      try {
        mockStateService.state.and.returnValue(baseState as any);
        await service.parseAndUpdateText(
          `Backup @every sunday ${gap.missingHour}:30am`,
          cfg,
          [],
          [],
          defaultProject,
        );
        expect(mockStateService.updateDate).toHaveBeenCalledWith(
          getDbDateStr(gap.sunday),
          `0${gap.missingHour}:30`,
        );
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('should set repeat setting from "@every friday"', async () => {
      mockStateService.state.and.returnValue(baseState as any);
      await service.parseAndUpdateText(
        'Water plants @every friday',
        cfg,
        [],
        [],
        defaultProject,
      );
      expect(mockStateService.updateRepeatSetting).toHaveBeenCalledWith({
        type: 'PRESET',
        quickSetting: 'WEEKLY_CURRENT_WEEKDAY',
      });
      expect(mockStateService.updateCleanText).toHaveBeenCalledWith('Water plants');
    });

    it('should set an interval repeat setting from "@every 2 weeks"', async () => {
      mockStateService.state.and.returnValue(baseState as any);
      await service.parseAndUpdateText(
        'Review @every 2 weeks',
        cfg,
        [],
        [],
        defaultProject,
      );
      expect(mockStateService.updateRepeatSetting).toHaveBeenCalledWith({
        type: 'INTERVAL',
        repeatCycle: 'WEEKLY',
        repeatEvery: 2,
      });
      expect(mockStateService.updateCleanText).toHaveBeenCalledWith('Review');
    });

    it('should not re-publish an unchanged interval on the next keystroke', async () => {
      mockStateService.state.and.returnValue(baseState as any);
      await service.parseAndUpdateText(
        'Review @every 2 weeks',
        cfg,
        [],
        [],
        defaultProject,
      );
      mockStateService.state.and.returnValue({
        ...baseState,
        repeat: { type: 'INTERVAL', repeatCycle: 'WEEKLY', repeatEvery: 2 },
      } as any);
      mockStateService.updateRepeatSetting.calls.reset();
      await service.parseAndUpdateText(
        'Review it @every 2 weeks',
        cfg,
        [],
        [],
        defaultProject,
      );
      expect(mockStateService.updateRepeatSetting).not.toHaveBeenCalled();
    });

    it('should collapse an interval of 1 to the matching preset', async () => {
      mockStateService.state.and.returnValue(baseState as any);
      await service.parseAndUpdateText(
        'Review @every 1 week',
        cfg,
        [],
        [],
        defaultProject,
      );
      expect(mockStateService.updateRepeatSetting).toHaveBeenCalledWith({
        type: 'PRESET',
        quickSetting: 'WEEKLY_CURRENT_WEEKDAY',
      });
    });

    it('should clear the repeat setting when the syntax is removed again', async () => {
      mockStateService.state.and.returnValue(baseState as any);
      await service.parseAndUpdateText(
        'Water plants @every friday',
        cfg,
        [],
        [],
        defaultProject,
      );
      mockStateService.state.and.returnValue({
        ...baseState,
        repeat: { type: 'PRESET', quickSetting: 'WEEKLY_CURRENT_WEEKDAY' },
      } as any);
      await service.parseAndUpdateText('Water plants', cfg, [], [], defaultProject);
      expect(mockStateService.clearRepeatSetting).toHaveBeenCalled();
    });

    it('should clear a syntax-set repeat setting when the input is emptied', async () => {
      mockStateService.state.and.returnValue(baseState as any);
      await service.parseAndUpdateText(
        'Water plants @every friday',
        cfg,
        [],
        [],
        defaultProject,
      );
      await service.parseAndUpdateText('', cfg, [], [], defaultProject);
      expect(mockStateService.clearRepeatSetting).toHaveBeenCalled();
    });

    it('should strip the phrase a menu pick contradicts', async () => {
      mockStateService.state.and.returnValue(baseState as any);
      const input = 'Water plants @every 2 weeks';
      mockStateService.inputTxt.and.returnValue(input);
      await service.parseAndUpdateText(input, cfg, [], [], defaultProject);

      service.applyUserRepeatPick(MENU_PICK);

      expect(mockStateService.updateRepeatSetting).toHaveBeenCalledWith(
        MENU_PICK,
        'Water plants',
      );
    });

    it('should strip the time the phrase absorbed along with it', async () => {
      // The recurrence consumed "@daily 6am" whole, so removing only the phrase
      // orphans "6am" into the title of the task and of its repeat config
      mockStateService.state.and.returnValue(baseState as any);
      const input = 'Journal @daily 6am';
      mockStateService.inputTxt.and.returnValue(input);
      await service.parseAndUpdateText(input, cfg, [], [], defaultProject);

      service.applyUserRepeatPick(MENU_PICK);

      expect(mockStateService.updateRepeatSetting).toHaveBeenCalledWith(
        MENU_PICK,
        'Journal',
      );
    });

    it('should strip the absorbed time when clearing the recurrence too', async () => {
      mockStateService.state.and.returnValue(baseState as any);
      const input = 'Call @every friday 3pm';
      await service.parseAndUpdateText(input, cfg, [], [], defaultProject);

      expect(service.removeShortSyntaxFromInput(input, 'repeat')).toBe('Call');
    });

    it('should keep the date the stripped phrase anchored', async () => {
      // The pick takes the whole due token with it, so the date that token
      // produced lives on in the state alone — the follow-up parse must not
      // read its absence from the text as the user clearing it
      mockStateService.state.and.returnValue(baseState as any);
      const input = 'Journal @daily 6am';
      mockStateService.inputTxt.and.returnValue(input);
      await service.parseAndUpdateText(input, cfg, [], [], defaultProject);
      const [anchoredDate, anchoredTime] = mockStateService.updateDate.calls.mostRecent()
        .args as [string, string];

      service.applyUserRepeatPick(MENU_PICK);
      mockStateService.state.and.returnValue({
        ...baseState,
        repeat: MENU_PICK,
        date: anchoredDate,
        time: anchoredTime,
      } as any);
      mockStateService.updateDate.calls.reset();

      await service.parseAndUpdateText('Journal', cfg, [], [], defaultProject);

      expect(anchoredTime).toBe('06:00');
      expect(mockStateService.updateDate).not.toHaveBeenCalled();
    });

    it('should leave a plain date alone when a recurrence is picked', async () => {
      // A date the user typed is not what the repeat control overrides — only a
      // recurrence in the text is, and this text has none
      mockStateService.state.and.returnValue(baseState as any);
      const input = 'Call mom @tomorrow';
      mockStateService.inputTxt.and.returnValue(input);
      await service.parseAndUpdateText(input, cfg, [], [], defaultProject);

      service.applyUserRepeatPick(MENU_PICK);

      expect(mockStateService.updateRepeatSetting).toHaveBeenCalledWith(MENU_PICK, input);
    });

    it('should keep a menu pick that replaced a parsed recurrence phrase', async () => {
      // The pick strips the phrase it contradicts, so the follow-up parse sees
      // it vanish — which must not be read as "the user deleted their syntax"
      mockStateService.state.and.returnValue(baseState as any);
      mockStateService.inputTxt.and.returnValue('Water plants @every 2 weeks');
      await service.parseAndUpdateText(
        'Water plants @every 2 weeks',
        cfg,
        [],
        [],
        defaultProject,
      );

      service.applyUserRepeatPick(MENU_PICK);
      mockStateService.state.and.returnValue({ ...baseState, repeat: MENU_PICK } as any);
      mockStateService.updateRepeatSetting.calls.reset();

      await service.parseAndUpdateText('Water plants', cfg, [], [], defaultProject);

      expect(mockStateService.clearRepeatSetting).not.toHaveBeenCalled();
      expect(mockStateService.updateRepeatSetting).not.toHaveBeenCalled();
    });

    it('should keep a pick made while the parse for the pre-strip text is in flight', async () => {
      mockStateService.state.and.returnValue(baseState as any);
      mockStateService.inputTxt.and.returnValue('Water plants @every 2 weeks');
      // No await: the pick lands in the middle of this parse, which was started
      // for the text the pick is about to strip
      const inFlight = service.parseAndUpdateText(
        'Water plants @every 2 weeks',
        cfg,
        [],
        [],
        defaultProject,
      );

      service.applyUserRepeatPick(MENU_PICK);
      mockStateService.updateRepeatSetting.calls.reset();
      await inFlight;

      // The stale parse published nothing, so the pick still stands
      expect(mockStateService.updateRepeatSetting).not.toHaveBeenCalled();
      expect(mockStateService.clearRepeatSetting).not.toHaveBeenCalled();
    });

    it('should keep a dialog-picked deadline that replaced parsed deadline syntax', async () => {
      mockStateService.state.and.returnValue(baseState as any);
      mockStateService.inputTxt.and.returnValue('Taxes !friday');
      await service.parseAndUpdateText('Taxes !friday', cfg, [], [], defaultProject);

      service.applyUserDeadlinePick('2026-08-31', null, null);
      mockStateService.state.and.returnValue({
        ...baseState,
        deadlineDate: '2026-08-31',
      } as any);
      mockStateService.updateDeadline.calls.reset();

      await service.parseAndUpdateText('Taxes', cfg, [], [], defaultProject);

      expect(mockStateService.updateDeadline).not.toHaveBeenCalled();
    });

    it('should keep a menu-picked estimate that replaced parsed estimate syntax', async () => {
      mockStateService.state.and.returnValue(baseState as any);
      mockStateService.inputTxt.and.returnValue('Task 30m');
      await service.parseAndUpdateText('Task 30m', cfg, [], [], defaultProject);

      service.applyUserEstimatePick(2 * 60 * 60 * 1000);
      mockStateService.state.and.returnValue({
        ...baseState,
        estimate: 2 * 60 * 60 * 1000,
      } as any);
      mockStateService.updateEstimate.calls.reset();

      await service.parseAndUpdateText('Task', cfg, [], [], defaultProject);

      expect(mockStateService.updateEstimate).not.toHaveBeenCalled();
    });

    it('should keep a recurrence whose phrase a picked date strips', async () => {
      const repeat = {
        type: 'INTERVAL' as const,
        repeatCycle: 'WEEKLY' as const,
        repeatEvery: 2,
      };
      mockStateService.inputTxt.and.returnValue('Water plants @every 2 fridays');
      mockStateService.state.and.returnValue(baseState as any);
      await service.parseAndUpdateText(
        'Water plants @every 2 fridays',
        cfg,
        [],
        [],
        defaultProject,
      );

      mockStateService.state.and.returnValue({ ...baseState, repeat } as any);
      service.applyUserDatePick('2026-08-31', null, null);
      mockStateService.state.and.returnValue({
        ...baseState,
        repeat,
        date: '2026-08-31',
      } as any);

      await service.parseAndUpdateText('Water plants', cfg, [], [], defaultProject);

      expect(mockStateService.clearRepeatSetting).not.toHaveBeenCalled();
    });

    it('should preserve a menu-selected repeat setting on unrelated text', async () => {
      mockStateService.state.and.returnValue({
        ...baseState,
        repeat: { type: 'PRESET', quickSetting: 'DAILY' },
      } as any);
      await service.parseAndUpdateText('Plain task', cfg, [], [], defaultProject);
      expect(mockStateService.clearRepeatSetting).not.toHaveBeenCalled();
    });
  });

  // A pick that lands while a parse is still in flight has to survive it. The
  // parse publishes state values it fell back to, and reading them before the
  // await means reading the values the pick has since replaced — with nothing
  // to correct it afterwards when the pick left the text unchanged, because an
  // unchanged input queues no parse.
  //
  // Runs against the real state service: what has to hold is that the state a
  // pick writes is still there once the parse lands, which a mocked state()
  // cannot show.
  describe('picks against real add bar state', () => {
    let realState: AddTaskBarStateService;
    const cfg = {
      isEnableProject: true,
      isEnableDue: true,
      isEnableTag: true,
    } as ShortSyntaxConfig;
    const defaultProject = { id: 'default-project', title: 'Default Project' } as Project;

    const parse = (text: string, defaultDate?: string): Promise<void> =>
      service.parseAndUpdateText(text, cfg, [], [], defaultProject, defaultDate);

    beforeEach(() => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [AddTaskBarParserService, AddTaskBarStateService],
      });
      service = TestBed.inject(AddTaskBarParserService);
      realState = TestBed.inject(AddTaskBarStateService);
    });

    it('should not let a parse that was in flight during a date pick republish the old date', async () => {
      realState.updateInputTxt('Standup');
      await parse('Standup');
      realState.updateDate('2027-03-27');

      // Not awaited: the pick lands while this parse is still waiting for the
      // chrono-node chunk. There is no due syntax in the text, so the pick
      // strips nothing and queues no replacement parse — this one is still the
      // parse that will publish.
      const inFlight = parse('Standup');
      service.applyUserDatePick('2027-03-29', null, null);
      expect(realState.state().date).toBe('2027-03-29');

      await inFlight;

      expect(realState.state().date).toBe('2027-03-29');
    });

    it('should not let it republish any other value the pick replaced either', async () => {
      // Same shape, on a control with no date anywhere near it: every value the
      // parse falls back to came from the snapshot it took before awaiting
      realState.updateInputTxt('Taxes');
      realState.updateDeadline('2027-04-01', null);
      await parse('Taxes');

      const inFlight = parse('Taxes');
      service.applyUserDeadlinePick('2027-05-01', null, null);
      expect(realState.state().deadlineDate).toBe('2027-05-01');

      await inFlight;

      expect(realState.state().deadlineDate).toBe('2027-05-01');
    });
  });

  describe('syntax highlight ranges', () => {
    const cfg = {
      isEnableProject: true,
      isEnableDue: true,
      isEnableTag: true,
    } as ShortSyntaxConfig;
    const defaultProject = { id: 'default-project', title: 'Default Project' } as Project;
    const baseState = {
      projectId: 'default-project',
      tagIds: [],
      tagIdsFromTxt: [],
      newTagTitles: [],
      date: null,
      time: null,
      spent: null,
      estimate: null,
      cleanText: null,
      remindOption: null,
      attachments: [],
      repeat: null,
      repeatEvery: null,
      deadlineDate: null,
      deadlineTime: null,
      deadlineRemindOption: null,
    };

    it('should publish ranges for detected tokens pinned to the input text', async () => {
      mockStateService.state.and.returnValue(baseState as any);
      const text = 'Fix bug #urgent @friday';
      await service.parseAndUpdateText(
        text,
        cfg,
        [],
        [{ id: 'tag-1', title: 'urgent' } as Tag],
        defaultProject,
      );
      const arg = mockStateService.updateSyntaxHighlight.calls.mostRecent().args[0];
      expect(arg?.forText).toBe(text);
      const highlighted = arg!.ranges.map((r) => ({
        text: text.slice(r.start, r.end),
        type: r.type,
      }));
      expect(highlighted).toEqual([
        { text: '#urgent', type: 'tag' },
        { text: '@friday', type: 'due' },
      ]);
    });

    it('should include recurrence phrases in the due range', async () => {
      mockStateService.state.and.returnValue(baseState as any);
      const text = 'Water plants @every friday';
      await service.parseAndUpdateText(text, cfg, [], [], defaultProject);
      const arg = mockStateService.updateSyntaxHighlight.calls.mostRecent().args[0];
      expect(arg?.ranges.length).toBe(1);
      expect(text.slice(arg!.ranges[0].start, arg!.ranges[0].end)).toBe('@every friday');
      expect(arg!.ranges[0].type).toBe('due');
    });

    it('should publish null when nothing is parsed', async () => {
      mockStateService.state.and.returnValue(baseState as any);
      await service.parseAndUpdateText('Plain task', cfg, [], [], defaultProject);
      expect(mockStateService.updateSyntaxHighlight).toHaveBeenCalledWith(null);
    });

    it('should publish null when the input is emptied', async () => {
      mockStateService.state.and.returnValue(baseState as any);
      await service.parseAndUpdateText('', cfg, [], [], defaultProject);
      expect(mockStateService.updateSyntaxHighlight).toHaveBeenCalledWith(null);
    });
  });

  describe('removeShortSyntaxFromInput repeat', () => {
    it('should remove "@every friday"', () => {
      expect(service.removeShortSyntaxFromInput('Water @every friday', 'repeat')).toBe(
        'Water',
      );
    });

    it('should remove "@daily"', () => {
      expect(service.removeShortSyntaxFromInput('Journal @daily', 'repeat')).toBe(
        'Journal',
      );
    });

    it('should leave a trailing time token like the date case does', () => {
      expect(service.removeShortSyntaxFromInput('Call @every friday 3pm', 'repeat')).toBe(
        'Call 3pm',
      );
    });

    it('should not eat words merely starting with a frequency word', () => {
      expect(service.removeShortSyntaxFromInput('Meet @dailystandup', 'repeat')).toBe(
        'Meet @dailystandup',
      );
    });

    it('should remove interval phrases', () => {
      const expected: [string, string][] = [
        ['Review @every 2 weeks', 'Review'],
        ['Water flowers @every 3 days', 'Water flowers'],
        ['Water plants @every 2 fridays', 'Water plants'],
      ];
      for (const [input, cleaned] of expected) {
        expect(service.removeShortSyntaxFromInput(input, 'repeat'))
          .withContext(input)
          .toBe(cleaned);
      }
    });

    // The button renders for any repeat setting, including menu-selected ones,
    // so it must not delete phrases the parser never treated as a recurrence
    it('should leave phrases the parser does not read as a recurrence', () => {
      const untouched = [
        'Ship @every quarter',
        'Review @every 0 days',
        'Standup @every 2 weekdays',
      ];
      for (const input of untouched) {
        expect(service.removeShortSyntaxFromInput(input, 'repeat'))
          .withContext(input)
          .toBe(input);
      }
    });

    it('should keep trailing punctuation joined like the parser does', () => {
      expect(
        service.removeShortSyntaxFromInput('Water plants @every friday.', 'repeat'),
      ).toBe('Water plants.');
    });
  });
});
