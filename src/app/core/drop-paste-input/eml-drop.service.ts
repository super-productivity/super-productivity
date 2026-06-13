import { inject, Injectable } from '@angular/core';
import { TaskService } from 'src/app/features/tasks/task.service';
import { SnackService } from '../snack/snack.service';
import { Log } from '../log';
import { parseEml } from 'src/app/util/eml-parser';

@Injectable({
  providedIn: 'root',
})
export class EmlDropService {
  private readonly taskService = inject(TaskService);
  private readonly _snackService = inject(SnackService);

  async createTaskFromEml(file: File): Promise<void> {
    try {
      const data = await parseEml(file);

      const sender = data.from?.name || data.from?.address || '';
      const subject = data?.subject || '';

      // If both are empty, no point in making an empty task.
      if (!sender && !subject) throw new Error('sender and subject are both empty');

      const message = `${sender}: ${subject}`;
      this.taskService.add(message);
      // TODO: add attachment to task
    } catch (e) {
      Log.err(e);
      this._snackService.open("Couldn't create task");
    }
    return;
  }
}
