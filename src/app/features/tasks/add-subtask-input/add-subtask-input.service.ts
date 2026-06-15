import { Injectable, signal } from '@angular/core';

export interface AddSubtaskInputOpenRequest {
  parentId: string;
  requestId: number;
}

@Injectable({
  providedIn: 'root',
})
export class AddSubtaskInputService {
  private _requestId = 0;

  readonly openRequest = signal<AddSubtaskInputOpenRequest | null>(null);

  requestOpen(parentId: string): void {
    this.openRequest.set({
      parentId,
      requestId: ++this._requestId,
    });
  }
}
