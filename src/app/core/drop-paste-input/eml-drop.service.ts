import { inject, Injectable } from '@angular/core';
import { TaskService } from '../../features/tasks/task.service';
import { SnackService } from '../snack/snack.service';
import { Log } from '../log';
import { parseEml } from '../../util/eml-parser';
import { T } from '../../t.const';

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

      const title = [sender, subject].filter(Boolean).join(': ');
      // Keep the email body as notes so the task retains context, not just a
      // title. Use the plain-text part only (never data.html) — notes render as
      // markdown, so injecting untrusted email HTML would be an XSS vector.
      const notes = data.text?.trim() || undefined;
      this._taskService.add(title, false, { notes });
      // TODO: add attachment to task
    } catch (e) {
      Log.err('Failed to parse EML file', e);
      this._snackService.open({ type: 'ERROR', msg: T.MH.EML_PARSE_ERROR });
    }
  }
}
