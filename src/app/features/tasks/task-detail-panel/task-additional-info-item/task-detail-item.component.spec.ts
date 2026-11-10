import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TaskDetailItemComponent } from './task-detail-item.component';

describe('TaskDetailItemComponent', () => {
  let fixture: ComponentFixture<TaskDetailItemComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaskDetailItemComponent, NoopAnimationsModule],
    }).compileComponents();
    fixture = TestBed.createComponent(TaskDetailItemComponent);
    fixture.detectChanges();
  });

  // A positive tabindex would put every detail item ahead of the rest of the
  // page in the Tab order (#8688).
  it('is focusable in document order', () => {
    expect((fixture.nativeElement as HTMLElement).tabIndex).toBe(0);
  });
});
