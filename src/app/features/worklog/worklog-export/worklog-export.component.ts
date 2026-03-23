import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  inject,
  input,
  OnDestroy,
  OnInit,
  output,
} from '@angular/core';
import { combineLatest, from, Subscription } from 'rxjs';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { SnackService } from '../../../core/snack/snack.service';
import { WorklogService } from '../worklog.service';
import {
  WorklogColTypes,
  WorklogExportSettingsCopy,
  WorklogGrouping,
} from '../worklog.model';
import { T } from '../../../t.const';
import { distinctUntilChanged, switchMap } from 'rxjs/operators';
import { distinctUntilChangedObject } from '../../../util/distinct-until-changed-object';
import { WorkContextAdvancedCfg } from '../../work-context/work-context.model';
import { WORKLOG_EXPORT_DEFAULTS } from '../../work-context/work-context.const';
import { WorkContextService } from '../../work-context/work-context.service';
import { ProjectService } from '../../project/project.service';
import { TagService } from '../../tag/tag.service';
import { createRows, formatRows, formatText } from './worklog-export.util';
import { MatDialogActions, MatDialogContent } from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { MatAnchor, MatButton, MatMiniFabButton } from '@angular/material/button';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIcon } from '@angular/material/icon';
import { MatSelect } from '@angular/material/select';
import { MatOption } from '@angular/material/core';
import { NgClass } from '@angular/common';
import { CollapsibleComponent } from '../../../ui/collapsible/collapsible.component';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatFormField } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { SimpleDownloadDirective } from '../../../ui/simple-download/simple-download.directive';
import { TranslatePipe } from '@ngx-translate/core';
import { TimeTrackingService } from '../../time-tracking/time-tracking.service';

@Component({
  selector: 'worklog-export',
  templateUrl: './worklog-export.component.html',
  styleUrls: ['./worklog-export.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogContent,
    FormsModule,
    MatMiniFabButton,
    MatMenuTrigger,
    MatTooltip,
    MatIcon,
    MatMenu,
    MatMenuItem,
    MatSelect,
    MatOption,
    NgClass,
    CollapsibleComponent,
    MatSlideToggle,
    MatFormField,
    MatInput,
    MatDialogActions,
    MatButton,
    MatAnchor,
    SimpleDownloadDirective,
    TranslatePipe,
  ],
})
export class WorklogExportComponent implements OnInit, OnDestroy {
  private _snackService = inject(SnackService);
  private _worklogService = inject(WorklogService);
  private _workContextService = inject(WorkContextService);
  private _changeDetectorRef = inject(ChangeDetectorRef);
  private _projectService = inject(ProjectService);
  private _tagService = inject(TagService);
  private _timeTrackingService = inject(TimeTrackingService);

  readonly rangeStart = input<Date>();
  readonly rangeEnd = input<Date>();
  readonly isWorklogExport = input<boolean>();
  readonly isShowClose = input<boolean>();
  readonly projectId = input<string | null>();

  // eslint-disable-next-line @angular-eslint/no-output-native
  readonly cancel = output<void>();

  T: typeof T = T;
  isShowAsText: boolean = false;
  headlineCols: string[] = [];
  formattedRows?: (string | number | undefined)[][];
  options: WorklogExportSettingsCopy = {
    ...WORKLOG_EXPORT_DEFAULTS,
    cols: [...WORKLOG_EXPORT_DEFAULTS.cols],
  };
  txt: string = '';
  fileName: string = 'tasks.csv';
  roundTimeOptions: { id: string; title: string }[] = [
    { id: 'QUARTER', title: T.F.WORKLOG.EXPORT.O.FULL_QUARTERS },
    { id: 'HALF', title: T.F.WORKLOG.EXPORT.O.FULL_HALF_HOURS },
    { id: 'HOUR', title: T.F.WORKLOG.EXPORT.O.FULL_HOURS },
  ];

  colOpts: { id: WorklogColTypes; title: string }[] = [
    { id: 'DATE', title: T.F.WORKLOG.EXPORT.O.DATE },
    { id: 'START', title: T.F.WORKLOG.EXPORT.O.STARTED_WORKING },
    { id: 'END', title: T.F.WORKLOG.EXPORT.O.ENDED_WORKING },
    { id: 'TITLES', title: T.F.WORKLOG.EXPORT.O.PARENT_TASK_TITLES_ONLY },
    {
      id: 'TITLES_INCLUDING_SUB',
      title: T.F.WORKLOG.EXPORT.O.TITLES_AND_SUB_TASK_TITLES,
    },
    { id: 'NOTES', title: T.F.WORKLOG.EXPORT.O.NOTES },
    { id: 'PROJECTS', title: T.F.WORKLOG.EXPORT.O.PROJECTS },
    { id: 'TAGS', title: T.F.WORKLOG.EXPORT.O.TAGS },
    { id: 'TIME_MS', title: T.F.WORKLOG.EXPORT.O.TIME_AS_MILLISECONDS },
    { id: 'TIME_STR', title: T.F.WORKLOG.EXPORT.O.TIME_AS_STRING },
    { id: 'TIME_CLOCK', title: T.F.WORKLOG.EXPORT.O.TIME_AS_CLOCK },
    { id: 'ESTIMATE_MS', title: T.F.WORKLOG.EXPORT.O.ESTIMATE_AS_MILLISECONDS },
    { id: 'ESTIMATE_STR', title: T.F.WORKLOG.EXPORT.O.ESTIMATE_AS_STRING },
    { id: 'ESTIMATE_CLOCK', title: T.F.WORKLOG.EXPORT.O.ESTIMATE_AS_CLOCK },
  ];

  groupByOptions: { id: string; title: string }[] = [
    { id: WorklogGrouping.DATE, title: T.F.WORKLOG.EXPORT.O.DATE },
    { id: WorklogGrouping.TASK, title: T.F.WORKLOG.EXPORT.O.TASK_SUBTASK },
    { id: WorklogGrouping.PARENT, title: T.F.WORKLOG.EXPORT.O.PARENT_TASK },
    { id: WorklogGrouping.WORKLOG, title: T.F.WORKLOG.EXPORT.O.WORKLOG },
  ];

  private _subs: Subscription = new Subscription();

  ngOnInit(): void {
    const rangeStart = this.rangeStart();
    const rangeEnd = this.rangeEnd();
    if (!rangeStart || !rangeEnd) {
      throw new Error('Worklog: Invalid date range');
    }
    this.fileName =
      'tasks' + getDbDateStr(rangeStart) + '-' + getDbDateStr(rangeEnd) + '.csv';

    this._subs.add(
      this._workContextService.advancedCfg$
        .pipe(distinctUntilChanged(distinctUntilChangedObject))
        .subscribe((advancedCfg: WorkContextAdvancedCfg) => {
          if (advancedCfg.worklogExportSettings) {
            this.options = {
              ...WORKLOG_EXPORT_DEFAULTS,
              ...advancedCfg.worklogExportSettings,
              // NOTE: if we don't do this typescript(?) gets aggressive
              cols: [
                ...(advancedCfg.worklogExportSettings
                  ? [...advancedCfg.worklogExportSettings.cols]
                  : [...WORKLOG_EXPORT_DEFAULTS.cols]),
              ],
            };
          } else {
            this.options = {
              ...WORKLOG_EXPORT_DEFAULTS,
              cols: [...WORKLOG_EXPORT_DEFAULTS.cols],
            };
          }
          this._changeDetectorRef.detectChanges();
        }),
    );

    this._subs.add(
      combineLatest([
        this._worklogService.getTaskListForRange$(
          rangeStart,
          rangeEnd,
          true,
          this.projectId(),
        ),
        this._projectService.list$,
        this._tagService.tags$,
        this._workContextService.activeWorkContext$.pipe(
          switchMap((ac) =>
            from(this._timeTrackingService.getLegacyWorkStartEndForWorkContext(ac)),
          ),
        ),
      ])
        .pipe()
        .subscribe(([tasks, projects, tags, activeContextTimeTracking]) => {
          if (tasks) {
            const workTimes = {
              start: activeContextTimeTracking.workStart,
              end: activeContextTimeTracking.workEnd,
            };
            const data = { tasks, projects, tags, workTimes };
            const rows = createRows(data, this.options.groupBy);
            this.formattedRows = formatRows(rows, this.options);
            // TODO format to csv

            this.headlineCols = this.options.cols.map((col) => {
              switch (col) {
                case 'DATE':
                  return 'Date';
                case 'START':
                  return 'Start';
                case 'END':
                  return 'End';
                case 'TITLES':
                  return 'Titles';
                case 'TITLES_INCLUDING_SUB':
                  return 'Titles';
                case 'NOTES':
                  return 'Descriptions';
                case 'PROJECTS':
                  return 'Projects';
                case 'TAGS':
                  return 'Tags';
                case 'TIME_MS':
                case 'TIME_STR':
                case 'TIME_CLOCK':
                  return 'Worked';
                case 'ESTIMATE_MS':
                case 'ESTIMATE_STR':
                case 'ESTIMATE_CLOCK':
                  return 'Estimate';
                default:
                  return 'INVALID COL';
              }
            });

            this.txt = formatText(this.headlineCols, this.formattedRows);
            this._changeDetectorRef.detectChanges();
          }
        }),
    );
  }

  ngOnDestroy(): void {
    this._subs.unsubscribe();
  }

  onCloseClick(): void {
    this.cancel.emit();
  }

  onOptionsChange(): void {
    this.options.cols = this.options.cols.filter((col) => !!col);
    this._workContextService.updateWorklogExportSettingsForCurrentContext(this.options);
  }

  addCol(colOpt: WorklogColTypes): void {
    this.options.cols.push(colOpt);
  }

  async copyToClipboard(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.txt);
      this._snackService.open({
        msg: T.GLOBAL_SNACK.COPY_TO_CLIPPBOARD,
        type: 'SUCCESS',
      });
    } catch (err) {
      this._snackService.open({
        msg: 'Failed to copy to clipboard',
        type: 'ERROR',
        isSkipTranslate: true,
      });
    }
  }
}
