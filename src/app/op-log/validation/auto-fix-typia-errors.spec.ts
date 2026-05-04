import { autoFixTypiaErrors } from './auto-fix-typia-errors';
import { createAppDataCompleteMock } from '../../util/app-data-mock';
import { createValidate } from 'typia';
import { initialTaskState } from '../../features/tasks/store/task.reducer';
import { DEFAULT_TASK, TaskState } from '../../features/tasks/task.model';
import { OpLog } from '../../core/log';

interface TestInterface {
  globalConfig: {
    misc: {
      startOfNextDay: number;
    };
  };
  optionalObj?: {
    optionalProp?: string;
    bool: boolean;
  };
  task?: TaskState;
}

describe('autoFixTypiaErrors', () => {
  const validate = createValidate<TestInterface>();

  let errSpy: jasmine.Spy;

  beforeEach(() => {
    // Spy on OpLog.err to prevent test output cluttering
    errSpy = spyOn(OpLog, 'err').and.stub();
  });

  afterEach(() => {
    // Reset spies
    errSpy.calls.reset();
  });

  it('should return data unchanged when no errors', () => {
    const d = createAppDataCompleteMock();
    const result = autoFixTypiaErrors(d, []);
    expect(result).toBe(d);
  });

  it('should work for typia validation errors for strings that should be numbers', () => {
    const d = {
      globalConfig: {
        misc: {
          startOfNextDay: '111',
        },
      },
    } as any;
    const validateResult = validate(d);
    expect(validateResult.success).toBe(false);
    const result = autoFixTypiaErrors(d, (validateResult as any).errors);
    expect(result).toEqual({
      globalConfig: {
        misc: {
          startOfNextDay: 111,
        },
      },
    } as any);
  });

  it('should use defaults for globalConfig if no other value could be added', () => {
    const d = {
      globalConfig: {
        misc: {
          startOfNextDay: undefined,
        },
      },
    } as any;
    const validateResult = validate(d);
    expect(validateResult.success).toBe(false);
    const result = autoFixTypiaErrors(d, (validateResult as any).errors);
    expect(result.globalConfig.misc.startOfNextDay).not.toEqual(111);
    expect(result.globalConfig.misc.startOfNextDay).toEqual('00:00' as any);
  });

  it('should sanitize null to undefined if model requests it', () => {
    const d = {
      globalConfig: {
        misc: {
          startOfNextDay: 111,
        },
      },
      optionalObj: {
        optionalProp: null,
      },
    } as any;
    const validateResult = validate(d);
    expect(validateResult.success).toBe(false);
    const result = autoFixTypiaErrors(d, (validateResult as any).errors);
    expect(result.globalConfig.misc.startOfNextDay).toEqual(111);
    expect((result as any).optionalObj.optionalProp).toEqual(undefined);
  });

  it('should sanitize boolean to false for undefined types', () => {
    const d = {
      globalConfig: {
        misc: {
          startOfNextDay: 111,
        },
      },
      optionalObj: {
        bool: null,
      },
    } as any;
    const validateResult = validate(d);
    expect(validateResult.success).toBe(false);
    const result = autoFixTypiaErrors(d, (validateResult as any).errors);
    expect((result as any).optionalObj.bool).toEqual(false);
  });

  it('should sanitize special id syntax', () => {
    const d = {
      globalConfig: {
        misc: {
          startOfNextDay: 111,
        },
      },
      task: {
        ...initialTaskState,
        entities: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'task-1': {
            ...DEFAULT_TASK,
            id: 'task-1',
            timeEstimate: '0',
            timeSpent: '0',
          },
        },
        ids: ['task-1'],
      },
    } as any;
    const validateResult = validate(d);
    expect(validateResult.success).toBe(false);

    const result = autoFixTypiaErrors(d, (validateResult as any).errors);

    expect((result as any).task.entities['task-1'].timeEstimate).toEqual(0);
    expect((result as any).task.entities['task-1'].timeSpent).toEqual(0);
  });

  it('should fix null simpleCounter countOnDay values to 0', () => {
    const mockData = createAppDataCompleteMock();
    // Add simpleCounter data with null countOnDay value
    (mockData as any).simpleCounter = {
      ids: ['BpYFLFtlIGGgTNfZB-t2-'],
      entities: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'BpYFLFtlIGGgTNfZB-t2-': {
          id: 'BpYFLFtlIGGgTNfZB-t2-',
          title: 'Test Counter',
          countOnDay: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            '2025-06-15': 5,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            '2025-06-16': null, // This should be fixed to 0
          },
        },
      },
    };

    const errors = [
      {
        path: "$input.simpleCounter.entities['BpYFLFtlIGGgTNfZB-t2-'].countOnDay['2025-06-16']",
        expected: 'number',
        value: null,
      },
    ];

    const result = autoFixTypiaErrors(mockData, errors as any);

    expect(
      (result as any).simpleCounter.entities['BpYFLFtlIGGgTNfZB-t2-'].countOnDay[
        '2025-06-16'
      ],
    ).toBe(0);
    expect(errSpy).toHaveBeenCalledWith(
      "Fixed: simpleCounter.entities['BpYFLFtlIGGgTNfZB-t2-'].countOnDay['2025-06-16'] from null to 0 for simpleCounter",
    );
  });

  // Issue #7330: a partial LWW Update payload can recreate a task with
  // required fields undefined. The meta-reducer is the primary fix; these
  // rules ensure dataRepair can still recover any state that already
  // contains such an entity (e.g. on disk from a prior corrupted session).
  describe('issue #7330 — partial task entities from LWW recreate', () => {
    it('should fix undefined task.title to ""', () => {
      const mockData = createAppDataCompleteMock();
      const errors = [
        {
          path: '$input.task.entities["rpt_partial_2026-04-29"].title',
          expected: 'string',
          value: undefined,
        },
      ];
      (mockData as any).task = {
        ids: ['rpt_partial_2026-04-29'],
        entities: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'rpt_partial_2026-04-29': { id: 'rpt_partial_2026-04-29' },
        },
      };

      const result = autoFixTypiaErrors(mockData, errors as any);

      expect((result as any).task.entities['rpt_partial_2026-04-29'].title).toBe('');
    });

    it('should fix undefined task.timeSpentOnDay to {}', () => {
      const mockData = createAppDataCompleteMock();
      const errors = [
        {
          path: '$input.task.entities["rpt_partial_2026-04-29"].timeSpentOnDay',
          expected: 'Readonly<TimeSpentOnDayCopy>',
          value: undefined,
        },
      ];
      (mockData as any).task = {
        ids: ['rpt_partial_2026-04-29'],
        entities: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'rpt_partial_2026-04-29': { id: 'rpt_partial_2026-04-29' },
        },
      };

      const result = autoFixTypiaErrors(mockData, errors as any);

      expect(
        (result as any).task.entities['rpt_partial_2026-04-29'].timeSpentOnDay,
      ).toEqual({});
    });

    it('should fix undefined task array fields (tagIds, subTaskIds, attachments) to []', () => {
      const mockData = createAppDataCompleteMock();
      const errors = [
        {
          path: '$input.task.entities["t1"].tagIds',
          expected: 'Array<string>',
          value: undefined,
        },
        {
          path: '$input.task.entities["t1"].subTaskIds',
          expected: 'Array<string>',
          value: undefined,
        },
        {
          path: '$input.task.entities["t1"].attachments',
          expected: 'Array<TaskAttachmentCopy>',
          value: undefined,
        },
      ];
      (mockData as any).task = {
        ids: ['t1'],
        entities: {
          t1: { id: 't1' },
        },
      };

      const result = autoFixTypiaErrors(mockData, errors as any);

      expect((result as any).task.entities['t1'].tagIds).toEqual([]);
      expect((result as any).task.entities['t1'].subTaskIds).toEqual([]);
      expect((result as any).task.entities['t1'].attachments).toEqual([]);
    });

    it('should fall back to first available project when INBOX_PROJECT is missing', () => {
      const mockData = createAppDataCompleteMock();
      const errors = [
        {
          path: '$input.task.entities["t1"].projectId',
          expected: 'string',
          value: undefined,
        },
      ];
      (mockData as any).task = {
        ids: ['t1'],
        entities: {
          t1: { id: 't1' },
        },
      };
      // Project state lacks INBOX_PROJECT but has another project
      (mockData as any).project = {
        ids: ['some-other-project'],
        entities: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'some-other-project': { id: 'some-other-project' },
        },
      };

      const result = autoFixTypiaErrors(mockData, errors as any);

      expect((result as any).task.entities['t1'].projectId).toBe('some-other-project');
    });

    it('should fix undefined task.projectId to INBOX_PROJECT id', () => {
      const mockData = createAppDataCompleteMock();
      const errors = [
        {
          path: '$input.task.entities["t1"].projectId',
          expected: 'string',
          value: undefined,
        },
      ];
      (mockData as any).task = {
        ids: ['t1'],
        entities: {
          t1: { id: 't1' },
        },
      };

      const result = autoFixTypiaErrors(mockData, errors as any);

      expect((result as any).task.entities['t1'].projectId).toBe('INBOX_PROJECT');
    });
  });
});
