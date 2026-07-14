import { Injectable } from '@angular/core';

/**
 * Carries the downloaded server cursor through remote apply/validation so a
 * REPAIR operation can prove which server state its snapshot includes.
 *
 * SyncCycleGuardService serializes sync sessions within a tab. The stack keeps
 * nested remote-processing calls well-defined without leaking context after an
 * exception.
 */
@Injectable({ providedIn: 'root' })
export class RepairSyncContextService {
  private _baseServerSeqStack: number[] = [];

  get baseServerSeq(): number | undefined {
    return this._baseServerSeqStack.at(-1);
  }

  async runWithBaseServerSeq<T>(
    baseServerSeq: number | undefined,
    callback: () => Promise<T>,
  ): Promise<T> {
    if (baseServerSeq === undefined) {
      return callback();
    }

    this._baseServerSeqStack.push(baseServerSeq);
    try {
      return await callback();
    } finally {
      this._baseServerSeqStack.pop();
    }
  }
}
