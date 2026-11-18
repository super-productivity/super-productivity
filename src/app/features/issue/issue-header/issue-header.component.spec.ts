import { TestBed } from '@angular/core/testing';
import { IssueHeaderComponent } from './issue-header.component';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { DEFAULT_TASK, TaskWithSubTasks } from '../../tasks/task.model';

describe('IssueHeaderComponent', () => {
  it('updates metadata when a plugin registers and unregisters with an unchanged task', () => {
    TestBed.configureTestingModule({ imports: [IssueHeaderComponent] });
    const registry = TestBed.inject(PluginIssueProviderRegistryService);
    const fixture = TestBed.createComponent(IssueHeaderComponent);
    const component = fixture.componentInstance;
    const task: TaskWithSubTasks = {
      ...DEFAULT_TASK,
      id: 'task-1',
      projectId: 'project-1',
      subTasks: [],
      issueType: 'GITHUB',
      issueId: '1',
      issueProviderId: 'provider-1',
    };
    fixture.componentRef.setInput('task', task);

    expect(component.icon()).toBeUndefined();
    expect(component.providerName()).toBeUndefined();

    registry.register({
      pluginId: 'github-issue-provider',
      issueProviderKey: 'GITHUB',
      name: 'GitHub Issues',
      humanReadableName: 'GitHub',
      icon: 'plugin-github-issue-provider-icon',
      pollIntervalMs: 60000,
      issueStrings: { singular: 'Issue', plural: 'Issues' },
      definition: {
        configFields: [],
        issueDisplay: [],
        getHeaders: () => ({}),
        searchIssues: async () => [],
        getById: async () => ({ id: '1', title: 'Issue', body: '', url: '' }),
        getIssueLink: () => 'https://github.com/example/repo/issues/1',
      },
    });

    expect(component.icon()).toBe('plugin-github-issue-provider-icon');
    expect(component.providerName()).toBe('GitHub Issues');

    registry.unregister('github-issue-provider');

    expect(component.icon()).toBeUndefined();
    expect(component.providerName()).toBeUndefined();
    expect(component.task()).toBe(task);
  });
});
