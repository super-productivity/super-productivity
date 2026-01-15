import { inject, Injectable } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { hideNonTaskSidePanelContent } from './layout.actions';
import { filter, mapTo } from 'rxjs/operators';
import { setSelectedTask } from '../../../features/tasks/store/task.actions';
import { TaskDetailTargetPanel } from '../../../features/tasks/task.model';
import { LayoutService } from '../layout.service';
import { NavigationStart, NavigationEnd, Router } from '@angular/router';

// what should happen
// task selected => open panel
// note show => open panel
// task selected, note show => task unselected, note shown
// note show, task selected, note show => task unselected, note shown
// note show, task selected => task shown, note hidden
// task selected, note show, task selected => task shown, note hidden

@Injectable()
export class LayoutEffects {
  private actions$ = inject(LOCAL_ACTIONS);
  private layoutService = inject(LayoutService);
  private router = inject(Router);

  hideNotesWhenTaskIsSelected$ = createEffect(() =>
    this.actions$.pipe(
      ofType(setSelectedTask),
      filter(({ id, taskDetailTargetPanel, isSkipToggle }) => {
        // Do not hide side content when opening modal (DONT_OPEN_PANEL) or when explicitly skipped
        if (id === null) return false;
        if (isSkipToggle) return false;
        return taskDetailTargetPanel !== TaskDetailTargetPanel.DONT_OPEN_PANEL;
      }),
      mapTo(hideNonTaskSidePanelContent()),
    ),
  );

  hideNotesNavigatingToDailySummary$ = createEffect(() =>
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      filter((event) => !!event.url.match(/(daily-summary)$/)),
      mapTo(hideNonTaskSidePanelContent()),
    ),
  );

  // Deselect task on navigation start - parent task button will re-select after navigation
  unselectTaskOnNavigation$ = createEffect(() =>
    this.router.events.pipe(
      filter((event): event is NavigationStart => event instanceof NavigationStart),
      mapTo(setSelectedTask({ id: null })),
    ),
  );
}
