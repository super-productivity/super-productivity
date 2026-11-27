import { getRepeatCfgSnapshotForNative } from './get-repeat-cfg-snapshot-for-native';
import {
  DEFAULT_TASK_REPEAT_CFG,
  TaskRepeatCfg,
} from '../../task-repeat-cfg/task-repeat-cfg.model';

describe('getRepeatCfgSnapshotForNative', () => {
  const cfg: TaskRepeatCfg = {
    ...DEFAULT_TASK_REPEAT_CFG,
    id: 'cfg1',
    title: 'Standup',
    projectId: 'p1',
    tagIds: ['t1'],
    startTime: '09:00',
    remindAt: 'AtStart' as TaskRepeatCfg['remindAt'],
    notes: 'private notes',
    subTaskTemplates: [{ title: 'sub' }],
  };

  it('keeps schedule fields and drops notes and subtask templates', () => {
    const parsed = JSON.parse(getRepeatCfgSnapshotForNative([cfg], new Set()));
    expect(parsed.cfgs[0]).toEqual(
      jasmine.objectContaining({
        id: 'cfg1',
        title: 'Standup',
        projectId: 'p1',
        tagIds: ['t1'],
        startTime: '09:00',
        remindAt: 'AtStart',
      }),
    );
    expect(parsed.cfgs[0].notes).toBeUndefined();
    expect(parsed.cfgs[0].subTaskTemplates).toBeUndefined();
    expect(parsed.cfgs[0].order).toBeUndefined();
  });

  it('lists archived project ids in a stable order', () => {
    const parsed = JSON.parse(getRepeatCfgSnapshotForNative([], new Set(['b', 'a'])));
    expect(parsed).toEqual({ cfgs: [], archivedProjectIds: ['a', 'b'] });
  });
});
