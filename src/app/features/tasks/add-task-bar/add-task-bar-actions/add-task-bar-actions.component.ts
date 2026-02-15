import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { first } from 'rxjs/operators';
import { ProjectService } from '../../../project/project.service';
import { TagService } from '../../../tag/tag.service';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { DialogScheduleTaskComponent } from '../../../planner/dialog-schedule-task/dialog-schedule-task.component';
import { AddTaskBarStateService } from '../add-task-bar-state.service';
import { AddTaskBarParserService } from '../add-task-bar-parser.service';
import { ESTIMATE_OPTIONS } from '../add-task-bar.const';
import { stringToMs } from '../../../../ui/duration/string-to-ms.pipe';
import { msToString } from '../../../../ui/duration/ms-to-string.pipe';
import { T } from '../../../../t.const';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { dateStrToUtcDate } from '../../../../util/date-str-to-utc-date';
import { getDbDateStr } from '../../../../util/get-db-date-str';
import { isSingleEmoji } from '../../../../util/extract-first-emoji';
import { DEFAULT_PROJECT_ICON } from '../../../project/project.const';
import { DateTimeFormatService } from 'src/app/core/date-time-format/date-time-format.service';

@Component({
  selector: 'add-task-bar-actions',
  templateUrl: './add-task-bar-actions.component.html',
  styleUrls: ['./add-task-bar-actions.component.scss', '../add-task-bar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    MatButton,
    MatIcon,
    MatTooltip,
    MatMenu,
    MatMenuTrigger,
    MatMenuItem,
    TranslateModule,
  ],
})
export class AddTaskBarActionsComponent {
  private _destroyRef = inject(DestroyRef);
  private _projectService = inject(ProjectService);
  private _tagService = inject(TagService);
  private _matDialog = inject(MatDialog);
  private _parserService = inject(AddTaskBarParserService);
  private _dateTimeFormatService = inject(DateTimeFormatService);
  private _translateService = inject(TranslateService);
  stateService = inject(AddTaskBarStateService);

  T = T;

  // Inputs
  isHideDueBtn = input<boolean>(false);
  isHideTagBtn = input<boolean>(false);

  // Outputs
  estimateChanged = output<string>();
  refocus = output<void>();
  scheduleDialogOpenChange = output<boolean>();

  // Menu state
  isProjectMenuOpen = signal<boolean>(false);
  isTagsMenuOpen = signal<boolean>(false);
  isEstimateMenuOpen = signal<boolean>(false);

  // State from service
  state = computed(() => this.stateService.state());
  hasNewTags = computed(() => this.state().newTagTitles.length > 0);
  isAutoDetected = computed(() => this.stateService.isAutoDetected());

  // Signals for projects and tags (sorted for consistency)
  allProjects = this._projectService.listSortedForUI;
  selectedProject = computed(() =>
    this.allProjects().find((p) => p.id === this.state().projectId),
  );
  allTags = this._tagService.tagsNoMyDayAndNoListSorted;
  selectedTags = computed(() =>
    this.allTags().filter(
      (t) =>
        this.state().tagIds.includes(t.id) || this.state().tagIdsFromTxt.includes(t.id),
    ),
  );
  hasTagsSelected = computed(
    () => this.state().tagIds.length > 0 || this.state().tagIdsFromTxt.length > 0,
  );

  // Constants
  readonly ESTIMATE_OPTIONS = ESTIMATE_OPTIONS;

  // View children
  projectMenuTrigger = viewChild('projectMenuTrigger', { read: MatMenuTrigger });
  tagsMenuTrigger = viewChild('tagsMenuTrigger', { read: MatMenuTrigger });
  estimateMenuTrigger = viewChild('estimateMenuTrigger', { read: MatMenuTrigger });

  // Computed values
  dateDisplay = computed(() => {
    const state = this.state();
    if (!state.date) return null;
    const today = new Date();
    const date = dateStrToUtcDate(state.date);
    if (this.isSameDate(date, today)) {
      return state.time || this._translateService.instant(T.F.TASK.ADD_TASK_BAR.TODAY);
    }
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (!state.time && this.isSameDate(date, tomorrow)) {
      return state.time || this._translateService.instant(T.F.TASK.ADD_TASK_BAR.TOMORROW);
    }
    const dateStr = date.toLocaleDateString(this._dateTimeFormatService.currentLocale(), {
      month: 'short',
      day: 'numeric',
    });
    return state.time ? `${dateStr} ${state.time}` : dateStr;
  });

  estimateDisplay = computed(() => {
    const estimate = this.state().estimate;
    return estimate ? msToString(estimate) : null;
  });

  // Emoji detection for project icons
  isProjectEmojiIcon = computed(() => {
    const project = this.selectedProject();
    const icon = project?.icon || 'folder';
    return isSingleEmoji(icon);
  });

  // Emoji detection for tag icons
  isTagEmojiIcon(tag: any): boolean {
    const icon = tag?.icon || 'label';
    return isSingleEmoji(icon);
  }

  openScheduleDialog(): void {
    const state = this.state();
    this.scheduleDialogOpenChange.emit(true);
    let dialogRef!: MatDialogRef<DialogScheduleTaskComponent>;
    try {
      dialogRef = this._matDialog.open(DialogScheduleTaskComponent, {
        data: {
          targetDay: state.date || undefined,
          targetTime: state.time || undefined,
          isSelectDueOnly: true,
        },
      });
    } catch (err) {
      this.scheduleDialogOpenChange.emit(false);
      throw err;
    }

    dialogRef.afterClosed().subscribe((result) => {
      if (result && typeof result === 'object' && result.date) {
        this.stateService.updateDate(getDbDateStr(result.date), result.time);
        // No UI access to reminder without a time being set
        this.stateService.updateRemindOption(result.remindOption);
      }
      this.refocus.emit();
      window.setTimeout(() => {
        if (!this._destroyRef.destroyed) {
          this.scheduleDialogOpenChange.emit(false);
        }
      });
    });
  }

  hasSelectedTag(tagId: string): boolean {
    return this.state().tagIds.includes(tagId);
  }

  onEstimateInput(value: string): void {
    const ms = stringToMs(value);
    if (ms > 0) {
      this.stateService.updateEstimate(ms);
      this.estimateChanged.emit(value);
    }
  }

  onProjectMenuClick(): void {
    this._handleMenuClick('project');
  }

  onTagsMenuClick(): void {
    this._handleMenuClick('tags');
  }

  onEstimateMenuClick(): void {
    this._handleMenuClick('estimate');
  }

  // Public methods to open menus programmatically
  openProjectMenu(): void {
    this._openMenuProgrammatically('project');
  }

  openTagsMenu(): void {
    this._openMenuProgrammatically('tags');
  }

  openEstimateMenu(): void {
    this._openMenuProgrammatically('estimate');
  }

  // Private helper methods for DRY menu handling
  private _handleMenuClick(menuType: 'project' | 'tags' | 'estimate'): void {
    if (this._destroyRef.destroyed) {
      return;
    }

    const { menuSignal, trigger } = this._getMenuRefs(menuType);
    menuSignal.set(true);

    if (trigger) {
      trigger.menuClosed.pipe(first()).subscribe(() => {
        menuSignal.set(false);
        this.refocus.emit();
      });
    }
  }

  private _openMenuProgrammatically(menuType: 'project' | 'tags' | 'estimate'): void {
    if (this._destroyRef.destroyed) {
      return;
    }

    const { menuSignal, trigger } = this._getMenuRefs(menuType);

    if (trigger) {
      menuSignal.set(true);
      trigger.openMenu();
      trigger.menuClosed.pipe(first()).subscribe(() => {
        menuSignal.set(false);
        this.refocus.emit();
      });
    }
  }

  private _getMenuRefs(menuType: 'project' | 'tags' | 'estimate'): {
    menuSignal: ReturnType<typeof signal<boolean>>;
    trigger: MatMenuTrigger | undefined;
  } {
    switch (menuType) {
      case 'project':
        return {
          menuSignal: this.isProjectMenuOpen,
          trigger: this.projectMenuTrigger(),
        };
      case 'tags':
        return {
          menuSignal: this.isTagsMenuOpen,
          trigger: this.tagsMenuTrigger(),
        };
      case 'estimate':
        return {
          menuSignal: this.isEstimateMenuOpen,
          trigger: this.estimateMenuTrigger(),
        };
    }
  }

  clearDateWithSyntax(): void {
    const currentInput = this.stateService.inputTxt();
    const cleanedInput = this._parserService.removeShortSyntaxFromInput(
      currentInput,
      'date',
    );
    this.stateService.clearDate(cleanedInput);
    this.refocus.emit();
  }

  clearTagsWithSyntax(): void {
    const currentInput = this.stateService.inputTxt();
    const cleanedInput = this._parserService.removeShortSyntaxFromInput(
      currentInput,
      'tags',
    );
    this.stateService.clearTags(cleanedInput);
    this.refocus.emit();
  }

  clearEstimateWithSyntax(): void {
    const currentInput = this.stateService.inputTxt();
    const cleanedInput = this._parserService.removeShortSyntaxFromInput(
      currentInput,
      'estimate',
    );
    this.stateService.clearEstimate(cleanedInput);
    this.refocus.emit();
  }

  toggleTagWithSyntax(tag: any): void {
    const currentInput = this.stateService.inputTxt();
    const isRemoving = this.hasSelectedTag(tag.id);

    if (isRemoving) {
      // If removing the tag, clean it from the input
      const cleanedInput = this._parserService.removeShortSyntaxFromInput(
        currentInput,
        'tags',
        tag.title,
      );
      this.stateService.toggleTag(tag, cleanedInput);
    } else {
      // If adding the tag, don't modify the input (let the parser handle it)
      this.stateService.toggleTag(tag);
    }
    this.refocus.emit();
  }

  private isSameDate(date1: Date, date2: Date): boolean {
    return (
      date1.getFullYear() === date2.getFullYear() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getDate() === date2.getDate()
    );
  }

  protected readonly DEFAULT_PROJECT_ICON = DEFAULT_PROJECT_ICON;
}
