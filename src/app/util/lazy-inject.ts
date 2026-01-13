import { Injector, Type, InjectionToken } from '@angular/core';

/**
 * Creates a lazy getter for an Angular service.
 *
 * Use this to break circular dependencies by deferring service resolution
 * until the service is actually needed at runtime.
 *
 * @example
 * ```typescript
 * private _injector = inject(Injector);
 * private getArchiveService = lazyInject(this._injector, ArchiveService);
 *
 * // Later in code:
 * const archiveService = this.getArchiveService();
 * ```
 *
 * @param injector The Angular Injector instance
 * @param token The service class or injection token to resolve
 * @returns A getter function that returns the service instance (cached after first call)
 */
export const lazyInject = <T>(
  injector: Injector,
  token: Type<T> | InjectionToken<T>,
): (() => T) => {
  let instance: T | undefined;
  return () => {
    if (!instance) {
      instance = injector.get(token);
    }
    return instance;
  };
};
