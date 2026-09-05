import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  MatMenu,
  MatMenuContent,
  MatMenuItem,
  MatMenuTrigger,
} from '@angular/material/menu';
import { MatIcon } from '@angular/material/icon';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatDivider } from '@angular/material/divider';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService, TranslateStore } from '@ngx-translate/core';
import { getPluralKey } from '../../../util/get-plural-key';
import { T } from '../../../t.const';
import { TaskMultiSelectService } from '../task-multi-select.service';
import { TaskBulkActionService } from '../task-bulk-action.service';
import { ProjectService } from '../../project/project.service';
import { TagService } from '../../tag/tag.service';
import { MenuTreeService } from '../../menu-tree/menu-tree.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { DEFAULT_PROJECT_ICON } from '../../project/project.const';
import { ESTIMATE_OPTIONS } from '../add-task-bar/add-task-bar.const';
import { SelectOptionRowComponent } from '../../../ui/select-option-row/select-option-row.component';
import { getCommonProjectId } from '../task-bulk-action.util';
import { KeyboardConfig } from '@sp/keyboard-config';
import { isTouchActive } from '../../../util/input-intent';

const EMPTY_KB = {} as KeyboardConfig;

/**
 * Sticky bar shown while tasks are multi-selected: clear, count, and one
 * "Actions" entry point to the bulk menu. Mounted once in the app layout so a
 * selection can never exist without a way to act on it. The same menu also
 * opens next to a selected row on right-click / Q (via requestMenuOpen).
 */
@Component({
  selector: 'task-multi-select-bar',
  templateUrl: './task-multi-select-bar.component.html',
  styleUrl: './task-multi-select-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatMenu,
    MatMenuContent,
    MatMenuItem,
    MatMenuTrigger,
    MatIcon,
    MatButton,
    MatIconButton,
    MatDivider,
    MatTooltip,
    TranslatePipe,
    SelectOptionRowComponent,
  ],
})
export class TaskMultiSelectBarComponent {
  readonly multiSelect = inject(TaskMultiSelectService);
  readonly bulk = inject(TaskBulkActionService);
  private readonly _projectService = inject(ProjectService);
  private readonly _tagService = inject(TagService);
  private readonly _menuTreeService = inject(MenuTreeService);
  private readonly _workContextService = inject(WorkContextService);
  private readonly _globalConfigService = inject(GlobalConfigService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _translateService = inject(TranslateService);
  private readonly _translateStore = inject(TranslateStore);

  readonly T = T;
  readonly ESTIMATE_OPTIONS = ESTIMATE_OPTIONS;
  readonly DEFAULT_PROJECT_ICON = DEFAULT_PROJECT_ICON;

  readonly count = this.multiSelect.count;
  readonly tasksTitleKey = computed(() =>
    getPluralKey(
      this._translateService,
      this._translateStore,
      this.count(),
      'F.TASK.MULTI_SELECT.TASKS_TITLE',
    ),
  );
  readonly kb = computed<KeyboardConfig>(() =>
    isTouchActive() ? EMPTY_KB : (this._globalConfigService.cfg()?.keyboard ?? EMPTY_KB),
  );
  readonly isTodayList = this._workContextService.isTodayListSignal;
  private readonly _activeWorkContext = toSignal(
    this._workContextService.activeWorkContext$,
  );
  readonly isShowBacklogBtns = computed(
    () => !!this._activeWorkContext()?.isEnableBacklog,
  );
  readonly toggleTagList = this._tagService.tagsNoMyDayAndNoListInTreeOrder;
  readonly projectFolderMap = computed(() => this._menuTreeService.projectFolderMap());
  readonly tagFolderMap = computed(() => this._menuTreeService.tagFolderMap());

  /** Exclude a project only when every selected task already lives in it. */
  private readonly _commonProjectId = computed(() =>
    getCommonProjectId(this.bulk.selectedTasks()),
  );
  readonly moveToProjectList = toSignal(
    toObservable(this._commonProjectId).pipe(
      switchMap((pid) =>
        this.multiSelect.isActive()
          ? this._projectService.getProjectsWithoutIdInTreeOrder$(pid)
          : of([]),
      ),
    ),
    { initialValue: [] },
  );

  readonly menuPosition = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  readonly positionedTrigger = viewChild('positionedTrigger', { read: MatMenuTrigger });

  constructor() {
    effect(() => {
      const request = this.multiSelect.menuOpenRequest();
      if (!request) {
        return;
      }
      this.menuPosition.set(request);
      this.multiSelect.consumeMenuOpenRequest();
      // Let the trigger element move to its new position first; a clear in
      // between (Esc) must not open an empty menu.
      setTimeout(() => {
        if (this.multiSelect.isActive()) {
          this.positionedTrigger()?.openMenu();
        }
      });
    });
  }

  clear(): void {
    this.multiSelect.clear();
  }

  onMenuClosed(): void {
    // Return keyboard focus to the anchor row so shortcuts keep working.
    const anchorId = this.multiSelect.anchorId();
    // A menu item may have opened a dialog; leave focus inside it.
    if (!anchorId || isTouchActive() || this._matDialog.openDialogs.length > 0) {
      return;
    }
    const rowEl = Array.from(document.querySelectorAll<HTMLElement>('task')).find(
      (el) =>
        el.getAttribute('data-task-id') === anchorId && !el.closest('task-detail-panel'),
    );
    rowEl?.focus({ preventScroll: true });
  }
}
