import { TestBed } from '@angular/core/testing';
import { PluginIssueProviderRegistryService } from './plugin-issue-provider-registry.service';
import {
  IssueProviderPluginDefinition,
  PluginIssueField,
  PluginFormField,
  PluginCommentsConfig,
  PluginFieldMapping,
} from './plugin-issue-provider.model';

const createMockDefinition = (
  overrides: Partial<IssueProviderPluginDefinition> = {},
): IssueProviderPluginDefinition => ({
  configFields: [],
  getHeaders: () => ({}),
  searchIssues: () => Promise.resolve([]),
  getById: () => Promise.resolve({ id: '1', title: 'mock', body: '', url: '' }),
  getIssueLink: () => 'http://mock',
  issueDisplay: [],
  ...overrides,
});

const registerProvider = (
  svc: PluginIssueProviderRegistryService,
  pluginId: string,
  definition: IssueProviderPluginDefinition,
  name: string,
  humanReadableName: string,
  icon: string,
  pollIntervalMs: number,
  issueStrings: { singular: string; plural: string },
): void =>
  svc.register({
    pluginId,
    definition,
    name,
    humanReadableName,
    icon,
    pollIntervalMs,
    issueStrings,
  });

describe('PluginIssueProviderRegistryService', () => {
  let service: PluginIssueProviderRegistryService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [PluginIssueProviderRegistryService],
    });
    service = TestBed.inject(PluginIssueProviderRegistryService);
  });

  describe('register', () => {
    it('should register a provider and store it under plugin:<pluginId>', () => {
      const definition = createMockDefinition();

      registerProvider(
        service,
        'my-plugin',
        definition,
        'My Plugin',
        'My Plugin',
        'bug_report',
        5000,
        {
          singular: 'Bug',
          plural: 'Bugs',
        },
      );

      expect(service.hasProvider('plugin:my-plugin')).toBeTrue();
    });

    it('should warn and reject duplicate registrations', () => {
      const definition = createMockDefinition();
      spyOn(console, 'warn');

      registerProvider(service, 'dup', definition, 'First', 'First', 'icon1', 1000, {
        singular: 'A',
        plural: 'As',
      });
      registerProvider(service, 'dup', definition, 'Second', 'Second', 'icon2', 2000, {
        singular: 'B',
        plural: 'Bs',
      });

      expect(console.warn).toHaveBeenCalledWith(
        jasmine.stringContaining('Duplicate registration'),
      );
      // The first registration should be preserved
      expect(service.getName('plugin:dup')).toBe('First');
      expect(service.getIcon('plugin:dup')).toBe('icon1');
    });
  });

  describe('getProvider', () => {
    it('should return the registered provider by key', () => {
      const definition = createMockDefinition();

      registerProvider(
        service,
        'provider-a',
        definition,
        'Provider A',
        'Provider A',
        'star',
        3000,
        {
          singular: 'Ticket',
          plural: 'Tickets',
        },
      );

      const provider = service.getProvider('plugin:provider-a');

      expect(provider).toBeDefined();
      expect(provider!.pluginId).toBe('provider-a');
      expect(provider!.name).toBe('Provider A');
      expect(provider!.icon).toBe('star');
      expect(provider!.pollIntervalMs).toBe(3000);
      expect(provider!.issueStrings).toEqual({
        singular: 'Ticket',
        plural: 'Tickets',
      });
      expect(provider!.definition).toBe(definition);
    });

    it('should return undefined for an unregistered key', () => {
      expect(service.getProvider('plugin:nonexistent')).toBeUndefined();
    });
  });

  describe('unregister', () => {
    it('should remove a previously registered provider', () => {
      const definition = createMockDefinition();

      registerProvider(
        service,
        'to-remove',
        definition,
        'Remove Me',
        'Remove Me',
        'delete',
        1000,
        {
          singular: 'X',
          plural: 'Xs',
        },
      );

      expect(service.hasProvider('plugin:to-remove')).toBeTrue();

      service.unregister('to-remove');

      expect(service.hasProvider('plugin:to-remove')).toBeFalse();
      expect(service.getProvider('plugin:to-remove')).toBeUndefined();
    });

    it('should not throw when unregistering a non-existent provider', () => {
      expect(() => service.unregister('does-not-exist')).not.toThrow();
    });
  });

  describe('hasProvider', () => {
    it('should return true for a registered provider', () => {
      registerProvider(service, 'exists', createMockDefinition(), 'E', 'E', 'e', 0, {
        singular: 'a',
        plural: 'as',
      });

      expect(service.hasProvider('plugin:exists')).toBeTrue();
    });

    it('should return false for an unregistered key', () => {
      expect(service.hasProvider('plugin:nope')).toBeFalse();
    });
  });

  describe('getAvailableProviders', () => {
    it('should return all registered providers', () => {
      registerProvider(service, 'p1', createMockDefinition(), 'P1', 'P1', 'i1', 100, {
        singular: 'a',
        plural: 'as',
      });
      registerProvider(service, 'p2', createMockDefinition(), 'P2', 'P2', 'i2', 200, {
        singular: 'b',
        plural: 'bs',
      });

      const providers = service.getAvailableProviders();

      expect(providers.length).toBe(2);
      expect(providers.map((p) => p.pluginId)).toEqual(
        jasmine.arrayContaining(['p1', 'p2']),
      );
    });

    it('should return an empty array when no providers are registered', () => {
      expect(service.getAvailableProviders()).toEqual([]);
    });
  });

  describe('getIcon', () => {
    it('should return the icon for a registered provider', () => {
      registerProvider(
        service,
        'icon-test',
        createMockDefinition(),
        'N',
        'N',
        'custom_icon',
        0,
        {
          singular: 'a',
          plural: 'as',
        },
      );

      expect(service.getIcon('plugin:icon-test')).toBe('custom_icon');
    });

    it('should return "extension" as default for an unregistered key', () => {
      expect(service.getIcon('plugin:unknown')).toBe('extension');
    });
  });

  describe('getName', () => {
    it('should return the name for a registered provider', () => {
      registerProvider(
        service,
        'name-test',
        createMockDefinition(),
        'My Provider',
        'My Provider',
        'i',
        0,
        {
          singular: 'a',
          plural: 'as',
        },
      );

      expect(service.getName('plugin:name-test')).toBe('My Provider');
    });

    it('should return "Plugin" as default for an unregistered key', () => {
      expect(service.getName('plugin:unknown')).toBe('Plugin');
    });
  });

  describe('getIssueStrings', () => {
    it('should return mapped issue strings for a registered provider', () => {
      registerProvider(service, 'str-test', createMockDefinition(), 'N', 'N', 'i', 0, {
        singular: 'Task',
        plural: 'Tasks',
      });

      const result = service.getIssueStrings('plugin:str-test');

      expect(result).toEqual({ ISSUE_STR: 'Task', ISSUES_STR: 'Tasks' });
    });

    it('should return "Issue"/"Issues" as defaults for an unregistered key', () => {
      const result = service.getIssueStrings('plugin:unknown');

      expect(result).toEqual({ ISSUE_STR: 'Issue', ISSUES_STR: 'Issues' });
    });
  });

  describe('getPollIntervalMs', () => {
    it('should return the poll interval for a registered provider', () => {
      registerProvider(
        service,
        'poll-test',
        createMockDefinition(),
        'N',
        'N',
        'i',
        7500,
        {
          singular: 'a',
          plural: 'as',
        },
      );

      expect(service.getPollIntervalMs('plugin:poll-test')).toBe(7500);
    });

    it('should return 0 as default for an unregistered key', () => {
      expect(service.getPollIntervalMs('plugin:unknown')).toBe(0);
    });
  });

  describe('getIssueDisplay', () => {
    it('should return the issue display fields for a registered provider', () => {
      const issueDisplay: PluginIssueField[] = [
        { field: 'status', label: 'Status', type: 'text' },
        { field: 'url', label: 'Link', type: 'link' },
      ];
      const definition = createMockDefinition({ issueDisplay });

      registerProvider(service, 'display-test', definition, 'N', 'N', 'i', 0, {
        singular: 'a',
        plural: 'as',
      });

      expect(service.getIssueDisplay('plugin:display-test')).toEqual(issueDisplay);
    });

    it('should return an empty array for an unregistered key', () => {
      expect(service.getIssueDisplay('plugin:unknown')).toEqual([]);
    });
  });

  describe('getConfigFields', () => {
    it('should return config fields for a registered provider', () => {
      const configFields: PluginFormField[] = [
        { key: 'apiUrl', type: 'input', label: 'API URL', required: true },
        { key: 'token', type: 'input', label: 'Token' },
      ];
      const definition = createMockDefinition({ configFields });

      registerProvider(service, 'config-test', definition, 'N', 'N', 'i', 0, {
        singular: 'a',
        plural: 'as',
      });

      expect(service.getConfigFields('plugin:config-test')).toEqual(configFields);
    });

    it('should return an empty array for an unregistered key', () => {
      expect(service.getConfigFields('plugin:unknown')).toEqual([]);
    });
  });

  describe('getCommentsConfig', () => {
    it('should return comments config for a registered provider', () => {
      const commentsConfig: PluginCommentsConfig = {
        authorField: 'author',
        bodyField: 'body',
        createdField: 'created',
        avatarField: 'avatarUrl',
      };
      const definition = createMockDefinition({ commentsConfig });

      registerProvider(service, 'comments-test', definition, 'N', 'N', 'i', 0, {
        singular: 'a',
        plural: 'as',
      });

      expect(service.getCommentsConfig('plugin:comments-test')).toEqual(commentsConfig);
    });

    it('should return undefined when no commentsConfig is set', () => {
      registerProvider(service, 'no-comments', createMockDefinition(), 'N', 'N', 'i', 0, {
        singular: 'a',
        plural: 'as',
      });

      expect(service.getCommentsConfig('plugin:no-comments')).toBeUndefined();
    });

    it('should return undefined for an unregistered key', () => {
      expect(service.getCommentsConfig('plugin:unknown')).toBeUndefined();
    });
  });

  describe('getFieldMappings', () => {
    it('should return field mappings for a registered provider', () => {
      const fieldMappings: PluginFieldMapping[] = [
        {
          taskField: 'isDone',
          issueField: 'state',
          defaultDirection: 'pullOnly',
          toIssueValue: (v: unknown) => (v ? 'closed' : 'open'),
          toTaskValue: (v: unknown) => v === 'closed',
        },
      ];
      const definition = createMockDefinition({ fieldMappings });

      registerProvider(service, 'mappings-test', definition, 'N', 'N', 'i', 0, {
        singular: 'a',
        plural: 'as',
      });

      const result = service.getFieldMappings('plugin:mappings-test');

      expect(result).toBeDefined();
      expect(result!.length).toBe(1);
      expect(result![0].taskField).toBe('isDone');
      expect(result![0].issueField).toBe('state');
    });

    it('should return undefined when no fieldMappings are set', () => {
      registerProvider(service, 'no-mappings', createMockDefinition(), 'N', 'N', 'i', 0, {
        singular: 'a',
        plural: 'as',
      });

      expect(service.getFieldMappings('plugin:no-mappings')).toBeUndefined();
    });

    it('should return undefined for an unregistered key', () => {
      expect(service.getFieldMappings('plugin:unknown')).toBeUndefined();
    });
  });
});
