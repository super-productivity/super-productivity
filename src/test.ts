// This file is required by karma.conf.js and loads recursively all the .spec and framework files

// NOTE: Do NOT import 'zone.js' or 'zone.js/testing' here explicitly.
// Angular's karma builder handles Zone.js setup automatically.
// Adding explicit imports causes conflicts with Jasmine's clock mocking.

// Replace globalThis.indexedDB with an in-memory polyfill BEFORE any service
// resolves `openDB()`. Real Chrome IndexedDB persists across specs in the
// shared Karma session: leftover connections, version-change races, and rxjs
// scheduler actions queued behind IDB callbacks have repeatedly poisoned the
// suite (Karma disconnects with "executing a cancelled action" cascades from
// op-log / multi-client-sync specs). Each spec wipes the in-memory databases
// in the beforeEach below, so no cross-spec IDB state survives.
//
// `fake-indexeddb/auto` installs the polyfill class globals (IDBDatabase,
// IDBKeyRange, IDBObjectStore, IDBIndex, IDBCursor, IDBTransaction, …) once.
// The `beforeEach` below swaps `globalThis.indexedDB` to a fresh `IDBFactory`
// instance per spec — the class globals stay constant so the `idb` library's
// `instanceof` checks (against IDBDatabase / IDBObjectStore / IDBIndex /
// IDBCursor / IDBTransaction, captured lazily by `getIdbProxyableTypes()`)
// keep wrapping per-spec connections, while the per-factory `_databases` map
// is empty so no leftover connections, schema versions, or blocked deletes
// survive between tests.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { asyncScheduler } from 'rxjs';
import { clearDeferredActions } from './app/op-log/capture/operation-capture.meta-reducer';
import { _resetDevErrorState } from './app/util/dev-error';

import { getTestBed, TestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';
import { provideZonelessChangeDetection } from '@angular/core';
// Type definitions for window.ea are in ./app/core/window-ea.d.ts

// Harden the suite against leaked rxjs scheduler actions. When a time-based
// operator (debounceTime / delay / timer / interval …) schedules an action
// and the owning subscription is torn down before its timer fires, the
// AsyncAction becomes `closed`, but a still-pending IDB-callback-queued timer
// can fire `scheduler.flush(action)` anyway. rxjs's AsyncAction.execute then
// returns `new Error('executing a cancelled action')`, which AsyncScheduler
// .flush RETHROWS synchronously inside the setInterval callback. That throw
// surfaces in whatever spec happens to be tearing down at the time ("An error
// was thrown in afterAll"), wedges Chrome, and disconnects the whole Karma
// session — a documented, order-dependent flake from op-log / sync specs.
//
// A cancelled action must not run its work regardless, so executing it as a
// no-op is semantically correct; we only drop rxjs's diagnostic Error (which
// no production code or spec relies on) to stop one leaked timer from killing
// the run. `asyncScheduler.schedulerActionCtor` is the base `AsyncAction`
// class; AsapAction / AnimationFrameAction / QueueAction extend it and inherit
// `execute`, so patching this one prototype covers every scheduler.
interface CancellableSchedulerAction {
  closed: boolean;
  execute(state: unknown, delay: number): unknown;
}
const asyncActionProto = (
  asyncScheduler as unknown as {
    schedulerActionCtor: { prototype: CancellableSchedulerAction };
  }
).schedulerActionCtor?.prototype;
if (asyncActionProto && typeof asyncActionProto.execute === 'function') {
  const originalExecute = asyncActionProto.execute;
  let warnedOnce = false;
  asyncActionProto.execute = function (
    this: CancellableSchedulerAction,
    state: unknown,
    delay: number,
  ): unknown {
    if (this.closed) {
      if (!warnedOnce) {
        warnedOnce = true;
        console.warn(
          '[test] Suppressed a leaked rxjs scheduler action (a cancelled ' +
            "action's timer fired after teardown). A spec is not tearing down " +
            'a time-based subscription; see the comment in src/test.ts.',
        );
      }
      return undefined;
    }
    return originalExecute.call(this, state, delay);
  };
}

beforeAll(() => {
  jasmine.DEFAULT_TIMEOUT_INTERVAL = 2000;
});

beforeEach(() => {
  // Swap in a fresh fake IDB factory per spec. `window.indexedDB` is
  // getter-only in browsers, so direct assignment throws — same
  // `defineProperty` trick `fake-indexeddb/auto` uses on initial install.
  // No `deleteDatabase` dance (which blocks on open connections held by
  // `providedIn: 'root'` services that have not been destroyed by TestBed).
  // Singleton services from previous specs retain a stale `_db` reference
  // until the next `TestBed.configureTestingModule` replaces them, so the
  // previous factory plateaus on those references — it does not grow per
  // spec — and is dropped on the next module reset.
  Object.defineProperty(globalThis, 'indexedDB', {
    value: new IDBFactory(),
    configurable: true,
    writable: true,
  });

  // The deferred-action buffer is module-level state shared by every spec in
  // the Karma context. Actions left in it leak into later spec FILES, where
  // the phantom-change guard (#8751) reads it and silently skips compaction
  // and snapshot saves — an order-dependent failure that passes standalone.
  clearDeferredActions();

  // The dialog spies below are created once at module load, so reset their
  // call history before every spec to prevent assertions from passing on a
  // stale call from an unrelated test. Re-arm devError's alert latch as well
  // so legitimate alerts remain observable regardless of spec order.
  if (jasmine.isSpy(window.alert)) {
    (window.alert as jasmine.Spy).calls.reset();
  }
  if (jasmine.isSpy(window.confirm)) {
    (window.confirm as jasmine.Spy).calls.reset();
  }
  _resetDevErrorState();
});

// Mock browser dialogs globally for tests
// We need to handle tests that try to spy on alert/confirm after we've already mocked them
// First check if alert/confirm are already spies (from previous test runs)
if (!(window.alert as jasmine.Spy).and) {
  window.alert = jasmine.createSpy('alert');
}
if (!(window.confirm as jasmine.Spy).and) {
  window.confirm = jasmine.createSpy('confirm').and.returnValue(true);
}

// Configure the TestBed providers globally
const originalConfigureTestingModule = TestBed.configureTestingModule;
TestBed.configureTestingModule = function (
  moduleDef: Parameters<typeof originalConfigureTestingModule>[0],
) {
  if (!moduleDef.providers) {
    moduleDef.providers = [];
  }

  // Add zoneless change detection provider if not already present
  const hasZonelessProvider = moduleDef.providers.some(
    (p: unknown) =>
      p === provideZonelessChangeDetection ||
      (p &&
        typeof p === 'object' &&
        'provide' in p &&
        p.provide === provideZonelessChangeDetection),
  );

  if (!hasZonelessProvider) {
    moduleDef.providers.push(provideZonelessChangeDetection());
  }

  return originalConfigureTestingModule.call(this, moduleDef);
};

// First, initialize the Angular testing environment.
getTestBed().initTestEnvironment(
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting(),
  {
    teardown: { destroyAfterEach: false },
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  },
);
