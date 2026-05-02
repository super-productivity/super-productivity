import { Injectable } from '@angular/core';
import { CdkDropList } from '@angular/cdk/drag-drop';
import { BehaviorSubject, merge, of, Subject, timer } from 'rxjs';
import { map, startWith, switchMap } from 'rxjs/operators';

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

  registerDropList(dropList: CdkDropList, isSubTaskList = false): void {
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
