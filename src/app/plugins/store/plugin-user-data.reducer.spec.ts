import { Action } from '@ngrx/store';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { lwwUpdateMetaReducer } from '../../root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer';
import { RootState } from '../../root-store/root-state';
import { PluginUserDataState } from '../plugin-persistence.model';
import { deletePluginUserData, upsertPluginUserData } from './plugin.actions';
import { pluginUserDataReducer } from './plugin-user-data.reducer';

describe('Plugin user data keyed collection', () => {
  const rows = [
    { id: 'viewer:z', data: 'last' },
    { id: 'viewer:A', data: 'first' },
    { id: 'viewer:a', data: 'middle' },
  ];
  const expected = [rows[1], rows[2], rows[0]];

  it('converges independent inserts without changing IDs or payloads', () => {
    const insert = (input: PluginUserDataState): PluginUserDataState =>
      input.reduce(
        (state, pluginUserData) =>
          pluginUserDataReducer(state, upsertPluginUserData({ pluginUserData })),
        [] as PluginUserDataState,
      );
    expect(insert(rows)).toEqual(expected);
    expect(insert([...rows].reverse())).toEqual(expected);
    const updated = pluginUserDataReducer(
      insert(rows),
      upsertPluginUserData({ pluginUserData: { ...rows[2], data: 'changed' } }),
    );
    expect(updated).toEqual([rows[1], { ...rows[2], data: 'changed' }, rows[0]]);
    expect(
      pluginUserDataReducer(updated, deletePluginUserData({ pluginId: rows[2].id })),
    ).toEqual([rows[1], rows[0]]);
  });

  it('normalizes old snapshots without mutating the imported array', () => {
    const original = [...rows];
    const action = {
      type: loadAllData.type,
      appDataComplete: { pluginUserData: original },
    };
    expect(pluginUserDataReducer([], action)).toEqual(expected);
    expect(original).toEqual(rows);
  });

  it('also orders rows recreated by the real LWW meta-reducer', () => {
    type State = RootState & { pluginUserData: PluginUserDataState };
    const reducer = lwwUpdateMetaReducer((state: State, action: Action) => ({
      ...state,
      pluginUserData: pluginUserDataReducer(state.pluginUserData, action),
    }));
    const state = { pluginUserData: [rows[0]] } as State;
    const recreated = reducer(state, {
      type: '[PLUGIN_USER_DATA] LWW Update',
      ...rows[1],
      meta: {
        isPersistent: true,
        isRemote: true,
        entityType: 'PLUGIN_USER_DATA',
        entityId: rows[1].id,
        lwwUpdateMode: 'replace',
      },
    } as Action) as State;
    expect(recreated.pluginUserData).toEqual([rows[1], rows[0]]);
    expect(state.pluginUserData).toEqual([rows[0]]);
  });
});
