import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  linkedSignal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { FormsModule, NgModel } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { Store } from '@ngrx/store';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { nanoid } from 'nanoid';
import { BoardCfg, BoardPanelCfg } from '../boards.model';
import { DEFAULT_PANEL_CFG } from '../boards.const';
import {
  getLayoutChanges,
  getPanelHeaderCount,
  normalizeBoardForSave,
  panelToCriteria,
  translateViewTitle,
  ViewLayout,
} from '../boards.util';
import { T } from '../../../t.const';
import {
  SegmentedButtonGroupComponent,
  SegmentedButtonOption,
} from '../../../ui/segmented-button-group/segmented-button-group.component';
import { selectAllTasksInActiveProjects } from '../../tasks/store/task.selectors';
import { ViewCriteriaContextService } from '../view-criteria-context.service';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { TaskCopy } from '../../tasks/task.model';
import { TaskCriteriaCtx } from '../../tasks/task-criteria/task-criteria.model';
import { matchesTaskCriteria } from '../../tasks/task-criteria/task-criteria';
import { Project } from '../../project/project.model';
import { ViewEditorSectionComponent } from './view-editor-section/view-editor-section.component';
import {
  isSectionTitleShown,
  toEditorDisplayModel,
  toSavedBoard,
} from './view-editor.util';

interface CachedCount {
  tasks: readonly TaskCopy[];
  ctx: TaskCriteriaCtx;
  projects: readonly Project[];
  isListLayout: boolean;
  count: number;
  /** Per task object, for this panel, ctx and project list. */
  matches: WeakMap<TaskCopy, boolean>;
}

const LAYOUT_OPTIONS: readonly SegmentedButtonOption[] = [
  { id: 'list', labelKey: T.F.BOARDS.EDITOR.LAYOUT_LIST, icon: 'view_list' },
  { id: 'board', labelKey: T.F.BOARDS.EDITOR.LAYOUT_BOARD, icon: 'view_kanban' },
];

/**
 * Edits a view (board): its title, layout and sections or columns with their
 * rules. Works on a copy of the stored board; fields it doesn't show
 * (unknown values from newer clients, `taskIds`) are carried through, and an
 * untouched save stores `normalizeBoardForSave(toEditorModel(board))`.
 */
@Component({
  selector: 'view-editor',
  standalone: true,
  imports: [
    FormsModule,
    MatFormField,
    MatLabel,
    MatError,
    MatInput,
    MatButton,
    MatIcon,
    TranslatePipe,
    SegmentedButtonGroupComponent,
    ViewEditorSectionComponent,
  ],
  templateUrl: './view-editor.component.html',
  styleUrl: './view-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewEditorComponent {
  /** The stored board (a new one has an id and no panels). */
  readonly board = input.required<BoardCfg>();
  /** A new view starts with one section. */
  readonly isNew = input<boolean>(false);
  /** The section shown open when the editor opens (default: the first). */
  readonly initialOpenPanelId = input<string | undefined>(undefined);

  protected readonly T = T;
  protected readonly LAYOUT_OPTIONS = LAYOUT_OPTIONS;

  private readonly _translateService = inject(TranslateService);
  private readonly _store = inject(Store);
  private readonly _viewCtx = inject(ViewCriteriaContextService);
  private readonly _isXs = inject(LayoutService).isXs;

  private readonly _titleModel = viewChild('titleModel', { read: NgModel });
  private readonly _titleInput = viewChild('titleModel', { read: MatInput });
  private readonly _colsModel = viewChild('colsModel', { read: NgModel });
  private readonly _colsInput = viewChild('colsModel', { read: MatInput });
  private readonly _sections = viewChildren(ViewEditorSectionComponent);
  private readonly _sectionEls = viewChildren<
    ViewEditorSectionComponent,
    ElementRef<HTMLElement>
  >(ViewEditorSectionComponent, { read: ElementRef });

  // A title that happens to name a group of keys ("F", "G") stays as typed.
  private readonly _translate = (key: string): string =>
    translateViewTitle(key, (k) => this._translateService.instant(k));

  /** The editor model, titles as shown. */
  readonly model = linkedSignal<BoardCfg>(() => {
    const model = toEditorDisplayModel(this.board(), this._translate);
    return this.isNew() && !model.panels.length
      ? { ...model, panels: [this._newPanel()] }
      : model;
  });

  /**
   * The section card that shows its rules when there are several (one at a
   * time): the one asked for (a column's title) or the first when the editor
   * opens, a new or duplicated one once added; none after removing the open
   * one. Kept by id when moving.
   */
  readonly openPanelId = linkedSignal<
    { board: BoardCfg; initialId: string | undefined },
    string | null
  >({
    source: () => ({ board: this.board(), initialId: this.initialOpenPanelId() }),
    computation: ({ board, initialId }) =>
      (initialId && board.panels.some((panel) => panel.id === initialId)
        ? initialId
        : board.panels[0]?.id) ?? null,
  });
  readonly isCollapsible = computed(() => this.model().panels.length > 1);

  constructor() {
    // A column's title asked for its card: on a phone it sits below the fold,
    // behind the collapsed cards before it. The first focus on its toggle
    // (`isFocusInitial`) would only bring the toggle itself into view.
    afterNextRender(() => {
      const id = this.openPanelId();
      const index = this.model().panels.findIndex((panel) => panel.id === id);
      if (this.initialOpenPanelId() && index > 0) {
        this._sectionEls()[index]?.nativeElement.scrollIntoView({ block: 'start' });
      }
    });
  }

  readonly layout = computed<ViewLayout>(() =>
    this.model().cols > 1 ? 'board' : 'list',
  );
  readonly isBoard = computed(() => this.layout() === 'board');
  readonly isSectionTitleShown = computed(() => isSectionTitleShown(this.model()));

  // The live count runs the view's own matching on what would be saved, so it
  // is the number the section header will show for the chosen layout.
  private readonly _allTasks = this._store.selectSignal(selectAllTasksInActiveProjects);
  // Per editor panel object: typing a title or editing one section doesn't
  // match the other sections against every task again.
  private readonly _countCache = new WeakMap<BoardPanelCfg, CachedCount>();
  readonly counts = computed(() => {
    const model = this.model();
    const tasks = this._allTasks();
    const ctx = this._viewCtx.ctx();
    // Backlog membership is read while matching: a cached match follows it.
    const projects = this._viewCtx.projects();
    // Phones show every view as a list (`BoardComponent.isListLayout`).
    const isListLayout = model.cols <= 1 || this._isXs();
    return model.panels.map((panel) => {
      const hit = this._countCache.get(panel);
      const isSameMatching = !!hit && hit.ctx === ctx && hit.projects === projects;
      if (isSameMatching && hit.tasks === tasks && hit.isListLayout === isListLayout) {
        return hit.count;
      }
      // A tracking tick or one edited task replaces only that task object:
      // the others keep their match instead of being matched again.
      const matches = isSameMatching ? hit.matches : new WeakMap<TaskCopy, boolean>();
      const saved = normalizeBoardForSave({ ...model, panels: [panel] }).panels[0];
      const criteria = panelToCriteria(saved);
      const matching = tasks.filter((task) => {
        let isMatch = matches.get(task);
        if (isMatch === undefined) {
          isMatch = matchesTaskCriteria(task, criteria, ctx);
          matches.set(task, isMatch);
        }
        return isMatch;
      });
      const count = getPanelHeaderCount(matching, saved, isListLayout);
      this._countCache.set(panel, { tasks, ctx, projects, isListLayout, count, matches });
      return count;
    });
  });

  setTitle(title: string): void {
    this.model.update((model) => ({ ...model, title }));
  }

  /** Same change as the title bar's List/Board button (`setViewLayout`). */
  setLayout(layout: string | number): void {
    if (layout !== 'list' && layout !== 'board') {
      return;
    }
    this.model.update((model) => ({ ...model, ...getLayoutChanges(model, layout) }));
  }

  setCols(value: number | null): void {
    // Kept while invalid, so the error shows; save refuses it.
    if (typeof value === 'number' && Number.isInteger(value) && value >= 2) {
      this.model.update((model) => ({ ...model, cols: value }));
    }
  }

  updatePanel(index: number, panel: BoardPanelCfg): void {
    this._setPanels(this.model().panels.map((p, i) => (i === index ? panel : p)));
  }

  addPanel(): void {
    const panel = this._newPanel();
    this._setPanels([...this._withHiddenTitleShown(), panel]);
    this.openPanelId.set(panel.id);
  }

  togglePanel(id: string): void {
    this.openPanelId.update((openId) => (openId === id ? null : id));
  }

  movePanel(index: number, offset: -1 | 1): void {
    const panels = [...this.model().panels];
    const target = index + offset;
    if (target < 0 || target >= panels.length) {
      return;
    }
    [panels[index], panels[target]] = [panels[target], panels[index]];
    this._setPanels(panels);
  }

  duplicatePanel(index: number): void {
    const panels = this._withHiddenTitleShown();
    const source = panels[index];
    const id = nanoid();
    panels.splice(index + 1, 0, {
      ...source,
      id,
      taskIds: [],
      title: `${source.title} (copy)`,
    });
    this._setPanels(panels);
    this.openPanelId.set(id);
  }

  removePanel(index: number): void {
    this._setPanels(this.model().panels.filter((_, i) => i !== index));
  }

  /**
   * The board to store, or null when a field is invalid: then every error
   * shows and the first invalid field gets the focus.
   */
  buildBoard(): BoardCfg | null {
    const fields: { isInvalid: () => boolean; focus: () => void }[] = [
      this._field(this._titleModel(), this._titleInput()),
      this._field(this._colsModel(), this._colsInput()),
      ...this._sections().map((section) => ({
        isInvalid: () => section.isTitleInvalid(),
        focus: () => section.focusTitle(),
      })),
    ];
    const invalid = fields.filter((field) => field.isInvalid());
    if (invalid.length) {
      invalid[0].focus();
      return null;
    }
    return toSavedBoard(this.model(), this.board(), this._translate);
  }

  /**
   * What saving without any change would store: the baseline for what the
   * user changed. It differs from the stored board where saving normalizes
   * (defaults filled in, a date rule's "scheduled"), which the user didn't do.
   */
  buildUntouchedBoard(): BoardCfg {
    return toSavedBoard(
      toEditorDisplayModel(this.board(), this._translate),
      this.board(),
      this._translate,
    );
  }

  private _field(
    ngModel: NgModel | undefined,
    matInput: MatInput | undefined,
  ): { isInvalid: () => boolean; focus: () => void } {
    return {
      isInvalid: () => {
        ngModel?.control.markAsTouched();
        return !!ngModel?.invalid;
      },
      focus: () => matInput?.focus(),
    };
  }

  /**
   * The panels, with the hidden title of a list's only section filled in as
   * save would (the view's title, unless it has its own), since it shows once
   * there is a second section.
   */
  private _withHiddenTitleShown(): BoardPanelCfg[] {
    const model = this.model();
    const [only, ...rest] = model.panels;
    if (!only || rest.length || this.isSectionTitleShown()) {
      return [...model.panels];
    }
    const storedTitle = this.board().title;
    const isFollowing =
      !only.title || (!!storedTitle && only.title === this._translate(storedTitle));
    return [isFollowing ? { ...only, title: model.title } : only];
  }

  private _setPanels(panels: BoardPanelCfg[]): void {
    this.model.update((model) => ({ ...model, panels }));
  }

  private _newPanel(): BoardPanelCfg {
    return { ...DEFAULT_PANEL_CFG, id: nanoid() };
  }
}
