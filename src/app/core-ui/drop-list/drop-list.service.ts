import { Injectable } from '@angular/core';
import { CdkDropList } from '@angular/cdk/drag-drop';
import { BehaviorSubject, merge, of, Subject, timer } from 'rxjs';
import { map, startWith, switchMap } from 'rxjs/operators';
import { applyMidpointSortPatch } from './midpoint-sort-patch';

export interface DragPointer {
  x: number;
  y: number;
}

@Injectable({
  providedIn: 'root',
})
export class DropListService {
  // Coalesce burst register/unregister calls (e.g. dozens of sections
  // mounting in one CD pass) into a single downstream emission via a
  // microtask flush. `cdkDropListConnectedTo` rebuilds its sibling
  // graph per emission, so without this every list mount would be
  // O(L²) total.
  readonly dropLists = new BehaviorSubject<CdkDropList[]>([]);

  blockAniTrigger$ = new Subject<void>();
  isBlockAniAfterDrop$ = this.blockAniTrigger$.pipe(
    switchMap(() => merge(of(true), timer(1200).pipe(map(() => false)))),
    startWith(false),
  );

  private _list: CdkDropList[] = [];
  private _flushScheduled = false;
  private _activeDragPointer: DragPointer | null = null;
  private _isSubTaskDragStarting = false;
  private _pointerHit: {
    x: number;
    y: number;
    result: { listModelId: string; isOverRow: boolean } | null;
  } | null = null;

  activeDragPointer(): DragPointer | null {
    return this._activeDragPointer;
  }

  setActiveDragPointer(pointer: DragPointer | null): void {
    this._activeDragPointer = pointer;
    if (!pointer) {
      this._pointerHit = null;
    }
  }

  /**
   * Memoises a sub-task-list hit-test for one pointer position. During a drag
   * CDK consults several connected lists' `enterPredicate`s per pointer move,
   * each running the same `document.elementFromPoint` for the identical coords.
   * A stationary pointer can't move the DOM (CDK only re-sorts on movement), so
   * caching by exact coords is safe and collapses those to a single hit-test.
   * The single-entry cache is keyed by coords (a moved pointer simply misses)
   * and cleared when the drag ends (`setActiveDragPointer(null)`).
   */
  hitTestPointerSubTaskList(
    x: number,
    y: number,
    compute: () => { listModelId: string; isOverRow: boolean } | null,
  ): { listModelId: string; isOverRow: boolean } | null {
    if (this._pointerHit && this._pointerHit.x === x && this._pointerHit.y === y) {
      return this._pointerHit.result;
    }
    const result = compute();
    this._pointerHit = { x, y, result };
    return result;
  }

  /**
   * True only for the microtask in which a subtask drag begins.
   *
   * CDK caches a sibling drop-list's geometry (`DropListRef._domRect`) lazily,
   * and for a non-source list only when its `enterPredicate` passes at drag
   * start (`_startReceiving`). An uncached list can never be entered, so it can
   * never receive the item. The parent DONE/UNDONE list normally rejects a
   * subtask drag while the pointer is over the source subtask list (so in-list
   * sorting keeps working) — but at the *instant* a subtask drag starts the
   * pointer is always over that subtask list, so that guard would block the
   * parent list from ever being cached, and converting a subtask back to a main
   * task would silently fail until some unrelated parent drag warmed the cache.
   *
   * This flag opens a one-microtask window at drag start during which the
   * top-level lists accept the drag (letting CDK cache their geometry); the
   * pointer guard then resumes for the rest of the drag.
   */
  isSubTaskDragStarting(): boolean {
    return this._isSubTaskDragStarting;
  }

  markSubTaskDragStarting(): void {
    this._isSubTaskDragStarting = true;
    // Clear after CDK's synchronous `_startReceiving` pass (which runs right
    // after the `cdkDragStarted` output) but before the first pointer move.
    queueMicrotask(() => {
      this._isSubTaskDragStarting = false;
    });
  }

  registerDropList(dropList: CdkDropList, isSubTaskList = false): void {
    // Opt this list into the midpoint-crossing sort hit-test. CDK recreates the
    // strategy per drag, so the patch lives on the shared prototype but applies
    // only to registered task-list containers. See midpoint-sort-patch header.
    applyMidpointSortPatch(dropList);
    if (isSubTaskList) {
      this._list.unshift(dropList);
    } else {
      this._list.push(dropList);
    }
    this._scheduleFlush();
  }

  unregisterDropList(dropList: CdkDropList): void {
    const idx = this._list.indexOf(dropList);
    if (idx === -1) return;
    this._list.splice(idx, 1);
    this._scheduleFlush();
  }

  private _scheduleFlush(): void {
    if (this._flushScheduled) return;
    this._flushScheduled = true;
    queueMicrotask(() => {
      this._flushScheduled = false;
      this.dropLists.next(this._list.slice());
    });
  }
}
