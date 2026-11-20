import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { DateTimeLocale } from '../../../core/locale.constants';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { _resetDevErrorState } from '../../../util/dev-error';
import { DEFAULT_TASK, TaskWithSubTasks } from '../../tasks/task.model';
import { TaskService } from '../../tasks/task.service';
import { IssueData, IssueProviderKey } from '../issue.model';
import { IssueContentComponent } from './issue-content.component';
import { IssueContentConfig, IssueFieldType } from './issue-content.model';

describe('IssueContentComponent', () => {
  let fixture: ComponentFixture<IssueContentComponent>;
  let component: IssueContentComponent;
  let registry: PluginIssueProviderRegistryService;
  let taskService: jasmine.SpyObj<TaskService>;

  const PLUGIN_ID = 'nested-test-provider';
  const PROVIDER_KEY = `plugin:${PLUGIN_ID}` as IssueProviderKey;

  const makeTask = (issueType: IssueProviderKey = PROVIDER_KEY): TaskWithSubTasks => ({
    ...DEFAULT_TASK,
    id: 'task-1',
    projectId: 'project-1',
    subTasks: [],
    issueType,
    issueId: '1',
    issueProviderId: 'provider-1',
  });

  beforeEach(async () => {
    taskService = jasmine.createSpyObj<TaskService>('TaskService', [
      'markIssueUpdatesAsRead',
    ]);

    await TestBed.configureTestingModule({
      imports: [IssueContentComponent, NoopAnimationsModule, TranslateModule.forRoot()],
      providers: [
        { provide: TaskService, useValue: taskService },
        {
          provide: DateTimeFormatService,
          useValue: { currentLocale: signal<DateTimeLocale>('en-US' as DateTimeLocale) },
        },
      ],
    }).compileComponents();

    registry = TestBed.inject(PluginIssueProviderRegistryService);
    registry.register({
      pluginId: PLUGIN_ID,
      name: 'Nested Provider',
      humanReadableName: 'Nested Provider',
      icon: 'bug_report',
      pollIntervalMs: 60000,
      issueStrings: { singular: 'Issue', plural: 'Issues' },
      definition: {
        configFields: [],
        issueDisplay: [
          {
            field: 'assignee.name',
            label: 'Assignee',
            type: 'text',
            hideEmpty: true,
          },
          {
            field: 'title',
            label: 'Title',
            type: 'link',
            linkField: 'links.html',
          },
        ],
        commentsConfig: {
          authorField: 'user.login',
          bodyField: 'content.rendered',
          createdField: 'meta.createdAt',
          avatarField: 'user.avatarUrl',
        },
        getHeaders: () => ({}),
        searchIssues: async () => [],
        getById: async () => ({ id: '1', title: 'Issue', body: '', url: '' }),
        getIssueLink: () => 'https://example.com/1',
      },
    });

    fixture = TestBed.createComponent(IssueContentComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('task', makeTask());
    fixture.detectChanges();
  });

  afterEach(() => {
    registry.unregister(PLUGIN_ID);
    if (jasmine.isSpy(window.confirm)) {
      (window.confirm as jasmine.Spy).and.returnValue(true);
    }
  });

  it('resolves dotted-path hideEmpty and linkField for plugin display fields', () => {
    const cfg = component.config();
    expect(cfg).toBeDefined();

    const assigneeField = cfg!.fields[0];
    const titleField = cfg!.fields[1];

    const populatedIssue = {
      id: '1',
      title: 'Fix nested field',
      assignee: { name: 'Ada' },
      links: { html: 'https://example.com/issues/1' },
    } as unknown as IssueData;

    const emptyIssue = {
      id: '2',
      title: 'Missing nested fields',
      assignee: { name: '' },
    } as unknown as IssueData;

    expect(assigneeField.isVisible?.(populatedIssue)).toBe(true);
    expect(assigneeField.isVisible?.(emptyIssue)).toBe(false);
    expect(
      assigneeField.isVisible?.({ id: '3', title: 'No assignee' } as IssueData),
    ).toBe(false);
    expect(titleField.getLink?.(populatedIssue)).toBe('https://example.com/issues/1');
    expect(titleField.getLink?.(emptyIssue)).toBe('');
  });

  it('reads comment author, body, created, and avatar via dotted paths', () => {
    const cfg = component.config() as IssueContentConfig;
    const comment = {
      user: { login: 'ada', avatarUrl: 'https://example.com/ada.png' },
      content: { rendered: 'Looks good' },
      meta: { createdAt: '2026-11-18T00:00:00Z' },
    };

    expect(component.getCommentAuthor(comment, cfg)).toBe('ada');
    expect(component.getCommentBody(comment, cfg)).toBe('Looks good');
    expect(component.getCommentCreated(comment, cfg)).toBe('2026-11-18T00:00:00Z');
    expect(component.getCommentAvatar(comment, cfg)).toBe('https://example.com/ada.png');
  });

  it('reads field values via dotted-path string, function callback, and reports callback errors', () => {
    const issue = {
      id: '1',
      status: { name: 'In Progress' },
    } as unknown as IssueData;

    expect(
      component.getFieldValue(
        { label: 'Status', type: IssueFieldType.TEXT, value: 'status.name' },
        issue,
      ),
    ).toBe('In Progress');

    expect(
      component.getFieldValue(
        {
          label: 'Formatted',
          type: IssueFieldType.TEXT,
          value: (i) => `ID:${(i as { id: string }).id}`,
        },
        issue,
      ),
    ).toBe('ID:1');

    expect(
      component.getFieldValue(
        { label: 'Missing', type: IssueFieldType.TEXT, value: 'status.name' },
        undefined,
      ),
    ).toBeUndefined();

    _resetDevErrorState();
    (window.confirm as jasmine.Spy).and.returnValue(false);
    expect(
      component.getFieldValue(
        {
          label: 'Broken',
          type: IssueFieldType.TEXT,
          value: () => {
            throw new Error('boom');
          },
        },
        issue,
      ),
    ).toBeUndefined();
    expect(window.alert).toHaveBeenCalled();
  });
});
