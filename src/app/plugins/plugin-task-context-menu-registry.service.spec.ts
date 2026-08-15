import { PluginTaskContextMenuEntryCfg } from '@super-productivity/plugin-api';
import { PluginTaskContextMenuRegistryService } from './plugin-task-context-menu-registry.service';

describe('PluginTaskContextMenuRegistryService', () => {
  let service: PluginTaskContextMenuRegistryService;

  const register = (
    pluginId: string,
    cfg: Partial<PluginTaskContextMenuEntryCfg> = {},
    permissions: readonly string[] = ['taskContextMenu'],
  ): jasmine.Spy => {
    const onClick = jasmine.createSpy(`${pluginId}OnClick`);
    service.register(pluginId, `${pluginId} name`, permissions, {
      id: 'action',
      label: 'Run action',
      onClick,
      ...cfg,
    });
    return onClick;
  };

  beforeEach(() => {
    service = new PluginTaskContextMenuRegistryService();
  });

  it('requires the taskContextMenu manifest permission', () => {
    expect(() => register('plugin-a', {}, [])).toThrowError(/taskContextMenu/);
  });

  it('validates ids, labels, icons and targets', () => {
    expect(() => register('plugin-a', { id: 'Invalid ID' })).toThrowError(/id/);
    expect(() => register('plugin-a', { label: '' })).toThrowError(/label/);
    expect(() => register('plugin-a', { icon: 'bad icon' })).toThrowError(/icon/);
    expect(() =>
      register('plugin-a', {
        showFor: ['UNKNOWN' as 'TASK'],
      }),
    ).toThrowError(/showFor/);
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
    service.register('plugin-a', 'Plugin A', ['taskContextMenu'], {
      id: 'action',
      label: 'Run action',
      onClick: () => Promise.reject(new Error('plugin failure')),
    });

    await expectAsync(service.execute('plugin-a', 'action', 'task-1')).toBeResolved();
  });
});
