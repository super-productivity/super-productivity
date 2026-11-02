import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ViewTaskListRegistry } from './view-task-list-registry.service';
import { ViewNewTaskTarget, ViewTaskListHost } from './view-task-list.token';

describe('ViewTaskListRegistry', () => {
  let registry: ViewTaskListRegistry;
  const target: ViewNewTaskTarget = {
    additionalFields: { projectId: 'INBOX_PROJECT' },
    tagsToRemove: [],
    taskIdsToExclude: [],
  };
  const host = (rowIds: string[], isTarget: boolean): ViewTaskListHost =>
    ({
      isRow: (id: string) => rowIds.includes(id),
      newTaskTarget: signal(isTarget ? target : null),
    }) as unknown as ViewTaskListHost;

  beforeEach(() => {
    registry = TestBed.inject(ViewTaskListRegistry);
  });

  it('adds into the first column that takes new tasks, in display order', () => {
    const overdue = host(['a'], false);
    const later = host(['b'], true);
    registry.set({}, [overdue, later]);
    expect(registry.addTarget()).toBe(later);
    expect(registry.hostForRow('a')).toBe(overdue);
    expect(registry.hostForRow('x')).toBeNull();
  });

  it("doesn't let a leaving view clear the next view's columns", () => {
    const leaving = {};
    const next = {};
    const nextHost = host([], true);
    registry.set(leaving, [host([], true)]);
    registry.set(next, [nextHost]);

    registry.clear(leaving);
    registry.set(leaving, []);
    expect(registry.addTarget()).toBe(nextHost);

    registry.clear(next);
    expect(registry.addTarget()).toBeNull();
    expect(registry.hosts()).toEqual([]);
  });
});
