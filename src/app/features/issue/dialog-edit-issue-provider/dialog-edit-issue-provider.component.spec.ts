import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { DialogEditIssueProviderComponent } from './dialog-edit-issue-provider.component';
import { ICAL_TYPE } from '../issue.const';
import { IssueProvider } from '../issue.model';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { PluginBridgeService } from '../../../plugins/plugin-bridge.service';
import { PluginHttpService } from '../../../plugins/issue-provider/plugin-http.service';
import { IssueService } from '../issue.service';
import { SnackService } from '../../../core/snack/snack.service';
import { TaskService } from '../../tasks/task.service';
import { TagService } from '../../tag/tag.service';

describe('DialogEditIssueProviderComponent', () => {
  let fixture: ComponentFixture<DialogEditIssueProviderComponent>;
  let component: DialogEditIssueProviderComponent;

  beforeEach(async () => {
    const pluginRegistry = jasmine.createSpyObj('PluginIssueProviderRegistryService', [
      'hasProvider',
      'getUseAgendaView',
      'getProvider',
      'getName',
      'getConfigFields',
      'getFieldMappings',
    ]);
    // ICAL is a built-in (non-plugin) provider — keep the plugin code paths inert.
    pluginRegistry.hasProvider.and.returnValue(false);
    pluginRegistry.getUseAgendaView.and.returnValue(false);
    pluginRegistry.getProvider.and.returnValue(undefined);
    pluginRegistry.getConfigFields.and.returnValue([]);
    pluginRegistry.getFieldMappings.and.returnValue([]);

    await TestBed.configureTestingModule({
      imports: [DialogEditIssueProviderComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { issueProviderKey: ICAL_TYPE } },
        { provide: PluginIssueProviderRegistryService, useValue: pluginRegistry },
        {
          provide: PluginBridgeService,
          useValue: jasmine.createSpyObj('PluginBridgeService', [
            'restoreAndCheckOAuthTokens',
            'clearOAuthTokens',
            'startOAuthFlow',
          ]),
        },
        {
          provide: PluginHttpService,
          useValue: jasmine.createSpyObj('PluginHttpService', ['createHttpHelper']),
        },
        {
          provide: MatDialogRef,
          useValue: jasmine.createSpyObj('MatDialogRef', ['close']),
        },
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        {
          provide: Store,
          useValue: jasmine.createSpyObj('Store', ['dispatch', 'select', 'pipe']),
        },
        {
          provide: IssueService,
          useValue: jasmine.createSpyObj('IssueService', ['testConnection']),
        },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
        { provide: TaskService, useValue: { allTasks$: of([]) } },
        { provide: TagService, useValue: { tagsNoMyDayAndNoList$: of([]) } },
      ],
    })
      // Render nothing: we only exercise the model-change handlers, not the
      // (heavy) template with its Material + child-component dependencies.
      .overrideComponent(DialogEditIssueProviderComponent, {
        set: { template: '', imports: [] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(DialogEditIssueProviderComponent);
    component = fixture.componentInstance;
  });

  describe('formlyModelChange (#8777 infinite rebuild-loop guard)', () => {
    // Formly runs in immutable mode (see formly-config.module.ts) and emits a
    // fresh clone of the full model on every change, short-circuiting its own
    // rebuild ONLY when it receives that exact reference back
    // (`_modelChangeValue === model`). If the handler runs the emitted model
    // through mergeIssueProviderModelUpdates() it produces a NEW object, defeats
    // that guard, and — because immutable mode re-clones array field values on
    // each rebuild — spins an infinite rebuild -> patchValue -> modelChange loop
    // that froze the whole app when picking a "Calendars to display" entry (an
    // array-valued multiSelect field). #8777
    it('assigns the emitted model by reference (no merged copy)', () => {
      const emitted = {
        ...component.model,
        pluginConfig: { readCalendarIds: ['primary'] },
      } as Partial<IssueProvider>;

      component.formlyModelChange(emitted);

      // Formly's immutable guard compares the top-level model reference; a merged
      // copy would differ and re-trigger a rebuild, looping forever on arrays.
      expect(component.model).toBe(emitted);
    });

    it('resets isConnectionWorks so a prior success is invalidated', () => {
      component.isConnectionWorks.set(true);

      component.formlyModelChange({ ...component.model } as Partial<IssueProvider>);

      expect(component.isConnectionWorks()).toBe(false);
    });
  });

  describe('customCfgCmpSave', () => {
    // Custom cfg components (Jira/OpenProject/Nextcloud-Deck) emit PARTIAL config
    // updates, so this path must still merge to preserve omitted keys.
    it('merges partial pluginConfig updates, preserving omitted keys', () => {
      component.model = {
        ...component.model,
        pluginConfig: { accountId: '1', bucketId: '10' },
      } as Partial<IssueProvider>;

      component.customCfgCmpSave({
        pluginConfig: { accountId: '2' },
      } as unknown as Parameters<typeof component.customCfgCmpSave>[0]);

      expect((component.model as { pluginConfig?: unknown }).pluginConfig).toEqual({
        accountId: '2',
        bucketId: '10',
      });
    });
  });
});
