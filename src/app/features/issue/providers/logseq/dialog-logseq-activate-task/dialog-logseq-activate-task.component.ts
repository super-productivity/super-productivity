import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogRef,
  MatDialogTitle,
  MatDialogContent,
  MatDialogActions,
} from '@angular/material/dialog';
import { Task } from '../../../../tasks/task.model';
import { MatIcon } from '@angular/material/icon';
import { MatButton } from '@angular/material/button';
import { Store } from '@ngrx/store';
import { setCurrentTask, unsetCurrentTask } from '../../../../tasks/store/task.actions';
import { LogseqCommonInterfacesService } from '../logseq-common-interfaces.service';
import { IssueProviderService } from '../../../issue-provider.service';
import { LogseqCfg, LogseqTaskWorkflow } from '../logseq.model';
import { TaskService } from '../../../../tasks/task.service';
import { LogseqBlock } from '../logseq-issue.model';
import { TaskSharedActions } from '../../../../../root-store/meta/task-shared.actions';

type DiscrepancyType =
  | 'LOGSEQ_DONE_SUPERPROD_NOT_DONE'
  | 'SUPERPROD_DONE_LOGSEQ_NOT_DONE'
  | 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE'
  | 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE';

@Component({
  selector: 'dialog-logseq-activate-task',
  templateUrl: './dialog-logseq-activate-task.component.html',
  styleUrls: ['./dialog-logseq-activate-task.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogTitle, MatIcon, MatDialogContent, MatDialogActions, MatButton],
})
export class DialogLogseqActivateTaskComponent {
  private _matDialogRef =
    inject<MatDialogRef<DialogLogseqActivateTaskComponent>>(MatDialogRef);
  private _store = inject(Store);
  private _logseqCommonService = inject(LogseqCommonInterfacesService);
  private _issueProviderService = inject(IssueProviderService);
  private _taskService = inject(TaskService);
  data = inject<{
    task: Task;
    block: LogseqBlock;
    discrepancyType: DiscrepancyType;
  }>(MAT_DIALOG_DATA);

  dialogTitle = computed(() => {
    switch (this.data.discrepancyType) {
      case 'LOGSEQ_DONE_SUPERPROD_NOT_DONE':
        return 'Task in Logseq abgeschlossen';
      case 'SUPERPROD_DONE_LOGSEQ_NOT_DONE':
        return 'Task in Super Productivity abgeschlossen';
      case 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE':
        return 'Task in Logseq gestartet';
      case 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE':
        return 'Task in Super Productivity aktiv';
    }
  });

  dialogMessage = computed(() => {
    switch (this.data.discrepancyType) {
      case 'LOGSEQ_DONE_SUPERPROD_NOT_DONE':
        return `Der Task "${this.data.task.title}" wurde in Logseq als DONE markiert.`;
      case 'SUPERPROD_DONE_LOGSEQ_NOT_DONE':
        return `Der Task "${this.data.task.title}" wurde in Super Productivity abgeschlossen, ist aber in Logseq noch nicht DONE.`;
      case 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE':
        return `Der Task "${this.data.task.title}" wurde in Logseq gestartet (Marker auf NOW/DOING gesetzt).`;
      case 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE':
        return `Der Task "${this.data.task.title}" ist in Super Productivity aktiv, aber in Logseq nicht als NOW/DOING markiert.`;
    }
  });

  logseqActionLabel = computed(() => {
    switch (this.data.discrepancyType) {
      case 'LOGSEQ_DONE_SUPERPROD_NOT_DONE':
        return 'Logseq auf TODO/LATER setzen';
      case 'SUPERPROD_DONE_LOGSEQ_NOT_DONE':
        return 'Logseq auf DONE setzen';
      case 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE':
        return 'Logseq auf TODO/LATER setzen';
      case 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE':
        return 'Logseq auf NOW/DOING setzen';
    }
  });

  superProdActionLabel = computed(() => {
    switch (this.data.discrepancyType) {
      case 'LOGSEQ_DONE_SUPERPROD_NOT_DONE':
        return 'Abschließen';
      case 'SUPERPROD_DONE_LOGSEQ_NOT_DONE':
        return 'SuperProd auf nicht-DONE setzen';
      case 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE':
        return 'Aktivieren';
      case 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE':
        return 'Task deaktivieren';
    }
  });

  private _getMarkers(workflow: LogseqTaskWorkflow): {
    active: 'DOING' | 'NOW';
    stopped: 'TODO' | 'LATER';
    done: 'DONE';
  } {
    return workflow === 'NOW_LATER'
      ? { active: 'NOW', stopped: 'LATER', done: 'DONE' }
      : { active: 'DOING', stopped: 'TODO', done: 'DONE' };
  }

  close(): void {
    // Save current Logseq state to prevent dialog from reappearing
    // User has acknowledged the discrepancy and chosen to ignore it
    const block = this.data.block;
    this._taskService.update(this.data.task.id, {
      issueMarker: block.marker,
      isDone: block.marker === 'DONE',
    });
    this._matDialogRef.close();
  }

  async logseqAction(): Promise<void> {
    const task = this.data.task;

    switch (this.data.discrepancyType) {
      case 'LOGSEQ_DONE_SUPERPROD_NOT_DONE':
      case 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE':
        // Reset Logseq block to TODO/LATER
        if (task.issueId && task.issueProviderId) {
          const cfg = await this._issueProviderService
            .getCfgOnce$(task.issueProviderId, 'LOGSEQ')
            .toPromise();
          if (cfg) {
            const markers = this._getMarkers((cfg as LogseqCfg).taskWorkflow);
            await this._logseqCommonService.updateBlockMarker(
              task.issueId as string,
              task.issueProviderId,
              markers.stopped,
            );
          }
        }
        break;

      case 'SUPERPROD_DONE_LOGSEQ_NOT_DONE':
        // Mark block as DONE in Logseq
        if (task.issueId && task.issueProviderId) {
          await this._logseqCommonService.updateBlockMarker(
            task.issueId as string,
            task.issueProviderId,
            'DONE',
          );
        }
        break;

      case 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE':
        // Set block to NOW/DOING in Logseq
        if (task.issueId && task.issueProviderId) {
          const cfg = await this._issueProviderService
            .getCfgOnce$(task.issueProviderId, 'LOGSEQ')
            .toPromise();
          if (cfg) {
            const markers = this._getMarkers((cfg as LogseqCfg).taskWorkflow);
            await this._logseqCommonService.updateBlockMarker(
              task.issueId as string,
              task.issueProviderId,
              markers.active,
            );
          }
        }
        break;
    }

    this._matDialogRef.close();
  }

  async superProdAction(): Promise<void> {
    const task = this.data.task;

    switch (this.data.discrepancyType) {
      case 'LOGSEQ_DONE_SUPERPROD_NOT_DONE':
        // Mark task as done in SuperProd
        this._store.dispatch(
          TaskSharedActions.updateTask({
            task: {
              id: task.id,
              changes: { isDone: true },
            },
          }),
        );
        break;

      case 'SUPERPROD_DONE_LOGSEQ_NOT_DONE':
        // Unmark task as done in SuperProd
        this._store.dispatch(
          TaskSharedActions.updateTask({
            task: {
              id: task.id,
              changes: { isDone: false },
            },
          }),
        );
        break;

      case 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE':
        // Activate task in SuperProd
        this._store.dispatch(setCurrentTask({ id: task.id }));
        break;

      case 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE':
        // Deactivate task in SuperProd
        this._store.dispatch(unsetCurrentTask());
        break;
    }

    this._matDialogRef.close();
  }
}
