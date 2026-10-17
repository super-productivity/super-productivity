import { PluginTaskContextMenuEntryCfg } from '@super-productivity/plugin-api';
import { TranslateService } from '@ngx-translate/core';
import { TestBed } from '@angular/core/testing';
import { PluginLog } from '../core/log';
import { T } from '../t.const';
import {
  PluginTaskContextMenuEntryView,
  PluginTaskContextMenuRegistryService,
} from './plugin-task-context-menu-registry.service';

describe('PluginTaskContextMenuRegistryService', () => {
  let service: PluginTaskContextMenuRegistryService;
  let translateService: jasmine.SpyObj<TranslateService>;

  const entriesFor = (target: 'TASK' | 'SUBTASK'): PluginTaskContextMenuEntryView[] =>
    service.groupsFor(target).flatMap((group) => group.entries);

  const register = (
    pluginId: string,
    cfg: Partial<PluginTaskContextMenuEntryCfg> = {},
  ): jasmine.Spy => {
    const onClick = jasmine.createSpy(`${pluginId}OnClick`);
    service.register(pluginId, {
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
    expect(() => register('plugin-a', { showFor: [] })).toThrowError(
      T.PLUGINS.TASK_CONTEXT_MENU_ENTRY_TARGET_INVALID,
    );
  });

  it('shows entries for tasks and subtasks by default', () => {
    register('plugin-a');

    expect(entriesFor('TASK').map((entry) => entry.entryId)).toEqual(['action']);
    expect(entriesFor('SUBTASK').map((entry) => entry.entryId)).toEqual(['action']);
  });

  it('filters entries by the declarative target', () => {
    register('plugin-a', { showFor: ['SUBTASK'] });

    expect(entriesFor('TASK')).toEqual([]);
    expect(entriesFor('SUBTASK')).toHaveSize(1);
  });

  it('groups by plugin identity, not by duplicate names or local entry ids', async () => {
    const first = jasmine.createSpy('first');
    const second = jasmine.createSpy('second');
    service.register(
      'plugin-z',
      { id: 'action', label: 'Second', onClick: second },
      'Same name',
    );
    service.register(
      'plugin-a',
      { id: 'action', label: 'First', onClick: first },
      'Same name',
    );

    expect(
      service.groupsFor('TASK').map(({ pluginId, label, entries }) => ({
        pluginId,
        label,
        ids: entries.map((entry) => entry.entryId),
      })),
    ).toEqual([
      { pluginId: 'plugin-a', label: 'Same name', ids: ['action'] },
      { pluginId: 'plugin-z', label: 'Same name', ids: ['action'] },
    ]);
    await service.execute('plugin-z', 'action', 'task-1');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnceWith({ taskId: 'task-1' });
  });

  it('uses the plugin id as the display name when no manifest name is provided', () => {
    register('plugin-a');
    expect(service.groupsFor('TASK')[0].label).toBe('plugin-a');
  });

  it('preserves long manifest names without adding them to action labels', () => {
    const name = 'A very long plugin name '.repeat(10);
    service.register(
      'plugin-a',
      { id: 'action', label: 'Run', onClick: () => undefined },
      name,
    );
    const group = service.groupsFor('TASK')[0];
    expect(group.label).toBe(name);
    expect(group.entries[0].label).toBe('Run');
  });

  it('omits groups with no matching entries and filters mixed groups', () => {
    register('plugin-a', { showFor: ['TASK'] });
    register('plugin-b', { showFor: ['SUBTASK'] });
    register('plugin-b', { id: 'both' });

    expect(
      service
        .groupsFor('TASK')
        .map((group) => [group.pluginId, group.entries.map((entry) => entry.entryId)]),
    ).toEqual([
      ['plugin-a', ['action']],
      ['plugin-b', ['both']],
    ]);
    expect(
      service
        .groupsFor('SUBTASK')
        .map((group) => [group.pluginId, group.entries.map((entry) => entry.entryId)]),
    ).toEqual([['plugin-b', ['action', 'both']]]);
  });

  it('rebuilds a removed group with fresh metadata and no stale entries', async () => {
    const stale = register('plugin-a', { id: 'old' });
    service.unregisterPlugin('plugin-a');
    expect(service.groupsFor('TASK')).toEqual([]);
    service.register(
      'plugin-a',
      { id: 'new', label: 'New action', onClick: () => undefined },
      'New name',
    );
    await service.execute('plugin-a', 'old', 'task-1');

    expect(stale).not.toHaveBeenCalled();
    expect(service.groupsFor('TASK')[0].label).toBe('New name');
    expect(entriesFor('TASK').map((entry) => entry.entryId)).toEqual(['new']);
  });

  it('replaces the same plugin entry id and invokes only the latest callback', async () => {
    const first = register('plugin-a');
    const second = register('plugin-a', { label: 'Replacement' });

    expect(entriesFor('TASK').map((entry) => entry.label)).toEqual(['Replacement']);
    await service.execute('plugin-a', 'action', 'task-1');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnceWith({ taskId: 'task-1' });
  });

  it('keeps equal local ids separate across plugins in deterministic order', () => {
    register('plugin-z');
    register('plugin-a');

    expect(entriesFor('TASK').map((entry) => entry.pluginId)).toEqual([
      'plugin-a',
      'plugin-z',
    ]);
  });

  it('preserves registration order within the same plugin', () => {
    register('plugin-a', { id: 'set-color' });
    register('plugin-a', { id: 'clear-color' });

    expect(entriesFor('TASK').map((entry) => entry.entryId)).toEqual([
      'set-color',
      'clear-color',
    ]);
  });

  it('keeps an entry in place when re-registering it', () => {
    register('plugin-a', { id: 'first' });
    register('plugin-a', { id: 'second' });
    register('plugin-a', { id: 'first', label: 'Replacement' });

    expect(entriesFor('TASK').map((entry) => entry.entryId)).toEqual(['first', 'second']);
  });

  it('removes only the unloaded plugin and cannot execute its stale callback', async () => {
    const removed = register('plugin-a');
    register('plugin-b');

    service.unregisterPlugin('plugin-a');
    await service.execute('plugin-a', 'action', 'task-1');

    expect(removed).not.toHaveBeenCalled();
    expect(entriesFor('TASK').map((entry) => entry.pluginId)).toEqual(['plugin-b']);
  });

  it('contains rejected callbacks instead of returning a rejection', async () => {
    const error = new Error('plugin failure');
    const logError = spyOn(PluginLog, 'err');
    service.register('plugin-a', {
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
