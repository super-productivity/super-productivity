import { Injectable } from '@angular/core';
import { CdkDropList } from '@angular/cdk/drag-drop';
import { BehaviorSubject, combineLatest, merge, of, Subject, timer } from 'rxjs';
import { map, startWith, switchMap } from 'rxjs/operators';

@Injectable({
  providedIn: 'root',
})
export class DropListService {
  private _subLists = new BehaviorSubject<CdkDropList[]>([]);
  private _mainLists = new BehaviorSubject<CdkDropList[]>([]);

  subLists$ = this._subLists.asObservable();
  mainLists$ = this._mainLists.asObservable();

  dropLists = combineLatest([this._subLists, this._mainLists]).pipe(
    map(([subLists, mainLists]) => [...subLists, ...mainLists]),
  );

  blockAniTrigger$ = new Subject<void>();
  isBlockAniAfterDrop$ = this.blockAniTrigger$.pipe(
    switchMap(() => merge(of(true), timer(1200).pipe(map(() => false)))),
    startWith(false),
  );

  isPromotionMode$ = new BehaviorSubject<boolean>(false);

  setPromotionMode(isPromoting: boolean): void {
    if (this.isPromotionMode$.getValue() !== isPromoting) {
      this.isPromotionMode$.next(isPromoting);
    }
  }

  registerDropList(dropList: CdkDropList, isSubTaskList = false): void {
    if (isSubTaskList) {
      this._subLists.next([dropList, ...this._subLists.getValue()]);
    } else {
      this._mainLists.next([...this._mainLists.getValue(), dropList]);
    }
    // Log.log(this.dropLists.getValue());
  }

  unregisterDropList(dropList: CdkDropList): void {
    // NOTE: we need to unregister from both, because we don't know the type
    this._subLists.next(this._subLists.getValue().filter((dl) => dl !== dropList));
    this._mainLists.next(this._mainLists.getValue().filter((dl) => dl !== dropList));
  }

  getSubLists(): CdkDropList[] {
    return this._subLists.getValue();
  }

  getMainLists(): CdkDropList[] {
    return this._mainLists.getValue();
  }
}
