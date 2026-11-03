import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { StateSnapshotService } from '../../../op-log/backup/state-snapshot.service';
import { T } from '../../../t.const';
import { isBigLoss, SyncFirstChoiceComponent } from './sync-first-choice.component';

const withTasks = (count: number): unknown => ({
  task: { ids: Array.from({ length: count }, (_, i) => `t${i}`) },
});

describe('isBigLoss', () => {
  it('always warns before replacing the account, whose tasks are not counted', () => {
    expect(isBigLoss('USE_LOCAL', 0)).toBe(true);
  });

  it('warns before using the account only when this device has 10 or more tasks', () => {
    expect(isBigLoss('USE_REMOTE', 9)).toBe(false);
    expect(isBigLoss('USE_REMOTE', 10)).toBe(true);
  });
});

describe('SyncFirstChoiceComponent', () => {
  let snapshot: jasmine.SpyObj<StateSnapshotService>;

  const render = async (
    taskCount: number,
  ): Promise<ComponentFixture<SyncFirstChoiceComponent>> => {
    snapshot.getStateSnapshotAsync.and.resolveTo(withTasks(taskCount) as never);
    const fixture = TestBed.createComponent(SyncFirstChoiceComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  };
  const text = (f: ComponentFixture<unknown>, sel: string): string =>
    (f.nativeElement as HTMLElement).querySelector(sel)?.textContent ?? '';
  const submitBtn = (f: ComponentFixture<unknown>): HTMLButtonElement =>
    (f.nativeElement as HTMLElement).querySelector('.e2e-first-sync-submit')!;
  const pick = (f: ComponentFixture<unknown>, sel: string): void => {
    (f.nativeElement as HTMLElement).querySelector<HTMLElement>(`${sel} input`)!.click();
    f.detectChanges();
  };

  beforeEach(async () => {
    snapshot = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshotAsync',
      'getStateSnapshot',
    ]);
    await TestBed.configureTestingModule({
      imports: [
        SyncFirstChoiceComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [{ provide: StateSnapshotService, useValue: snapshot }],
    }).compileComponents();
  });

  it("preselects the account's tasks when this device has few, and continues with one click", async () => {
    const fixture = await render(4);
    const emitted: unknown[] = [];
    fixture.componentInstance.chosen.subscribe((c) => emitted.push(c));

    expect(fixture.componentInstance.taskCount()).toBe(4);
    expect(text(fixture, '.e2e-first-sync-use-account')).toContain(
      T.F.SYNC.D_FIRST_SYNC.RECOMMENDED,
    );
    expect(text(fixture, '.e2e-first-sync-warning')).toBe('');
    expect(text(fixture, '.e2e-first-sync-submit')).toContain(
      T.F.SYNC.D_FIRST_SYNC.CONTINUE,
    );

    submitBtn(fixture).click();
    expect(emitted).toEqual(['USE_REMOTE']);
  });

  it('warns in place before replacing the account', async () => {
    const fixture = await render(4);
    const emitted: unknown[] = [];
    fixture.componentInstance.chosen.subscribe((c) => emitted.push(c));

    pick(fixture, '.e2e-first-sync-replace-account');

    expect(text(fixture, '.e2e-first-sync-warning')).not.toBe('');
    expect(text(fixture, '.e2e-first-sync-submit')).toContain(
      T.F.SYNC.D_FIRST_SYNC.REMOVE_ACCOUNT_TASKS,
    );
    submitBtn(fixture).click();
    expect(emitted).toEqual(['USE_LOCAL']);
  });

  it('preselects nothing when this device has many tasks, and names the loss', async () => {
    const fixture = await render(380);

    expect(fixture.componentInstance.choice()).toBeNull();
    expect(submitBtn(fixture).disabled).toBe(true);

    pick(fixture, '.e2e-first-sync-use-account');

    expect(text(fixture, '.e2e-first-sync-warning')).not.toBe('');
    expect(text(fixture, '.e2e-first-sync-submit')).toContain(
      T.F.SYNC.D_FIRST_SYNC.REMOVE_DEVICE_TASKS,
    );
    expect(submitBtn(fixture).disabled).toBe(false);
  });

  it('still counts the active tasks when the archives fail to load', async () => {
    snapshot.getStateSnapshot.and.returnValue(withTasks(3) as never);
    snapshot.getStateSnapshotAsync.and.rejectWith(new Error('idb'));
    const fixture = TestBed.createComponent(SyncFirstChoiceComponent);
    await fixture.whenStable();

    expect(fixture.componentInstance.taskCount()).toBe(3);
  });
});
