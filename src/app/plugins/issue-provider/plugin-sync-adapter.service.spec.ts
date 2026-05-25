import { createPluginSyncAdapter } from './plugin-sync-adapter.service';
import {
  IssueProviderPluginDefinition,
  PluginFieldMapping,
  PluginHttp,
} from './plugin-issue-provider.model';
import { IssueProviderPluginType } from '../../features/issue/issue.model';

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

describe('createPluginSyncAdapter', () => {
  it('should return field mappings from plugin definition', () => {
    const adapter = createPluginSyncAdapter(createMockDefinition(), () => mockHttpHelper);

    const mappings = adapter.getFieldMappings();

    expect(mappings.length).toBe(2);
    expect(mappings[0].taskField).toBe('isDone');
    expect(mappings[0].issueField).toBe('state');
    expect(mappings[1].taskField).toBe('title');
  });

  it('should return sync config from pluginConfig.twoWaySync', () => {
    const adapter = createPluginSyncAdapter(createMockDefinition(), () => mockHttpHelper);

    const syncConfig = adapter.getSyncConfig(MOCK_CFG);

    expect(syncConfig).toEqual(
      jasmine.objectContaining({
        isDone: 'both',
        title: 'pullOnly',
      }),
    );
  });

  it('should return empty sync config when twoWaySync is absent', () => {
    const adapter = createPluginSyncAdapter(createMockDefinition(), () => mockHttpHelper);

    const cfgWithoutSync = {
      ...MOCK_CFG,
      pluginConfig: {},
    };

    expect(adapter.getSyncConfig(cfgWithoutSync)).toEqual({});
  });

  it('should fetch issue via definition.getById', async () => {
    const definition = createMockDefinition();
    const adapter = createPluginSyncAdapter(definition, () => mockHttpHelper);

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
    const adapter = createPluginSyncAdapter(definition, () => mockHttpHelper);

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
    const adapter = createPluginSyncAdapter(definition, () => mockHttpHelper);

    await expectAsync(
      adapter.pushChanges('1', { state: 'closed' }, MOCK_CFG),
    ).toBeRejectedWithError(/does not implement updateIssue/);
  });

  it('should extract sync values via definition.extractSyncValues', () => {
    const definition = createMockDefinition();
    const adapter = createPluginSyncAdapter(definition, () => mockHttpHelper);

    const issue = { state: 'open', title: 'test', extra: 'ignored' };
    const result = adapter.extractSyncValues(issue);

    expect(definition.extractSyncValues).toHaveBeenCalledWith(issue);
    expect(result).toEqual({ state: 'open', title: 'test' });
  });

  it('should fall back to field-based extraction when extractSyncValues is absent', () => {
    const definition = createMockDefinition({ extractSyncValues: undefined });
    const adapter = createPluginSyncAdapter(definition, () => mockHttpHelper);

    const issue = { state: 'open', title: 'test', extra: 'ignored' };
    const result = adapter.extractSyncValues(issue);

    expect(result).toEqual({ state: 'open', title: 'test' });
  });

  it('should create issue via definition.createIssue', async () => {
    const definition = createMockDefinition();
    const adapter = createPluginSyncAdapter(definition, () => mockHttpHelper);

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
    const adapter = createPluginSyncAdapter(definition, () => mockHttpHelper);

    await expectAsync(adapter.createIssue!('new issue', MOCK_CFG)).toBeRejectedWithError(
      /does not implement createIssue/,
    );
  });

  it('should convert field mapping direction functions correctly', () => {
    const adapter = createPluginSyncAdapter(createMockDefinition(), () => mockHttpHelper);

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
    );

    const mappings = adapter.getFieldMappings();
    const dueDayMapping = mappings.find((m) => m.taskField === 'dueDay');

    expect(dueDayMapping).toBeDefined();
    expect(dueDayMapping!.mutuallyExclusive).toEqual(['dueWithTime']);
  });

  it('should not set mutuallyExclusive when not provided in plugin mapping', () => {
    const adapter = createPluginSyncAdapter(createMockDefinition(), () => mockHttpHelper);

    const mappings = adapter.getFieldMappings();

    expect(mappings[0].mutuallyExclusive).toBeUndefined();
  });

  it('should delete issue via definition.deleteIssue', async () => {
    const deleteIssueSpy = jasmine
      .createSpy('deleteIssue')
      .and.returnValue(Promise.resolve());
    const definition = createMockDefinition({ deleteIssue: deleteIssueSpy });
    const adapter = createPluginSyncAdapter(definition, () => mockHttpHelper);

    await adapter.deleteIssue!('99', MOCK_CFG);

    expect(deleteIssueSpy).toHaveBeenCalledWith(
      '99',
      MOCK_CFG.pluginConfig,
      jasmine.anything(),
    );
  });

  it('should set deleteIssue to undefined when definition does not implement it', () => {
    const definition = createMockDefinition({ deleteIssue: undefined });
    const adapter = createPluginSyncAdapter(definition, () => mockHttpHelper);

    expect(adapter.deleteIssue).toBeUndefined();
  });
});
