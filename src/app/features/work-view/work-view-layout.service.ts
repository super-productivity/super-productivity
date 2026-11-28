import { Injectable, signal } from '@angular/core';

export type WorkViewLayout = 'list' | 'kanban';

/**
 * UI-only layout for work contexts that have no persisted view state.
 * Today is a virtual tag, so its board/list choice must not touch synced data.
 */
@Injectable({ providedIn: 'root' })
export class WorkViewLayoutService {
  private readonly _layouts = signal<Readonly<Record<string, WorkViewLayout>>>({});

  getLayout(contextId: string): WorkViewLayout {
    return this._layouts()[contextId] ?? 'list';
  }

  toggleLayout(contextId: string): void {
    const next = this.getLayout(contextId) === 'kanban' ? 'list' : 'kanban';
    this._layouts.update((layouts) => ({ ...layouts, [contextId]: next }));
  }
}
