import { inject, Injectable } from '@angular/core';
import { TaskService } from 'src/app/features/tasks/task.service';
import { SnackService } from '../snack/snack.service';
import { Log } from '../log';
import { parseEml } from 'src/app/util/eml-parser';
import { T } from 'src/app/t.const';

@Injectable({
  providedIn: 'root',
})
export class EmlDropService {
  private readonly _taskService = inject(TaskService);
  private readonly _snackService = inject(SnackService);

  async createTaskFromEml(file: File): Promise<void> {
    try {
      const data = await parseEml(file);

      const sender = data.from?.name || data.from?.address || '';
      const subject = data.subject || '';

      // If both are empty, no point in making an empty task.
      if (!sender && !subject) {
        this._snackService.open({ type: 'WARNING', msg: T.MH.EML_EMPTY });
        return;
      }

      const message = [sender, subject].filter(Boolean).join(': ');
      this._taskService.add(message);
      // TODO: add attachment to task
    } catch (e) {
      Log.err(e);
      this._snackService.open({ type: 'ERROR', msg: T.MH.EML_PARSE_ERROR });
    }
  }
}
