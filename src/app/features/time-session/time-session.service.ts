import { inject, Injectable } from '@angular/core';
import { TaskService } from '../tasks/task.service';
import { TaskTimeSyncService } from '../tasks/task-time-sync.service';
import { TimeSession } from './time-session.model';
import { editTimeSession } from './time-session-edit.util';

@Injectable({ providedIn: 'root' })
export class TimeSessionService {
  private readonly _tasks = inject(TaskService);
  private readonly _timeSync = inject(TaskTimeSyncService);

  async edit(
    taskId: string,
    day: string,
    previousId?: string,
    replacement?: TimeSession,
  ): Promise<void> {
    this._timeSync.flushOne(taskId);
    const task = await this._tasks.getByIdFromEverywhere(taskId);
    if (!task || task.subTaskIds.length) return;
    const changes = editTimeSession(task, day, previousId, replacement);
    if (Object.keys(changes).length) await this._tasks.updateEverywhere(taskId, changes);
  }

  async setTotal(taskId: string, day: string, total: number): Promise<void> {
    if (!Number.isFinite(total) || total < 0) return;
    this._timeSync.flushOne(taskId);
    const task = await this._tasks.getByIdFromEverywhere(taskId);
    if (!task || task.subTaskIds.length) return;
    await this._tasks.updateEverywhere(taskId, {
      timeSpentOnDay: { ...task.timeSpentOnDay, [day]: total },
    });
  }
}
