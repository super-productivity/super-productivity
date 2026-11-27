import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { combineLatest, EMPTY, from, Observable } from 'rxjs';
import { SimpleMetrics } from './metric.model';
import { delay, map, switchMap, take } from 'rxjs/operators';
import { WorkContextType } from '../work-context/work-context.model';
import { mapSimpleMetrics } from './metric.util';
import { TaskArchiveOrchestratorService } from '../tasks/task-archive-orchestrator.service';
import { ProjectService } from '../project/project.service';
import { WorklogService } from '../worklog/worklog.service';
import { WorkContextService } from '../work-context/work-context.service';

@Injectable({
  providedIn: 'root',
})
export class ProjectMetricsService {
  private readonly _taskArchiveOrchestrator = inject(TaskArchiveOrchestratorService);
  private _projectService = inject(ProjectService);
  private _worklogService = inject(WorklogService);
  private _workContextService = inject(WorkContextService);

  private _simpleMetricsObs$: Observable<SimpleMetrics> =
    this._workContextService.activeWorkContextTypeAndId$.pipe(
      // wait for current projectId to settle in :(
      delay(100),
      switchMap(({ activeType, activeId }) => {
        return activeType === WorkContextType.PROJECT
          ? combineLatest([
              this._projectService.getBreakNrForProject$(activeId),
              this._projectService.getBreakTimeForProject$(activeId),
              this._worklogService.worklog$,
              this._worklogService.totalTimeSpent$,
              from(this._taskArchiveOrchestrator.getAllTasksForProject(activeId)),
            ]).pipe(
              map(mapSimpleMetrics),
              // because otherwise the page is always redrawn if a task is active
              take(1),
            )
          : EMPTY;
      }),
    );

  simpleMetrics = toSignal(this._simpleMetricsObs$);
}
