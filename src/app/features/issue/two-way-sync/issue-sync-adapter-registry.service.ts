import { Injectable } from '@angular/core';
import { IssueSyncAdapter } from './issue-sync-adapter.interface';

@Injectable({
  providedIn: 'root',
})
export class IssueSyncAdapterRegistryService {
  private _adapters = new Map<string, IssueSyncAdapter<unknown>>();

  register<TCfg>(key: string, adapter: IssueSyncAdapter<TCfg>): void {
    this._adapters.set(key, adapter as IssueSyncAdapter<unknown>);
  }

  get(key: string): IssueSyncAdapter<unknown> | undefined {
    return this._adapters.get(key);
  }

  has(key: string): boolean {
    return this._adapters.has(key);
  }

  unregister(key: string): void {
    this._adapters.delete(key);
  }
}
