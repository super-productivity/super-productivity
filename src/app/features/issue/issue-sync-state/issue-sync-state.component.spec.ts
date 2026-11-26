import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { IssueSyncStateComponent } from './issue-sync-state.component';
import { IssueSyncStateService } from '../two-way-sync/issue-sync-state.service';

describe('IssueSyncStateComponent', () => {
  let fixture: ComponentFixture<IssueSyncStateComponent>;
  let state: IssueSyncStateService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IssueSyncStateComponent, TranslateModule.forRoot()],
    }).compileComponents();
    state = TestBed.inject(IssueSyncStateService);
    fixture = TestBed.createComponent(IssueSyncStateComponent);
    fixture.componentRef.setInput('task', { id: 'task-1' });
    fixture.detectChanges();
  });

  const text = (): string => fixture.nativeElement.textContent.trim();
  const button = (): HTMLButtonElement | null =>
    fixture.nativeElement.querySelector('button');

  it('renders nothing while the task syncs', () => {
    expect(text()).toBe('');
  });

  it('shows a failed push with Retry, which asks for the pending push', () => {
    spyOn(state, 'requestPush');
    state.reportFailure('task-1', { text: 'offline' });
    fixture.detectChanges();
    expect(text()).toContain('F.ISSUE.SYNC_STATE.COULD_NOT_SYNC');
    button()!.click();
    expect(state.requestPush).toHaveBeenCalledOnceWith('task-1', false);
  });

  it('shows "no longer in your list" without Retry, over a failure', () => {
    state.reportFailure('task-1', { text: 'offline' });
    state.setMissing(['task-1'], ['task-1']);
    fixture.detectChanges();
    expect(text()).toContain('PLAINSPACE.SYNC.NOT_IN_LIST');
    expect(button()).toBeNull();
  });

  it('ignores the state of other tasks', () => {
    state.reportFailure('task-2', { text: 'offline' });
    fixture.detectChanges();
    expect(text()).toBe('');
  });
});
