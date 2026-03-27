import { inject, Injectable, OnDestroy } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { WorkContextService } from '../work-context/work-context.service';
import { WorkContextType } from '../work-context/work-context.model';
import {
  computeBlocksDelta,
  DividerBlock,
  DocumentBlock,
  HeadingBlock,
  HeadingLevel,
  MarkdownBlock,
  TaskBlock,
  TextBlock,
} from './document-block.model';
import { updateProject } from '../project/store/project.actions';
import { selectProjectFeatureState } from '../project/store/project.selectors';
import { updateTag } from '../tag/store/tag.actions';
import { selectTagFeatureState } from '../tag/store/tag.reducer';
import {
  updateDocumentBlocksDelta,
  updateDocumentBlocksLocal,
} from './store/document-mode.actions';
import { uuidv7 } from '../../util/uuid-v7';

const SYNC_DEBOUNCE_MS = 5_000;

interface ActiveContext {
  id: string;
  type: WorkContextType;
  title: string;
  taskIds: string[];
  documentBlocks?: DocumentBlock[];
  isDocumentMode?: boolean;
}

@Injectable({ providedIn: 'root' })
export class DocumentModeService implements OnDestroy {
  private _store = inject(Store);
  private _workContextService = inject(WorkContextService);
  private _activeWorkContext = toSignal(this._workContextService.activeWorkContext$);
  private _projectState = this._store.selectSignal(selectProjectFeatureState);
  private _tagState = this._store.selectSignal(selectTagFeatureState);
  private _syncTimeout: ReturnType<typeof setTimeout> | null = null;
  private _pendingSync: {
    contextId: string;
    contextType: WorkContextType;
  } | null = null;
  private _lastPersistedBlocks: DocumentBlock[] = [];
  private _lastPersistedContextId: string | null = null;
  private _beforeUnloadHandler = (): void => this._flushSync();
  private _visibilityHandler = (): void => {
    if (document.visibilityState === 'hidden') {
      this._flushSync();
    }
  };

  constructor() {
    window.addEventListener('beforeunload', this._beforeUnloadHandler);
    document.addEventListener('visibilitychange', this._visibilityHandler);
  }

  ngOnDestroy(): void {
    window.removeEventListener('beforeunload', this._beforeUnloadHandler);
    document.removeEventListener('visibilitychange', this._visibilityHandler);
    this._flushSync();
  }

  toggleDocumentMode(): void {
    const active = this._getActiveContext();
    if (!active) return;
    const { id, type, ctx } = active;
    const isDocumentMode = !ctx.isDocumentMode;
    let documentBlocks = ctx.documentBlocks;

    if (isDocumentMode && (!documentBlocks || documentBlocks.length === 0)) {
      const titleBlock: HeadingBlock = {
        id: uuidv7(),
        type: 'heading',
        content: ctx.title || '',
        level: 1,
      };
      // Seed document blocks from existing tasks
      const taskBlocks: DocumentBlock[] = (ctx.taskIds || []).map((taskId) => ({
        id: uuidv7(),
        type: 'task' as const,
        taskId,
      }));
      const dividerBlock: DividerBlock = { id: uuidv7(), type: 'divider' };
      documentBlocks = [
        titleBlock,
        dividerBlock,
        ...taskBlocks,
        { id: uuidv7(), type: 'text' as const, content: '' },
      ];
    }

    // Toggle is always persisted immediately via full updateProject/updateTag
    this._dispatchPersistent(id, type, { isDocumentMode, documentBlocks });
    this._updateSnapshot(id, documentBlocks || []);
  }

  /**
   * Ensure all tasks from taskIds have a corresponding TaskBlock in documentBlocks.
   * Appends missing tasks at the end (before the trailing text block if one exists).
   */
  syncMissingTasks(): void {
    const active = this._getActiveContext();
    if (!active) return;
    const { id, type, ctx } = active;
    const blocks = ctx.documentBlocks || [];
    const existingTaskIds = new Set(
      blocks.filter((b) => b.type === 'task').map((b) => (b as TaskBlock).taskId),
    );
    const missingTaskIds = (ctx.taskIds || []).filter((tid) => !existingTaskIds.has(tid));
    if (missingTaskIds.length === 0) return;

    const newBlocks: DocumentBlock[] = missingTaskIds.map((taskId) => ({
      id: uuidv7(),
      type: 'task' as const,
      taskId,
    }));

    // Insert before the last block if it's an empty text block, otherwise append
    const updated = [...blocks];
    const lastBlock = updated[updated.length - 1];
    if (lastBlock?.type === 'text' && !(lastBlock as TextBlock).content) {
      updated.splice(updated.length - 1, 0, ...newBlocks);
    } else {
      updated.push(...newBlocks);
    }

    this._dispatchLocal(id, type, updated);
  }

  /**
   * Remove task blocks whose tasks no longer exist (e.g. deleted from list mode).
   */
  removeOrphanedTaskBlocks(): void {
    const active = this._getActiveContext();
    if (!active) return;
    const { id, type, ctx } = active;
    const blocks = ctx.documentBlocks || [];
    const validTaskIds = new Set(ctx.taskIds || []);
    const cleaned = blocks.filter(
      (b) => b.type !== 'task' || validTaskIds.has((b as TaskBlock).taskId),
    );
    if (cleaned.length < blocks.length) {
      this._dispatchLocal(id, type, cleaned);
    }
  }

  addBlock(block: DocumentBlock, afterBlockId?: string): void {
    const active = this._getActiveContext();
    if (!active) return;
    const { id, type, ctx } = active;
    const blocks = [...(ctx.documentBlocks || [])];
    if (afterBlockId) {
      const idx = blocks.findIndex((b) => b.id === afterBlockId);
      if (idx === -1) {
        blocks.push(block);
      } else {
        blocks.splice(idx + 1, 0, block);
      }
    } else {
      blocks.push(block);
    }
    this._dispatchLocal(id, type, blocks);
  }

  removeBlock(blockId: string): void {
    const active = this._getActiveContext();
    if (!active) return;
    const { id, type, ctx } = active;
    const blocks = (ctx.documentBlocks || []).filter((b) => b.id !== blockId);
    this._dispatchLocal(id, type, blocks);
  }

  moveBlock(blockId: string, newIndex: number): void {
    const active = this._getActiveContext();
    if (!active) return;
    const { id, type, ctx } = active;
    const blocks = [...(ctx.documentBlocks || [])];
    const oldIndex = blocks.findIndex((b) => b.id === blockId);
    if (oldIndex === -1) return;
    const [block] = blocks.splice(oldIndex, 1);
    blocks.splice(newIndex, 0, block);
    this._dispatchLocal(id, type, blocks);
  }

  updateBlockContent(blockId: string, changes: Partial<TextBlock | HeadingBlock>): void {
    const active = this._getActiveContext();
    if (!active) return;
    const { id, type, ctx } = active;
    const blocks = (ctx.documentBlocks || []).map((b) =>
      b.id === blockId ? ({ ...b, ...changes } as DocumentBlock) : b,
    );
    this._dispatchLocal(id, type, blocks);
  }

  createTextBlock(content: string = '', afterBlockId?: string): void {
    const block: TextBlock = { id: uuidv7(), type: 'text', content };
    this.addBlock(block, afterBlockId);
  }

  createHeadingBlock(
    level: HeadingLevel,
    content: string = '',
    afterBlockId?: string,
  ): void {
    const block: HeadingBlock = { id: uuidv7(), type: 'heading', content, level };
    this.addBlock(block, afterBlockId);
  }

  createTaskBlock(taskId: string, afterBlockId?: string): void {
    const block: TaskBlock = { id: uuidv7(), type: 'task', taskId };
    this.addBlock(block, afterBlockId);
  }

  createMarkdownBlock(content: string = '', afterBlockId?: string): void {
    const block: MarkdownBlock = { id: uuidv7(), type: 'markdown', content };
    this.addBlock(block, afterBlockId);
  }

  createDividerBlock(afterBlockId?: string): string {
    const block: DividerBlock = { id: uuidv7(), type: 'divider' };
    this.addBlock(block, afterBlockId);
    return block.id;
  }

  /**
   * Split a text/heading block at the cursor position.
   * The current block keeps `before`, a new text block gets `after`.
   * Returns the new block's id for focusing.
   */
  splitBlock(blockId: string, before: string, after: string): string {
    const newBlockId = uuidv7();
    const active = this._getActiveContext();
    if (!active) return newBlockId;
    const { id, type, ctx } = active;
    const blocks = (ctx.documentBlocks || []).map((b) => {
      if (b.id !== blockId) return b;
      if (b.type === 'text') return { ...b, content: before } as TextBlock;
      if (b.type === 'heading') return { ...b, content: before } as HeadingBlock;
      return b;
    });

    const idx = blocks.findIndex((b) => b.id === blockId);
    const sourceBlock = (ctx.documentBlocks || []).find((b) => b.id === blockId);
    if (idx === -1 || !sourceBlock) return newBlockId;

    // After split, new block is always text (like Super List / Notion)
    const newBlock: DocumentBlock = { id: newBlockId, type: 'text', content: after };

    blocks.splice(idx + 1, 0, newBlock);
    this._dispatchLocal(id, type, blocks);
    return newBlockId;
  }

  /**
   * Merge a block's content into the previous block, then remove it.
   * Returns the target block id and the offset where content was appended.
   */
  mergeBlockIntoPrevious(blockId: string): { targetId: string; offset: number } | null {
    const active = this._getActiveContext();
    if (!active) return null;
    const { id, type, ctx } = active;
    const blocks = [...(ctx.documentBlocks || [])];
    const idx = blocks.findIndex((b) => b.id === blockId);
    if (idx <= 0) return null;

    const current = blocks[idx];
    const prev = blocks[idx - 1];

    // Only merge into text/heading blocks
    if (prev.type !== 'text' && prev.type !== 'heading') return null;

    const prevContent = (prev as TextBlock | HeadingBlock).content;
    const currentContent =
      current.type === 'text' || current.type === 'heading'
        ? (current as TextBlock | HeadingBlock).content
        : '';

    const offset = prevContent.length;
    const merged = prevContent + currentContent;

    const updated = blocks
      .map((b) => {
        if (b.id === prev.id) {
          return { ...b, content: merged } as DocumentBlock;
        }
        return b;
      })
      .filter((b) => b.id !== blockId);

    this._dispatchLocal(id, type, updated);
    return { targetId: prev.id, offset };
  }

  appendTaskBlockIfMissing(taskId: string): void {
    const active = this._getActiveContext();
    if (!active) return;
    const { id, type, ctx } = active;
    const blocks = ctx.documentBlocks || [];
    const exists = blocks.some((b) => b.type === 'task' && b.taskId === taskId);
    if (!exists) {
      const newBlock: TaskBlock = { id: uuidv7(), type: 'task', taskId };
      this._dispatchLocal(id, type, [...blocks, newBlock]);
    }
  }

  /**
   * Convert a block to a different type.
   * text/heading → task: creates a new task, replaces block with TaskBlock.
   * task → text: extracts title, replaces TaskBlock with TextBlock.
   * text ↔ heading: preserves content.
   */
  convertBlock(
    blockId: string,
    targetType: string,
    taskService: { add: (title: string) => string },
  ): void {
    const active = this._getActiveContext();
    if (!active) return;
    const { id, type, ctx } = active;
    const blocks = [...(ctx.documentBlocks || [])];
    const idx = blocks.findIndex((b) => b.id === blockId);
    if (idx === -1) return;

    const block = blocks[idx];
    let content = '';
    if (block.type === 'text' || block.type === 'heading' || block.type === 'markdown') {
      content = (block as TextBlock | HeadingBlock | MarkdownBlock).content;
    }

    let newBlock: DocumentBlock;
    switch (targetType) {
      case 'text':
        if (block.type === 'task') {
          // We can't easily get the task title here synchronously,
          // so just create an empty text block
          newBlock = { id: block.id, type: 'text', content: '' };
        } else {
          newBlock = { id: block.id, type: 'text', content };
        }
        break;
      case 'h1':
        newBlock = { id: block.id, type: 'heading', content, level: 1 as HeadingLevel };
        break;
      case 'h2':
        newBlock = { id: block.id, type: 'heading', content, level: 2 as HeadingLevel };
        break;
      case 'h3':
        newBlock = { id: block.id, type: 'heading', content, level: 3 as HeadingLevel };
        break;
      case 'task': {
        const taskId = taskService.add(content || 'New task');
        newBlock = { id: block.id, type: 'task', taskId };
        break;
      }
      case 'markdown':
        newBlock = { id: block.id, type: 'markdown', content };
        break;
      case 'divider':
        newBlock = { id: block.id, type: 'divider' };
        break;
      default:
        return;
    }

    blocks[idx] = newBlock;
    this._dispatchLocal(id, type, blocks);
  }

  /**
   * Duplicate a block, inserting the copy immediately after the original.
   */
  duplicateBlock(blockId: string, taskService: { add: (title: string) => string }): void {
    const active = this._getActiveContext();
    if (!active) return;
    const { id, type, ctx } = active;
    const blocks = [...(ctx.documentBlocks || [])];
    const idx = blocks.findIndex((b) => b.id === blockId);
    if (idx === -1) return;

    const block = blocks[idx];
    let newBlock: DocumentBlock;

    if (block.type === 'task') {
      // Create a new task for the duplicate
      const newTaskId = taskService.add('New task');
      newBlock = { id: uuidv7(), type: 'task', taskId: newTaskId };
    } else if (block.type === 'heading') {
      newBlock = {
        id: uuidv7(),
        type: 'heading',
        content: (block as HeadingBlock).content,
        level: (block as HeadingBlock).level,
      };
    } else if (block.type === 'divider') {
      newBlock = { id: uuidv7(), type: 'divider' };
    } else if (block.type === 'markdown') {
      newBlock = {
        id: uuidv7(),
        type: 'markdown',
        content: (block as MarkdownBlock).content,
      };
    } else {
      newBlock = {
        id: uuidv7(),
        type: 'text',
        content: (block as TextBlock).content,
      };
    }

    blocks.splice(idx + 1, 0, newBlock);
    this._dispatchLocal(id, type, blocks);
  }

  removeTaskBlock(taskId: string): void {
    const active = this._getActiveContext();
    if (!active) return;
    const { id, type, ctx } = active;
    const blocks = (ctx.documentBlocks || []).filter(
      (b) => !(b.type === 'task' && b.taskId === taskId),
    );
    this._dispatchLocal(id, type, blocks);
  }

  private _getActiveContext(): {
    id: string;
    type: WorkContextType;
    ctx: ActiveContext;
  } | null {
    const ctx = this._activeWorkContext();
    if (!ctx) return null;
    return {
      id: ctx.id,
      type: ctx.type,
      ctx: {
        id: ctx.id,
        type: ctx.type,
        title: ctx.title,
        taskIds: ctx.taskIds,
        documentBlocks: ctx.documentBlocks,
        isDocumentMode: ctx.isDocumentMode,
      },
    };
  }

  /**
   * Dispatch non-persistent action for immediate local UI update,
   * then schedule a debounced persistent sync.
   */
  private _dispatchLocal(
    contextId: string,
    contextType: WorkContextType,
    documentBlocks: DocumentBlock[],
  ): void {
    this._store.dispatch(
      updateDocumentBlocksLocal({
        contextId,
        contextType: contextType === WorkContextType.PROJECT ? 'PROJECT' : 'TAG',
        documentBlocks,
      }),
    );
    this._scheduleSyncDebounced(contextId, contextType);
  }

  /**
   * Dispatch persistent action immediately (for toggle, etc.)
   */
  private _dispatchPersistent(
    contextId: string,
    contextType: WorkContextType,
    changes: { documentBlocks?: DocumentBlock[]; isDocumentMode?: boolean },
  ): void {
    if (contextType === WorkContextType.PROJECT) {
      this._store.dispatch(updateProject({ project: { id: contextId, changes } }));
    } else {
      this._store.dispatch(
        updateTag({ tag: { id: contextId, changes }, isSkipSnack: true }),
      );
    }
  }

  private _scheduleSyncDebounced(contextId: string, contextType: WorkContextType): void {
    // C1: flush pending sync if it's for a different context
    if (this._pendingSync && this._pendingSync.contextId !== contextId) {
      this._flushSync();
    }
    this._pendingSync = { contextId, contextType };
    if (this._syncTimeout) {
      clearTimeout(this._syncTimeout);
    }
    this._syncTimeout = setTimeout(() => this._flushSync(), SYNC_DEBOUNCE_MS);
  }

  private _flushSync(): void {
    if (!this._pendingSync) return;
    const { contextId, contextType } = this._pendingSync;
    this._pendingSync = null;
    if (this._syncTimeout) {
      clearTimeout(this._syncTimeout);
      this._syncTimeout = null;
    }

    // Read blocks by entity ID so flush works even after context switch
    const entity =
      contextType === WorkContextType.PROJECT
        ? this._projectState().entities[contextId]
        : this._tagState().entities[contextId];
    if (!entity) return;

    const currentBlocks = entity.documentBlocks || [];
    const lastBlocks =
      this._lastPersistedContextId === contextId ? this._lastPersistedBlocks : [];
    const delta = computeBlocksDelta(lastBlocks, currentBlocks);
    if (!delta) return; // Nothing changed since last persist

    this._store.dispatch(
      updateDocumentBlocksDelta({
        contextId,
        contextType: contextType === WorkContextType.PROJECT ? 'PROJECT' : 'TAG',
        delta,
      }),
    );
    this._updateSnapshot(contextId, currentBlocks);
  }

  private _updateSnapshot(contextId: string, blocks: DocumentBlock[]): void {
    this._lastPersistedContextId = contextId;
    this._lastPersistedBlocks = blocks;
  }
}
