import { mapToProjectWithTasks } from './map-to-project-with-tasks.util';

describe('mapToProjectWithTasks()', () => {
  it('should return a mapped project', () => {
    const project = {
      id: 'PID',
      title: 'P_TITLE',
    };
    expect(mapToProjectWithTasks(project as any, [], 'TODAY_STR')).toEqual({
      id: 'PID',
      title: 'P_TITLE',
      color: undefined,
      icon: 'list_alt',
      isEmojiIcon: false,
      tasks: [],
      timeSpentToday: 0,
      timeSpentYesterday: undefined,
    });
  });

  it('should return a mapped project with accumulated time spent for tasks', () => {
    const project = {
      id: 'PID',
      title: 'P_TITLE',
    };
    const TDS = 'TODAY_STR';
    const flatTasks = [
      { projectId: 'PID', parentId: 'IGNORE', timeSpentOnDay: { [TDS]: 100000 } },
      { projectId: 'PID', timeSpentOnDay: { [TDS]: 111 } },
      { projectId: 'PID', timeSpentOnDay: { [TDS]: 222 } },
      { projectId: 'PID', timeSpentOnDay: { fakeOtherDayProp: 444 } },
      { projectId: 'OTHER_PID', timeSpentOnDay: { [TDS]: 222 } },
    ];
    expect(mapToProjectWithTasks(project as any, flatTasks as any, TDS)).toEqual({
      id: 'PID',
      title: 'P_TITLE',
      color: undefined,
      icon: 'list_alt',
      isEmojiIcon: false,
      tasks: [
        { projectId: 'PID', parentId: 'IGNORE', timeSpentOnDay: { [TDS]: 100000 } },
        { projectId: 'PID', timeSpentOnDay: { [TDS]: 111 } },
        { projectId: 'PID', timeSpentOnDay: { [TDS]: 222 } },
        { projectId: 'PID', timeSpentOnDay: { fakeOtherDayProp: 444 } },
      ] as any,
      timeSpentToday: 333,
      timeSpentYesterday: undefined,
    });
  });

  it('should return a mapped project with accumulated time spent for tasks yesterday', () => {
    const project = {
      id: 'PID',
      title: 'P_TITLE',
    };
    const TDS = 'TODAY_STR';
    const YDS = 'YESTERDAY_STR';
    const flatTasks = [
      { projectId: 'PID', parentId: 'IGNORE', timeSpentOnDay: { [TDS]: 100000 } },
      { projectId: 'PID', timeSpentOnDay: { [TDS]: 111 } },
      { projectId: 'PID', timeSpentOnDay: { [YDS]: 222 } },
      { projectId: 'PID', timeSpentOnDay: { [YDS]: 444 } },
      { projectId: 'OTHER_PID', timeSpentOnDay: { [YDS]: 222 } },
    ];
    expect(mapToProjectWithTasks(project as any, flatTasks as any, TDS, YDS)).toEqual({
      id: 'PID',
      title: 'P_TITLE',
      color: undefined,
      icon: 'list_alt',
      isEmojiIcon: false,
      tasks: [
        { projectId: 'PID', parentId: 'IGNORE', timeSpentOnDay: { [TDS]: 100000 } },
        { projectId: 'PID', timeSpentOnDay: { [TDS]: 111 } },
        { projectId: 'PID', timeSpentOnDay: { [YDS]: 222 } },
        { projectId: 'PID', timeSpentOnDay: { [YDS]: 444 } },
      ] as any,
      timeSpentToday: 111,
      timeSpentYesterday: 666,
    });
  });

  it('should use the project icon and color', () => {
    const project = {
      id: 'PID',
      title: 'P',
      icon: 'work',
      theme: { primary: '#3f51b5' },
    };
    expect(mapToProjectWithTasks(project as any, [], 'TODAY_STR')).toEqual(
      jasmine.objectContaining({ icon: 'work', isEmojiIcon: false, color: '#3f51b5' }),
    );
  });

  it('should flag an emoji project icon', () => {
    const project = { id: 'PID', title: 'P', icon: '🚀' };
    expect(mapToProjectWithTasks(project as any, [], 'TODAY_STR')).toEqual(
      jasmine.objectContaining({ icon: '🚀', isEmojiIcon: true }),
    );
  });

  it('should have no icon for the without-project group', () => {
    const result = mapToProjectWithTasks({ id: null, title: 'None' }, [], 'TODAY_STR');
    expect(result.icon).toBeUndefined();
    expect(result.isEmojiIcon).toBe(false);
  });
});
