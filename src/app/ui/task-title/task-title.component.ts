import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  input,
  Input,
  OnDestroy,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { T } from 'src/app/t.const';
import { TranslateModule } from '@ngx-translate/core';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { Log } from '../../core/log';
import { MentionConfig, MentionModule } from '../mentions';
import { AsyncPipe } from '@angular/common';
import { Observable } from 'rxjs';
import { MentionConfigService } from '../../features/tasks/mention-config.service';
import { hasLinkHints, RenderLinksPipe } from '../pipes/render-links.pipe';

/**
 * Inline-editable text field for task titles.
 * Click to edit, Enter/Escape to save. Removes newlines and short syntax.
 * Renders URLs as clickable links when not editing.
 */
@Component({
  selector: 'task-title',
  imports: [TranslateModule, MentionModule, AsyncPipe, RenderLinksPipe],
  templateUrl: './task-title.component.html',
  styleUrl: './task-title.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    ['[class.is-focused]']: 'isFocused()',
    ['[class.is-editing]']: 'isEditing()',
    ['[class.is-readonly]']: 'readonly()',
  },
})
export class TaskTitleComponent implements OnDestroy {
  T: typeof T = T;

  // short-syntax autocomplete config shared across all editor instances
  mentionCfg$: Observable<MentionConfig> = inject(MentionConfigService).mentionConfig$;

  private readonly _isMentionListShown = signal(false);
  readonly readonly = input<boolean>(false); // When true, disables editing and only displays the value

  // Reset value only if user is not currently editing (prevents overwriting edits during sync)
  @Input() set resetToLastExternalValueTrigger(value: unknown) {
    const externalValue = this._extractExternalValue(value);
    if (externalValue === undefined) {
      return;
    }

    this.lastExternalValue = externalValue;
    if (!this._isFocused() && this.tmpValue() !== externalValue) {
      this.updateTmpValue(externalValue, this.textarea()?.nativeElement);
    }
  }

  /**
   * Updates the displayed value from parent component.
   * Syncs both the signal (tmpValue) and the textarea DOM element.
   *
   * Why we need this: When short syntax is processed by the parent,
   * the cleaned value must update BOTH the signal and the textarea DOM.
   * Without updating the textarea directly, the old value with short syntax
   * remains visible in the DOM even though the signal has the cleaned value.
   */
  @Input() set value(value: string) {
    const externalValue = value ?? '';
    this.lastExternalValue = externalValue;
    this.updateTmpValue(externalValue, this.textarea()?.nativeElement);
  }

  lastExternalValue?: string; // Last value from parent, used to detect changes on blur
  readonly tmpValue = signal(''); // Current editing value
  readonly textarea = viewChild<ElementRef<HTMLTextAreaElement>>('textAreaElement');

  /** Fast pre-check: does the title contain URL or markdown hints? */
  readonly hasUrlsOrMarkdown = computed<boolean>(() => {
    const text = this.tmpValue();
    return !!text && hasLinkHints(text);
  });

  readonly valueEdited = output<{
    newVal: string;
    wasChanged: boolean;
    blurEvent?: FocusEvent;
  }>();

  private readonly _isFocused = signal(false);
  private readonly _isEditing = signal(false);
  private _focusTimeoutId: number | undefined;

  updateMentionListShown(isShown: boolean): void {
    // use setTimeout to ensure blur event order doesn't interfere with mention selection
    window.setTimeout(() => {
      this._isMentionListShown.set(isShown);
    });
  }

  // Click to enter edit mode or follow links.
  // Using click (not mousedown) allows CDK drag-and-drop to work from the title:
  // mousedown propagates → CDK tracks pointer → drag (≥5px) prevents click; click (<5px) enters edit mode.
  @HostListener('click', ['$event'])
  onClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;

    // Let link clicks propagate to the browser but not to parent components
    if (target?.tagName === 'A' || target?.closest('a')) {
      event.stopPropagation();
      return;
    }

    // Don't enter edit mode if readonly or clicking the textarea (already editing)
    if (this.readonly() || target?.tagName === 'TEXTAREA') {
      return;
    }

    event.stopPropagation();
    this.focusInput();
  }

  focusInput(): void {
    if (this.readonly()) {
      return; // Don't allow focusing in readonly mode
    }
    this._isEditing.set(true);
    if (this._focusTimeoutId) {
      window.clearTimeout(this._focusTimeoutId);
    }
    this._focusTimeoutId = window.setTimeout(() => {
      const textarea = this.textarea()?.nativeElement;
      textarea?.focus();
    });
  }

  cancelEditing(): void {
    const textarea = this.textarea()?.nativeElement;
    if (textarea) {
      textarea.blur();
    } else {
      this._endEditing();
    }
  }

  isEditing(): boolean {
    return this._isEditing();
  }

  isFocused(): boolean {
    return this._isFocused();
  }

  // Move cursor to end when focused
  focused(): void {
    this._isFocused.set(true);
    this._isEditing.set(true);
    try {
      window.setTimeout(() => {
        const textarea = this.textarea()?.nativeElement;
        if (!textarea) {
          return;
        }
        const len = textarea.value.length;
        textarea.setSelectionRange(len, len);
        textarea.selectionStart = textarea.selectionEnd = len;
      });
    } catch (e) {
      Log.err(e);
    }
  }

  blurred(event?: FocusEvent): void {
    this._isFocused.set(false);
    this._submit(event);
    this._endEditing();
  }

  // Enter/Escape to submit and blur
  handleKeyDown(ev: KeyboardEvent): void {
    ev.stopPropagation();
    if (ev.key === 'Escape') {
      // if mention list is open, Escape is handled by MentionDirective - don't blur
      if (!this._isMentionListShown()) {
        this._forceBlur();
      }
    } else if (ev.key === 'Enter') {
      // if mention list is open, Enter selects from list - don't blur
      if (!this._isMentionListShown()) {
        this._forceBlur();
        ev.preventDefault();
      }
    }
  }

  // Android WebView: Enter key comes through as textInput
  onTextInput(ev: Event): void {
    if (IS_ANDROID_WEB_VIEW && (ev as InputEvent)?.data?.slice(-1) === '\n') {
      Log.log('android enter key press');
      this._forceBlur();
      ev.preventDefault();
      setTimeout(() => {
        this._forceBlur();
      });
    }
  }

  /**
   * Updates both the signal and textarea DOM with the new value.
   *
   * Critical for short syntax removal: Angular's signal update alone doesn't
   * update the textarea DOM value. We must manually sync textarea.value to
   * ensure the cleaned text (without short syntax) is visible to the user.
   */
  updateTmpValue(value: string, target?: HTMLTextAreaElement | null): void {
    const sanitizedValue = this._sanitizeForEditing(value);
    this.tmpValue.set(sanitizedValue); // Update signal
    if (target && target.value !== sanitizedValue) {
      target.value = sanitizedValue; // Update DOM directly
    }
  }

  onInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement | null;
    if (!target) {
      return;
    }
    this.updateTmpValue(target.value, target);
  }

  // Sanitize pasted content (remove newlines)
  handlePaste(event: ClipboardEvent): void {
    event.preventDefault();

    const pastedText = event.clipboardData?.getData('text/plain') || '';
    const cleaned = this._sanitizeForEditing(pastedText);

    const textarea = this.textarea()?.nativeElement;
    if (!textarea) {
      return;
    }
    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;

    const currentVal = textarea.value;
    const newVal = currentVal.slice(0, start) + cleaned + currentVal.slice(end);
    this.updateTmpValue(newVal, textarea);

    requestAnimationFrame(() => {
      const finalValue = this.tmpValue() ?? '';
      const caretPosition = Math.min(start + cleaned.length, finalValue.length);
      textarea.selectionStart = textarea.selectionEnd = caretPosition;
    });
  }

  private _forceBlur(): void {
    this.textarea()?.nativeElement.blur();
  }

  private _submit(blurEvent?: FocusEvent): void {
    const previousValue = this.lastExternalValue;
    const cleanVal = this._cleanValue(this.tmpValue());
    this.tmpValue.set(cleanVal);
    this.lastExternalValue = cleanVal;
    this.valueEdited.emit({
      newVal: cleanVal,
      wasChanged: cleanVal !== previousValue,
      blurEvent,
    });
  }

  private _cleanValue(value: string = ''): string {
    return this._sanitizeForEditing(value).trim();
  }

  private _sanitizeForEditing(value: string = ''): string {
    return value?.replace(/\r/g, '').replace(/\n/g, '');
  }

  private _extractExternalValue(value: unknown): string | undefined {
    if (typeof value === 'string') {
      return value;
    }
    if (value && typeof value === 'object' && 'title' in value) {
      const title = (value as { title?: unknown }).title;
      return typeof title === 'string' ? title : undefined;
    }
    return undefined;
  }

  private _endEditing(): void {
    this._isEditing.set(false);
    if (this._focusTimeoutId) {
      window.clearTimeout(this._focusTimeoutId);
      this._focusTimeoutId = undefined;
    }
  }

  ngOnDestroy(): void {
    if (this._focusTimeoutId) {
      window.clearTimeout(this._focusTimeoutId);
    }
  }
}
