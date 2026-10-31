import {
  ChangeDetectionStrategy,
  Component,
  computed,
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
  getPanelHeaderCount,
  matchPanelTasks,
  normalizeBoardForSave,
  panelToCriteria,
} from '../boards.util';
import { T } from '../../../t.const';
import {
  SegmentedButtonGroupComponent,
  SegmentedButtonOption,
} from '../../../ui/segmented-button-group/segmented-button-group.component';
import { selectAllTasksInActiveProjects } from '../../tasks/store/task.selectors';
import { ViewCriteriaContextService } from '../view-criteria-context.service';
import { ViewEditorSectionComponent } from './view-editor-section/view-editor-section.component';
import {
  isSectionTitleShown,
  toEditorDisplayModel,
  toSavedBoard,
} from './view-editor.util';

type ViewLayout = 'list' | 'board';

const LAYOUT_OPTIONS: readonly SegmentedButtonOption[] = [
  { id: 'list', labelKey: T.F.BOARDS.EDITOR.LAYOUT_LIST, icon: 'filter_list' },
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

  protected readonly T = T;
  protected readonly LAYOUT_OPTIONS = LAYOUT_OPTIONS;

  private readonly _translateService = inject(TranslateService);
  private readonly _store = inject(Store);
  private readonly _viewCtx = inject(ViewCriteriaContextService);

  private readonly _titleModel = viewChild('titleModel', { read: NgModel });
  private readonly _titleInput = viewChild('titleModel', { read: MatInput });
  private readonly _colsModel = viewChild('colsModel', { read: NgModel });
  private readonly _colsInput = viewChild('colsModel', { read: MatInput });
  private readonly _sections = viewChildren(ViewEditorSectionComponent);

  private readonly _translate = (key: string): string =>
    this._translateService.instant(key);

  /** The editor model, titles as shown. */
  readonly model = linkedSignal<BoardCfg>(() => {
    const model = toEditorDisplayModel(this.board(), this._translate);
    return this.isNew() && !model.panels.length
      ? { ...model, panels: [this._newPanel()] }
      : model;
  });

  readonly layout = computed<ViewLayout>(() =>
    this.model().cols > 1 ? 'board' : 'list',
  );
  readonly isBoard = computed(() => this.layout() === 'board');
  readonly isSectionTitleShown = computed(() => isSectionTitleShown(this.model()));

  // The live count runs the view's own matching on what would be saved, so it
  // is the number the section header will show for the chosen layout.
  private readonly _allTasks = this._store.selectSignal(selectAllTasksInActiveProjects);
  readonly counts = computed(() => {
    const model = this.model();
    const ctx = this._viewCtx.ctx();
    const tasks = this._allTasks();
    const isListLayout = model.cols <= 1;
    return normalizeBoardForSave(model).panels.map((panel) =>
      getPanelHeaderCount(
        matchPanelTasks(tasks, panelToCriteria(panel), ctx),
        panel,
        isListLayout,
      ),
    );
  });

  setTitle(title: string): void {
    this.model.update((model) => ({ ...model, title }));
  }

  setLayout(layout: string | number): void {
    this.model.update((model) =>
      layout === 'board'
        ? { ...model, cols: Math.max(2, model.panels.length) }
        : { ...model, cols: 1 },
    );
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
    const model = this.model();
    let panels = model.panels;
    // The only section of a list hides its title; it shows again now.
    if (panels.length === 1 && !this.isSectionTitleShown() && !panels[0].title) {
      panels = [{ ...panels[0], title: model.title }];
    }
    this._setPanels([...panels, this._newPanel()]);
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
    const panels = [...this.model().panels];
    const source = panels[index];
    panels.splice(index + 1, 0, {
      ...source,
      id: nanoid(),
      taskIds: [],
      title: `${source.title} (copy)`,
    });
    this._setPanels(panels);
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

  private _setPanels(panels: BoardPanelCfg[]): void {
    this.model.update((model) => ({ ...model, panels }));
  }

  private _newPanel(): BoardPanelCfg {
    return { ...DEFAULT_PANEL_CFG, id: nanoid() };
  }
}
