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
  private _baseServerSeqStack: (number | undefined)[] = [];

  get baseServerSeq(): number | undefined {
    return this._baseServerSeqStack.at(-1);
  }

  /**
   * Withdraws the base for the innermost `runWithBaseServerSeq` run — used
   * once the remote batch turned out to be blocked at an op, so the cursor
   * the caller supplied no longer proves what the resulting state includes.
   * Any REPAIR created afterwards in this run is a legacy (non-causal) one,
   * which receivers treat non-destructively. No-op outside a run.
   */
  dropBaseServerSeqForCurrentRun(): void {
    if (this._baseServerSeqStack.length > 0) {
      this._baseServerSeqStack[this._baseServerSeqStack.length - 1] = undefined;
    }
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
