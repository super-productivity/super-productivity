import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { Component, EventEmitter, input, Output } from '@angular/core';
import { FocusModeTaskRowComponent } from './focus-mode-task-row.component';
import { TaskTitleComponent } from '../../../ui/task-title/task-title.component';
import { FocusModeTaskTrackingComponent } from '../focus-mode-task-tracking/focus-mode-task-tracking.component';
import { Task } from '../../tasks/task.model';

@Component({ selector: 'task-title', template: '', standalone: true })
class MockTaskTitleComponent {
  readonly value = input<string>('');
  @Output() valueEdited = new EventEmitter<{ newVal: string; wasChanged: boolean }>();
}

@Component({ selector: 'focus-mode-task-tracking', template: '', standalone: true })
class MockFocusModeTaskTrackingComponent {
  readonly task = input<Task | null>();
}

const mockTask = (overrides: Partial<Task> = {}): Task =>
  ({ id: 't1', title: 'My task', ...overrides }) as Task;

describe('FocusModeTaskRowComponent', () => {
  let fixture: ComponentFixture<FocusModeTaskRowComponent>;
  let component: FocusModeTaskRowComponent;
  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        FocusModeTaskRowComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
    })
      .overrideComponent(FocusModeTaskRowComponent, {
        remove: { imports: [TaskTitleComponent, FocusModeTaskTrackingComponent] },
        add: { imports: [MockTaskTitleComponent, MockFocusModeTaskTrackingComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(FocusModeTaskRowComponent);
    component = fixture.componentInstance;
  });

  it('renders the task row (switch, time, finish) when a task is set', () => {
    fixture.componentRef.setInput('task', mockTask());
    fixture.detectChanges();
    expect(el().querySelector('.task-title-row')).not.toBeNull();
    expect(el().querySelector('.task-side-btn--switch')).not.toBeNull();
    expect(el().querySelector('focus-mode-task-tracking')).not.toBeNull();
    expect(el().querySelector('.break-message')).toBeNull();
    expect(el().querySelector('.select-task-cta')).toBeNull();
  });

  it('renders the relax message when there is no task and showRelaxMessage is true', () => {
    fixture.componentRef.setInput('task', null);
    fixture.componentRef.setInput('showRelaxMessage', true);
    fixture.detectChanges();
    expect(el().querySelector('.break-message')).not.toBeNull();
    expect(el().querySelector('.task-title-row')).toBeNull();
    expect(el().querySelector('.select-task-cta')).toBeNull();
  });

  it('renders the select-task CTA when there is no task and showRelaxMessage is false', () => {
    fixture.componentRef.setInput('task', null);
    fixture.componentRef.setInput('showRelaxMessage', false);
    fixture.detectChanges();
    expect(el().querySelector('.select-task-cta')).not.toBeNull();
    expect(el().querySelector('.break-message')).toBeNull();
  });

  it('shows the parent title when provided', () => {
    fixture.componentRef.setInput('task', mockTask());
    fixture.componentRef.setInput('parentTitle', 'Parent task');
    fixture.detectChanges();
    expect(el().querySelector('.parent-title')?.textContent).toContain('Parent task');
  });

  it('emits switchTask / finishTask / selectTask on the respective clicks', () => {
    const switched = jasmine.createSpy('switchTask');
    const finished = jasmine.createSpy('finishTask');
    const selected = jasmine.createSpy('selectTask');
    component.switchTask.subscribe(switched);
    component.finishTask.subscribe(finished);
    component.selectTask.subscribe(selected);

    fixture.componentRef.setInput('task', mockTask());
    fixture.detectChanges();
    (el().querySelector('.task-side-btn--switch') as HTMLButtonElement).click();
    (
      el().querySelector('.task-end-controls .task-side-btn') as HTMLButtonElement
    ).click();
    expect(switched).toHaveBeenCalled();
    expect(finished).toHaveBeenCalled();

    fixture.componentRef.setInput('task', null);
    fixture.componentRef.setInput('showRelaxMessage', false);
    fixture.detectChanges();
    (el().querySelector('.select-task-cta') as HTMLButtonElement).click();
    expect(selected).toHaveBeenCalled();
  });
});
