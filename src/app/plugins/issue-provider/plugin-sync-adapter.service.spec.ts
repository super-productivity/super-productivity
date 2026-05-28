import { createPluginSyncAdapter } from './plugin-sync-adapter.service';
import {
  IssueProviderPluginDefinition,
  PluginFieldMapping,
  PluginHttp,
} from './plugin-issue-provider.model';
import { IssueProviderPluginType } from '../../features/issue/issue.model';
import { TagService } from '../../features/tag/tag.service';

const MOCK_FIELD_MAPPINGS: PluginFieldMapping[] = [
  {
    taskField: 'isDone',
    issueField: 'state',
    defaultDirection: 'pullOnly',
    toIssueValue: (v: unknown) => (v ? 'closed' : 'open'),
    toTaskValue: (v: unknown) => v === 'closed',
  },
  {
    taskField: 'title',
    issueField: 'title',
    defaultDirection: 'pullOnly',
    toIssueValue: (v: unknown) => v,
    toTaskValue: (v: unknown) => v,
  },
];

const MOCK_TAG_IDS_FIELD_MAPPING: PluginFieldMapping = {
  taskField: 'tagIds',
  issueField: 'labels',
  defaultDirection: 'both',
  toIssueValue: (v: unknown) => v,
  toTaskValue: (v: unknown) => v,
};

const createMockDefinition = (
  overrides: Partial<IssueProviderPluginDefinition> = {},
): IssueProviderPluginDefinition => ({
  configFields: [],
  getHeaders: () => ({ Authorization: 'token abc' }),
  searchIssues: () => Promise.resolve([]),
  getById: jasmine
    .createSpy('getById')
    .and.returnValue(
      Promise.resolve({ id: '1', title: 'issue', state: 'open', body: 'text' }),
    ),
  getIssueLink: () => 'http://mock/1',
  issueDisplay: [],
  fieldMappings: MOCK_FIELD_MAPPINGS,
  updateIssue: jasmine.createSpy('updateIssue').and.returnValue(Promise.resolve()),
  extractSyncValues: jasmine
    .createSpy('extractSyncValues')
    .and.callFake((issue: Record<string, unknown>) => ({
      state: issue['state'],
      title: issue['title'],
    })),
  createIssue: jasmine.createSpy('createIssue').and.returnValue(
    Promise.resolve({
      issueId: '42',
      issueNumber: 42,
      issueData: { id: '42', title: 'new issue', state: 'open' },
    }),
  ),
  ...overrides,
});

const MOCK_CFG: IssueProviderPluginType = {
  id: 'test-provider-id',
  isEnabled: true,
  issueProviderKey: 'plugin:test',
  pluginId: 'test',
  pluginConfig: {
    twoWaySync: {
      isDone: 'both',
      title: 'pullOnly',
    },
  },
} as IssueProviderPluginType;

const mockHttpHelper: PluginHttp = {
  get: jasmine.createSpy('get'),
  post: jasmine.createSpy('post'),
  put: jasmine.createSpy('put'),
  patch: jasmine.createSpy('patch'),
  delete: jasmine.createSpy('delete'),
  request: jasmine.createSpy('request'),
};

const mockTagService = {
  tags: () => [],
  addTag: jasmine.createSpy('addTag').and.returnValue('new-tag-id'),
} as unknown as TagService;

describe('createPluginSyncAdapter', () => {
  it('should return field mappings from plugin definition', () => {
    const adapter = createPluginSyncAdapter(
      createMockDefinition(),
      () => mockHttpHelper,
      mockTagService,
    );

    const mappings = adapter.getFieldMappings();

    expect(mappings.length).toBe(2);
    expect(mappings[0].taskField).toBe('isDone');
    expect(mappings[0].issueField).toBe('state');
    expect(mappings[1].taskField).toBe('title');
  });

  it('should return sync config from pluginConfig.twoWaySync', () => {
    const adapter = createPluginSyncAdapter(
      createMockDefinition(),
      () => mockHttpHelper,
      mockTagService,
    );

    const syncConfig = adapter.getSyncConfig(MOCK_CFG);

    expect(syncConfig).toEqual(
      jasmine.objectContaining({
        isDone: 'both',
        title: 'pullOnly',
      }),
    );
  });

  it('should downgrade push directions when updateIssue is absent', () => {
    const adapter = createPluginSyncAdapter(
      createMockDefinition({
        updateIssue: undefined,
        fieldMappings: [
          {
            taskField: 'isDone',
            issueField: 'state',
            defaultDirection: 'both',
            toIssueValue: (v: unknown) => (v ? 'closed' : 'open'),
            toTaskValue: (v: unknown) => v === 'closed',
          },
        ],
      }),
      () => mockHttpHelper,
      mockTagService,
    );

    expect(adapter.getFieldMappings()[0].defaultDirection).toBe('pullOnly');
    expect(
      adapter.getSyncConfig({
        ...MOCK_CFG,
        pluginConfig: { twoWaySync: { isDone: 'pushOnly' } },
      }).isDone,
    ).toBe('pullOnly');
  });

  it('should return empty sync config when twoWaySync is absent', () => {
    const adapter = createPluginSyncAdapter(
      createMockDefinition(),
      () => mockHttpHelper,
      mockTagService,
    );

    const cfgWithoutSync = {
      ...MOCK_CFG,
      pluginConfig: {},
    };

    expect(adapter.getSyncConfig(cfgWithoutSync)).toEqual({});
  });

  it('should fetch issue via definition.getById', async () => {
    const definition = createMockDefinition();
    const adapter = createPluginSyncAdapter(
      definition,
      () => mockHttpHelper,
      mockTagService,
    );

    const result = await adapter.fetchIssue('1', MOCK_CFG);

    expect(definition.getById).toHaveBeenCalledWith(
      '1',
      MOCK_CFG.pluginConfig,
      jasmine.anything(),
    );
    expect(result['id']).toBe('1');
  });

  it('should push changes via definition.updateIssue', async () => {
    const definition = createMockDefinition();
    const adapter = createPluginSyncAdapter(
      definition,
      () => mockHttpHelper,
      mockTagService,
    );

    await adapter.pushChanges('1', { state: 'closed' }, MOCK_CFG);

    expect(definition.updateIssue).toHaveBeenCalledWith(
      '1',
      { state: 'closed' },
      MOCK_CFG.pluginConfig,
      jasmine.anything(),
    );
  });

  it('should throw when pushing without updateIssue', async () => {
    const definition = createMockDefinition({ updateIssue: undefined });
    const adapter = createPluginSyncAdapter(
      definition,
      () => mockHttpHelper,
      mockTagService,
    );

    await expectAsync(
      adapter.pushChanges('1', { state: 'closed' }, MOCK_CFG),
    ).toBeRejectedWithError(/does not implement updateIssue/);
  });

  it('should extract sync values via definition.extractSyncValues', () => {
    const definition = createMockDefinition();
    const adapter = createPluginSyncAdapter(
      definition,
      () => mockHttpHelper,
      mockTagService,
    );

    const issue = { state: 'open', title: 'test', extra: 'ignored' };
    const result = adapter.extractSyncValues(issue);

    expect(definition.extractSyncValues).toHaveBeenCalledWith(issue);
    expect(result).toEqual({ state: 'open', title: 'test' });
  });

  it('should fall back to field-based extraction when extractSyncValues is absent', () => {
    const definition = createMockDefinition({ extractSyncValues: undefined });
    const adapter = createPluginSyncAdapter(
      definition,
      () => mockHttpHelper,
      mockTagService,
    );

    const issue = { state: 'open', title: 'test', extra: 'ignored' };
    const result = adapter.extractSyncValues(issue);

    expect(result).toEqual({ state: 'open', title: 'test' });
  });

  it('should create issue via definition.createIssue', async () => {
    const definition = createMockDefinition();
    const adapter = createPluginSyncAdapter(
      definition,
      () => mockHttpHelper,
      mockTagService,
    );

    const result = await adapter.createIssue!('new issue', MOCK_CFG);

    expect(definition.createIssue).toHaveBeenCalledWith(
      'new issue',
      MOCK_CFG.pluginConfig,
      jasmine.anything(),
    );
    expect(result.issueId).toBe('42');
    expect(result.issueNumber).toBe(42);
  });

  it('should throw when creating without createIssue', async () => {
    const definition = createMockDefinition({ createIssue: undefined });
    const adapter = createPluginSyncAdapter(
      definition,
      () => mockHttpHelper,
      mockTagService,
    );

    await expectAsync(adapter.createIssue!('new issue', MOCK_CFG)).toBeRejectedWithError(
      /does not implement createIssue/,
    );
  });

  it('should convert field mapping direction functions correctly', () => {
    const adapter = createPluginSyncAdapter(
      createMockDefinition(),
      () => mockHttpHelper,
      mockTagService,
    );

    const mappings = adapter.getFieldMappings();
    const isDoneMapping = mappings[0];

    expect(isDoneMapping.toIssueValue(true, { issueId: '1' })).toBe('closed');
    expect(isDoneMapping.toIssueValue(false, { issueId: '1' })).toBe('open');
    expect(isDoneMapping.toTaskValue('closed', { issueId: '1' })).toBeTrue();
    expect(isDoneMapping.toTaskValue('open', { issueId: '1' })).toBeFalse();
  });

  it('should forward mutuallyExclusive from plugin mapping', () => {
    const mappingsWithExclusive: PluginFieldMapping[] = [
      ...MOCK_FIELD_MAPPINGS,
      {
        taskField: 'dueDay',
        issueField: 'start_date',
        defaultDirection: 'both',
        mutuallyExclusive: ['dueWithTime'],
        toIssueValue: (v: unknown) => v,
        toTaskValue: (v: unknown) => v,
      },
    ];
    const adapter = createPluginSyncAdapter(
      createMockDefinition({ fieldMappings: mappingsWithExclusive }),
      () => mockHttpHelper,
      mockTagService,
    );

    const mappings = adapter.getFieldMappings();
    const dueDayMapping = mappings.find((m) => m.taskField === 'dueDay');

    expect(dueDayMapping).toBeDefined();
    expect(dueDayMapping!.mutuallyExclusive).toEqual(['dueWithTime']);
  });

  it('should not set mutuallyExclusive when not provided in plugin mapping', () => {
    const adapter = createPluginSyncAdapter(
      createMockDefinition(),
      () => mockHttpHelper,
      mockTagService,
    );

    const mappings = adapter.getFieldMappings();

    expect(mappings[0].mutuallyExclusive).toBeUndefined();
  });

  it('should delete issue via definition.deleteIssue', async () => {
    const deleteIssueSpy = jasmine
      .createSpy('deleteIssue')
      .and.returnValue(Promise.resolve());
    const definition = createMockDefinition({ deleteIssue: deleteIssueSpy });
    const adapter = createPluginSyncAdapter(
      definition,
      () => mockHttpHelper,
      mockTagService,
    );

    await adapter.deleteIssue!('99', MOCK_CFG);

    expect(deleteIssueSpy).toHaveBeenCalledWith(
      '99',
      MOCK_CFG.pluginConfig,
      jasmine.anything(),
    );
  });

  it('should set deleteIssue to undefined when definition does not implement it', () => {
    const definition = createMockDefinition({ deleteIssue: undefined });
    const adapter = createPluginSyncAdapter(
      definition,
      () => mockHttpHelper,
      mockTagService,
    );

    expect(adapter.deleteIssue).toBeUndefined();
  });

  describe('tagIds mapping', () => {
    const tagIdA = 'tag-a';
    const tagIdB = 'tag-b';
    const tagServiceWithTags = {
      tags: () => [
        { id: tagIdA, title: 'bug' },
        { id: tagIdB, title: 'feature' },
      ],
      addTag: jasmine.createSpy('addTag'),
    } as unknown as TagService;

    it('should convert tagIds to sorted label array via toIssueValue', () => {
      const definition = createMockDefinition({
        fieldMappings: [...MOCK_FIELD_MAPPINGS, MOCK_TAG_IDS_FIELD_MAPPING],
      });
      const adapter = createPluginSyncAdapter(
        definition,
        () => mockHttpHelper,
        tagServiceWithTags,
      );

      const mappings = adapter.getFieldMappings();
      const tagMapping = mappings.find((m) => m.taskField === 'tagIds');

      expect(tagMapping).toBeDefined();
      const result = tagMapping!.toIssueValue([tagIdB, tagIdA], {
        issueId: '1',
      }) as string[];
      expect(result).toEqual(['bug', 'feature']);
    });

    it('should fall back to raw tagId as label when tag is not found locally', () => {
      const tagServiceNoTags = {
        tags: () => [],
        addTag: jasmine.createSpy('addTag'),
      } as unknown as TagService;

      const definition = createMockDefinition({
        fieldMappings: [...MOCK_FIELD_MAPPINGS, MOCK_TAG_IDS_FIELD_MAPPING],
      });
      const adapter = createPluginSyncAdapter(
        definition,
        () => mockHttpHelper,
        tagServiceNoTags,
      );

      const mappings = adapter.getFieldMappings();
      const tagMapping = mappings.find((m) => m.taskField === 'tagIds');

      const result = tagMapping!.toIssueValue(['unknown-tag-id'], {
        issueId: '1',
      }) as string[];
      expect(result).toEqual(['unknown-tag-id']);
    });

    it('should sort label arrays in extractSyncValues for consistent diffing', () => {
      const definition = createMockDefinition({
        fieldMappings: [...MOCK_FIELD_MAPPINGS, MOCK_TAG_IDS_FIELD_MAPPING],
        extractSyncValues: undefined,
      });
      const adapter = createPluginSyncAdapter(
        definition,
        () => mockHttpHelper,
        tagServiceWithTags,
      );

      const issue = { state: 'open', title: 'test', labels: ['feature', 'bug'] };
      const result = adapter.extractSyncValues(issue);

      expect(result['labels']).toEqual(['bug', 'feature']);
    });

    it('should fall back to the raw issue field when extractSyncValues omits labels', () => {
      const definition = createMockDefinition({
        fieldMappings: [...MOCK_FIELD_MAPPINGS, MOCK_TAG_IDS_FIELD_MAPPING],
        extractSyncValues: jasmine
          .createSpy('extractSyncValues')
          .and.returnValue({ state: 'open', title: 'test' }),
      });
      const adapter = createPluginSyncAdapter(
        definition,
        () => mockHttpHelper,
        tagServiceWithTags,
      );

      const issue = { state: 'open', title: 'test', labels: ['feature', 'bug'] };
      const result = adapter.extractSyncValues(issue);

      expect(result['labels']).toEqual(['bug', 'feature']);
    });
  });
});
