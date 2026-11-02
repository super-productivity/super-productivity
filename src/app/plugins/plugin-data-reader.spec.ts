import { TestBed } from '@angular/core/testing';
import { provideStore, Store } from '@ngrx/store';
import { listPluginDataKeys, loadPluginPersistedData } from './plugin-data-reader';
import { pluginUserDataReducer } from './store/plugin-user-data.reducer';
import { deletePluginUserData, upsertPluginUserData } from './store/plugin.actions';
import { PluginUserPersistenceService } from './plugin-user-persistence.service';

describe('loadPluginPersistedData', () => {
  let persistence: jasmine.SpyObj<PluginUserPersistenceService>;

  beforeEach(() => {
    persistence = jasmine.createSpyObj<PluginUserPersistenceService>('persistence', [
      'loadPluginUserData',
    ]);
  });

  it('preserves legacy and keyed reads without changing the value', async () => {
    persistence.loadPluginUserData.and.resolveTo('данные');
    expect(await loadPluginPersistedData(persistence, 'plugin-a')).toBe('данные');
    expect(persistence.loadPluginUserData).toHaveBeenCalledWith('plugin-a');
    expect(await loadPluginPersistedData(persistence, 'plugin-a', 'a:b')).toBe('данные');
    expect(persistence.loadPluginUserData).toHaveBeenCalledWith('plugin-a:a:b');
  });

  it('preserves null for missing data and load failures', async () => {
    persistence.loadPluginUserData.and.resolveTo(null);
    expect(await loadPluginPersistedData(persistence, 'plugin-a')).toBeNull();
    persistence.loadPluginUserData.and.rejectWith(new Error('не удалось прочитать'));
    expect(await loadPluginPersistedData(persistence, 'plugin-a')).toBeNull();
  });

  it('rejects invalid owners and keys before reading', async () => {
    await expectAsync(
      loadPluginPersistedData(persistence, 'plugin:a'),
    ).toBeRejectedWithError(/must not contain ':'/);
    await expectAsync(
      loadPluginPersistedData(persistence, 'plugin-a', 'x'.repeat(257)),
    ).toBeRejectedWithError(/exceeds maximum length/);
    expect(persistence.loadPluginUserData).not.toHaveBeenCalled();
  });
});

describe('listPluginDataKeys applied-state snapshot', () => {
  let store: Store;
  let persistence: PluginUserPersistenceService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideStore({ pluginUserData: pluginUserDataReducer }),
        PluginUserPersistenceService,
      ],
    });
    store = TestBed.inject(Store);
    persistence = TestBed.inject(PluginUserPersistenceService);
  });

  afterEach(async () => {
    await persistence.removePluginUserData('plugin-a');
  });

  it('tracks applied additions and deletions without dispatching on reads', async () => {
    const dispatch = spyOn(store, 'dispatch').and.callThrough();
    store.dispatch(
      upsertPluginUserData({ pluginUserData: { id: 'plugin-a:key', data: 'value' } }),
    );
    store.dispatch(
      upsertPluginUserData({ pluginUserData: { id: 'plugin-ab:key', data: 'other' } }),
    );
    const count = dispatch.calls.count();
    expect(await listPluginDataKeys(store, 'plugin-a')).toEqual(['key']);
    expect(dispatch.calls.count()).toBe(count);
    store.dispatch(deletePluginUserData({ pluginId: 'plugin-a:key' }));
    expect(await listPluginDataKeys(store, 'plugin-a')).toEqual([]);
    expect(await listPluginDataKeys(store, 'plugin-ab')).toEqual(['key']);
    expect(dispatch.calls.count()).toBe(count + 1);
  });

  it('excludes a new entry while the real persistence service is compressing it', async () => {
    const value = 'attachment metadata '.repeat(200);
    const saving = persistence.persistPluginUserData('plugin-a:new-key', value);
    const beforeDispatch = listPluginDataKeys(store, 'plugin-a');
    expect(await persistence.loadPluginUserData('plugin-a:new-key')).toBe(value);
    expect(await beforeDispatch).toEqual([]);
    await saving;
    expect(await listPluginDataKeys(store, 'plugin-a')).toEqual(['new-key']);
  });

  it('ignores a pending replacement when the applied key is deleted', async () => {
    await persistence.persistPluginUserData('plugin-a:key', 'old');
    await persistence.persistPluginUserData('plugin-a:key', 'pending');
    expect(await persistence.loadPluginUserData('plugin-a:key')).toBe('pending');
    expect(await listPluginDataKeys(store, 'plugin-a')).toEqual(['key']);
    store.dispatch(deletePluginUserData({ pluginId: 'plugin-a:key' }));
    expect(await listPluginDataKeys(store, 'plugin-a')).toEqual([]);
    expect(await persistence.loadPluginUserData('plugin-a:key')).toBe('pending');
  });
});
