import {
  ChangeDetectionStrategy,
  Component,
  contentChild,
  DestroyRef,
  ElementRef,
  inject,
  input,
  model,
  output,
  signal,
  TemplateRef,
} from '@angular/core';
import { NgClass, NgStyle, NgTemplateOutlet } from '@angular/common';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDragEnd,
  CdkDragMove,
  CdkDropList,
  DragDropModule,
} from '@angular/cdk/drag-drop';
import {
  CanDropPredicate,
  DropListContext,
  DropWhere,
  FolderTplContext,
  HoverTarget,
  ItemTplContext,
  MoveInstruction,
  PointerPosition,
  TreeId,
  TreeNode,
} from './tree.types';
import { moveNode } from './tree.utils';
import { TreeDragService } from './tree-drag.service';
import { TreeIndicatorService } from './tree-indicator.service';
import { TREE_CONSTANTS } from './tree-constants';
import { assertTreeId } from './tree-guards';
import { expandCollapseAni } from './tree.animations';
import { DRAG_DELAY_FOR_TOUCH } from '../../app.constants';
import { isTouchActive } from '../../util/input-intent';

@Component({
  selector: 'tree-dnd',
  standalone: true,
  imports: [NgTemplateOutlet, NgStyle, NgClass, DragDropModule],
  providers: [TreeIndicatorService, TreeDragService],
  templateUrl: './tree.component.html',
  styleUrls: ['./tree.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [expandCollapseAni],
})
export class TreeDndComponent<TData = unknown> {
  // === INJECTED DEPENDENCIES ===
  private readonly _host = inject(ElementRef<HTMLElement>);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _dragService = inject(TreeDragService);
  private readonly _indicatorService = inject(TreeIndicatorService);

  // === PUBLIC INPUTS/OUTPUTS/MODELS ===
  readonly nodes = model.required<readonly TreeNode<TData>[]>();
  readonly indent = input(TREE_CONSTANTS.DEFAULT_INDENT);
  readonly canDrop = input<CanDropPredicate<TData>>(() => true);
  readonly moved = output<MoveInstruction>();

  // === PUBLIC CONTENT CHILDREN ===
  readonly itemTpl = contentChild<TemplateRef<ItemTplContext<TData>>>('treeItem');
  readonly folderTpl = contentChild<TemplateRef<FolderTplContext<TData>>>('treeFolder');

  // === PUBLIC SIGNALS ===
  readonly draggingId = signal<TreeId | null>(null);
  readonly justDroppedId = signal<TreeId | null>(null);
  readonly isDragInvalid = signal<boolean>(false);
  readonly isRootOver = signal<boolean>(false);
  readonly indicatorStyle = this._indicatorService.indicatorStyle;
  protected readonly DRAG_DELAY_FOR_TOUCH = DRAG_DELAY_FOR_TOUCH;
  protected readonly isTouchActive = isTouchActive;

  // === PRIVATE STATE ===
  /**
   * Tracks which drop zones are currently being hovered over.
   * Structure: { nodeId: { before: true, after: false, inside: false } }
   * This allows multiple drop zones to be highlighted simultaneously if needed.
   */
  private readonly _overMap = signal<Record<TreeId, Partial<Record<DropWhere, boolean>>>>(
    {},
  );
  private _hoverTarget: HoverTarget | null = null;
  private _treeRootEl: HTMLElement | null = null;
  private _rootDropEl: HTMLElement | null = null;
  private _dropHandled = false;
  private _dropFlashTimer?: number;
  private _dragMoveRafId: number | null = null;

  constructor() {
    this._destroyRef.onDestroy(() => {
      if (this._dropFlashTimer) clearTimeout(this._dropFlashTimer);
      if (this._dragMoveRafId !== null) cancelAnimationFrame(this._dragMoveRafId);
      this._indicatorService.clear();
    });
  }

  // === PUBLIC METHODS ===
  readonly canEnterList = (
    drag: CdkDrag<TreeId>,
    drop: CdkDropList<DropListContext<TData>>,
  ): boolean => this._canEnterListPredicate(drag, drop);

  setOver(id: TreeId, where: DropWhere, on: boolean): void {
    this._overMap.update((m) => {
      const current = m[id]?.[where] ?? false;
      if (current === on) {
        return m; // No change needed
      }
      const entry = { ...(m[id] ?? {}) };
      entry[where] = on;
      return { ...m, [id]: entry };
    });
  }

  isOver(id: TreeId, where: DropWhere): boolean {
    return !!this._overMap()[id]?.[where];
  }

  toggle(node: TreeNode<TData>): void {
    if (!node.children?.length) return;
    node.expanded = !node.expanded;
    const updatedNodes = [...this.nodes()] as TreeNode<TData>[];
    this.nodes.set(updatedNodes);
  }

  // === EVENT HANDLERS ===
  onDrop(event: CdkDragDrop<DropListContext<TData>>): void {
    if (this._dragMoveRafId !== null) {
      cancelAnimationFrame(this._dragMoveRafId);
      this._dragMoveRafId = null;
    }
    const dragId = this._extractDragId(event.item.data);
    this.draggingId.set(null);
    this._dropHandled = true;

    // if we have no dragId it means we dragged an invalid element, so we just reset
    if (!dragId) {
      this._scheduleItemReset(event.item);
      this._clearHoverStates();
      return;
    }

    const instruction = this._getDropInstruction(dragId, event);
    const wasMoved = instruction ? this._applyInstruction(instruction) : false;

    if (wasMoved) {
      this._flashJustDropped(dragId);
    }

    // Always schedule reset to ensure proper cleanup
    this._scheduleItemReset(event.item);
    this._clearHoverStates();
  }

  onDragStarted(id: TreeId): void {
    try {
      assertTreeId(id, 'drag ID');
      this.draggingId.set(id);
      this.isDragInvalid.set(false);
      this._hoverTarget = null;
      this._dropHandled = false;
      this.isRootOver.set(false);
      this._treeRootEl = this._host.nativeElement.querySelector('.tree');
      this._rootDropEl = this._host.nativeElement.querySelector('.root-drop');
      this._indicatorService.clear();
    } catch (error) {
      console.error('Invalid drag start:', error);
    }
  }

  onDragMoved(event: CdkDragMove<TreeId>): void {
    const dragId = this._extractDragId(event.source.data);
    if (!dragId) return;

    const pointer = event.pointerPosition;
    if (!pointer) return;

    if (this._dragMoveRafId !== null) return;
    this._dragMoveRafId = requestAnimationFrame(() => {
      this._dragMoveRafId = null;
      this._treeRootEl ??= this._host.nativeElement.querySelector('.tree');
      this._rootDropEl ??= this._host.nativeElement.querySelector('.root-drop');

      const target = this._findHoverTarget(pointer);
      this._updateHover(dragId, target);

      // Clear hover if dragged outside tree boundaries
      if (!target && this._hoverTarget) {
        this._setHoverTarget(null);
      }
    });
  }

  onDragEnded(event: CdkDragEnd<TreeId>): void {
    const dragId = this._extractDragId(event.source.data);

    if (!this._dropHandled && dragId) {
      if (this._hoverTarget) {
        const instruction = this._buildInstructionFromHover(dragId, this._hoverTarget);
        if (instruction && this._applyInstruction(instruction)) {
          this._flashJustDropped(dragId);
        }
      }
      // Always reset when drag ends without a drop, regardless of hover target
      this._scheduleItemReset(event.source);
    }

    if (this._dragMoveRafId !== null) {
      cancelAnimationFrame(this._dragMoveRafId);
      this._dragMoveRafId = null;
    }
    this.draggingId.set(null);
    this.isDragInvalid.set(false);
    this._dropHandled = false;
    this._clearHoverStates();
  }

  // === PRIVATE METHODS ===
  private _canEnterListPredicate(
    drag: CdkDrag<TreeId>,
    drop: CdkDropList<DropListContext<TData>>,
  ): boolean {
    const data = drop.data;
    const dragId = this._extractDragId(drag.data);
    if (!dragId || !data) {
      return false;
    }
    if (data.parentId && this._isNodeAncestor(dragId, data.parentId)) {
      return false;
    }
    const dragNode = this._findNode(dragId);
    if (!dragNode) {
      return false;
    }
    if (!data.parentId) {
      return this.canDrop()({ drag: dragNode, drop: null, where: 'root' });
    }
    const parentNode = this._findNode(data.parentId);
    if (!parentNode || parentNode.children === undefined) {
      return false;
    }
    return this.canDrop()({ drag: dragNode, drop: parentNode, where: 'inside' });
  }

  /**
   * Determines what element the user is hovering over during drag operations.
   * This is complex because we need to:
   * 1. Respect tree boundaries (don't allow drops outside the tree)
   * 2. Handle the special "root drop" zone at the bottom
   * 3. Calculate drop zones (before/after/inside) based on pointer position
   * 4. Return the correct element for indicator positioning
   */
  private _findHoverTarget(pointer: PointerPosition): HoverTarget | null {
    // First check: Are we even within the tree boundaries?
    if (this._treeRootEl) {
      const treeRect = this._treeRootEl.getBoundingClientRect();
      if (!this._dragService.isPointInRect(pointer, treeRect)) {
        return null; // Outside tree boundaries - show invalid cursor
      }
    }

    // Special case: Check if hovering over the root drop zone (bottom of tree)
    if (this._rootDropEl) {
      const rect = this._rootDropEl.getBoundingClientRect();
      if (this._dragService.isPointInRect(pointer, rect)) {
        return { id: '', where: 'root', element: this._rootDropEl };
      }
    }

    // Find the actual DOM element under the mouse pointer
    const element = document.elementFromPoint(pointer.x, pointer.y) as HTMLElement | null;
    if (!element) return null;

    // Navigate up the DOM to find the nearest tree item container
    const itemEl = element.closest('.item') as HTMLElement | null;
    if (!itemEl || !this._treeRootEl?.contains(itemEl)) {
      return null; // Element not within this tree instance
    }

    // Extract the node ID from the data attribute
    const nodeId = itemEl.getAttribute('data-node-id') as TreeId | null;
    if (!nodeId) return null;

    const itemRect = itemEl.getBoundingClientRect();

    // Calculate drop zone: folders get larger "inside" zones for easier targeting
    const targetNode = this._findNode(nodeId);
    const isTargetFolder = targetNode ? targetNode.children !== undefined : false;
    const where = this._dragService.calculateHoverZone(pointer, itemRect, isTargetFolder);

    return { id: nodeId, where, element: itemEl };
  }

  private _updateHover(dragId: string, target: HoverTarget | null): void {
    const isValid = target && this._isHoverAllowed(dragId, target);

    // Show invalid cursor when hovering outside tree or over invalid targets
    this.isDragInvalid.set(!isValid);

    if (!isValid) {
      this._setHoverTarget(null);
      return;
    }
    this._setHoverTarget(target);
  }

  private _isHoverAllowed(dragId: string, target: HoverTarget): boolean {
    return this._buildInstructionFromHover(dragId, target) !== null;
  }

  /**
   * Updates the current hover target and manages visual feedback.
   * This handles the complex state transitions between different hover targets:
   * - Clearing previous hover states (remove highlights)
   * - Setting new hover states (add highlights)
   * - Managing the drop indicator position
   * - Handling special "root" hover state separately
   */
  private _setHoverTarget(next: HoverTarget | null): void {
    const prev = this._hoverTarget;

    // Optimization: if we're hovering over the same target, just update indicator
    if (prev && next && prev.id === next.id && prev.where === next.where) {
      this._hoverTarget = next;
      this._showIndicator(next);
      return;
    }

    // Clear previous hover visual feedback
    if (prev) {
      if (prev.where === 'root') {
        this.isRootOver.set(false);
      } else {
        this.setOver(prev.id, prev.where, false);
      }
    }

    // Handle clearing hover state
    if (!next) {
      this._hoverTarget = null;
      this._indicatorService.hide();
      return;
    }

    // Set new hover state and visual feedback
    this._hoverTarget = next;
    if (next.where === 'root') {
      this.isRootOver.set(true);
    } else {
      this.setOver(next.id, next.where, true);
    }
    this._showIndicator(next);
  }

  /**
   * Determines the final move instruction when a drop occurs.
   * This is complex because we need to handle two different types of drop detection:
   * 1. Hover-based drops (precise positioning for folders)
   * 2. Drop-list-based drops (reliable for list ordering)
   *
   * We prioritize hover instructions for "inside" folder drops because they provide
   * better UX - users can see exactly where they're dropping via the indicator.
   */
  private _getDropInstruction(
    dragId: TreeId,
    event: CdkDragDrop<DropListContext<TData>>,
  ): MoveInstruction | null {
    // Get hover-based instruction (more precise for folders)
    let hoverInstruction: MoveInstruction | null = null;
    if (this._hoverTarget) {
      hoverInstruction = this._buildInstructionFromHover(dragId, this._hoverTarget);
    }

    // Get drop-list-based instruction (more reliable for ordering)
    const dropInstruction = this._dragService.buildInstructionFromDropEvent<TData>(
      dragId,
      event,
      this._findNode.bind(this),
      this._getSiblings.bind(this),
      (node: TreeNode<TData>) => node.children !== undefined,
      this._isNodeAncestor.bind(this),
      this.canDrop(),
    );

    // Prioritize hover instruction for "inside" folder drops
    // This gives users better visual feedback and more precise control
    if (hoverInstruction?.where === 'inside' && hoverInstruction.targetId) {
      const targetNode = this._findNode(hoverInstruction.targetId);
      if (targetNode && targetNode.children !== undefined) {
        return hoverInstruction;
      }
    }

    // Fall back to drop instruction for ordering, or hover instruction as last resort
    return dropInstruction ?? hoverInstruction;
  }

  /**
   * Resets a dragged item to its original position with proper timing.
   * We use requestAnimationFrame to ensure the reset happens after Angular's
   * change detection cycle, preventing visual glitches.
   */
  private _scheduleItemReset(item: CdkDrag<TreeId>): void {
    const reset = (): void => {
      try {
        item.reset();
      } catch (error) {
        // Ignore reset errors - they can happen if the item is already destroyed
        console.debug('Failed to reset drag item:', error);
      }
    };

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(reset);
    } else {
      reset();
    }
  }

  private _showIndicator(target: HoverTarget): void {
    if (!this._treeRootEl) return;
    this._indicatorService.show(
      target.element,
      target.where,
      this._treeRootEl,
      this.indent(),
    );
  }

  private _clearHoverStates(): void {
    this._hoverTarget = null;
    this._overMap.set({});
    this.isRootOver.set(false);
    this._indicatorService.hide();
    this._rootDropEl = null;
  }

  private _traverseNodes(
    nodes: TreeNode<TData>[],
    callback: (node: TreeNode<TData>) => void,
  ): void {
    const stack = [...nodes];
    while (stack.length) {
      const node = stack.pop()!;
      callback(node);
      if (node.children?.length) {
        stack.push(...node.children);
      }
    }
  }

  private _getSiblings(parentId: TreeId): TreeNode<TData>[] {
    if (!parentId) return this.nodes() as TreeNode<TData>[];
    return this._findNode(parentId)?.children ?? [];
  }

  private readonly _findNode = (id: TreeId): TreeNode<TData> | null => {
    if (!id) return null;

    const stack = [...this.nodes()] as TreeNode<TData>[];
    while (stack.length) {
      const node = stack.pop()!;
      if (node.id === id) return node;
      if (node.children?.length) {
        stack.push(...node.children);
      }
    }
    return null;
  };

  private _buildInstructionFromHover(
    dragId: TreeId,
    hover: HoverTarget,
  ): MoveInstruction | null {
    return this._dragService.buildInstructionFromHover<TData>(
      dragId,
      hover,
      this._findNode.bind(this),
      () => this.nodes() as TreeNode<TData>[],
      (node: TreeNode<TData>) => node.children !== undefined,
      this._isNodeAncestor.bind(this),
      this.canDrop(),
    );
  }

  private _applyInstruction(instr: MoveInstruction): boolean {
    const updatedNodes = moveNode<TData>(this.nodes() as TreeNode<TData>[], instr);
    this.nodes.set(updatedNodes);
    this.moved.emit(instr);
    return true;
  }

  /**
   * Checks if one node is an ancestor of another.
   * This prevents users from dropping a folder into itself or its descendants,
   * which would create invalid tree structures.
   *
   * Example: Can't drag "Folder A" into "Folder A/Subfolder B"
   */
  private readonly _isNodeAncestor = (
    ancestorId: TreeId,
    possibleDescendantId: TreeId,
  ): boolean => {
    const ancestorNode = this._findNode(ancestorId);
    if (!ancestorNode?.children) return false;

    let found = false;
    this._traverseNodes(ancestorNode.children as TreeNode<TData>[], (node) => {
      if (node.id === possibleDescendantId) {
        found = true;
      }
    });
    return found;
  };

  /**
   * Extracts and validates drag data as a TreeId.
   *
   * CDK drag events type item.data as 'any', but we set [cdkDragData]="node.id"
   * so we expect it to be a TreeId (string). This function provides runtime validation:
   * 1. Checks if data is a non-empty string
   * 2. Verifies the string is actually a valid node ID in our tree
   *
   * This prevents issues from malformed drag data or external drag sources.
   */
  private _extractDragId(data: unknown): TreeId | null {
    if (typeof data === 'string' && data.length > 0) {
      // Verify this is actually a node ID that exists in our tree
      const node = this._findNode(data);
      return node ? data : null;
    }
    return null;
  }

  private _flashJustDropped(id: TreeId): void {
    if (typeof window === 'undefined') return;

    this.justDroppedId.set(id);
    if (this._dropFlashTimer) clearTimeout(this._dropFlashTimer);
    this._dropFlashTimer = window.setTimeout(() => {
      if (this.justDroppedId() === id) this.justDroppedId.set(null);
    }, TREE_CONSTANTS.DROP_FLASH_DURATION);
  }
}
