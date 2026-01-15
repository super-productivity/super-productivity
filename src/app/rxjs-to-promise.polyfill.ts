import { lastValueFrom, Observable } from 'rxjs';

declare module 'rxjs' {
  interface Observable<T> {
    toPromise(): Promise<T>;
  }
}

// Reintroduce the removed toPromise helper to ease the migration.
type ObservablePrototype = {
  toPromise?: <T>() => Promise<T>;
};

const observableProto = (Observable as unknown as { prototype: ObservablePrototype })
  .prototype;

if (!observableProto.toPromise) {
  observableProto.toPromise = function <T>(this: Observable<T>): Promise<T> {
    return lastValueFrom(this);
  };
}
