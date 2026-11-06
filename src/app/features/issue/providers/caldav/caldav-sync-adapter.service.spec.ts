import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { CaldavSyncAdapterService } from './caldav-sync-adapter.service';
import { CaldavClientService } from './caldav-client.service';
import { CaldavCfg } from './caldav.model';

const BASE_CFG: CaldavCfg = {
  isEnabled: true,
  caldavUrl: 'https://cal.example.com',
  resourceName: 'Personal',
  username: 'user',
  password: 'secret',
  categoryFilter: null,
};

describe('CaldavSyncAdapterService.deleteIssue', () => {
  let adapter: CaldavSyncAdapterService;
  let client: jasmine.SpyObj<CaldavClientService>;

  beforeEach(() => {
    client = jasmine.createSpyObj('CaldavClientService', ['deleteTask$', 'createTask$']);
    client.deleteTask$.and.returnValue(of(undefined));
    TestBed.configureTestingModule({
      providers: [
        CaldavSyncAdapterService,
        { provide: CaldavClientService, useValue: client },
      ],
    });
    adapter = TestBed.inject(CaldavSyncAdapterService);
  });

  // The generic remote-delete path has no gate of its own (#10096): existing
  // providers saved without the key must never delete server data.
  it('does nothing for a provider saved without the setting', async () => {
    await adapter.deleteIssue('uid-1', BASE_CFG);
    await adapter.deleteIssue('uid-1', { ...BASE_CFG, twoWaySync: { isDone: 'both' } });

    expect(client.deleteTask$).not.toHaveBeenCalled();
  });

  it('does nothing when the setting is off', async () => {
    await adapter.deleteIssue('uid-1', {
      ...BASE_CFG,
      twoWaySync: { deleteOnServer: false },
    });

    expect(client.deleteTask$).not.toHaveBeenCalled();
  });

  it('deletes the VTODO when the user opted in', async () => {
    const cfg: CaldavCfg = { ...BASE_CFG, twoWaySync: { deleteOnServer: true } };

    await adapter.deleteIssue('uid-1', cfg);

    expect(client.deleteTask$).toHaveBeenCalledOnceWith(cfg, 'uid-1');
  });
});

describe('CaldavSyncAdapterService.createIssue', () => {
  let adapter: CaldavSyncAdapterService;
  let client: jasmine.SpyObj<CaldavClientService>;

  beforeEach(() => {
    client = jasmine.createSpyObj('CaldavClientService', ['createTask$']);
    client.createTask$.and.returnValue(
      of({
        id: 'sp-todo-task-1@super-productivity',
        completed: false,
        item_url: '',
        summary: 'Buy milk',
        labels: [],
        etag_hash: 5,
      }),
    );
    TestBed.configureTestingModule({
      providers: [
        CaldavSyncAdapterService,
        { provide: CaldavClientService, useValue: client },
      ],
    });
    adapter = TestBed.inject(CaldavSyncAdapterService);
  });

  it('derives the UID from the task id so a repeated create finds the same VTODO', async () => {
    const created = await adapter.createIssue('Buy milk', BASE_CFG, { taskId: 'task-1' });

    expect(client.createTask$).toHaveBeenCalledOnceWith(BASE_CFG, {
      uid: 'sp-todo-task-1@super-productivity',
      summary: 'Buy milk',
    });
    expect(created.issueId).toBe('sp-todo-task-1@super-productivity');
    expect(created.issueData['etag_hash']).toBe(5);
  });

  it('refuses to create without a task id', async () => {
    await expectAsync(adapter.createIssue('Buy milk', BASE_CFG)).toBeRejected();
    expect(client.createTask$).not.toHaveBeenCalled();
  });
});
