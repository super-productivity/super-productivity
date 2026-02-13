import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  Input,
  OnDestroy,
  output,
  signal,
  viewChild,
  SecurityContext,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { T } from 'src/app/t.const';
import { TranslateModule } from '@ngx-translate/core';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { Log } from '../../core/log';

// URL regex matching URLs with protocol (http, https, file) or www prefix
const URL_REGEX = /(?:(?:https?|file):\/\/\S+|www\.\S+?)(?=\s|$)/gi;

// Markdown link regex for keep-title mode: [title](url)
const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\(([^)]+)\)/g;

/**
 * Inline-editable text field for task titles.
 * Click to edit, Enter/Escape to save. Removes newlines and short syntax.
 * Renders URLs as clickable links when not editing.
 */
@Component({
  selector: 'task-title',
  imports: [TranslateModule],
  templateUrl: './task-title.component.html',
  styleUrl: './task-title.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    ['[class.is-focused]']: 'isFocused()',
    ['[class.is-editing]']: 'isEditing()',
  },
})
export class TaskTitleComponent implements OnDestroy {
  T: typeof T = T;
  private _sanitizer = inject(DomSanitizer);

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

  /**
   * Escapes HTML special characters to prevent XSS attacks using Angular's built-in sanitizer.
   * This is safer than rolling our own escaping function.
   */
  private _escapeHtml(text: string): string {
    // Use Angular's sanitizer to escape HTML - it returns null for unsafe content
    // which we treat as empty string. For plain text, it returns the escaped version.
    return this._sanitizer.sanitize(SecurityContext.HTML, text) || '';
  }

  /**
   * Computed signal that determines if the title contains URLs or markdown links.
   * Used to decide whether to render with innerHTML (for links) or text binding (for plain text).
   */
  readonly hasUrlsOrMarkdown = computed<boolean>(() => {
    const text = this.tmpValue();
    if (!text) {
      return false;
    }

    // Check for markdown links
    MARKDOWN_LINK_REGEX.lastIndex = 0;
    if (MARKDOWN_LINK_REGEX.test(text)) {
      return true;
    }

    // Check for plain URLs
    URL_REGEX.lastIndex = 0;
    return URL_REGEX.test(text);
  });

  /**
   * Memoized computed signal that converts URLs and Markdown links to clickable links.
   * Only recalculates when tmpValue changes, providing optimal performance.
   * Returns SafeHtml for use with [innerHTML] in the template.
   *
   * Supports two formats:
   * - Direct URLs (keep-url mode): https://example.com
   * - Markdown links (keep-title mode): [Page Title](https://example.com)
   *
   * XSS Protection: All user-supplied content (titles and URLs) is HTML-escaped
   * using Angular's DomSanitizer before being inserted into the generated HTML.
   */
  readonly displayHtml = computed<SafeHtml>(() => {
    const text = this.tmpValue();
    if (!text) {
      return '';
    }

    let htmlWithLinks = text;
    let hasMarkdown = false;
    let hasUrls = false;

    // First, handle Markdown links (keep-title mode): [title](url)
    MARKDOWN_LINK_REGEX.lastIndex = 0;
    hasMarkdown = MARKDOWN_LINK_REGEX.test(text);
    if (hasMarkdown) {
      MARKDOWN_LINK_REGEX.lastIndex = 0;
      htmlWithLinks = htmlWithLinks.replace(MARKDOWN_LINK_REGEX, (_match, title, url) => {
        // Handle different URL formats:
        // - Full URL with protocol: https://example.com
        // - Protocol-relative URL: //example.com
        // - No protocol: example.com
        let href = url;
        if (url.match(/^(?:https?|file):\/\//)) {
          // Already has protocol, use as-is
          href = url;
        } else if (url.startsWith('//')) {
          // Protocol-relative URL, add https:
          href = `https:${url}`;
        } else {
          // No protocol at all, add http://
          href = `http://${url}`;
        }
        // IMPORTANT: Escape both href and title using Angular's sanitizer to prevent XSS
        const escapedHref = this._escapeHtml(href);
        const escapedTitle = this._escapeHtml(title);
        return `<a href="${escapedHref}" target="_blank" rel="noopener noreferrer">${escapedTitle}</a>`;
      });
    }

    // Then, handle regular URLs (keep-url mode)
    // Process plain URLs even if markdown exists, but avoid double-processing URLs inside <a> tags
    URL_REGEX.lastIndex = 0;
    hasUrls = URL_REGEX.test(htmlWithLinks);
    if (hasUrls) {
      // Split by anchor tags to process only text outside of <a>...</a>
      const anchorRegex = /<a\b[^>]*>.*?<\/a>/gs;
      const parts: Array<{ text: string; isAnchor: boolean }> = [];
      let lastIndex = 0;
      let anchorMatch: RegExpExecArray | null;

      // Extract all anchor tags and the text between them
      while ((anchorMatch = anchorRegex.exec(htmlWithLinks)) !== null) {
        // Add text before this anchor
        if (anchorMatch.index > lastIndex) {
          parts.push({
            text: htmlWithLinks.slice(lastIndex, anchorMatch.index),
            isAnchor: false,
          });
        }
        // Add the anchor tag itself (don't process URLs inside it)
        parts.push({ text: anchorMatch[0], isAnchor: true });
        lastIndex = anchorRegex.lastIndex;
      }
      // Add remaining text after last anchor
      if (lastIndex < htmlWithLinks.length) {
        parts.push({ text: htmlWithLinks.slice(lastIndex), isAnchor: false });
      }

      // Process URLs only in non-anchor parts
      htmlWithLinks = parts
        .map((part) => {
          if (part.isAnchor) {
            return part.text;
          }
          // Process plain URLs in this text segment
          URL_REGEX.lastIndex = 0;
          return part.text.replace(URL_REGEX, (url) => {
            // Clean trailing punctuation
            const cleanUrl = url.replace(/[.,;!?]+$/, '');
            // Handle different URL formats (same logic as Markdown links)
            let href = cleanUrl;
            if (cleanUrl.match(/^(?:https?|file):\/\//)) {
              href = cleanUrl;
            } else if (cleanUrl.startsWith('//')) {
              href = `https:${cleanUrl}`;
            } else {
              href = `http://${cleanUrl}`;
            }
            // IMPORTANT: Escape both href and displayed URL using Angular's sanitizer to prevent XSS
            const escapedHref = this._escapeHtml(href);
            const escapedDisplay = this._escapeHtml(cleanUrl);
            // Return clickable link (mousedown handler prevents edit mode for A tags)
            return `<a href="${escapedHref}" target="_blank" rel="noopener noreferrer">${escapedDisplay}</a>`;
          });
        })
        .join('');
    }

    // If no links or markdown, return plain text
    if (!hasMarkdown && !hasUrls) {
      return text;
    }

    // Use bypassSecurityTrustHtml since we have escaped all user-supplied content
    // using Angular's built-in sanitizer
    return this._sanitizer.bypassSecurityTrustHtml(htmlWithLinks);
  });

  readonly valueEdited = output<{
    newVal: string;
    wasChanged: boolean;
    blurEvent?: FocusEvent;
  }>();

  private readonly _isFocused = signal(false);
  private readonly _isEditing = signal(false);
  private _focusTimeoutId: number | undefined;

  constructor() {}

  // Click anywhere to enter edit mode (except links)
  @HostListener('mousedown', ['$event'])
  onMouseDown(event: MouseEvent): void {
    event.stopPropagation();
    const target = event.target as HTMLElement | null;
    // Don't enter edit mode if clicking a link or textarea
    if (event.button !== 0 || target?.tagName === 'TEXTAREA' || target?.tagName === 'A') {
      return;
    }
    this.focusInput();
  }

  focusInput(): void {
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
      this._forceBlur();
    } else if (ev.key === 'Enter') {
      this._forceBlur();
      ev.preventDefault();
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
