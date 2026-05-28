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

import { getTestBed, TestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';
import { provideZonelessChangeDetection } from '@angular/core';
// Type definitions for window.ea are in ./app/core/window-ea.d.ts

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
