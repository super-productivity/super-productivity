import { PluginTaskDetailBlockRegistryService } from './plugin-task-detail-block-registry.service';

describe('PluginTaskDetailBlockRegistryService', () => {
  let registry: PluginTaskDetailBlockRegistryService;

  beforeEach(() => {
    registry = new PluginTaskDetailBlockRegistryService();
  });

  it('keeps IDs scoped to each plugin and replaces a registration in place', () => {
    registry.register('plugin-a', { id: 'info', label: 'First' });
    registry.register('plugin-b', { id: 'info', label: 'Second' });
    registry.register('plugin-a', { id: 'info', label: ' Updated ' });
    expect(registry.blocks()).toEqual([
      { pluginId: 'plugin-a', id: 'info', label: 'Updated' },
      { pluginId: 'plugin-b', id: 'info', label: 'Second' },
    ]);

    registry.unregisterPlugin('plugin-a');
    expect(registry.blocks()).toEqual([
      { pluginId: 'plugin-b', id: 'info', label: 'Second' },
    ]);
  });

  it('rejects malformed registrations', () => {
    expect(() =>
      registry.register('plugin-a', { id: '../info', label: 'Info' }),
    ).toThrow();
    expect(() => registry.register('plugin-a', { id: 'info', label: '  ' })).toThrow();
    expect(() =>
      registry.register('plugin-a', { id: 'info', label: 'x'.repeat(81) }),
    ).toThrow();
    expect(registry.blocks()).toEqual([]);
  });
});
