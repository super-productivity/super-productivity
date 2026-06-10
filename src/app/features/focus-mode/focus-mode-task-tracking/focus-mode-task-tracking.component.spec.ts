import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { FocusModeTaskTrackingComponent } from './focus-mode-task-tracking.component';
import { Task } from '../../tasks/task.model';

const mockTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 'task-1',
    title: 'My task',
    timeSpent: 90 * 60 * 1000,
    timeEstimate: 120 * 60 * 1000,
    ...overrides,
  }) as Task;

describe('FocusModeTaskTrackingComponent', () => {
  let component: FocusModeTaskTrackingComponent;
  let fixture: ComponentFixture<FocusModeTaskTrackingComponent>;
  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        FocusModeTaskTrackingComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FocusModeTaskTrackingComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('task', mockTask());
    fixture.detectChanges();
  });

  it('renders both spent and estimate when time is spent', () => {
    expect(el().querySelector('.time-wrapper')?.textContent).toContain('/');
  });

  it('omits the separator when no time is spent', () => {
    fixture.componentRef.setInput('task', mockTask({ timeSpent: 0 }));
    fixture.detectChanges();
    expect(el().querySelector('.separator')).toBeNull();
  });

  it('hides the time entirely when there is no spent or estimate', () => {
    fixture.componentRef.setInput('task', mockTask({ timeSpent: 0, timeEstimate: 0 }));
    fixture.detectChanges();
    expect(el().querySelector('.time-wrapper')).toBeNull();
  });

  it('shows the pause icon while tracking and play when paused', () => {
    fixture.componentRef.setInput('isTracking', true);
    fixture.detectChanges();
    expect(el().querySelector('mat-icon')?.textContent?.trim()).toBe('pause');

    fixture.componentRef.setInput('isTracking', false);
    fixture.detectChanges();
    expect(el().querySelector('mat-icon')?.textContent?.trim()).toBe('play_arrow');
  });

  it('emits toggleTracking when the button is clicked', () => {
    let emitted = false;
    component.toggleTracking.subscribe(() => (emitted = true));
    (el().querySelector('.play-pause-btn') as HTMLButtonElement).click();
    expect(emitted).toBe(true);
  });

  it('renders read-only (no toggle button) when showToggle is false', () => {
    fixture.componentRef.setInput('showToggle', false);
    fixture.detectChanges();
    expect(el().querySelector('.play-pause-btn')).toBeNull();
    expect(el().querySelector('.time-wrapper')).not.toBeNull();
  });
});
