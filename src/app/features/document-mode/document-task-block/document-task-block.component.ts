import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { TaskBlock } from '../document-block.model';
import { Store } from '@ngrx/store';
import { selectTaskById } from '../../tasks/store/task.selectors';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { TaskService } from '../../tasks/task.service';
import { Task } from '../../tasks/task.model';
import { MatIcon } from '@angular/material/icon';
import { TagListComponent } from '../../tag/tag-list/tag-list.component';

@Component({
  selector: 'document-task-block',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, TagListComponent],
  template: `
    @if (task(); as t) {
      <div
        class="task-row"
        [class.is-done]="t.isDone"
      >
        <div
          class="done-toggle"
          [class.is-done]="t.isDone"
          (click)="toggleDone(t)"
          role="checkbox"
          [attr.aria-checked]="t.isDone"
          tabindex="0"
          (keydown.enter)="toggleDone(t); $event.stopPropagation()"
          (keydown.space)="
            toggleDone(t); $event.stopPropagation(); $event.preventDefault()
          "
        >
          <svg
            class="done-toggle-svg"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              class="done-circle"
              cx="12"
              cy="12"
              r="10"
            />
            <polyline
              class="done-check"
              points="8,12 11,15 16,9"
            />
          </svg>
        </div>
        <span
          #titleEl
          class="task-title"
          contenteditable="true"
          (input)="onTitleInput($event, t)"
          (blur)="onTitleBlur($event, t)"
          (keydown)="onKeydown($event)"
        ></span>
        <button
          class="detail-btn"
          (click)="openDetail(t)"
        >
          <mat-icon>arrow_forward</mat-icon>
        </button>
      </div>
      @if (t.tagIds?.length || t.projectId || t.repeatCfgId || t.issueId) {
        <div class="tags-row">
          <tag-list [task]="t"></tag-list>
        </div>
      }
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .task-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 3px 0;
      }

      @keyframes draw-check {
        from {
          stroke-dashoffset: 16;
        }
        to {
          stroke-dashoffset: 0;
        }
      }

      .done-toggle {
        width: 24px;
        height: 24px;
        min-width: 24px;
        cursor: pointer;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        background: none;
        padding: 0;
      }

      .done-toggle-svg {
        width: 24px;
        height: 24px;
        opacity: 0.3;
        transition: opacity var(--transition-duration-m) var(--ani-standard-timing);
      }

      .done-circle {
        stroke: currentColor;
        stroke-width: 2;
        fill: none;
      }

      .done-check {
        stroke: currentColor;
        stroke-width: 2;
        fill: none;
        stroke-linecap: round;
        stroke-linejoin: round;
        stroke-dasharray: 16;
        stroke-dashoffset: 16;
      }

      .done-toggle.is-done .done-toggle-svg {
        opacity: 0.5;
      }

      .done-toggle.is-done .done-check {
        animation: draw-check 150ms ease-out forwards;
      }

      .done-toggle:hover .done-toggle-svg {
        opacity: 0.6;
      }

      .done-toggle.is-done:hover .done-toggle-svg {
        opacity: 0.8;
      }

      .task-title {
        flex: 1;
        outline: none;
        cursor: text;
        line-height: 1.5;
        color: inherit;
        min-height: 1.5em;
      }

      .task-title:empty:focus::before {
        content: 'To-do';
        color: var(--text-color-muted);
        opacity: 0.4;
        pointer-events: none;
      }

      .is-done .task-title {
        text-decoration: line-through;
        color: var(--text-color-muted);
      }

      .detail-btn {
        opacity: 0;
        border: none;
        background: none;
        cursor: pointer;
        color: var(--text-color-muted);
        padding: 2px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: opacity var(--transition-duration-s) var(--ani-standard-timing);
      }

      .task-row:hover .detail-btn {
        opacity: 1;
      }

      .detail-btn:hover {
        color: var(--text-color);
        background: var(--c-dark-10);
      }

      :host-context(.isDarkTheme) .detail-btn:hover {
        background: var(--c-light-05);
      }

      .detail-btn .mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }

      .tags-row {
        padding-left: 34px;
        margin-top: -2px;
        opacity: 0.55;
        filter: grayscale(1);
        transition:
          opacity var(--transition-duration-s) var(--ani-standard-timing),
          filter var(--transition-duration-s) var(--ani-standard-timing);
      }

      :host(:focus-within) .tags-row {
        opacity: 1;
        filter: none;
      }
    `,
  ],
})
export class DocumentTaskBlockComponent {
  block = input.required<TaskBlock>();
  enterPressed = output<void>();
  enterOnEmpty = output<void>();
  splitAtCursor = output<{ before: string; after: string }>();
  backspaceOnEmpty = output<void>();
  backspaceAtStart = output<string>();
  navigateUp = output<number>();
  navigateDown = output<number>();

  private _store = inject(Store);
  private _taskService = inject(TaskService);
  private _destroyRef = inject(DestroyRef);
  private _lastSetTitle = '';
  private _titleSaveTimeout: ReturnType<typeof setTimeout> | null = null;
  private _pendingTitle: { taskId: string; title: string } | null = null;

  titleEl = viewChild<ElementRef<HTMLSpanElement>>('titleEl');

  task = toSignal(
    toObservable(this.block).pipe(
      switchMap((b) => this._store.select(selectTaskById, { id: b.taskId })),
    ),
  );

  constructor() {
    effect(() => {
      const t = this.task();
      const el = this.titleEl()?.nativeElement;
      if (t && el && t.title !== this._lastSetTitle) {
        if (el.textContent !== t.title) {
          el.textContent = t.title;
        }
        this._lastSetTitle = t.title;
      }
    });
    this._destroyRef.onDestroy(() => {
      if (this._titleSaveTimeout) {
        clearTimeout(this._titleSaveTimeout);
        this._flushTitleSave();
      }
    });
  }

  focus(position?: 'start' | 'end'): void {
    const el = this.titleEl()?.nativeElement;
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
    const el = this.titleEl()?.nativeElement;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel) return;
    const pos = this._findNodeAtOffset(el, offset);
    if (pos) {
      sel.collapse(pos.node, pos.offset);
    }
  }

  toggleDone(task: Task): void {
    this._taskService.update(task.id, { isDone: !task.isDone });
  }

  openDetail(task: Task): void {
    this._taskService.setSelectedId(task.id);
  }

  onTitleInput(_ev: Event, task: Task): void {
    const el = this.titleEl()?.nativeElement;
    if (!el) return;
    const newTitle = el.textContent?.trim() || '';
    if (newTitle === task.title) return;
    if (this._titleSaveTimeout) clearTimeout(this._titleSaveTimeout);
    this._pendingTitle = { taskId: task.id, title: newTitle };
    this._titleSaveTimeout = setTimeout(() => this._flushTitleSave(), 1000);
  }

  onTitleBlur(ev: FocusEvent, task: Task): void {
    if (this._titleSaveTimeout) {
      clearTimeout(this._titleSaveTimeout);
      this._titleSaveTimeout = null;
    }
    const newTitle = (ev.target as HTMLElement).textContent?.trim();
    if (newTitle && newTitle !== task.title) {
      this._lastSetTitle = newTitle;
      this._taskService.update(task.id, { title: newTitle });
    }
    this._pendingTitle = null;
  }

  onKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      const el = this.titleEl()?.nativeElement;
      if (!el) return;
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const fullText = el.textContent || '';
        const offset = this._getTextOffset(el, range);
        const before = fullText.substring(0, offset);
        const after = fullText.substring(offset);
        if (before || after) {
          this.splitAtCursor.emit({ before, after });
        } else {
          this.enterOnEmpty.emit();
        }
      } else {
        this.enterOnEmpty.emit();
      }
      return;
    }

    if (ev.key === 'Backspace' || ev.key === 'Delete') {
      const el = this.titleEl()?.nativeElement;
      if (!el) return;
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

  private _getCurrentOffset(): number {
    const el = this.titleEl()?.nativeElement;
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

  private _flushTitleSave(): void {
    if (this._pendingTitle) {
      this._lastSetTitle = this._pendingTitle.title;
      this._taskService.update(this._pendingTitle.taskId, {
        title: this._pendingTitle.title,
      });
      this._pendingTitle = null;
    }
    this._titleSaveTimeout = null;
  }

  private _shouldNavigateAcrossBlocks(key: 'ArrowUp' | 'ArrowDown'): boolean {
    const el = this.titleEl()?.nativeElement;
    if (!el) return false;
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || !sel.rangeCount) return false;

    if (!el.textContent) return true;

    const range = sel.getRangeAt(0);
    const textOffset = this._getTextOffset(el, range);
    const totalLength = el.textContent.length;

    if (key === 'ArrowUp' && textOffset === 0) return true;
    if (key === 'ArrowDown' && textOffset === totalLength) return true;

    const marker = document.createElement('span');
    marker.textContent = '\u200b';
    range.insertNode(marker);
    const markerRect = marker.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    marker.remove();
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
