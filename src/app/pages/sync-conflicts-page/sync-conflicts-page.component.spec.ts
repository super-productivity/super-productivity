import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { By } from '@angular/platform-browser';
import { SyncConflictsPageComponent } from './sync-conflicts-page.component';
import { ConflictJournalService } from '../../op-log/sync/conflict-journal.service';
import { ConflictJournalEntry } from '../../op-log/sync/conflict-journal.model';
import { SyncConflictUiService } from '../../op-log/sync/sync-conflict-ui.service';
import { CLIENT_ID_PROVIDER } from '../../op-log/util/client-id.provider';
import { EntityType } from '../../op-log/core/operation.types';

const makeEntry = (over: Partial<ConflictJournalEntry> = {}): ConflictJournalEntry => ({
  id: Math.random().toString(36).slice(2),
  entityType: 'TASK' as EntityType,
  entityId: 'task-1',
  entityTitle: 'Buy milk',
  resolvedAt: 1_700_000_000_000,
  winner: 'remote',
  reason: 'newer',
  fieldDiffs: [
    {
      field: 'title',
      localVal: 'Buy oat milk',
      remoteVal: 'Buy milk',
      pickedSide: 'remote',
    },
  ],
  localClientId: 'AAAAAAAAAA',
  remoteClientId: 'BBBBBBBBBB',
  localTs: 1_700_000_000_000,
  remoteTs: 1_700_000_100_000,
  status: 'unreviewed',
  ...over,
});

describe('SyncConflictsPageComponent', () => {
  let fixture: ComponentFixture<SyncConflictsPageComponent>;
  let component: SyncConflictsPageComponent;
  let journal: ConflictJournalService;
  let ui: jasmine.SpyObj<SyncConflictUiService>;

  const setUp = async (entries: ConflictJournalEntry[]): Promise<void> => {
    ui = jasmine.createSpyObj<SyncConflictUiService>('SyncConflictUiService', [
      'keep',
      'flip',
      'keepAll',
      'flipAllToSide',
      'getStaleState',
      'canFlip',
    ]);
    ui.getStaleState.and.resolveTo({ isStale: false, current: undefined });
    ui.canFlip.and.returnValue(true);
    ui.keep.and.resolveTo();
    ui.flip.and.resolveTo('applied');
    ui.keepAll.and.resolveTo();
    ui.flipAllToSide.and.resolveTo();

    await TestBed.configureTestingModule({
      imports: [
        SyncConflictsPageComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        ConflictJournalService,
        { provide: SyncConflictUiService, useValue: ui },
        {
          provide: CLIENT_ID_PROVIDER,
          useValue: {
            loadClientId: () => Promise.resolve('AAAAAAAAAA'),
            getOrGenerateClientId: () => Promise.resolve('AAAAAAAAAA'),
            clearCache: () => undefined,
          },
        },
      ],
    }).compileComponents();

    journal = TestBed.inject(ConflictJournalService);
    for (const e of entries) {
      await journal.record(e);
    }

    fixture = TestBed.createComponent(SyncConflictsPageComponent);
    component = fixture.componentInstance;
    await component.reload();
    fixture.detectChanges();
  };

  it('shows the empty state when there are no unreviewed conflicts', async () => {
    await setUp([]);
    expect(fixture.debugElement.query(By.css('.empty-state'))).not.toBeNull();
    expect(fixture.debugElement.queryAll(By.css('.conflict-row')).length).toBe(0);
  });

  it('renders a grouped row per unreviewed entry with winner + reason chips', async () => {
    await setUp([
      makeEntry({ id: 'a', entityType: 'TASK' as EntityType }),
      makeEntry({ id: 'b', entityType: 'PROJECT' as EntityType, entityTitle: 'Work' }),
    ]);

    const rows = fixture.debugElement.queryAll(By.css('.conflict-row'));
    expect(rows.length).toBe(2);
    expect(fixture.debugElement.queryAll(By.css('.entity-group')).length).toBe(2);
    expect(fixture.debugElement.query(By.css('.chip--winner'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('.chip--reason'))).not.toBeNull();
  });

  it('marks the winning side in the expanded diff table', async () => {
    await setUp([makeEntry({ id: 'a' })]);
    await component.toggleExpand(component.unreviewed()[0]);
    fixture.detectChanges();

    const won = fixture.debugElement.queryAll(By.css('td.is-won'));
    expect(won.length).toBe(1); // remote won the single 'title' field
    expect(fixture.debugElement.query(By.css('.won-ico'))).not.toBeNull();
  });

  it('KEEP calls the service; FLIP calls the service', async () => {
    await setUp([makeEntry({ id: 'a' })]);
    const entry = component.unreviewed()[0];
    await component.toggleExpand(entry);
    fixture.detectChanges();

    const [keepBtn, flipBtn] = fixture.debugElement.queryAll(
      By.css('.row-actions button'),
    );
    keepBtn.nativeElement.click();
    expect(ui.keep).toHaveBeenCalledWith(entry);

    flipBtn.nativeElement.click();
    expect(ui.flip).toHaveBeenCalledWith(entry);
  });

  it('bulk actions delegate to the service', async () => {
    await setUp([makeEntry({ id: 'a' })]);
    const buttons = fixture.debugElement.queryAll(By.css('.bulk-actions button'));
    buttons[0].nativeElement.click();
    expect(ui.keepAll).toHaveBeenCalled();
    buttons[1].nativeElement.click();
    expect(ui.flipAllToSide).toHaveBeenCalledWith(jasmine.any(Array), 'local');
    buttons[2].nativeElement.click();
    expect(ui.flipAllToSide).toHaveBeenCalledWith(jasmine.any(Array), 'remote');
  });

  it('History tab renders a merged entry as per-field chips', async () => {
    await setUp([
      makeEntry({
        id: 'm',
        winner: 'merged',
        reason: 'disjoint-merge',
        status: 'info',
        fieldDiffs: [
          { field: 'title', localVal: 'L', remoteVal: undefined, pickedSide: 'local' },
          { field: 'notes', localVal: undefined, remoteVal: 'R', pickedSide: 'remote' },
        ],
      }),
    ]);

    // Switch to History tab and expand the merged entry.
    component.onTabIndexChange(1);
    fixture.detectChanges();
    await component.toggleExpand(component.history()[0]);
    fixture.detectChanges();

    const chips = fixture.debugElement.queryAll(By.css('.chip--merged-field'));
    expect(chips.length).toBe(2);
    // Read-only: no KEEP/FLIP actions in History.
    expect(fixture.debugElement.query(By.css('.row-actions'))).toBeNull();
  });
});
