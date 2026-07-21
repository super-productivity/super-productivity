import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';

import {
  ConflictReviewDialogData,
  DialogConflictReviewComponent,
} from './dialog-conflict-review.component';
import { WholeDatasetDiff } from '../../../op-log/sync/whole-dataset-diff.util';
import { pickKey } from '../../../op-log/sync/whole-dataset-merge.util';

const makeDiff = (): WholeDatasetDiff => ({
  differing: [
    {
      modelKey: 'task',
      entityType: 'TASK',
      entityId: 'remoteNewer',
      title: 'remoteNewer',
      localModified: 100,
      remoteModified: 900,
      fieldDiffs: [{ field: 'title', localVal: 'L', remoteVal: 'R' }],
      local: { id: 'remoteNewer', title: 'L' },
      remote: { id: 'remoteNewer', title: 'R' },
    },
    {
      modelKey: 'task',
      entityType: 'TASK',
      entityId: 'localNewer',
      title: 'localNewer',
      localModified: 900,
      remoteModified: 100,
      fieldDiffs: [{ field: 'title', localVal: 'L', remoteVal: 'R' }],
      local: { id: 'localNewer', title: 'L' },
      remote: { id: 'localNewer', title: 'R' },
    },
  ],
  onlyLocal: [
    {
      modelKey: 'task',
      entityType: 'TASK',
      entityId: 'ol',
      title: 'ol',
      modified: 1,
      entity: { id: 'ol' },
    },
  ],
  onlyRemote: [
    {
      modelKey: 'task',
      entityType: 'TASK',
      entityId: 'or',
      title: 'or',
      modified: 1,
      entity: { id: 'or' },
    },
  ],
});

describe('DialogConflictReviewComponent', () => {
  let closeSpy: jasmine.Spy;

  const createComponent = (diff: WholeDatasetDiff): DialogConflictReviewComponent => {
    const data: ConflictReviewDialogData = { diff };
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: data });
    return TestBed.createComponent(DialogConflictReviewComponent).componentInstance;
  };

  beforeEach(async () => {
    closeSpy = jasmine.createSpy('close');
    await TestBed.configureTestingModule({
      imports: [
        DialogConflictReviewComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        { provide: MatDialogRef, useValue: { close: closeSpy, disableClose: false } },
        { provide: MAT_DIALOG_DATA, useValue: { diff: makeDiff() } },
      ],
    }).compileComponents();
  });

  it('preselects differing picks via newest-wins (entity modified)', () => {
    const c = createComponent(makeDiff());
    expect(c.differingPick(c.differing[0])).toBe('remote'); // remoteNewer
    expect(c.differingPick(c.differing[1])).toBe('local'); // localNewer
    // only-local defaults to keep, only-remote defaults to add
    expect(c.onlyLocalPick(c.onlyLocal[0])).toBe('keep');
    expect(c.onlyRemotePick(c.onlyRemote[0])).toBe('add');
  });

  it('apply() closes with the current picks', () => {
    const c = createComponent(makeDiff());
    c.setDiffering(c.differing[0], 'local'); // override newest-wins
    c.setOnlyLocal(c.onlyLocal[0], 'discard');
    c.apply();

    expect(closeSpy).toHaveBeenCalledTimes(1);
    const arg = closeSpy.calls.mostRecent().args[0] as {
      picks: {
        differing: Record<string, string>;
        onlyLocal: Record<string, string>;
        onlyRemote: Record<string, string>;
      };
    };
    expect(arg.picks.differing[pickKey('task', 'remoteNewer')]).toBe('local');
    expect(arg.picks.onlyLocal[pickKey('task', 'ol')]).toBe('discard');
    expect(arg.picks.onlyRemote[pickKey('task', 'or')]).toBe('add');
  });

  it('cancel() closes with undefined (no picks) — conflict stays unresolved', () => {
    const c = createComponent(makeDiff());
    c.cancel();
    expect(closeSpy).toHaveBeenCalledWith(undefined);
  });

  it('bulk setAllDiffering overrides every differing pick', () => {
    const c = createComponent(makeDiff());
    c.setAllDiffering('remote');
    expect(c.differingPick(c.differing[0])).toBe('remote');
    expect(c.differingPick(c.differing[1])).toBe('remote');
  });
});
