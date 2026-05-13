import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TextBlock } from '../document-block.model';
import { sanitizeBlockHtml } from '../sanitize-block-html';

@Component({
  selector: 'document-text-block',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  template: `
    <div
      #editableEl
      class="text-block"
      contenteditable="true"
      data-placeholder="Type something, or press / for commands"
      (input)="onInput($event)"
      (keydown)="onKeydown($event)"
      (paste)="onPaste($event)"
    ></div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .text-block {
        outline: none;
        cursor: text;
        padding: 3px 0;
        line-height: 1.6;
        color: inherit;
        word-wrap: break-word;
        white-space: pre-wrap;
        min-height: 1.6em;
      }

      .text-block:empty:focus::before {
        content: attr(data-placeholder);
        color: var(--text-color-muted);
        opacity: 0.4;
        pointer-events: none;
      }
    `,
  ],
})
export class DocumentTextBlockComponent {
  block = input.required<TextBlock>();
  contentChanged = output<string>();
  enterPressed = output<void>();
  splitAtCursor = output<{ before: string; after: string }>();
  backspaceOnEmpty = output<void>();
  backspaceAtStart = output<string>();
  markdownConvert = output<{ targetType: string; content: string }>();
  slashTyped = output<HTMLElement>();
  slashFilterChanged = output<string>();
  navigateUp = output<number>();
  navigateDown = output<number>();

  editableEl = viewChild<ElementRef<HTMLDivElement>>('editableEl');
  private _initialized = signal(false);
  private _slashActive = false;

  constructor() {
    effect(() => {
      const el = this.editableEl()?.nativeElement;
      const content = this.block().content;
      if (el) {
        // Skip if this is a local edit (user is actively typing)
        if (this._initialized() && document.activeElement === el) return;
        if (content.includes('<')) {
          el.innerHTML = sanitizeBlockHtml(content);
        } else {
          el.textContent = content;
        }
        this._initialized.set(true);
      }
    });
  }

  focus(position?: 'start' | 'end'): void {
    const el = this.editableEl()?.nativeElement;
    if (!el) return;
    el.focus();
    if (position && el.childNodes.length > 0) {
      const sel = window.getSelection();
      if (!sel) return;
      const textNode = el.firstChild!;
      if (position === 'end') {
        sel.collapse(textNode, textNode.textContent?.length || 0);
      } else {
        sel.collapse(textNode, 0);
      }
    }
  }

  focusAtOffset(offset: number): void {
    const el = this.editableEl()?.nativeElement;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel) return;
    const pos = this._findNodeAtOffset(el, offset);
    if (pos) {
      sel.collapse(pos.node, pos.offset);
    }
  }

  onInput(ev: Event): void {
    const el = ev.target as HTMLElement;
    const text = el.textContent || '';
    // Emit innerHTML if there are formatting elements, otherwise plain text
    const hasFormatting = el.querySelector('b, strong, i, em, a, u');
    this.contentChanged.emit(hasFormatting ? sanitizeBlockHtml(el.innerHTML) : text);

    // Detect markdown shortcuts at line start
    const md = this._detectMarkdownShortcut(text);
    if (md) {
      this.markdownConvert.emit(md);
      return;
    }

    if (this._slashActive) {
      const slashIdx = text.lastIndexOf('/');
      if (slashIdx >= 0) {
        const filter = text.substring(slashIdx + 1);
        if (filter.includes(' ')) {
          this._slashActive = false;
        } else {
          this.slashFilterChanged.emit(filter);
        }
      } else {
        this._slashActive = false;
      }
    } else if (text.endsWith('/')) {
      this._slashActive = true;
      this.slashTyped.emit(el);
    }
  }

  onPaste(ev: ClipboardEvent): void {
    ev.preventDefault();
    const text = ev.clipboardData?.getData('text/plain') || '';
    document.execCommand('insertText', false, text);
  }

  cancelSlash(): void {
    this._slashActive = false;
  }

  /**
   * Remove the slash (and any filter text after it) from the DOM element directly.
   * Needed because the contenteditable element is the DOM source of truth after init.
   */
  clearSlashText(): void {
    this._slashActive = false;
    const el = this.editableEl()?.nativeElement;
    if (!el) return;
    const text = el.textContent || '';
    const slashIdx = text.lastIndexOf('/');
    if (slashIdx >= 0) {
      const cleaned = text.substring(0, slashIdx);
      el.textContent = cleaned;
      this.contentChanged.emit(cleaned);
    }
  }

  onKeydown(ev: KeyboardEvent): void {
    // Inline formatting shortcuts
    if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey) {
      if (ev.key === 'b') {
        ev.preventDefault();
        document.execCommand('bold');
        this._emitContent();
        return;
      }
      if (ev.key === 'i') {
        ev.preventDefault();
        document.execCommand('italic');
        this._emitContent();
        return;
      }
    }

    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      const el = this.editableEl()?.nativeElement;
      if (!el) return;
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const fullText = el.textContent || '';
        const offset = this._getTextOffset(el, range);
        const before = fullText.substring(0, offset);
        const after = fullText.substring(offset);
        this.splitAtCursor.emit({ before, after });
      } else {
        this.enterPressed.emit();
      }
      return;
    }

    if (ev.key === 'Backspace' || ev.key === 'Delete') {
      const el = ev.target as HTMLElement;
      const text = el.textContent || '';
      if (!text) {
        ev.preventDefault();
        this.backspaceOnEmpty.emit();
        return;
      }
      if (ev.key === 'Backspace') {
        const sel = window.getSelection();
        if (sel && sel.isCollapsed && this._isAtStart(el, sel)) {
          ev.preventDefault();
          this.backspaceAtStart.emit(text);
          return;
        }
      }
    }

    if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      if (this._shouldNavigateAcrossBlocks(ev.key)) {
        ev.preventDefault();
        const offset = this._getCurrentOffset();
        if (ev.key === 'ArrowUp') {
          this.navigateUp.emit(offset);
        } else {
          this.navigateDown.emit(offset);
        }
      }
    }
  }

  private _emitContent(): void {
    const el = this.editableEl()?.nativeElement;
    if (!el) return;
    const hasFormatting = el.querySelector('b, strong, i, em, a, u');
    this.contentChanged.emit(
      hasFormatting ? sanitizeBlockHtml(el.innerHTML) : el.textContent || '',
    );
  }

  private _detectMarkdownShortcut(
    text: string,
  ): { targetType: string; content: string } | null {
    if (text.startsWith('### ')) {
      return { targetType: 'h3', content: text.substring(4) };
    }
    if (text.startsWith('## ')) {
      return { targetType: 'h2', content: text.substring(3) };
    }
    if (text.startsWith('# ')) {
      return { targetType: 'h1', content: text.substring(2) };
    }
    if (text.startsWith('[] ') || text.startsWith('- ')) {
      return { targetType: 'task', content: text.substring(text.indexOf(' ') + 1) };
    }
    if (text === '---') {
      return { targetType: 'divider', content: '' };
    }
    return null;
  }

  private _getCurrentOffset(): number {
    const el = this.editableEl()?.nativeElement;
    if (!el) return 0;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return 0;
    return this._getTextOffset(el, sel.getRangeAt(0));
  }

  private _findNodeAtOffset(
    container: Node,
    target: number,
  ): { node: Node; offset: number } | null {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let remaining = target;
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const len = node.textContent?.length || 0;
      if (remaining <= len) {
        return { node, offset: remaining };
      }
      remaining -= len;
    }
    // Offset exceeds content — place at end of last text node
    const lastNode = this._lastTextNode(container);
    if (lastNode) {
      return { node: lastNode, offset: lastNode.textContent?.length || 0 };
    }
    return null;
  }

  private _lastTextNode(container: Node): Text | null {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      last = node;
    }
    return last;
  }

  private _getTextOffset(container: HTMLElement, range: Range): number {
    const preRange = document.createRange();
    preRange.selectNodeContents(container);
    preRange.setEnd(range.startContainer, range.startOffset);
    return preRange.toString().length;
  }

  private _isAtStart(el: HTMLElement, sel: Selection): boolean {
    if (!sel.rangeCount) return false;
    const range = sel.getRangeAt(0);
    return this._getTextOffset(el, range) === 0;
  }

  private _shouldNavigateAcrossBlocks(key: 'ArrowUp' | 'ArrowDown'): boolean {
    const el = this.editableEl()?.nativeElement;
    if (!el) return false;
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || !sel.rangeCount) return false;

    if (!el.textContent) return true;

    const range = sel.getRangeAt(0);
    const textOffset = this._getTextOffset(el, range);
    const totalLength = el.textContent.length;

    // At absolute start/end → always navigate
    if (key === 'ArrowUp' && textOffset === 0) return true;
    if (key === 'ArrowDown' && textOffset === totalLength) return true;

    // For multi-line content, use rect-based detection with a temp marker
    // (collapsed range rects are often zero-height and unreliable)
    const marker = document.createElement('span');
    marker.textContent = '\u200b';
    range.insertNode(marker);
    const markerRect = marker.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    marker.remove();
    // Restore selection after DOM mutation
    sel.collapse(range.startContainer, range.startOffset);

    if (!markerRect.height) return false;

    const tolerance = 4;
    if (key === 'ArrowUp') {
      return markerRect.top - elRect.top < tolerance;
    } else {
      return elRect.bottom - markerRect.bottom < tolerance;
    }
  }
}
