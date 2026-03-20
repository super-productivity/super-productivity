import { AfterViewInit, ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ShepherdService } from './shepherd.service';
import { LS } from '../../core/persistence/storage-keys.const';
import { concatMap, first } from 'rxjs/operators';
import { ProjectService } from '../project/project.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { showAddTaskBar } from '../../core-ui/layout/store/layout.actions';
import {
  WelcomeDialogComponent,
  WelcomeDialogResult,
} from '../welcome-dialog/welcome-dialog.component';

@Component({
  selector: 'shepherd',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShepherdComponent implements AfterViewInit {
  private _shepherdService = inject(ShepherdService);
  private _dataInitStateService = inject(DataInitStateService);
  private _projectService = inject(ProjectService);
  private _matDialog = inject(MatDialog);
  private _store = inject(Store);

  ngAfterViewInit(): void {
    if (
      !localStorage.getItem(LS.IS_SKIP_TOUR) &&
      navigator.userAgent !== 'NIGHTWATCH' &&
      !navigator.userAgent.includes('PLAYWRIGHT')
    ) {
      this._dataInitStateService.isAllDataLoadedInitially$
        .pipe(
          concatMap(() => this._projectService.list$),
          first(),
        )
        .subscribe((projectList) => {
          if (projectList.length <= 2) {
            this._showWelcomeDialog();
          } else {
            localStorage.setItem(LS.IS_SKIP_TOUR, 'true');
          }
        });
    }
  }

  private _showWelcomeDialog(): void {
    const dialogRef = this._matDialog.open(WelcomeDialogComponent, {
      disableClose: false,
      autoFocus: false,
    });
    dialogRef.afterClosed().subscribe((result: WelcomeDialogResult | undefined) => {
      localStorage.setItem(LS.IS_SKIP_TOUR, 'true');
      if (result === 'addTask') {
        this._store.dispatch(showAddTaskBar());
      } else if (result === 'tour') {
        this._shepherdService.init();
      }
    });
  }
}
