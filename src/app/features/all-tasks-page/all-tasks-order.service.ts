import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AllTasksOrderService {
  private _orderVersion = signal(0);
  readonly orderVersion = this._orderVersion.asReadonly();

  notifyOrderChanged(): void {
    this._orderVersion.update((v) => v + 1);
  }
}
