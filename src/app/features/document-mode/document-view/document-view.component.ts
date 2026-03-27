import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  inject,
  QueryList,
  ViewChildren,
} from '@angular/core';
import { WorkContextService } from '../../work-context/work-context.service';
import { DocumentModeService } from '../document-mode.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { DocumentBlock, TaskBlock } from '../document-block.model';
import { DocumentTaskBlockComponent } from '../document-task-block/document-task-block.component';
import { DocumentTextBlockComponent } from '../document-text-block/document-text-block.component';
import { DocumentHeadingBlockComponent } from '../document-heading-block/document-heading-block.component';
import { DocumentDividerBlockComponent } from '../document-divider-block/document-divider-block.component';
import { MatIcon } from '@angular/material/icon';
import { CdkDragDrop, CdkDrag, CdkDropList, CdkDragHandle } from '@angular/cdk/drag-drop';
import { TaskService } from '../../tasks/task.service';
import { Task } from '../../tasks/task.model';
import { MatDialog } from '@angular/material/dialog';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { T } from '../../../t.const';

interface SlashMenuItem {
  label: string;
  icon: string;
  action: string;
}

@Component({
  selector: 'document-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DocumentTaskBlockComponent,
    DocumentTextBlockComponent,
    DocumentHeadingBlockComponent,
    DocumentDividerBlockComponent,
    MatIcon,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
  ],
  template: `
    <div
      class="document"
      [class.is-empty-document]="blocks().length === 0"
      cdkDropList
      (cdkDropListDropped)="onDrop($event)"
      (click)="onDocumentClick($event)"
    >
      @for (block of blocks(); track block.id; let i = $index) {
        <div
          class="block-row"
          [class.is-last-task]="isLastTaskInSequence(i)"
          [class.before-h1]="
            blocks()[i + 1]?.type === 'heading' && $any(blocks()[i + 1]).level === 1
          "
          [class.before-h2]="
            blocks()[i + 1]?.type === 'heading' && $any(blocks()[i + 1]).level === 2
          "
          [class.before-h3]="
            blocks()[i + 1]?.type === 'heading' && $any(blocks()[i + 1]).level === 3
          "
          [class.after-h1]="
            blocks()[i - 1]?.type === 'heading' && $any(blocks()[i - 1]).level === 1
          "
          [class.after-h2]="
            blocks()[i - 1]?.type === 'heading' && $any(blocks()[i - 1]).level === 2
          "
          [class.after-h3]="
            blocks()[i - 1]?.type === 'heading' && $any(blocks()[i - 1]).level === 3
          "
          [class.is-divider]="block.type === 'divider'"
          [class.is-task-group]="
            block.type === 'task' && blocks()[i + 1]?.type === 'task'
          "
          [attr.data-block-id]="block.id"
          (click)="$event.stopPropagation()"
          cdkDrag
        >
          <div
            class="gutter"
            (click)="$event.stopPropagation()"
          >
            <button
              class="gutter-btn drag-btn"
              cdkDragHandle
            >
              <mat-icon>drag_indicator</mat-icon>
            </button>
            <button
              class="gutter-btn type-btn"
              (click)="showBlockMenu($event, block)"
            >
              <mat-icon>{{ blockTypeIcon(block) }}</mat-icon>
            </button>
          </div>
          <div
            class="block-content"
            (click)="$event.stopPropagation()"
          >
            @switch (block.type) {
              @case ('task') {
                <document-task-block
                  [block]="$any(block)"
                  (enterPressed)="onEnterPressed(block.id)"
                  (enterOnEmpty)="onTaskEnterOnEmpty(block)"
                  (splitAtCursor)="onTaskSplitAtCursor(block, $event)"
                  (backspaceOnEmpty)="onBackspaceOnEmpty(block.id)"
                  (backspaceAtStart)="onBackspaceAtStart(block.id, $event)"
                  (navigateUp)="onNavigateUp(block.id, $event)"
                  (navigateDown)="onNavigateDown(block.id, $event)"
                ></document-task-block>
              }
              @case ('text') {
                <document-text-block
                  [block]="$any(block)"
                  (contentChanged)="onContentChanged(block.id, $event)"
                  (enterPressed)="onEnterPressed(block.id)"
                  (splitAtCursor)="onSplitAtCursor(block.id, $event)"
                  (backspaceOnEmpty)="onBackspaceOnEmpty(block.id)"
                  (backspaceAtStart)="onBackspaceAtStart(block.id, $event)"
                  (markdownConvert)="onMarkdownConvert(block.id, $event)"
                  (slashTyped)="showSlashMenu($event, block.id)"
                  (slashFilterChanged)="onSlashFilterChanged($event)"
                  (navigateUp)="onNavigateUp(block.id, $event)"
                  (navigateDown)="onNavigateDown(block.id, $event)"
                ></document-text-block>
              }
              @case ('heading') {
                <document-heading-block
                  [block]="$any(block)"
                  (contentChanged)="onContentChanged(block.id, $event)"
                  (enterPressed)="onEnterPressed(block.id)"
                  (splitAtCursor)="onSplitAtCursor(block.id, $event)"
                  (backspaceOnEmpty)="onBackspaceOnEmpty(block.id)"
                  (backspaceAtStart)="onBackspaceAtStart(block.id, $event)"
                  (navigateUp)="onNavigateUp(block.id, $event)"
                  (navigateDown)="onNavigateDown(block.id, $event)"
                ></document-heading-block>
              }
              @case ('divider') {
                <document-divider-block
                  [block]="$any(block)"
                  (enterPressed)="onEnterPressed(block.id)"
                  (deleteBlock)="onBackspaceOnEmpty(block.id)"
                  (navigateUp)="onNavigateUp(block.id)"
                  (navigateDown)="onNavigateDown(block.id)"
                ></document-divider-block>
              }
            }
          </div>
        </div>
      }
    </div>

    @if (menuBlockId) {
      <div
        class="menu-backdrop"
        (click)="closeMenu()"
      ></div>
      <div
        class="popup-menu"
        [class.is-slash-menu]="menuMode === 'slash'"
        [style.top.px]="menuTop"
        [style.left.px]="menuLeft"
      >
        @for (item of filteredMenuItems; track item.label) {
          <button
            class="menu-item"
            (click)="onMenuSelect(item.action)"
            (mouseenter)="menuActiveIndex = $index"
            [class.is-active]="$index === menuActiveIndex"
          >
            <mat-icon>{{ item.icon }}</mat-icon>
            <span>{{ item.label }}</span>
          </button>
        }
        @if (filteredMenuItems.length === 0) {
          <div class="menu-empty">No results</div>
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        flex: 1;
      }

      .document {
        max-width: 720px;
        margin: 0 auto;
        padding: var(--s4) var(--s2) var(--s4) 60px;
        cursor: default;
        font-weight: 500;
        color: var(--text-color-most-intense);
      }

      .document.is-empty-document {
        cursor: text;
        min-height: 200px;
        display: flex;
        align-items: flex-start;
        justify-content: flex-start;
      }

      .document.is-empty-document::before {
        content: 'Start typing, or press / for commands';
        color: var(--text-color-muted);
        opacity: 0.4;
        font-size: 16px;
        pointer-events: none;
        padding-top: var(--s2);
      }

      .block-row {
        display: flex;
        align-items: center;
        position: relative;
        cursor: auto;
        animation: block-enter 200ms ease-out;
      }

      @keyframes block-enter {
        from {
          opacity: 0;
          transform: translateY(-4px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      /* Context-aware spacing */
      .gutter {
        display: flex;
        align-items: center;
        gap: 2px;
        opacity: 0;
        transition: opacity var(--transition-duration-s) var(--ani-standard-timing);
        flex-shrink: 0;
        width: 52px;
        margin-left: -52px;
      }

      .block-row:hover > .gutter,
      .block-row:focus-within > .gutter {
        opacity: 1;
      }

      .gutter-btn {
        width: 28px;
        height: 28px;
        line-height: 28px;
        padding: 0;
        border: none;
        background: none;
        color: var(--text-color-muted);
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
      }

      .drag-btn {
        cursor: grab;
      }

      .type-btn {
        cursor: pointer;
      }

      .gutter-btn:hover {
        color: var(--text-color);
        background: var(--c-dark-10);
      }

      :host-context(.isDarkTheme) .gutter-btn:hover {
        background: var(--c-light-05);
      }

      .gutter-btn .mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }

      .block-content {
        flex: 1;
        min-width: 0;
      }

      .block-row.before-h1 > .block-content {
        padding-bottom: var(--s2);
      }

      .block-row.before-h2 > .block-content,
      .block-row.before-h3 > .block-content {
        padding-bottom: var(--s);
      }

      .block-row.is-task-group > .block-content {
        padding-bottom: var(--s);
      }

      .block-row.after-h1 > .block-content {
        padding-top: var(--s);
      }

      .block-row.after-h2 > .block-content,
      .block-row.after-h3 > .block-content {
        padding-top: var(--s-half);
      }

      .block-row.is-divider.after-h1 > .block-content,
      .block-row.is-divider.after-h2 > .block-content,
      .block-row.is-divider.after-h3 > .block-content {
        padding-top: 0;
      }

      .block-row.is-last-task > .block-content {
        padding-bottom: var(--s2);
      }

      /* CDK Drag */
      .cdk-drag-preview {
        background: var(--bg);
        box-shadow: var(--whiteframe-shadow-6dp);
        border-radius: var(--card-border-radius);
        padding: 0 var(--s);
      }

      .cdk-drag-placeholder {
        opacity: 0;
        position: relative;
        height: 4px !important;
        min-height: 0 !important;
        overflow: hidden;
        padding: 0 !important;
        margin: 0 !important;
      }

      .cdk-drag-placeholder::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        top: 0;
        height: 3px;
        border-radius: 2px;
        background: var(--palette-primary-500);
        opacity: 1;
      }

      .cdk-drag-animating {
        transition: transform var(--transition-duration-m) var(--ani-standard-timing);
      }

      .cdk-drop-list-dragging .block-row:not(.cdk-drag-placeholder) {
        transition: transform var(--transition-duration-m) var(--ani-standard-timing);
      }

      /* Popup menu (slash menu + block context menu) */
      .menu-backdrop {
        position: fixed;
        inset: 0;
        z-index: var(--z-backdrop);
      }

      .popup-menu {
        position: fixed;
        z-index: calc(var(--z-backdrop) + 1);
        background: var(--card-bg);
        border-radius: 8px;
        box-shadow: var(--whiteframe-shadow-6dp);
        padding: 6px 0;
        min-width: 200px;
        max-height: 400px;
        overflow-y: auto;
        animation: menu-enter 150ms ease-out;
      }

      @keyframes menu-enter {
        from {
          opacity: 0;
          transform: scale(0.95) translateY(-4px);
        }
        to {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
      }

      .menu-item {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 8px 14px;
        border: none;
        background: none;
        cursor: pointer;
        text-align: left;
        color: var(--text-color);
        font: inherit;
        font-size: 14px;
        font-weight: 400;
      }

      .menu-item:hover,
      .menu-item.is-active {
        background: var(--c-dark-10);
      }

      :host-context(.isDarkTheme) .menu-item:hover,
      :host-context(.isDarkTheme) .menu-item.is-active {
        background: var(--c-light-05);
      }

      .menu-item .mat-icon {
        color: var(--text-color-less-intense);
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      .menu-empty {
        padding: 8px 14px;
        color: var(--text-color-muted);
        font-size: 14px;
      }
    `,
  ],
})
export class DocumentViewComponent {
  @ViewChildren(DocumentTextBlockComponent)
  textBlocks!: QueryList<DocumentTextBlockComponent>;

  @ViewChildren(DocumentHeadingBlockComponent)
  headingBlocks!: QueryList<DocumentHeadingBlockComponent>;

  @ViewChildren(DocumentTaskBlockComponent)
  taskBlocks!: QueryList<DocumentTaskBlockComponent>;

  @ViewChildren(DocumentDividerBlockComponent)
  dividerBlocks!: QueryList<DocumentDividerBlockComponent>;

  private _workContextService = inject(WorkContextService);
  private _documentModeService = inject(DocumentModeService);
  private _taskService = inject(TaskService);
  private _matDialog = inject(MatDialog);

  constructor() {
    this._documentModeService.removeOrphanedTaskBlocks();
    this._documentModeService.syncMissingTasks();
  }

  // Unified menu state (slash menu + block context menu)
  menuBlockId: string | null = null;
  menuMode: 'slash' | 'block' = 'slash';
  menuTop = 0;
  menuLeft = 0;
  menuActiveIndex = 0;
  menuFilter = '';

  private readonly _slashInsertItems: SlashMenuItem[] = [
    { label: 'Task', icon: 'check_circle_outline', action: 'task' },
    { label: 'Paragraph', icon: 'segment', action: 'text' },
    { label: 'Heading 1', icon: 'title', action: 'h1' },
    { label: 'Heading 2', icon: 'text_fields', action: 'h2' },
    { label: 'Heading 3', icon: 'short_text', action: 'h3' },
    { label: 'Divider', icon: 'horizontal_rule', action: 'divider' },
  ];

  private readonly _turnIntoItems: SlashMenuItem[] = [
    { label: 'Task', icon: 'check_circle_outline', action: 'turn-task' },
    { label: 'Paragraph', icon: 'segment', action: 'turn-text' },
    { label: 'Heading 1', icon: 'title', action: 'turn-h1' },
    { label: 'Heading 2', icon: 'text_fields', action: 'turn-h2' },
    { label: 'Heading 3', icon: 'short_text', action: 'turn-h3' },
  ];

  private readonly _blockMenuItems: SlashMenuItem[] = [
    { label: 'Delete', icon: 'delete', action: 'delete' },
    { label: 'Duplicate', icon: 'content_copy', action: 'duplicate' },
    { label: 'Move up', icon: 'arrow_upward', action: 'move-up' },
    { label: 'Move down', icon: 'arrow_downward', action: 'move-down' },
  ];

  filteredMenuItems: SlashMenuItem[] = [];

  blocks = toSignal(
    this._workContextService.activeWorkContext$.pipe(
      map((ctx) => (ctx.documentBlocks as DocumentBlock[]) || []),
    ),
    { initialValue: [] as DocumentBlock[] },
  );

  @HostListener('keydown', ['$event'])
  onHostKeydown(ev: KeyboardEvent): void {
    // Handle menu keyboard navigation
    if (this.menuBlockId) {
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        if (this.filteredMenuItems.length > 0) {
          this.menuActiveIndex =
            (this.menuActiveIndex + 1) % this.filteredMenuItems.length;
        }
        return;
      }
      if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (this.filteredMenuItems.length > 0) {
          this.menuActiveIndex =
            (this.menuActiveIndex - 1 + this.filteredMenuItems.length) %
            this.filteredMenuItems.length;
        }
        return;
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        if (this.filteredMenuItems.length > 0) {
          this.onMenuSelect(this.filteredMenuItems[this.menuActiveIndex].action);
        }
        return;
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this._closeMenuAndRestoreFocus();
        return;
      }
    }

    // Ctrl/Cmd+Shift+ArrowUp/Down to move blocks
    if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey) {
      if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
        ev.preventDefault();
        this._moveCurrentBlock(ev.key === 'ArrowUp' ? -1 : 1);
      }
    }
  }

  onDocumentClick(ev: MouseEvent): void {
    const currentBlocks = this.blocks();
    if (currentBlocks.length > 0) {
      return;
    }

    this._documentModeService.createTextBlock('');
    setTimeout(() => {
      const updatedBlocks = this.blocks();
      const newLast = updatedBlocks[updatedBlocks.length - 1];
      if (newLast) {
        this._focusBlock(newLast.id);
      }
    });
  }

  onDrop(event: CdkDragDrop<DocumentBlock[]>): void {
    if (event.previousIndex !== event.currentIndex) {
      const block = this.blocks()[event.previousIndex];
      this._documentModeService.moveBlock(block.id, event.currentIndex);
    }
  }

  onContentChanged(blockId: string, content: string): void {
    this._documentModeService.updateBlockContent(blockId, { content });
  }

  onTaskEnterOnEmpty(block: DocumentBlock): void {
    // Empty task + Enter → convert to text paragraph, delete the empty task
    if (block.type === 'task') {
      const taskId = (block as TaskBlock).taskId;
      this._deleteTaskEntity(taskId, () => {
        this._convertBlock(block.id, 'text');
        setTimeout(() => this._focusBlock(block.id));
      });
    }
  }

  onEnterPressed(afterBlockId: string): void {
    // Tasks → new task, headings/text/dividers → new text block
    const block = this.blocks().find((b) => b.id === afterBlockId);
    if (block?.type === 'task') {
      const taskId = this._taskService.add('');
      this._documentModeService.createTaskBlock(taskId, afterBlockId);
    } else {
      this._documentModeService.createTextBlock('', afterBlockId);
    }
    setTimeout(() => this._focusBlockAfter(afterBlockId));
  }

  onSplitAtCursor(blockId: string, ev: { before: string; after: string }): void {
    const newBlockId = this._documentModeService.splitBlock(blockId, ev.before, ev.after);
    setTimeout(() => this._focusBlock(newBlockId, 'start'));
  }

  onTaskSplitAtCursor(block: DocumentBlock, ev: { before: string; after: string }): void {
    if (block.type === 'task') {
      const taskBlock = block as TaskBlock;
      if (ev.before !== undefined) {
        this._taskService.update(taskBlock.taskId, { title: ev.before });
      }
      // Split creates a new task with the remaining text
      const newTaskId = this._taskService.add(ev.after || '');
      this._documentModeService.createTaskBlock(newTaskId, block.id);
      setTimeout(() => this._focusBlockAfter(block.id, 'start'));
    }
  }

  onBackspaceOnEmpty(blockId: string): void {
    const currentBlocks = this.blocks();
    if (currentBlocks.length <= 1) return;
    const idx = currentBlocks.findIndex((b) => b.id === blockId);
    const block = currentBlocks[idx];

    const removeAndFocus = (): void => {
      this._documentModeService.removeBlock(blockId);
      if (idx > 0) {
        setTimeout(() => this._focusBlock(currentBlocks[idx - 1].id, 'end'));
      }
    };

    if (block?.type === 'task') {
      this._deleteTaskEntity((block as TaskBlock).taskId, removeAndFocus);
    } else {
      removeAndFocus();
    }
  }

  onBackspaceAtStart(blockId: string, _content: string): void {
    // Heading → convert to text first (like Super List / Notion)
    const block = this.blocks().find((b) => b.id === blockId);
    if (block?.type === 'heading') {
      this._convertBlock(blockId, 'text');
      setTimeout(() => this._focusBlock(blockId, 'start'));
      return;
    }
    const result = this._documentModeService.mergeBlockIntoPrevious(blockId);
    if (result) {
      setTimeout(() => this._focusBlockAtOffset(result.targetId, result.offset));
    }
  }

  onMarkdownConvert(blockId: string, ev: { targetType: string; content: string }): void {
    if (ev.targetType === 'divider') {
      // Replace the text block with a divider, then create a new text block after it
      this._documentModeService.convertBlock(blockId, 'divider', this._taskService);
      this._documentModeService.createTextBlock('', blockId);
      setTimeout(() => this._focusBlockAfter(blockId));
    } else if (ev.targetType === 'task') {
      const taskId = this._taskService.add(ev.content || 'New task');
      this._documentModeService.convertBlock(blockId, 'task', {
        add: () => taskId,
      });
      setTimeout(() => this._focusBlock(blockId));
    } else {
      // Heading conversions: update content and convert type
      this._documentModeService.updateBlockContent(blockId, { content: ev.content });
      this._documentModeService.convertBlock(blockId, ev.targetType, this._taskService);
      setTimeout(() => this._focusBlock(blockId, 'end'));
    }
  }

  onNavigateUp(blockId: string, offset?: number): void {
    const currentBlocks = this.blocks();
    const idx = currentBlocks.findIndex((b) => b.id === blockId);
    if (idx > 0) {
      const targetId = currentBlocks[idx - 1].id;
      if (offset !== undefined) {
        this._focusBlockAtOffset(targetId, offset);
      } else {
        this._focusBlock(targetId, 'end');
      }
    }
  }

  onNavigateDown(blockId: string, offset?: number): void {
    const currentBlocks = this.blocks();
    const idx = currentBlocks.findIndex((b) => b.id === blockId);
    if (idx >= 0 && idx < currentBlocks.length - 1) {
      const targetId = currentBlocks[idx + 1].id;
      if (offset !== undefined) {
        this._focusBlockAtOffset(targetId, offset);
      } else {
        this._focusBlock(targetId, 'start');
      }
    }
  }

  // --- Menu (shared slash + block context) ---

  showSlashMenu(el: HTMLElement, blockId: string): void {
    const rect = el.getBoundingClientRect();
    this.menuTop = rect.bottom + 4;
    this.menuLeft = rect.left;
    this.menuBlockId = blockId;
    this.menuMode = 'slash';
    this.menuFilter = '';
    this.menuActiveIndex = 0;

    const block = this.blocks().find((b) => b.id === blockId);
    const hasContent =
      block &&
      (block.type === 'text' || block.type === 'heading') &&
      (block as { content: string }).content.replace('/', '').trim().length > 0;

    this.filteredMenuItems = hasContent
      ? [...this._turnIntoItems]
      : [...this._slashInsertItems];
  }

  showBlockMenu(event: MouseEvent, block: DocumentBlock): void {
    event.stopPropagation();
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    this.menuTop = rect.bottom + 4;
    this.menuLeft = rect.left;
    this.menuBlockId = block.id;
    this.menuMode = 'block';
    this.menuActiveIndex = 0;
    this.menuFilter = '';
    this.filteredMenuItems = [...this._turnIntoItems, ...this._blockMenuItems];
  }

  onSlashFilterChanged(filter: string): void {
    this.menuFilter = filter;
    const lowerFilter = filter.toLowerCase();

    const block = this.blocks().find((b) => b.id === this.menuBlockId);
    const hasContent =
      block &&
      (block.type === 'text' || block.type === 'heading') &&
      (block as { content: string }).content.replace(/\/.*$/, '').trim().length > 0;

    const items = hasContent ? this._turnIntoItems : this._slashInsertItems;
    this.filteredMenuItems = items.filter((item) =>
      item.label.toLowerCase().includes(lowerFilter),
    );
    this.menuActiveIndex = 0;
  }

  closeMenu(): void {
    this.menuBlockId = null;
    this.menuFilter = '';
  }

  onMenuSelect(action: string): void {
    const blockId = this.menuBlockId;
    if (!blockId) return;

    this.closeMenu();

    switch (action) {
      case 'delete':
        this._deleteBlock(blockId);
        return;
      case 'duplicate':
        this._duplicateBlock(blockId);
        return;
      case 'move-up':
        this._moveBlockByIndex(blockId, -1);
        return;
      case 'move-down':
        this._moveBlockByIndex(blockId, 1);
        return;
    }

    if (action.startsWith('turn-')) {
      const targetType = action.replace('turn-', '');
      const block = this.blocks().find((b) => b.id === blockId);
      if (block?.type === 'task' && targetType !== 'task') {
        this._deleteTaskEntity((block as TaskBlock).taskId, () => {
          this._convertBlock(blockId, targetType);
          setTimeout(() => this._focusBlock(blockId));
        });
      } else {
        this._convertBlock(blockId, targetType);
        setTimeout(() => this._focusBlock(blockId));
      }
      return;
    }

    this._clearSlashFromBlock(blockId);

    // If the block is now empty after clearing slash, convert in-place instead of inserting after
    const block = this.blocks().find((b) => b.id === blockId);
    const blockContent =
      block && (block.type === 'text' || block.type === 'heading')
        ? (block as { content: string }).content.trim()
        : null;
    const isEmptyBlock = blockContent === '' || blockContent === null;

    if (isEmptyBlock && action !== 'text') {
      // Convert current block in-place
      switch (action) {
        case 'h1':
        case 'h2':
        case 'h3':
        case 'task':
          this._convertBlock(blockId, action);
          setTimeout(() => this._focusBlock(blockId));
          return;
        case 'divider':
          this._convertBlock(blockId, 'divider');
          this._documentModeService.createTextBlock('', blockId);
          setTimeout(() => this._focusBlockAfter(blockId));
          return;
      }
    }

    // Block has content: insert new block after
    switch (action) {
      case 'text':
        this._documentModeService.createTextBlock('', blockId);
        break;
      case 'h1':
        this._documentModeService.createHeadingBlock(1, '', blockId);
        break;
      case 'h2':
        this._documentModeService.createHeadingBlock(2, '', blockId);
        break;
      case 'h3':
        this._documentModeService.createHeadingBlock(3, '', blockId);
        break;
      case 'divider': {
        const dividerId = this._documentModeService.createDividerBlock(blockId);
        this._documentModeService.createTextBlock('', dividerId);
        setTimeout(() => this._focusBlockAfter(dividerId));
        return;
      }
      case 'task': {
        const taskId = this._taskService.add('New task');
        this._documentModeService.createTaskBlock(taskId, blockId);
        break;
      }
    }
    setTimeout(() => this._focusBlockAfter(blockId));
  }

  blockTypeIcon(block: DocumentBlock): string {
    switch (block.type) {
      case 'task':
        return 'check_circle_outline';
      case 'heading':
        return 'title';
      case 'divider':
        return 'horizontal_rule';
      default:
        return 'segment';
    }
  }

  isLastTaskInSequence(index: number): boolean {
    const b = this.blocks();
    if (b[index]?.type !== 'task') return false;
    return index === b.length - 1 || b[index + 1]?.type !== 'task';
  }

  // --- Private helpers ---

  private _convertBlock(blockId: string, targetType: string): void {
    this._documentModeService.convertBlock(blockId, targetType, this._taskService);
  }

  private _deleteBlock(blockId: string): void {
    const currentBlocks = this.blocks();
    if (currentBlocks.length <= 1) return;
    const block = currentBlocks.find((b) => b.id === blockId);
    if (!block) return;
    if (block.type === 'task') {
      this._deleteTaskEntity((block as TaskBlock).taskId, () => {
        this._documentModeService.removeBlock(blockId);
      });
    } else {
      this._documentModeService.removeBlock(blockId);
    }
  }

  private _deleteTaskEntity(taskId: string, onDone: () => void): void {
    const taskComp = this.taskBlocks?.find((c) => c.block().taskId === taskId);
    const task = taskComp?.task();

    if (task && !this._isBareTask(task)) {
      this._matDialog
        .open(DialogConfirmComponent, {
          data: {
            okTxt: T.F.TASK.D_CONFIRM_DELETE.OK,
            message: T.F.TASK.D_CONFIRM_DELETE.MSG,
            translateParams: { title: task.title || 'Untitled task' },
          },
        })
        .afterClosed()
        .subscribe((isConfirm) => {
          if (isConfirm) {
            this._taskService.removeMultipleTasks([taskId]);
            onDone();
          }
        });
    } else {
      this._taskService.removeMultipleTasks([taskId]);
      onDone();
    }
  }

  /** A bare task has nothing beyond a title and project — safe to delete without confirmation */
  private _isBareTask(task: Task): boolean {
    return (
      !task.isDone &&
      task.timeSpent === 0 &&
      task.subTaskIds.length === 0 &&
      task.attachments.length === 0 &&
      task.tagIds.length === 0 &&
      !task.issueId &&
      !task.repeatCfgId &&
      !task.dueDay &&
      !task.dueWithTime &&
      !task.deadlineDay &&
      !task.deadlineWithTime &&
      !task.reminderId
    );
  }

  private _duplicateBlock(blockId: string): void {
    this._documentModeService.duplicateBlock(blockId, this._taskService);
  }

  private _moveBlockByIndex(blockId: string, delta: number): void {
    const currentBlocks = this.blocks();
    const idx = currentBlocks.findIndex((b) => b.id === blockId);
    if (idx === -1) return;
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= currentBlocks.length) return;
    this._documentModeService.moveBlock(blockId, newIdx);
  }

  private _moveCurrentBlock(delta: number): void {
    const blockId = this._findFocusedBlockId();
    if (blockId) {
      this._moveBlockByIndex(blockId, delta);
      setTimeout(() => this._focusBlock(blockId));
    }
  }

  private _findFocusedBlockId(): string | null {
    const active = document.activeElement;
    if (!active) return null;
    const blockRow = active.closest('[data-block-id]');
    return blockRow?.getAttribute('data-block-id') || null;
  }

  private _clearSlashFromBlock(blockId: string): void {
    // Clear slash text directly from the DOM (store-only updates don't sync back to contenteditable)
    const textComp = this.textBlocks?.find((c) => c.block().id === blockId);
    if (textComp) {
      textComp.clearSlashText();
      return;
    }
    // Fallback for heading blocks: update store (heading blocks don't have slash support currently)
    const block = this.blocks().find((b) => b.id === blockId);
    if (block && block.type === 'heading') {
      const content = (block as { content: string }).content;
      const slashIdx = content.lastIndexOf('/');
      if (slashIdx >= 0) {
        const cleaned = content.substring(0, slashIdx);
        this._documentModeService.updateBlockContent(blockId, { content: cleaned });
      }
    }
  }

  private _closeMenuAndRestoreFocus(): void {
    const blockId = this.menuBlockId;
    if (this.menuMode === 'slash' && blockId) {
      this._clearSlashFromBlock(blockId);
    }
    this.closeMenu();
    if (blockId) {
      setTimeout(() => this._focusBlock(blockId, 'end'));
    }
  }

  private _focusBlockAfter(afterBlockId: string, position?: 'start' | 'end'): void {
    const currentBlocks = this.blocks();
    const idx = currentBlocks.findIndex((b) => b.id === afterBlockId);
    if (idx >= 0 && idx < currentBlocks.length - 1) {
      this._focusBlock(currentBlocks[idx + 1].id, position);
    }
  }

  private _focusBlock(blockId: string, position?: 'start' | 'end'): void {
    const block = this.blocks().find((b) => b.id === blockId);
    if (!block) return;

    if (block.type === 'text') {
      this.textBlocks?.find((c) => c.block().id === blockId)?.focus(position);
    } else if (block.type === 'heading') {
      this.headingBlocks?.find((c) => c.block().id === blockId)?.focus(position);
    } else if (block.type === 'task') {
      this.taskBlocks?.find((c) => c.block().id === blockId)?.focus(position);
    } else if (block.type === 'divider') {
      this.dividerBlocks?.find((c) => c.block().id === blockId)?.focus();
    }
  }

  private _focusBlockAtOffset(blockId: string, offset: number): void {
    const block = this.blocks().find((b) => b.id === blockId);
    if (!block) return;

    if (block.type === 'text') {
      this.textBlocks?.find((c) => c.block().id === blockId)?.focusAtOffset(offset);
    } else if (block.type === 'heading') {
      this.headingBlocks?.find((c) => c.block().id === blockId)?.focusAtOffset(offset);
    } else if (block.type === 'task') {
      this.taskBlocks?.find((c) => c.block().id === blockId)?.focusAtOffset(offset);
    } else if (block.type === 'divider') {
      this.dividerBlocks?.find((c) => c.block().id === blockId)?.focus();
    }
  }
}
