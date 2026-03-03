import { Injectable } from '@angular/core';
import { IssueProviderKey } from '../issue.model';
import { IssueSyncAdapter } from './issue-sync-adapter.interface';

@Injectable({
  providedIn: 'root',
})
export class IssueSyncAdapterRegistryService {
  private _adapters = new Map<IssueProviderKey, IssueSyncAdapter<unknown>>();

  register<TCfg>(key: IssueProviderKey, adapter: IssueSyncAdapter<TCfg>): void {
    this._adapters.set(key, adapter as IssueSyncAdapter<unknown>);
  }

  get(key: IssueProviderKey): IssueSyncAdapter<unknown> | undefined {
    return this._adapters.get(key);
  }

  has(key: IssueProviderKey): boolean {
    return this._adapters.has(key);
  }
}
