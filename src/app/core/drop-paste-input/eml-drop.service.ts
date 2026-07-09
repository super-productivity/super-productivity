import { inject, Injectable } from '@angular/core';
import { TaskService } from '../../features/tasks/task.service';
import { SnackService } from '../snack/snack.service';
import { Log } from '../log';
import { parseEml } from '../../util/eml-parser';
import { T } from '../../t.const';

// postal-mime parses synchronously on the main thread, and the body becomes a
// note that syncs to every device. Bound the untrusted input so a pathological
// .eml can't freeze the UI or balloon the op-log.
const MAX_EML_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

@Injectable({
  providedIn: 'root',
})
export class EmlDropService {
  private readonly _taskService = inject(TaskService);
  private readonly _snackService = inject(SnackService);

  async createTaskFromEml(file: File): Promise<void> {
    if (file.size > MAX_EML_FILE_SIZE) {
      this._snackService.open({ type: 'ERROR', msg: T.MH.EML_TOO_LARGE });
      return;
    }

    try {
      const data = await parseEml(file);

      const sender = (data.from?.name || data.from?.address || '').trim();
      const subject = (data.subject || '').trim();

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
      // isIgnoreShortSyntax: the subject is untrusted external content — don't
      // let ShortSyntaxEffects parse #tag/@date/+project tokens out of it.
      this._taskService.add(title, false, { notes }, false, true);
    } catch (e) {
      // Log a bounded reason, not the raw error: the source is untrusted email
      // content and log history is exportable (rule #9). postal-mime's throw
      // messages are structural (no message content), so the reason is safe to keep.
      Log.err(
        'Failed to parse EML file',
        e instanceof Error ? e.message : 'Unknown error',
      );
      this._snackService.open({ type: 'ERROR', msg: T.MH.EML_PARSE_ERROR });
    }
  }
}
