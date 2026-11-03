import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule, NgModel } from '@angular/forms';
import { MatIconButton } from '@angular/material/button';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { ErrorStateMatcher } from '@angular/material/core';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../../t.const';

let nextTitleId = 0;

/**
 * A title shown as text that turns into a required text field to rename it:
 * on a click (or the pencil), back to text on Enter or blur. An empty title
 * keeps the field, so it is never shown as empty text; its error shows only
 * once the user tries to leave it empty (Enter or Save), not on a blur.
 */
@Component({
  selector: 'view-editor-title',
  standalone: true,
  imports: [
    FormsModule,
    MatFormField,
    MatLabel,
    MatError,
    MatInput,
    MatIcon,
    MatIconButton,
    MatTooltip,
    TranslatePipe,
  ],
  templateUrl: './view-editor-title.component.html',
  styleUrl: './view-editor-title.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewEditorTitleComponent {
  readonly title = input.required<string>();
  /** The field's label (translated), e.g. "Title" or "Column title". */
  readonly label = input.required<string>();
  /**
   * With a pencil button: the button is the keyboard control and the text
   * only a click target. Without: the text is the button.
   */
  readonly isPencilShown = input<boolean>(false);
  /** The dialog's first focus (`cdkFocusInitial`) goes to the text. */
  readonly isFocusInitial = input<boolean>(false);
  /**
   * A plain field at the text's own size, for a card's bar: no label (the
   * placeholder and `aria-label` name it), so the bar keeps its height.
   */
  readonly isInline = input<boolean>(false);

  readonly titleChange = output<string>();

  protected readonly T = T;

  private readonly _injector = inject(Injector);
  private readonly _model = viewChild('model', { read: NgModel });
  private readonly _input = viewChild('model', { read: ElementRef });
  private readonly _textBtn = viewChild('textBtn', { read: ElementRef });

  // Renaming starts on a click and whenever the title is empty (a new view
  // or section); it only ends through `finish`, so typing doesn't end it.
  readonly isEditing = linkedSignal<string, boolean>({
    source: this.title,
    computation: (title, previous) => !title || (previous?.value ?? false),
  });

  // Set by Enter or Save on an empty title; a blur alone doesn't flag it.
  private readonly _isErrorShown = signal(false);
  readonly isError = computed(() => this._isErrorShown() && !this.title());
  readonly errorId = `view-editor-title-error-${nextTitleId++}`;
  /** Material's field shows the error when `isError` says, not on touch. */
  readonly errorMatcher = computed<ErrorStateMatcher>(() => {
    const isError = this.isError();
    return { isErrorState: () => isError };
  });

  edit(): void {
    this.isEditing.set(true);
    afterNextRender(() => this._input()?.nativeElement.focus(), {
      injector: this._injector,
    });
  }

  onEnter(ev: KeyboardEvent): void {
    if (ev.isComposing || ev.keyCode === 229) return;
    ev.preventDefault();
    this.finish(true);
  }

  /**
   * Back to text, unless the title is empty: then the field stays, and on
   * Enter (`isRefocus`) its error shows.
   */
  finish(isRefocus: boolean = false): void {
    if (!this.isEditing()) {
      return;
    }
    if (!this.title()) {
      if (isRefocus) {
        this._isErrorShown.set(true);
      }
      return;
    }
    this.isEditing.set(false);
    if (isRefocus) {
      afterNextRender(() => this.focusText(), { injector: this._injector });
    }
  }

  /** Shows the error of an empty title; whether it has one. */
  isInvalid(): boolean {
    const isInvalid = !!this._model()?.invalid;
    this._isErrorShown.set(isInvalid);
    return isInvalid;
  }

  focus(): void {
    if (this.isEditing()) {
      this._input()?.nativeElement.focus();
    } else {
      this.edit();
    }
  }

  focusText(): void {
    this._textBtn()?.nativeElement.focus();
  }
}
