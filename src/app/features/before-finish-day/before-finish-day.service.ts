import { Injectable } from '@angular/core';
import { BeforeFinishDayAction } from './before-finish-day.model';

@Injectable({
  providedIn: 'root',
})
export class BeforeFinishDayService {
  private _actions: BeforeFinishDayAction[] = [];

  constructor() {}

  addAction(actionToAdd: BeforeFinishDayAction): void {
    this._actions.push(actionToAdd);
  }

  async executeActions(dayStr: string): Promise<'SUCCESS' | 'ERROR'> {
    const results = await Promise.all(this._actions.map((action) => action(dayStr)));
    if (results.includes('ERROR')) {
      return 'ERROR';
    }

    return 'SUCCESS';
  }
}
