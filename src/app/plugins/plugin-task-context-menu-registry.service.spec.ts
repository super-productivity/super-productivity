import { PluginTaskContextMenuEntryCfg } from '@super-productivity/plugin-api';
import { TranslateService } from '@ngx-translate/core';
import { TestBed } from '@angular/core/testing';
import { PluginLog } from '../core/log';
import { T } from '../t.const';
import { PluginTaskContextMenuRegistryService } from './plugin-task-context-menu-registry.service';

describe('PluginTaskContextMenuRegistryService', () => {
  let service: PluginTaskContextMenuRegistryService;
  let translateService: jasmine.SpyObj<TranslateService>;

  const register = (
    pluginId: string,
    cfg: Partial<PluginTaskContextMenuEntryCfg> = {},
  ): jasmine.Spy => {
    const onClick = jasmine.createSpy(`${pluginId}OnClick`);
    service.register(pluginId, `${pluginId} name`, {
      id: 'action',
      label: 'Run action',
      onClick,
      ...cfg,
    });
    return onClick;
  };

  beforeEach(() => {
    translateService = jasmine.createSpyObj<TranslateService>('TranslateService', [
      'instant',
    ]);
    translateService.instant.and.callFake((key: string) => key);
    TestBed.configureTestingModule({
      providers: [
        PluginTaskContextMenuRegistryService,
        { provide: TranslateService, useValue: translateService },
      ],
    });
    service = TestBed.inject(PluginTaskContextMenuRegistryService);
  });

  it('validates ids, labels, icons, callbacks and targets', () => {
    expect(() => register('plugin-a', { id: 'Invalid ID' })).toThrowError(
      T.PLUGINS.TASK_CONTEXT_MENU_ENTRY_ID_INVALID,
    );
    expect(() => register('plugin-a', { label: '' })).toThrowError(
      T.PLUGINS.TASK_CONTEXT_MENU_ENTRY_LABEL_INVALID,
    );
    expect(() => register('plugin-a', { icon: 'bad icon' })).toThrowError(
      T.PLUGINS.TASK_CONTEXT_MENU_ENTRY_ICON_INVALID,
    );
    expect(() => register('plugin-a', { onClick: undefined })).toThrowError(
      T.PLUGINS.TASK_CONTEXT_MENU_ENTRY_ONCLICK_REQUIRED,
    );
    expect(() =>
      register('plugin-a', {
        showFor: ['UNKNOWN' as 'TASK'],
      }),
    ).toThrowError(T.PLUGINS.TASK_CONTEXT_MENU_ENTRY_TARGET_INVALID);
  });

  it('shows entries for tasks and subtasks by default', () => {
    register('plugin-a');

    expect(service.entriesFor('TASK').map((entry) => entry.entryId)).toEqual(['action']);
    expect(service.entriesFor('SUBTASK').map((entry) => entry.entryId)).toEqual([
      'action',
    ]);
  });

  it('filters entries by the declarative target', () => {
    register('plugin-a', { showFor: ['SUBTASK'] });

    expect(service.entriesFor('TASK')).toEqual([]);
    expect(service.entriesFor('SUBTASK')).toHaveSize(1);
  });

  it('replaces the same plugin entry id and invokes only the latest callback', async () => {
    const first = register('plugin-a');
    const second = register('plugin-a', { label: 'Replacement' });

    expect(service.entriesFor('TASK').map((entry) => entry.label)).toEqual([
      'Replacement',
    ]);
    await service.execute('plugin-a', 'action', 'task-1');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnceWith({ taskId: 'task-1' });
  });

  it('keeps equal local ids separate across plugins in deterministic order', () => {
    register('plugin-z');
    register('plugin-a');

    expect(service.entriesFor('TASK').map((entry) => entry.pluginId)).toEqual([
      'plugin-a',
      'plugin-z',
    ]);
  });

  it('removes only the unloaded plugin and cannot execute its stale callback', async () => {
    const removed = register('plugin-a');
    register('plugin-b');

    service.unregisterPlugin('plugin-a');
    await service.execute('plugin-a', 'action', 'task-1');

    expect(removed).not.toHaveBeenCalled();
    expect(service.entriesFor('TASK').map((entry) => entry.pluginId)).toEqual([
      'plugin-b',
    ]);
  });

  it('contains rejected callbacks instead of returning a rejection', async () => {
    const error = new Error('plugin failure');
    const logError = spyOn(PluginLog, 'err');
    service.register('plugin-a', 'Plugin A', {
      id: 'action',
      label: 'Run action',
      onClick: () => Promise.reject(error),
    });

    await expectAsync(service.execute('plugin-a', 'action', 'task-1')).toBeResolved();
    expect(logError).toHaveBeenCalledWith(
      'Plugin task context menu action failed',
      { pluginId: 'plugin-a', entryId: 'action', taskId: 'task-1' },
      error,
    );
  });
});
