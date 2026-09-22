import { TestBed } from '@angular/core/testing';
import { TaskService } from '../tasks/task.service';
import { TaskTimeSyncService } from '../tasks/task-time-sync.service';
import { DEFAULT_TASK } from '../tasks/task.model';
import { TimeSessionService } from './time-session.service';

describe('TimeSessionService', () => {
  it('flushes pending tracking and edits the latest task, including archived tasks', async () => {
    const day = '2026-09-13';
    const recording = { id: 'recording', d: day, t: 60000 };
    const tasks = jasmine.createSpyObj<TaskService>('TaskService', [
      'getByIdFromEverywhere',
      'updateEverywhere',
    ]);
    const sync = jasmine.createSpyObj<TaskTimeSyncService>('TaskTimeSyncService', [
      'flushOne',
    ]);
    tasks.getByIdFromEverywhere.and.resolveTo({
      ...DEFAULT_TASK,
      id: 'task',
      projectId: 'INBOX',
      timeSessions: [recording],
      timeSpentOnDay: { [day]: 60000 },
    });
    tasks.updateEverywhere.and.resolveTo();
    TestBed.configureTestingModule({
      providers: [
        TimeSessionService,
        { provide: TaskService, useValue: tasks },
        { provide: TaskTimeSyncService, useValue: sync },
      ],
    });
    const service = TestBed.inject(TimeSessionService);
    await service.setTotal('task', day, 30000);
    expect(sync.flushOne).toHaveBeenCalledBefore(tasks.getByIdFromEverywhere);
    expect(tasks.updateEverywhere).toHaveBeenCalledWith('task', {
      timeSpentOnDay: { [day]: 30000 },
    });
    await service.edit('task', day, recording.id, { ...recording, t: 90000 });
    expect(tasks.updateEverywhere).toHaveBeenCalledWith('task', {
      timeSpentOnDay: { [day]: 90000 },
      timeSessions: [{ ...recording, t: 90000 }],
    });
  });
});
