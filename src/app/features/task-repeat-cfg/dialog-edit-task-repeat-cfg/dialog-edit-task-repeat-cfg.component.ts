import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Task } from '../../tasks/task.model';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatDialog } from '@angular/material/dialog';
import { TaskRepeatCfgService } from '../task-repeat-cfg.service';
import {
  DEFAULT_TASK_REPEAT_CFG,
  TaskRepeatCfg,
  TaskRepeatCfgCopy,
} from '../task-repeat-cfg.model';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { UntypedFormGroup } from '@angular/forms';
import {
  TASK_REPEAT_CFG_ADVANCED_FORM_CFG,
  TASK_REPEAT_CFG_FORM_CFG_BEFORE_TAGS,
} from './task-repeat-cfg-form.const';
import { T } from '../../../t.const';
import { TagService } from '../../tag/tag.service';
import { unique } from '../../../util/unique';
import { exists } from '../../../util/exists';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { getDbDateStr, isDBDateStr } from '../../../util/get-db-date-str';
import { formatMonthDay } from '../../../util/format-month-day.util';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { first } from 'rxjs/operators';
import { getQuickSettingUpdates } from './get-quick-setting-updates';
import { clockStringFromDate } from '../../../ui/duration/clock-string-from-date';
import { HelpSectionComponent } from '../../../ui/help-section/help-section.component';
import { ChipListInputComponent } from '../../../ui/chip-list-input/chip-list-input.component';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { Log } from '../../../core/log';
import { toSignal } from '@angular/core/rxjs-interop';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { GlobalConfigService } from '../../config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
import { DateTimeFormatService } from 'src/app/core/date-time-format/date-time-format.service';
import { RepeatTaskHeatmapComponent } from '../repeat-task-heatmap/repeat-task-heatmap.component';

// TASK_REPEAT_CFG_FORM_CFG
@Component({
  selector: 'dialog-edit-task-repeat-cfg',
  templateUrl: './dialog-edit-task-repeat-cfg.component.html',
  styleUrls: ['./dialog-edit-task-repeat-cfg.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    TranslatePipe,
    MatDialogContent,
    HelpSectionComponent,
    FormlyModule,
    ChipListInputComponent,
    MatDialogActions,
    MatButton,
    MatIcon,
    RepeatTaskHeatmapComponent,
  ],
})
export class DialogEditTaskRepeatCfgComponent {
  private _globalConfigService = inject(GlobalConfigService);
  private _tagService = inject(TagService);
  private _taskRepeatCfgService = inject(TaskRepeatCfgService);
  private _matDialog = inject(MatDialog);
  private _matDialogRef =
    inject<MatDialogRef<DialogEditTaskRepeatCfgComponent>>(MatDialogRef);
  private _translateService = inject(TranslateService);
  private _dateTimeFormatService = inject(DateTimeFormatService);
  private _data = inject<{
    task?: Task;
    repeatCfg?: TaskRepeatCfg;
    targetDate?: string;
  }>(MAT_DIALOG_DATA);

  T: typeof T = T;

  repeatCfgInitial = signal<TaskRepeatCfgCopy | undefined>(undefined);
  repeatCfg = signal<Omit<TaskRepeatCfgCopy, 'id'> | TaskRepeatCfg>(
    this._initializeRepeatCfg(),
  );
  isLoading = signal<boolean>(false);
  isEdit = computed(() => {
    if (this._data.repeatCfg) return true;
    if (this._data.task?.repeatCfgId) return true;
    return false;
  });

  repeatCfgId = computed(() => {
    const cfg = this.repeatCfg();
    if ('id' in cfg && cfg.id) {
      return cfg.id;
    }
    return this._data.repeatCfg?.id || this._data.task?.repeatCfgId || null;
  });

  TASK_REPEAT_CFG_FORM_CFG_BEFORE_TAGS = signal<FormlyFieldConfig[]>([]);
  TASK_REPEAT_CFG_ADVANCED_FORM_CFG = signal<FormlyFieldConfig[]>(
    TASK_REPEAT_CFG_ADVANCED_FORM_CFG,
  );

  formGroup1 = signal(new UntypedFormGroup({}));
  formGroup2 = signal(new UntypedFormGroup({}));
  tagSuggestions = toSignal(this._tagService.tagsNoMyDayAndNoList$, { initialValue: [] });
  canRemoveInstance = signal<boolean>(false);
  removeInstanceButtonText = computed(() => {
    if (!this._data.targetDate) {
      return this._translateService.instant(T.F.TASK_REPEAT.F.REMOVE_INSTANCE);
    }

    // Format date using same logic as ShortDate2Pipe
    const date = isDBDateStr(this._data.targetDate)
      ? dateStrToUtcDate(this._data.targetDate)
      : new Date(this._data.targetDate);

    const formattedDate = formatMonthDay(
      date,
      this._dateTimeFormatService.currentLocale(),
    );

    return this._translateService.instant(T.F.TASK_REPEAT.F.REMOVE_FOR_DATE, {
      date: formattedDate,
    });
  });

  constructor() {
    // Initialize form config
    this._initializeFormConfig();

    // Set up effect to load task repeat config if editing
    effect(() => {
      if (this.isEdit() && this._data.task?.repeatCfgId) {
        this.isLoading.set(true);
        this._taskRepeatCfgService
          .getTaskRepeatCfgById$(this._data.task.repeatCfgId)
          .pipe(first())
          .subscribe((cfg) => {
            this._setRepeatCfgInitiallyForEditOnly(cfg);
            this._checkCanRemoveInstance();
            this.isLoading.set(false);
          });
      }
      this._checkCanRemoveInstance();
    });
  }

  private _initializeRepeatCfg(): Omit<TaskRepeatCfgCopy, 'id'> | TaskRepeatCfg {
    if (this._data.repeatCfg) {
      // Process the repeat config to determine if quickSetting needs to be changed to CUSTOM
      const processedCfg = this._processQuickSettingForDate(this._data.repeatCfg);

      // Set initial value for comparison
      this.repeatCfgInitial.set({ ...this._data.repeatCfg });
      return processedCfg;
    } else if (this._data.task) {
      const startTime = this._data.task.dueWithTime
        ? clockStringFromDate(this._data.task.dueWithTime)
        : undefined;
      return {
        ...DEFAULT_TASK_REPEAT_CFG,
        startDate: getDbDateStr(this._data.task.dueWithTime || undefined),
        startTime,
        remindAt: startTime
          ? (this._globalConfigService.cfg()?.reminder.defaultTaskRemindOption ??
            DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption!)
          : undefined,
        title: this._data.task.title,
        notes: this._data.task.notes || undefined,
        tagIds: unique(this._data.task.tagIds),
        defaultEstimate: this._data.task.timeEstimate,
      };
    } else {
      throw new Error('Invalid params given for repeat dialog!');
    }
  }

  private _initializeFormConfig(): void {
    const _locale = this._dateTimeFormatService.currentLocale();
    const today = new Date();
    const weekdayStr = today.toLocaleDateString(_locale, {
      weekday: 'long',
    });
    const dateDayStr = today.toLocaleDateString(_locale, {
      day: 'numeric',
    });
    const dayAndMonthStr = today.toLocaleDateString(_locale, {
      day: 'numeric',
      month: 'numeric',
    });

    const formConfigBeforeTags = [...TASK_REPEAT_CFG_FORM_CFG_BEFORE_TAGS];
    (formConfigBeforeTags[1] as any).templateOptions.options = [
      {
        value: 'DAILY',
        label: this._translateService.instant(T.F.TASK_REPEAT.F.Q_DAILY),
      },
      {
        value: 'MONDAY_TO_FRIDAY',
        label: this._translateService.instant(T.F.TASK_REPEAT.F.Q_MONDAY_TO_FRIDAY),
      },
      {
        value: 'WEEKLY_CURRENT_WEEKDAY',
        label: this._translateService.instant(
          T.F.TASK_REPEAT.F.Q_WEEKLY_CURRENT_WEEKDAY,
          { weekdayStr },
        ),
      },
      {
        value: 'MONTHLY_CURRENT_DATE',
        label: this._translateService.instant(T.F.TASK_REPEAT.F.Q_MONTHLY_CURRENT_DATE, {
          dateDayStr,
        }),
      },
      {
        value: 'YEARLY_CURRENT_DATE',
        label: this._translateService.instant(T.F.TASK_REPEAT.F.Q_YEARLY_CURRENT_DATE, {
          dayAndMonthStr,
        }),
      },
      {
        value: 'CUSTOM',
        label: this._translateService.instant(T.F.TASK_REPEAT.F.Q_CUSTOM, {}),
      },
    ];

    this.TASK_REPEAT_CFG_FORM_CFG_BEFORE_TAGS.set(formConfigBeforeTags);
  }

  save(): void {
    const formGroup1 = this.formGroup1();
    const formGroup2 = this.formGroup2();

    // Check if both forms are valid
    if (!formGroup1.valid || !formGroup2.valid) {
      // Mark all fields as touched to show validation errors
      formGroup1.markAllAsTouched();
      formGroup2.markAllAsTouched();
      Log.err('Form validation failed', {
        form1Errors: formGroup1.errors,
        form2Errors: formGroup2.errors,
      });
      return;
    }

    const currentRepeatCfg = this.repeatCfg();

    // workaround for formly not always updating hidden fields correctly (in time??)
    if (currentRepeatCfg.quickSetting !== 'CUSTOM') {
      // Pass startDate to use correct weekday for WEEKLY_CURRENT_WEEKDAY (fixes #5806)
      const referenceDate = currentRepeatCfg.startDate
        ? dateStrToUtcDate(currentRepeatCfg.startDate)
        : undefined;
      const updatesForQuickSetting = getQuickSettingUpdates(
        currentRepeatCfg.quickSetting,
        referenceDate,
      );
      if (updatesForQuickSetting) {
        this.repeatCfg.update((cfg) => ({ ...cfg, ...updatesForQuickSetting }));
      }
    }

    const finalRepeatCfg = this.repeatCfg();

    if (this.isEdit()) {
      const initial = this.repeatCfgInitial();
      if (!initial) {
        throw new Error('Initial task repeat cfg missing (code error)');
      }
      const isRelevantChangesForUpdateAllTasks =
        initial.title !== finalRepeatCfg.title ||
        initial.defaultEstimate !== finalRepeatCfg.defaultEstimate ||
        initial.remindAt !== finalRepeatCfg.remindAt ||
        initial.startTime !== finalRepeatCfg.startTime ||
        initial.notes !== finalRepeatCfg.notes ||
        JSON.stringify(initial.tagIds) !== JSON.stringify(finalRepeatCfg.tagIds);

      this._taskRepeatCfgService.updateTaskRepeatCfg(
        exists((finalRepeatCfg as TaskRepeatCfg).id),
        finalRepeatCfg,
        isRelevantChangesForUpdateAllTasks,
      );
      this.close();
    } else {
      this._taskRepeatCfgService.addTaskRepeatCfgToTask(
        (this._data.task as Task).id,
        (this._data.task as Task).projectId || null,
        finalRepeatCfg,
      );
      this.close();
    }
  }

  remove(): void {
    const currentRepeatCfg = this.repeatCfg();
    this._taskRepeatCfgService.deleteTaskRepeatCfgWithDialog(
      exists((currentRepeatCfg as TaskRepeatCfg).id),
    );
    this.close();
  }

  deleteInstance(): void {
    if (!this._data.targetDate || !this.canRemoveInstance()) {
      return;
    }

    const currentRepeatCfg = this.repeatCfg() as TaskRepeatCfg;
    const targetDate = this._data.targetDate;

    this._matDialog
      .open(DialogConfirmComponent, {
        restoreFocus: true,
        data: {
          message: this._translateService.instant(T.F.TASK_REPEAT.D_DELETE_INSTANCE.MSG, {
            date: new Date(targetDate).toLocaleDateString(
              this._dateTimeFormatService.currentLocale(),
            ),
          }),
          okTxt: this._translateService.instant(T.F.TASK_REPEAT.D_DELETE_INSTANCE.OK),
        },
      })
      .afterClosed()
      .subscribe((isConfirm: boolean) => {
        if (isConfirm) {
          this._taskRepeatCfgService.deleteTaskRepeatCfgInstance(
            exists(currentRepeatCfg.id),
            targetDate,
          );
          this.close();
        }
      });
  }

  close(): void {
    this._matDialogRef.close();
  }

  addTag(id: string): void {
    this.repeatCfg.update((cfg) => ({
      ...cfg,
      tagIds: unique([...cfg.tagIds, id]),
    }));
  }

  addNewTag(title: string): void {
    const id = this._tagService.addTag({ title });
    this.repeatCfg.update((cfg) => ({
      ...cfg,
      tagIds: unique([...cfg.tagIds, id]),
    }));
  }

  removeTag(id: string): void {
    this.repeatCfg.update((cfg) => ({
      ...cfg,
      tagIds: cfg.tagIds.filter((tagId) => tagId !== id),
    }));
  }

  private _setRepeatCfgInitiallyForEditOnly(repeatCfg: TaskRepeatCfg): void {
    const processedCfg = this._processQuickSettingForDate(repeatCfg);
    this.repeatCfg.set(processedCfg);
    this.repeatCfgInitial.set({ ...repeatCfg });
  }

  private _processQuickSettingForDate<
    T extends { quickSetting?: string; startDate?: string },
  >(cfg: T): T {
    let processedCfg = { ...cfg };

    if (processedCfg.quickSetting === 'WEEKLY_CURRENT_WEEKDAY') {
      if (!processedCfg.startDate) {
        // Gracefully fall back to CUSTOM when data is incomplete
        return { ...processedCfg, quickSetting: 'CUSTOM' } as T;
      }
      if (new Date(processedCfg.startDate).getDay() !== new Date().getDay()) {
        processedCfg = { ...processedCfg, quickSetting: 'CUSTOM' };
      }
    }
    if (processedCfg.quickSetting === 'YEARLY_CURRENT_DATE') {
      if (!processedCfg.startDate) {
        // Gracefully fall back to CUSTOM when data is incomplete
        return { ...processedCfg, quickSetting: 'CUSTOM' } as T;
      }
      if (
        new Date(processedCfg.startDate).getDate() !== new Date().getDate() ||
        new Date(processedCfg.startDate).getMonth() !== new Date().getMonth()
      ) {
        processedCfg = { ...processedCfg, quickSetting: 'CUSTOM' };
      }
    }
    if (processedCfg.quickSetting === 'MONTHLY_CURRENT_DATE') {
      if (!processedCfg.startDate) {
        // Gracefully fall back to CUSTOM when data is incomplete
        return { ...processedCfg, quickSetting: 'CUSTOM' } as T;
      }
      if (new Date(processedCfg.startDate).getDate() !== new Date().getDate()) {
        processedCfg = { ...processedCfg, quickSetting: 'CUSTOM' };
      }
    }

    return processedCfg;
  }

  private _checkCanRemoveInstance(): void {
    if (!this._data.targetDate) {
      this.canRemoveInstance.set(false);
      return;
    }
    const todayStr = getDbDateStr(new Date());
    const isTargetTodayOrPast = this._data.targetDate <= todayStr;
    this.canRemoveInstance.set(!isTargetTodayOrPast);
  }
}
