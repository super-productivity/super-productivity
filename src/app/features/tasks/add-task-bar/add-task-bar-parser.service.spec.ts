import { TestBed } from '@angular/core/testing';
import { AddTaskBarParserService } from './add-task-bar-parser.service';
import { AddTaskBarStateService } from './add-task-bar-state.service';
import { ShortSyntaxConfig } from '../../config/global-config.model';
import { Project } from '../../project/project.model';
import { Tag } from '../../tag/tag.model';

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
      'isAutoDetected',
      'state',
    ]);

    mockStateServiceSpy.isAutoDetected.and.returnValue(false);

    // Default state return value
    const defaultMockState = {
      projectId: null,
      tagIds: [],
      newTagTitles: [],
      date: null,
      time: null,
      estimate: null,
      cleanText: null,
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
    });

    it('should handle empty text', () => {
      service.parseAndUpdateText('', null, [], [], null as any);
      expect(mockStateService.updateCleanText).not.toHaveBeenCalled();
    });

    it('should handle null config', () => {
      service.parseAndUpdateText('test task', null, [], [], null as any);
      expect(mockStateService.updateCleanText).not.toHaveBeenCalled();
    });

    describe('Date Parsing', () => {
      it('should handle default date when no date syntax present and no current state', () => {
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
        };
        mockStateService.state.and.returnValue(mockState);

        service.parseAndUpdateText(
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

      it('should preserve current date/time when no syntax present', () => {
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
        };
        mockStateService.state.and.returnValue(mockState);

        service.parseAndUpdateText(
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

      it('should preserve current date but use default time when no current time', () => {
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
        };
        mockStateService.state.and.returnValue(mockState);

        service.parseAndUpdateText(
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

      it('should handle no date or default date', () => {
        service.parseAndUpdateText(
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

      it('should test date parsing integration with shortSyntax', () => {
        // Since shortSyntax is complex and depends on external implementation,
        // we'll test the parser's handling of the parsed results
        service.parseAndUpdateText(
          'Task with date syntax that may or may not be parsed',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        expect(mockStateService.updateDate).toHaveBeenCalled();
        expect(mockStateService.updateCleanText).toHaveBeenCalled();
      });

      it('should handle default date and time when no syntax is found', () => {
        const defaultDate = '2024-01-15';
        const defaultTime = '09:00';

        service.parseAndUpdateText(
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
    });

    describe('Parsing Integration', () => {
      it('should call updateEstimate when parsing text', () => {
        service.parseAndUpdateText(
          'Task with potential time estimate',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        expect(mockStateService.updateEstimate).toHaveBeenCalled();
      });

      it('should handle null time estimates', () => {
        service.parseAndUpdateText(
          'Simple task',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        expect(mockStateService.updateEstimate).toHaveBeenCalledWith(null);
      });

      it('should call updateSpent when parsing text', () => {
        service.parseAndUpdateText(
          'Task with potential time spent',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        expect(mockStateService.updateSpent).toHaveBeenCalled();
      });

      it('should handle null time spent', () => {
        service.parseAndUpdateText(
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
      it('should update tags when parsing text', () => {
        service.parseAndUpdateText(
          'Task with tags',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        expect(mockStateService.updateTagIdsFromTxt).toHaveBeenCalled();
        expect(mockStateService.updateNewTagTitles).toHaveBeenCalled();
      });

      it('should handle auto-detected projects', () => {
        mockStateService.isAutoDetected.and.returnValue(false);

        service.parseAndUpdateText(
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

      it('should handle text with clean text update', () => {
        service.parseAndUpdateText(
          'Task text',
          mockConfig,
          mockProjects,
          mockTags,
          mockDefaultProject,
        );

        expect(mockStateService.updateCleanText).toHaveBeenCalledWith('Task text');
      });

      it('should handle edge cases gracefully', () => {
        const longText = 'Task ' + 'a'.repeat(1000);

        expect(() => {
          service.parseAndUpdateText(
            longText,
            mockConfig,
            mockProjects,
            mockTags,
            mockDefaultProject,
          );
        }).not.toThrow();
      });

      it('should handle empty arrays for projects and tags', () => {
        service.parseAndUpdateText(
          'Task with no matching items',
          mockConfig,
          [],
          [],
          mockDefaultProject,
        );

        expect(mockStateService.updateTagIdsFromTxt).toHaveBeenCalled();
        expect(mockStateService.updateNewTagTitles).toHaveBeenCalled();
      });

      it('should handle special characters in task text', () => {
        service.parseAndUpdateText(
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
    it('should reset previous result without error', () => {
      expect(() => service.resetPreviousResult()).not.toThrow();
    });
  });

  describe('removeShortSyntaxFromInput', () => {
    it('should return same input for empty string', () => {
      expect(service.removeShortSyntaxFromInput('', 'tags')).toBe('');
    });

    describe('tags removal', () => {
      it('should remove specific tag', () => {
        const input = 'Task #important #urgent';
        const result = service.removeShortSyntaxFromInput(input, 'tags', 'important');
        expect(result).toBe('Task #urgent');
      });

      it('should remove all tags when no specific tag provided', () => {
        const input = 'Task #important #urgent #todo';
        const result = service.removeShortSyntaxFromInput(input, 'tags');
        expect(result).toBe('Task');
      });

      it('should handle tag removal case insensitively', () => {
        const input = 'Task #Important #URGENT';
        const result = service.removeShortSyntaxFromInput(input, 'tags', 'important');
        expect(result).toBe('Task #URGENT');
      });

      it('should handle tags at the beginning of input', () => {
        const input = '#urgent Task content';
        const result = service.removeShortSyntaxFromInput(input, 'tags', 'urgent');
        expect(result).toBe('Task content');
      });

      it('should handle tags at the end of input', () => {
        const input = 'Task content #urgent';
        const result = service.removeShortSyntaxFromInput(input, 'tags', 'urgent');
        expect(result).toBe('Task content');
      });
    });

    describe('date removal', () => {
      it('should remove date syntax', () => {
        const input = 'Task @today @16:30 @2024-01-15';
        const result = service.removeShortSyntaxFromInput(input, 'date');
        expect(result).toBe('Task');
      });

      it('should handle complex date formats', () => {
        const input = 'Meeting @tomorrow @next-week @2024-12-25';
        const result = service.removeShortSyntaxFromInput(input, 'date');
        expect(result).toBe('Meeting');
      });

      it('should handle date at beginning', () => {
        const input = '@today Task content';
        const result = service.removeShortSyntaxFromInput(input, 'date');
        expect(result).toBe('Task content');
      });

      it('should handle date at end', () => {
        const input = 'Task content @today';
        const result = service.removeShortSyntaxFromInput(input, 'date');
        expect(result).toBe('Task content');
      });
    });

    describe('estimate removal', () => {
      it('should remove various time estimate formats', () => {
        const testCases = [
          { input: 'Task t30m', expected: 'Task' },
          { input: 'Task 1h', expected: 'Task' },
          { input: 'Task 30m/1h', expected: 'Task' },
          { input: 'Task t1.5h', expected: 'Task' },
          { input: 'Task 45d', expected: 'Task' },
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

      it('should handle multiple time estimates', () => {
        const input = 'Task t30m another t1h final';
        const result = service.removeShortSyntaxFromInput(input, 'estimate');
        expect(result).toBe('Task another final');
      });

      it('should handle time estimate at beginning', () => {
        const input = 't30m Task content';
        const result = service.removeShortSyntaxFromInput(input, 'estimate');
        expect(result).toBe('Task content');
      });

      it('should handle time estimate at end', () => {
        const input = 'Task content t30m';
        const result = service.removeShortSyntaxFromInput(input, 'estimate');
        expect(result).toBe('Task content');
      });

      it('should handle decimal hours', () => {
        const input = 'Task t2.5h content';
        const result = service.removeShortSyntaxFromInput(input, 'estimate');
        expect(result).toBe('Task content');
      });

      it('should handle days format', () => {
        const input = 'Task 3d content';
        const result = service.removeShortSyntaxFromInput(input, 'estimate');
        expect(result).toBe('Task content');
      });
    });

    it('should clean up extra whitespace', () => {
      const input = 'Task   #tag   @today   t30m   end';
      const result = service.removeShortSyntaxFromInput(input, 'tags');
      expect(result).toBe('Task @today t30m end');
    });

    it('should trim final result', () => {
      const input = '  #tag Task #another  ';
      const result = service.removeShortSyntaxFromInput(input, 'tags');
      expect(result).toBe('Task');
    });

    it('should handle mixed removal scenarios', () => {
      // Remove all tags and clean up spacing
      const input = 'Task #urgent #important content #todo';
      const result = service.removeShortSyntaxFromInput(input, 'tags');
      expect(result).toBe('Task content');
    });

    it('should handle empty input after removal', () => {
      const input = '#tag1 #tag2';
      const result = service.removeShortSyntaxFromInput(input, 'tags');
      expect(result).toBe('');
    });

    it('should handle whitespace-only input after removal', () => {
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

    it('should handle date strings consistently across timezones', () => {
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
      };
      mockStateService.state.and.returnValue(mockState);

      service.parseAndUpdateText(
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

    it('should handle dates near DST transitions', () => {
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
      };
      mockStateService.state.and.returnValue(mockState);

      service.parseAndUpdateText(
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

    it('should handle dates at year boundaries', () => {
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
      };
      mockStateService.state.and.returnValue(mockState);

      service.parseAndUpdateText(
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

    it('should maintain date consistency when parsing date-only strings', () => {
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
      };
      mockStateService.state.and.returnValue(mockState);

      service.parseAndUpdateText(
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

    it('should handle midnight time correctly', () => {
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
      };
      mockStateService.state.and.returnValue(mockState);

      service.parseAndUpdateText(
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
      it('should return true for equal arrays', () => {
        expect(serviceAny._arraysEqual(['a', 'b'], ['a', 'b'])).toBe(true);
        expect(serviceAny._arraysEqual([], [])).toBe(true);
        expect(serviceAny._arraysEqual([1, 2, 3], [1, 2, 3])).toBe(true);
      });

      it('should return false for different arrays', () => {
        expect(serviceAny._arraysEqual(['a', 'b'], ['a', 'c'])).toBe(false);
        expect(serviceAny._arraysEqual(['a'], ['a', 'b'])).toBe(false);
        expect(serviceAny._arraysEqual([1, 2], [2, 1])).toBe(false);
        expect(serviceAny._arraysEqual([1, 2], [])).toBe(false);
        expect(serviceAny._arraysEqual([], [1])).toBe(false);
      });

      it('should handle null and undefined values', () => {
        expect(serviceAny._arraysEqual([null], [null])).toBe(true);
        expect(serviceAny._arraysEqual([undefined], [undefined])).toBe(true);
        expect(serviceAny._arraysEqual([null], [undefined])).toBe(false);
      });
    });

    describe('_datesEqual', () => {
      it('should return true for equal date strings', () => {
        const dateStr1 = '2024-01-15';
        const dateStr2 = '2024-01-15';
        expect(serviceAny._datesEqual(dateStr1, dateStr2)).toBe(true);
        expect(serviceAny._datesEqual(null, null)).toBe(true);
      });

      it('should return false for different date strings', () => {
        const dateStr1 = '2024-01-15';
        const dateStr2 = '2024-01-16';
        expect(serviceAny._datesEqual(dateStr1, dateStr2)).toBe(false);
        expect(serviceAny._datesEqual(dateStr1, null)).toBe(false);
        expect(serviceAny._datesEqual(null, dateStr1)).toBe(false);
      });

      it('should handle same date strings', () => {
        const dateStr1 = '2024-01-15';
        const dateStr2 = '2024-01-15';
        expect(serviceAny._datesEqual(dateStr1, dateStr2)).toBe(true);
      });

      it('should handle different date strings', () => {
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

    it('should extract single HTTPS URL and update state', () => {
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
      };
      mockStateService.state.and.returnValue(mockState);

      service.parseAndUpdateText(
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

    it('should extract file:// URL with FILE type', () => {
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
      };
      mockStateService.state.and.returnValue(mockState);

      service.parseAndUpdateText(
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

    it('should detect image URLs as IMG type', () => {
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
      };
      mockStateService.state.and.returnValue(mockState);

      service.parseAndUpdateText(
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

    it('should extract multiple URLs', () => {
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
      };
      mockStateService.state.and.returnValue(mockState);

      service.parseAndUpdateText(
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

    it('should work with combined short syntax (URL + date + tag + estimate)', () => {
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
      };
      mockStateService.state.and.returnValue(mockState);

      const mockTag = { id: 'urgent-id', title: 'urgent' } as Tag;
      const tagsWithUrgent = [mockTag];

      service.parseAndUpdateText(
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

    it('should not extract URLs from empty text', () => {
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
      };
      mockStateService.state.and.returnValue(mockState);

      service.parseAndUpdateText(
        '',
        mockConfig,
        mockProjects,
        mockTags,
        mockDefaultProject,
      );

      expect(mockStateService.updateAttachments).not.toHaveBeenCalled();
    });

    it('should update attachments when URL changes', () => {
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
      };
      mockStateService.state.and.returnValue(mockState);

      // First parse
      service.parseAndUpdateText(
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
      service.parseAndUpdateText(
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

    it('should clear attachments when URL removed from text', () => {
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
      };
      mockStateService.state.and.returnValue(mockState);

      // First parse with URL
      service.parseAndUpdateText(
        'Task https://example.com',
        mockConfig,
        mockProjects,
        mockTags,
        mockDefaultProject,
      );

      expect(mockStateService.updateAttachments).toHaveBeenCalledTimes(1);

      // Remove URL from text
      service.parseAndUpdateText(
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

    it('should handle www URLs correctly', () => {
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
      };
      mockStateService.state.and.returnValue(mockState);

      service.parseAndUpdateText(
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
});
