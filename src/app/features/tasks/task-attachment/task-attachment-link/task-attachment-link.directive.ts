import { Directive, HostListener, inject, input } from '@angular/core';
import { IS_ELECTRON } from '../../../../app.constants';
import { TaskAttachmentType } from '../task-attachment.model';
import { SnackService } from '../../../../core/snack/snack.service';
import { T } from '../../../../t.const';

@Directive({ selector: '[taskAttachmentLink]' })
export class TaskAttachmentLinkDirective {
  private _snackService = inject(SnackService);

  readonly type = input<TaskAttachmentType>();
  readonly href = input<string>();

  @HostListener('click', ['$event']) onClick(ev: Event): void {
    const href = this.href();
    if (!href) {
      throw new Error('No href');
    }

    if (ev.target) {
      const el = ev.target as HTMLElement;
      el.blur();
    }

    if (!IS_ELECTRON && this._isLocalFileUrl(href)) {
      ev.preventDefault();
      this._snackService.open({
        msg: T.F.ATTACHMENT.LOCAL_FILE_UNAVAILABLE,
        type: 'ERROR',
      });
      return;
    }

    if (IS_ELECTRON) {
      ev.preventDefault();
      const type = this.type();
      if (!type || type === 'LINK') {
        this._openExternalUrl(href);
      } else if (type === 'FILE') {
        window.ea.openPath(href);
      } else if (type === 'COMMAND') {
        // COMMAND attachments can no longer run shell commands: the exec IPC was
        // removed to close GHSA-256q. Legacy/imported COMMAND attachments still
        // render but are inert on click.
        this._snackService.open({
          msg: T.F.ATTACHMENT.COMMAND_UNSUPPORTED,
          type: 'ERROR',
        });
      }
    } else if (this.type() === 'LINK') {
      this._openExternalUrl(href);
    }
  }

  private _isLocalFileUrl(url: string): boolean {
    return url.toLowerCase().startsWith('file://');
  }

  private _openExternalUrl(rawUrl: string): void {
    if (!rawUrl) {
      return;
    }

    // try to account for jira(?) adding a second http to the url
    const url = rawUrl
      .replace('https://https://', 'https://')
      .replace('http://http://', 'http://');

    if (IS_ELECTRON) {
      window.ea.openExternalUrl(url);
    } else {
      const win = window.open(url, '_blank');
      if (win) {
        win.focus();
      }
    }
  }
}
