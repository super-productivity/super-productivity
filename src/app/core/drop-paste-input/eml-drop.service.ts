import { inject, Injectable } from '@angular/core';
import { TaskService } from '../../features/tasks/task.service';
import { SnackService } from '../snack/snack.service';
import { Log } from '../log';
import { T } from '../../t.const';

// Parsing runs on the main thread, and the body becomes a note that syncs to every
// device. Bound the untrusted input so a pathological .eml can't freeze the UI or
// balloon the op-log.
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
      const { parseEml } = await import('../../util/eml-parser');
      const data = await parseEml(file);

      const sender = (data.from?.name || data.from?.address || '').trim();
      const subject = (data.subject || '').trim();

      // If both are empty, no point in making an empty task.
      if (!sender && !subject) {
        this._snackService.open({ type: 'WARNING', msg: T.MH.EML_EMPTY });
        return;
      }

      const title = [sender, subject].filter(Boolean).join(': ');
      // A text/plain body is external text, not trusted Markdown. Store it in a
      // fence that cannot occur in the body so rendering stays literal and inert.
      const plainText = data.text?.trim();
      const notes = plainText ? _asLiteralMarkdown(plainText) : undefined;
      // isIgnoreShortSyntax: the subject is untrusted external content — don't
      // let ShortSyntaxEffects parse #tag/@date/+project tokens out of it.
      this._taskService.add(title, false, { notes }, false, true);
    } catch {
      // Error details cross an untrusted file boundary and may contain user content.
      Log.err('Failed to parse EML file');
      this._snackService.open({ type: 'ERROR', msg: T.MH.EML_PARSE_ERROR });
    }
  }
}

const _asLiteralMarkdown = (text: string): string => {
  const backtickFence = '`'.repeat(_getFenceLength(text, /^ {0,3}(`{3,})/gm));
  const tildeFence = '~'.repeat(_getFenceLength(text, /^ {0,3}(~{3,})/gm));
  const fence = backtickFence.length <= tildeFence.length ? backtickFence : tildeFence;

  return `${fence}\n${text}\n${fence}`;
};

const _getFenceLength = (text: string, fencePattern: RegExp): number => {
  let fenceLength = 3;

  for (const match of text.matchAll(fencePattern)) {
    fenceLength = Math.max(fenceLength, match[1].length + 1);
  }

  return fenceLength;
};
