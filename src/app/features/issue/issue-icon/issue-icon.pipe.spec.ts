import { TestBed } from '@angular/core/testing';
import { IssueIconPipe } from './issue-icon.pipe';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { IssueProviderPluginDefinition } from '../../../plugins/issue-provider/plugin-issue-provider.model';
import { IssueProviderKey } from '../issue.model';

describe('IssueIconPipe', () => {
  let pipe: IssueIconPipe;
  let registry: PluginIssueProviderRegistryService;

  const registerWithIcon = (pluginId: string, icon: string): void =>
    registry.register({
      pluginId,
      definition: {} as IssueProviderPluginDefinition,
      name: pluginId,
      humanReadableName: pluginId,
      icon,
      pollIntervalMs: 0,
      issueStrings: { singular: 'Issue', plural: 'Issues' },
    });

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [IssueIconPipe] });
    pipe = TestBed.inject(IssueIconPipe);
    registry = TestBed.inject(PluginIssueProviderRegistryService);
  });

  it('should return the built-in icon for a built-in provider', () => {
    expect(pipe.transform('GITLAB')).toBe('gitlab');
  });

  it('should return a plugin provider SVG icon', () => {
    registerWithIcon('svg', 'plugin-svg-icon');
    expect(pipe.transform('plugin:svg' as IssueProviderKey)).toBe('plugin-svg-icon');
  });

  it('should not pass a Material ligature to svgIcon (#10550)', () => {
    registerWithIcon('ligature', 'confirmation_number');
    expect(pipe.transform('plugin:ligature' as IssueProviderKey)).toBeUndefined();
  });
});
