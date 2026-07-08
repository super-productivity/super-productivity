import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { provideMockStore } from '@ngrx/store/testing';

import { DialogSyncConflictComponent } from './dialog-sync-conflict.component';
import { ConflictData, ConflictReason, VectorClock } from '../../../op-log/sync-exports';
import { T } from '../../../t.const';

const buildConflictData = (overrides: {
  localVectorClock?: VectorClock;
  remoteVectorClock?: VectorClock;
  lastSyncedVectorClock?: VectorClock | null;
  localUnsyncedOpsCount?: number;
}): ConflictData => ({
  reason: ConflictReason.NoLastSync,
  localUnsyncedOpsCount: overrides.localUnsyncedOpsCount,
  remote: {
    lastUpdate: 1000,
    lastUpdateAction: 'Remote data',
    revMap: {},
    crossModelVersion: 1,
    mainModelData: {},
    isFullData: true,
    vectorClock: overrides.remoteVectorClock,
  },
  local: {
    lastUpdate: 2000,
    lastUpdateAction: 'local changes',
    revMap: {},
    crossModelVersion: 1,
    lastSyncedUpdate: null,
    metaRev: null,
    vectorClock: overrides.localVectorClock,
    lastSyncedVectorClock: overrides.lastSyncedVectorClock,
  },
});

describe('DialogSyncConflictComponent', () => {
  const createComponent = (data: ConflictData): DialogSyncConflictComponent => {
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: data });
    const fixture = TestBed.createComponent(DialogSyncConflictComponent);
    return fixture.componentInstance;
  };

  beforeEach(async () => {
    const mockDialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    const mockDialog = jasmine.createSpyObj('MatDialog', ['open']);

    await TestBed.configureTestingModule({
      imports: [
        DialogSyncConflictComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        provideMockStore(),
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MatDialog, useValue: mockDialog },
        { provide: MAT_DIALOG_DATA, useValue: buildConflictData({}) },
      ],
    }).compileComponents();
  });

  describe('getChangeCount()', () => {
    it('(a) returns correct per-client delta when lastSyncedVectorClock is present', () => {
      const component = createComponent(
        buildConflictData({
          localVectorClock: { clientA: 10, clientB: 5 },
          remoteVectorClock: { clientA: 3, clientB: 12 },
          lastSyncedVectorClock: { clientA: 3, clientB: 5 },
        }),
      );

      // local: max(0,10-3) + max(0,5-5) = 7
      expect(component.localChangeCount).toBe(7);
      // remote: max(0,3-3) + max(0,12-5) = 7
      expect(component.remoteChangeCount).toBe(7);
    });

    it('(b) returns null (no whole-clock summing) when lastSyncedVectorClock is null', () => {
      const component = createComponent(
        buildConflictData({
          localVectorClock: { clientA: 1000, clientB: 2000 },
          remoteVectorClock: { clientA: 500, clientB: 900 },
          lastSyncedVectorClock: null,
        }),
      );

      // Bug SPAP-7: previously summed the whole clock (3000 / 1400). Must be null now.
      expect(component.localChangeCount).toBeNull();
      expect(component.remoteChangeCount).toBeNull();
    });

    it('shows the exact pending-op count when the clock delta under-counts (compaction fold)', () => {
      // Compaction folded the unsynced ops into the last-synced clock, so the
      // per-client delta computes 0 even though 3 ops are known to be pending.
      // The measured count is what USE_REMOTE would discard — show it.
      const component = createComponent(
        buildConflictData({
          localVectorClock: { clientA: 5 },
          remoteVectorClock: { clientA: 5, clientB: 2 },
          lastSyncedVectorClock: { clientA: 5 },
          localUnsyncedOpsCount: 3,
        }),
      );

      expect(component.localChangeCount).toBe(3);
      // The remote count still comes from the clock delta.
      expect(component.remoteChangeCount).toBe(2);
    });

    it('prefers the measured pending-op count over the clock delta whenever provided', () => {
      const component = createComponent(
        buildConflictData({
          localVectorClock: { clientA: 10 },
          remoteVectorClock: { clientA: 3 },
          lastSyncedVectorClock: { clientA: 3 },
          localUnsyncedOpsCount: 3,
        }),
      );

      // delta = 7, but 3 is the exact figure for "what USE_REMOTE discards".
      expect(component.localChangeCount).toBe(3);
    });

    it('falls back to the clock delta when no pending-op count is provided', () => {
      const component = createComponent(
        buildConflictData({
          localVectorClock: { clientA: 10 },
          remoteVectorClock: { clientA: 3 },
          lastSyncedVectorClock: { clientA: 3 },
        }),
      );

      expect(component.localChangeCount).toBe(7);
    });

    it('returns null when vector clocks are entirely absent', () => {
      const component = createComponent(
        buildConflictData({
          localVectorClock: undefined,
          remoteVectorClock: undefined,
          lastSyncedVectorClock: null,
        }),
      );

      expect(component.localChangeCount).toBeNull();
      expect(component.remoteChangeCount).toBeNull();
    });
  });

  describe('getConfirmationMessage() / shouldConfirmOverwrite()', () => {
    it('(c) renders the counted warning key when deltas are known', () => {
      const component = createComponent(
        buildConflictData({
          localVectorClock: { clientA: 30 },
          remoteVectorClock: { clientA: 3 },
          lastSyncedVectorClock: { clientA: 3 },
        }),
      );

      // local delta = 27, remote delta = 0 -> USE_REMOTE should confirm (>= 20)
      expect(
        (
          component as unknown as { shouldConfirmOverwrite(r: string): boolean }
        ).shouldConfirmOverwrite('USE_REMOTE'),
      ).toBe(true);

      const msg = (
        component as unknown as { getConfirmationMessage(r: string): string }
      ).getConfirmationMessage('USE_REMOTE');
      expect(msg).toContain(T.F.SYNC.D_CONFLICT.OVERWRITE_WARNING);
      expect(msg).not.toContain('OVERWRITE_WARNING_UNKNOWN');
    });

    it('(c) renders the count-free warning key and still confirms when deltas are unknown', () => {
      const component = createComponent(
        buildConflictData({
          localVectorClock: { clientA: 1000 },
          remoteVectorClock: { clientA: 500 },
          lastSyncedVectorClock: null,
        }),
      );

      // Null counts must still allow the confirmation dialog to appear.
      expect(
        (
          component as unknown as { shouldConfirmOverwrite(r: string): boolean }
        ).shouldConfirmOverwrite('USE_REMOTE'),
      ).toBe(true);

      const msg = (
        component as unknown as { getConfirmationMessage(r: string): string }
      ).getConfirmationMessage('USE_REMOTE');
      expect(msg).toContain(T.F.SYNC.D_CONFLICT.OVERWRITE_WARNING_UNKNOWN);
    });

    it('confirms USE_REMOTE from the exact pending count when the clock delta reads 0', () => {
      // Compaction folded 25 unsynced ops into the baseline clock: the delta
      // computed local=0, remote=0 and shouldConfirmOverwrite('USE_REMOTE')
      // returned false — no secondary confirmation despite 25 real unsynced
      // local changes about to be discarded. The measured count restores the
      // designed >= 20-difference confirmation.
      const component = createComponent(
        buildConflictData({
          localVectorClock: { clientA: 5 },
          remoteVectorClock: { clientA: 5 },
          lastSyncedVectorClock: { clientA: 5 },
          localUnsyncedOpsCount: 25,
        }),
      );

      expect(component.localChangeCount).toBe(25);
      const typed = component as unknown as {
        shouldConfirmOverwrite(r: string): boolean;
        getConfirmationMessage(r: string): string;
      };
      expect(typed.shouldConfirmOverwrite('USE_REMOTE')).toBe(true);
      // The counted (not count-free) warning is used — the figure is exact.
      expect(typed.getConfirmationMessage('USE_REMOTE')).toContain(
        T.F.SYNC.D_CONFLICT.OVERWRITE_WARNING,
      );
    });
  });
});
