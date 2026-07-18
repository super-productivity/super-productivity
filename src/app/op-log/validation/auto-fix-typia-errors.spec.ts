import { autoFixTypiaErrors } from './auto-fix-typia-errors';
import { createAppDataCompleteMock } from '../../util/app-data-mock';
import { validateAllData } from './validation-fn';
import type { AppDataComplete } from '../model/model-config';
import type { IValidation } from 'typia';
import { initialTaskState } from '../../features/tasks/store/task.reducer';
import { DEFAULT_TASK } from '../../features/tasks/task.model';
import { OP_LOG_SYNC_LOGGER } from '../core/sync-logger.adapter';
import { DEFAULT_TAG, TODAY_TAG } from '../../features/tag/tag.const';
import { DEFAULT_PROJECT, INBOX_PROJECT } from '../../features/project/project.const';

const createTypiaError = (
  path: string,
  expected: string,
  value?: unknown,
): IValidation.IError => ({ path, expected, value }) as IValidation.IError;

describe('autoFixTypiaErrors', () => {
  let errSpy: jasmine.Spy;
  let warnSpy: jasmine.Spy;

  beforeEach(() => {
    // Spy on sync logger methods to prevent test output cluttering.
    errSpy = spyOn(OP_LOG_SYNC_LOGGER, 'err').and.stub();
    warnSpy = spyOn(OP_LOG_SYNC_LOGGER, 'warn').and.stub();
  });

  afterEach(() => {
    // Reset spies
    errSpy.calls.reset();
    warnSpy.calls.reset();
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
    const result = autoFixTypiaErrors(d, [
      createTypiaError('$input.globalConfig.misc.startOfNextDay', 'number', '111'),
    ]);
    expect(result).toEqual({
      globalConfig: {
        misc: {
          startOfNextDay: 111,
        },
      },
    } as any);
  });

  it('should log auto-fixes without raw validation values', () => {
    const d = {
      globalConfig: {
        misc: {
          startOfNextDay: '4321',
        },
      },
    } as any;

    autoFixTypiaErrors(d, [
      createTypiaError('$input.globalConfig.misc.startOfNextDay', 'number', '4321'),
    ]);

    const serializedLogArgs = JSON.stringify([
      ...errSpy.calls.allArgs(),
      ...warnSpy.calls.allArgs(),
    ]);
    expect(serializedLogArgs).toContain('valueStringLength');
    expect(serializedLogArgs).toContain('replacementType');
    expect(serializedLogArgs).not.toContain('4321');
  });

  it('should use defaults for globalConfig if no other value could be added', () => {
    const d = {
      globalConfig: {
        misc: {
          startOfNextDay: undefined,
        },
      },
    } as any;
    const result = autoFixTypiaErrors(d, [
      createTypiaError('$input.globalConfig.misc.startOfNextDay', 'number'),
    ]);
    expect(result.globalConfig.misc.startOfNextDay).not.toEqual(111);
    expect(result.globalConfig.misc.startOfNextDay).toEqual(0);
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
    const result = autoFixTypiaErrors(d, [
      createTypiaError('$input.optionalObj.optionalProp', 'string | undefined', null),
    ]);
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
    const result = autoFixTypiaErrors(d, [
      createTypiaError('$input.optionalObj.bool', 'boolean', null),
    ]);
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

    const result = autoFixTypiaErrors(d, [
      createTypiaError('$input.task.entities["task-1"].timeEstimate', 'number', '0'),
      createTypiaError('$input.task.entities["task-1"].timeSpent', 'number', '0'),
    ]);

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
      '[auto-fix-typia-errors] Applied validation auto-fix',
      undefined,
      jasmine.objectContaining({
        path: "simpleCounter.entities['BpYFLFtlIGGgTNfZB-t2-'].countOnDay['2025-06-16']",
        pathDepth: 5,
        pathRoot: 'simpleCounter',
        fix: 'simple-counter-countOnDay-null-to-zero',
        valueType: 'null',
        replacementType: 'number',
      }),
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

  // Issue #7330 recurred on SIMPLE_COUNTER: a concurrent delete-vs-update
  // across devices recreated a counter with `type === undefined` (and possibly
  // other required scalars), which typia rejects and dataRepair had no rule
  // for — dead-ending the user on "Repair attempted but failed". These verify
  // the on-disk heal mirrors the task fix.
  describe('issue #7330 — partial simpleCounter entities from LWW recreate', () => {
    it('should fix undefined simpleCounter.type to the ClickCounter default', () => {
      const mockData = createAppDataCompleteMock();
      (mockData as any).simpleCounter = {
        ids: ['cnt1'],
        entities: {
          // A counter recreated from a partial payload: id + the count data
          // survived, but `type` (and isEnabled/isOn) never made it in.
          // eslint-disable-next-line @typescript-eslint/naming-convention
          cnt1: { id: 'cnt1', countOnDay: { '2026-06-29': 3 } },
        },
      };
      const errors = [
        createTypiaError(
          '$input.simpleCounter.entities["cnt1"].type',
          '("ClickCounter" | "RepeatedCountdownReminder" | "StopWatch")',
          undefined,
        ),
      ];

      const result = autoFixTypiaErrors(mockData, errors as any);

      expect((result as any).simpleCounter.entities['cnt1'].type).toBe('ClickCounter');
      // The surviving count data must be preserved, not clobbered by defaults.
      expect((result as any).simpleCounter.entities['cnt1'].countOnDay).toEqual({
        // eslint-disable-next-line @typescript-eslint/naming-convention
        '2026-06-29': 3,
      });
    });

    it('should fix undefined simpleCounter boolean/string required fields', () => {
      const mockData = createAppDataCompleteMock();
      (mockData as any).simpleCounter = {
        ids: ['cnt1'],
        entities: {
          cnt1: { id: 'cnt1', type: 'StopWatch' },
        },
      };
      const errors = [
        createTypiaError(
          '$input.simpleCounter.entities["cnt1"].title',
          'string',
          undefined,
        ),
        createTypiaError(
          '$input.simpleCounter.entities["cnt1"].isEnabled',
          'boolean',
          undefined,
        ),
        createTypiaError(
          '$input.simpleCounter.entities["cnt1"].isOn',
          'boolean',
          undefined,
        ),
        createTypiaError(
          '$input.simpleCounter.entities["cnt1"].countOnDay',
          'Record<string, number>',
          undefined,
        ),
      ];

      const result = autoFixTypiaErrors(mockData, errors as any);

      const counter = (result as any).simpleCounter.entities['cnt1'];
      expect(counter.title).toBe('');
      expect(counter.isEnabled).toBe(false);
      expect(counter.isOn).toBe(false);
      expect(counter.countOnDay).toEqual({});
      // A user-chosen field present in the payload must not be overwritten.
      expect(counter.type).toBe('StopWatch');
    });
  });

  // Discussion #8022: a Nextcloud-synced state imported from MS Todos had 84
  // taskRepeatCfg entities with undefined `quickSetting` (required field) and
  // a TODAY tag with undefined `created`. dataRepair couldn't repair them so
  // post-sync validation looped on "State still invalid after repair".
  describe('discussion #8022 — legacy entities missing required fields', () => {
    it('should default undefined taskRepeatCfg.quickSetting to "CUSTOM"', () => {
      const mockData = createAppDataCompleteMock();
      (mockData as any).taskRepeatCfg = {
        ids: ['rpt1'],
        entities: {
          rpt1: { id: 'rpt1', title: 'imported' },
        },
      };
      const errors = [
        createTypiaError(
          '$input.taskRepeatCfg.entities["rpt1"].quickSetting',
          '("CUSTOM" | "DAILY" | "MONDAY_TO_FRIDAY" | ...)',
          undefined,
        ),
      ];

      const result = autoFixTypiaErrors(mockData, errors);

      expect((result as any).taskRepeatCfg.entities.rpt1.quickSetting).toBe('CUSTOM');
      expect(errSpy).toHaveBeenCalledWith(
        '[auto-fix-typia-errors] Applied validation auto-fix',
        undefined,
        jasmine.objectContaining({
          fix: 'task-repeat-cfg-quickSetting-undefined-to-custom',
          pathRoot: 'taskRepeatCfg',
        }),
      );
    });

    it('should default undefined tag.created to a number timestamp', () => {
      const mockData = createAppDataCompleteMock();
      (mockData as any).tag = {
        ids: ['TODAY'],
        entities: {
          TODAY: { id: 'TODAY', title: 'Today', taskIds: [] },
        },
      };
      const before = Date.now();
      const errors = [
        createTypiaError('$input.tag.entities.TODAY.created', 'number', undefined),
      ];

      const result = autoFixTypiaErrors(mockData, errors);

      const created = (result as any).tag.entities.TODAY.created;
      expect(typeof created).toBe('number');
      expect(created).toBeGreaterThanOrEqual(before);
      expect(errSpy).toHaveBeenCalledWith(
        '[auto-fix-typia-errors] Applied validation auto-fix',
        undefined,
        jasmine.objectContaining({
          fix: 'tag-created-undefined-to-now',
          pathRoot: 'tag',
        }),
      );
    });
  });

  describe('issue #9139 — tag/project entities missing `theme` entirely', () => {
    // The `expected` string typia ACTUALLY emits for this error, captured by
    // running the real validator. It is a generated anonymous type name whose
    // ordinal suffix moves whenever the type graph changes — which is exactly
    // why the fix must not key on it. See the no-longer-brittle test below.
    const REAL_EXPECTED = 'Readonly<__type>.o26';

    it('should backfill a missing tag.theme with the default tag theme', () => {
      const mockData = createAppDataCompleteMock();
      (mockData as any).tag = {
        ids: ['t1', 't2'],
        entities: {
          t1: { id: 't1', title: 'User tag', taskIds: [] },
          t2: { id: 't2', title: 'Other', taskIds: [] },
        },
      };
      const errors = [
        createTypiaError('$input.tag.entities.t1.theme', REAL_EXPECTED, undefined),
        createTypiaError('$input.tag.entities.t2.theme', REAL_EXPECTED, undefined),
      ];

      const result = autoFixTypiaErrors(mockData, errors);

      const a = (result as any).tag.entities.t1.theme;
      const b = (result as any).tag.entities.t2.theme;
      expect(a).toEqual(DEFAULT_TAG.theme);
      // Backfill a COPY: aliasing the constant across entities would let any
      // later mutation write through into DEFAULT_TAG for the whole app.
      expect(a).not.toBe(DEFAULT_TAG.theme);
      expect(a).not.toBe(b);
      expect(errSpy).toHaveBeenCalledWith(
        '[auto-fix-typia-errors] Applied validation auto-fix',
        undefined,
        jasmine.objectContaining({
          fix: 'work-context-theme-undefined-to-default',
          pathRoot: 'tag',
        }),
      );
    });

    it('should backfill a missing project.theme with the default project theme', () => {
      const mockData = createAppDataCompleteMock();
      (mockData as any).project = {
        ids: ['p1'],
        entities: { p1: { id: 'p1', title: 'Proj', taskIds: [] } },
      };
      const errors = [
        createTypiaError('$input.project.entities.p1.theme', REAL_EXPECTED, undefined),
      ];

      const result = autoFixTypiaErrors(mockData, errors);

      expect((result as any).project.entities.p1.theme).toEqual(DEFAULT_PROJECT.theme);
    });

    it('should still fire when typia renames the generated `expected` type', () => {
      // Guards the #9045 failure mode: a branch keyed on `error.expected`
      // would silently stop firing the moment the ordinal shifts. This fix
      // matches on path + `value === undefined` only, so a renamed type must
      // not change the outcome.
      const mockData = createAppDataCompleteMock();
      (mockData as any).tag = {
        ids: ['t1'],
        entities: { t1: { id: 't1', title: 'User tag', taskIds: [] } },
      };
      const errors = [
        createTypiaError(
          '$input.tag.entities.t1.theme',
          'Readonly<__type>.o99999',
          undefined,
        ),
      ];

      const result = autoFixTypiaErrors(mockData, errors);

      expect((result as any).tag.entities.t1.theme).toEqual(DEFAULT_TAG.theme);
    });

    it('should repair an explicit null theme, not just a missing one', () => {
      // The `setOne` 'replace' branch applies a remote entity verbatim, so
      // `theme: null` is reachable and typia reports it at the same path with
      // `value: null`. Gating on `undefined` alone left this dead-ending the
      // repair pipeline ("state still invalid after repair").
      const mockData = createAppDataCompleteMock();
      (mockData as any).tag = {
        ids: ['t1'],
        entities: { t1: { id: 't1', title: 'Other', taskIds: [], theme: null } },
      };
      const errors = [
        createTypiaError('$input.tag.entities.t1.theme', REAL_EXPECTED, null),
      ];

      const result = autoFixTypiaErrors(mockData, errors);

      expect((result as any).tag.entities.t1.theme).toEqual(DEFAULT_TAG.theme);
      // Pins the branch's POSITION in the else-if chain: one of the earlier
      // `expected.includes('null'|'undefined')` branches swallowing this error
      // would still leave state changed, but under a different fix label.
      expect(errSpy).toHaveBeenCalledWith(
        '[auto-fix-typia-errors] Applied validation auto-fix',
        undefined,
        jasmine.objectContaining({ fix: 'work-context-theme-undefined-to-default' }),
      );
    });

    it('should restore the TODAY tag its own theme, not the generic tag default', () => {
      // TODAY is the entity from the #9139 report and ships a distinct theme.
      // The repair is written to disk, so a generic default would permanently
      // restyle it (cornflower + tint-disabled -> purple + tint-enabled).
      const mockData = createAppDataCompleteMock();
      (mockData as any).tag = {
        ids: ['TODAY'],
        entities: { TODAY: { id: 'TODAY', title: 'Today', taskIds: [] } },
      };
      const errors = [
        createTypiaError('$input.tag.entities.TODAY.theme', REAL_EXPECTED, undefined),
      ];

      const result = autoFixTypiaErrors(mockData, errors);

      const healed = (result as any).tag.entities.TODAY.theme;
      expect(healed).toEqual(TODAY_TAG.theme);
      expect(healed.primary).toBe(TODAY_TAG.theme.primary);
      expect(healed.isDisableBackgroundTint).toBe(true);
      expect(healed.huePrimary).toBe('400');
      // Guards the regression this test was written for.
      expect(healed.primary).not.toBe(DEFAULT_TAG.theme.primary);
    });

    it('should restore the INBOX project its own theme', () => {
      const mockData = createAppDataCompleteMock();
      (mockData as any).project = {
        ids: [INBOX_PROJECT.id],
        entities: {
          [INBOX_PROJECT.id]: { id: INBOX_PROJECT.id, title: 'Inbox', taskIds: [] },
        },
      };
      const errors = [
        createTypiaError(
          `$input.project.entities.${INBOX_PROJECT.id}.theme`,
          REAL_EXPECTED,
          undefined,
        ),
      ];

      const result = autoFixTypiaErrors(mockData, errors);

      const healed = (result as any).project.entities[INBOX_PROJECT.id].theme;
      expect(healed).toEqual(INBOX_PROJECT.theme);
      expect(healed.primary).not.toBe(DEFAULT_PROJECT.theme.primary);
    });

    it('should not resolve a hostile "__proto__" entity id to a system theme', () => {
      // The lookup is a Map for exactly this: an object literal would return
      // Object.prototype here, which is non-nullish, so the `??` would not fall
      // through and the entity would be healed to an empty theme.
      const mockData = createAppDataCompleteMock();
      // Built via JSON.parse because that is what a hostile payload actually
      // arrives as, and it is the ONLY construction that yields a genuine own
      // "__proto__" key. `obj['__proto__'] = x` invokes the inherited setter
      // and sets the prototype instead, creating no own property.
      const tagState = JSON.parse(
        '{"ids":["__proto__"],"entities":{"__proto__":{"id":"__proto__","title":"x","taskIds":[]}}}',
      );
      expect(Object.prototype.hasOwnProperty.call(tagState.entities, '__proto__')).toBe(
        true,
      );
      (mockData as any).tag = tagState;
      const errors = [
        createTypiaError('$input.tag.entities.__proto__.theme', REAL_EXPECTED, undefined),
      ];

      const result = autoFixTypiaErrors(mockData, errors);

      expect((result as any).tag.entities['__proto__'].theme).toEqual(DEFAULT_TAG.theme);
    });
  });
});

// Every test above hand-builds its typia errors, so all of them would still
// pass if REAL typia reported a themeless entity somewhere else entirely and
// the fix's branch never fired on real data. That is not hypothetical here:
// #9045 shipped a check that was fully tested and never once ran in
// production. These tests close that loop by driving the actual validator.
describe('autoFixTypiaErrors — against REAL typia validation (#9139)', () => {
  beforeEach(() => {
    spyOn(OP_LOG_SYNC_LOGGER, 'err').and.stub();
    spyOn(OP_LOG_SYNC_LOGGER, 'warn').and.stub();
  });

  // A tag/project that is valid in every respect except what each test does to
  // `theme`, so nothing unrelated pollutes the error list.
  const buildTag = (mutate: (t: Record<string, unknown>) => void): AppDataComplete => {
    const d = createAppDataCompleteMock() as unknown as Record<string, unknown>;
    const tag = {
      ...DEFAULT_TAG,
      id: 't1',
      title: 'Probe',
      created: Date.now(),
    } as unknown as Record<string, unknown>;
    mutate(tag);
    d.tag = { ids: ['t1'], entities: { t1: tag } };
    return d as unknown as AppDataComplete;
  };

  const buildProject = (
    mutate: (p: Record<string, unknown>) => void,
  ): AppDataComplete => {
    const d = createAppDataCompleteMock() as unknown as Record<string, unknown>;
    const project = { ...DEFAULT_PROJECT, id: 'p1', title: 'Probe' } as unknown as Record<
      string,
      unknown
    >;
    mutate(project);
    d.project = { ids: ['p1'], entities: { p1: project } };
    return d as unknown as AppDataComplete;
  };

  const errorsOf = (d: AppDataComplete): IValidation.IError[] => {
    const res = validateAllData(d) as { success: boolean; errors?: IValidation.IError[] };
    return res.errors ?? [];
  };
  const isValid = (d: AppDataComplete): boolean =>
    (validateAllData(d) as { success: boolean }).success;

  it('the unmodified mock is fully valid, so any error below is caused by the test', () => {
    // Without this the round-trips further down could pass or fail for reasons
    // that have nothing to do with `theme`.
    expect(isValid(createAppDataCompleteMock())).toBe(true);
  });

  (
    [
      ['tag', (): AppDataComplete => buildTag((t) => delete t.theme), 't1'],
      ['project', (): AppDataComplete => buildProject((p) => delete p.theme), 'p1'],
    ] as const
  ).forEach(([root, build, entityId]) => {
    it(`real typia reports a missing ${root} theme at the exact path the fix matches`, () => {
      const errors = errorsOf(build());

      // The branch keys on: keys[0] in {tag,project}, keys[1] === 'entities',
      // keys.length === 4, keys[3] === 'theme'. If typia ever reported this
      // per-member (deeper) or on the entity (shallower), the fix would go
      // silently dead — so pin the shape, not just "some error exists".
      expect(errors.length).toBe(1);
      expect(errors[0].path).toBe(`$input.${root}.entities.${entityId}.theme`);
      expect(errors[0].path.split('.').length - 1).toBe(4);
      expect(errors[0].value).toBeUndefined();
    });

    it(`repairing the real errors makes the ${root} data validate clean`, () => {
      const data = build();
      expect(isValid(data)).toBe(false);

      const repaired = autoFixTypiaErrors(data, errorsOf(data)) as AppDataComplete;

      // The round trip is the point: the fix does not merely write *a* value,
      // it writes one the validator accepts.
      expect(isValid(repaired)).toBe(true);
    });
  });

  it('real typia reports an explicit null theme at the same path', () => {
    // Justifies the `value == null` gate rather than `=== undefined`: null is
    // reachable via the setOne 'replace' branch and reported identically.
    const errors = errorsOf(buildTag((t) => (t.theme = null)));

    expect(errors.length).toBe(1);
    expect(errors[0].path).toBe('$input.tag.entities.t1.theme');
    expect(errors[0].value).toBeNull();
  });

  // KNOWN GAP (#9156), pinned deliberately as characterization, NOT approval.
  //
  // Every member of WorkContextThemeCfg is optional; only `theme` itself is
  // required. So typia accepts `{}` and even a theme missing `primary` — no
  // error is produced, which means the heal above can never see them and the
  // read-side `??` never fires either (both are nullish-gated).
  //
  // This is why an empty theme is STICKIER than a missing one: a missing theme
  // self-heals on the next validation pass, `{}` is invisible to validation
  // forever. The settings dialog persists exactly `{}` (see #9156).
  //
  // When #9156 is fixed these expectations SHOULD flip — that is the signal,
  // not a regression.
  it('DOCUMENTS #9156: an empty or partial theme is invisible to validation', () => {
    expect(isValid(buildTag((t) => (t.theme = {})))).toBe(true);
    expect(
      isValid(
        buildTag((t) => {
          const theme = { ...DEFAULT_TAG.theme } as Record<string, unknown>;
          delete theme.primary;
          t.theme = theme;
        }),
      ),
    ).toBe(true);
  });
});
