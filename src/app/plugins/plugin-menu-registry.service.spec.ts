import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { PluginMenuRegistryService } from './plugin-menu-registry.service';
import { PluginTaskContextMenuEntryCfg } from './plugin-api.model';
import { T } from '../t.const';
import { PluginLog } from '../core/log';

describe('PluginMenuRegistryService', () => {
  let service: PluginMenuRegistryService;

  const taskEntry = (label: string): Omit<PluginTaskContextMenuEntryCfg, 'pluginId'> => ({
    label,
    icon: 'terminal',
    onClick: () => {},
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PluginMenuRegistryService,
        { provide: TranslateService, useValue: { instant: (key: string) => key } },
      ],
    });
    service = TestBed.inject(PluginMenuRegistryService);
  });

  describe('registerTaskContextMenuEntry', () => {
    it('stores the entry with the registering plugin id', () => {
      const cfg = taskEntry('Start elsewhere');

      service.registerTaskContextMenuEntry('plugin-a', cfg);

      expect(service.taskContextMenuEntries()).toEqual([
        { ...cfg, pluginId: 'plugin-a' },
      ]);
    });

    it('skips a duplicate label from the same plugin but not from another', () => {
      service.registerTaskContextMenuEntry('plugin-a', taskEntry('Same'));
      service.registerTaskContextMenuEntry('plugin-a', taskEntry('Same'));
      service.registerTaskContextMenuEntry('plugin-b', taskEntry('Same'));

      expect(service.taskContextMenuEntries().map((e) => e.pluginId)).toEqual([
        'plugin-a',
        'plugin-b',
      ]);
    });

    it('rejects an entry without a label, onClick or with a non-string icon', () => {
      expect(() =>
        service.registerTaskContextMenuEntry('plugin-a', {
          ...taskEntry(''),
        }),
      ).toThrowError(T.PLUGINS.MENU_ENTRY_LABEL_REQUIRED);
      expect(() =>
        service.registerTaskContextMenuEntry('plugin-a', {
          label: 'x',
        } as unknown as PluginTaskContextMenuEntryCfg),
      ).toThrowError(T.PLUGINS.MENU_ENTRY_ONCLICK_REQUIRED);
      expect(() =>
        service.registerTaskContextMenuEntry('plugin-a', {
          ...taskEntry('x'),
          icon: 1 as unknown as string,
        }),
      ).toThrowError(T.PLUGINS.MENU_ENTRY_ICON_STRING);
      expect(service.taskContextMenuEntries()).toEqual([]);
    });
  });

  describe('runTaskContextMenuEntry', () => {
    it('passes the task id to the plugin', () => {
      const onClick = jasmine.createSpy('onClick');
      service.runTaskContextMenuEntry(
        { pluginId: 'plugin-a', label: 'x', onClick },
        'task-1',
      );
      expect(onClick).toHaveBeenCalledWith('task-1');
    });

    it('logs a throwing or rejecting plugin instead of letting it escape', async () => {
      const errSpy = spyOn(PluginLog, 'err');
      expect(() =>
        service.runTaskContextMenuEntry(
          {
            pluginId: 'plugin-a',
            label: 'x',
            onClick: () => {
              throw new Error('boom');
            },
          },
          'task-1',
        ),
      ).not.toThrow();
      service.runTaskContextMenuEntry(
        {
          pluginId: 'plugin-b',
          label: 'y',
          onClick: (() => Promise.reject(new Error('later'))) as unknown as (
            taskId: string,
          ) => void,
        },
        'task-1',
      );
      await Promise.resolve();
      await Promise.resolve();
      expect(errSpy).toHaveBeenCalledWith(jasmine.any(String), {
        pluginId: 'plugin-a',
        error: 'Error',
      });
      expect(errSpy).toHaveBeenCalledWith(jasmine.any(String), {
        pluginId: 'plugin-b',
        error: 'Error',
      });
    });
  });

  describe('removePluginEntries', () => {
    it('removes side-nav and task context menu entries of that plugin only', () => {
      service.registerMenuEntry('plugin-a', { label: 'Nav A', onClick: () => {} });
      service.registerMenuEntry('plugin-b', { label: 'Nav B', onClick: () => {} });
      service.registerTaskContextMenuEntry('plugin-a', taskEntry('Task A'));
      service.registerTaskContextMenuEntry('plugin-b', taskEntry('Task B'));

      service.removePluginEntries('plugin-a');

      expect(service.menuEntries().map((e) => e.label)).toEqual(['Nav B']);
      expect(service.taskContextMenuEntries().map((e) => e.label)).toEqual(['Task B']);
    });
  });
});
