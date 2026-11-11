import { ChangeDetectionStrategy, Component, DebugElement, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { CdkDragStart, DragRef } from '@angular/cdk/drag-drop';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { ScheduleDayOverdueComponent } from './schedule-day-overdue.component';
import { PlannerTaskComponent } from '../../planner/planner-task/planner-task.component';
import { ScheduleExternalDragService } from '../schedule-week/schedule-external-drag.service';
import { TaskService } from '../../tasks/task.service';
import { TaskCopy, TaskWithSubTasks } from '../../tasks/task.model';

// The real card needs half the app; the list only has to hand it a task.
@Component({
  selector: 'planner-task',
  template: '{{ task().title }}',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class PlannerTaskStubComponent {
  readonly task = input.required<TaskCopy>();
}

describe('ScheduleDayOverdueComponent', () => {
  const tasks = [
    { id: 'a', title: 'Call Anna' },
    { id: 'b', title: 'Write report' },
  ] as TaskCopy[];
  const taskWithSubTasks = { id: 'a', subTasks: [] } as unknown as TaskWithSubTasks;

  let fixture: ComponentFixture<ScheduleDayOverdueComponent>;
  let component: ScheduleDayOverdueComponent;
  let externalDragService: ScheduleExternalDragService;
  let el: HTMLElement;

  const cardTitles = (): string[] =>
    Array.from(el.querySelectorAll('planner-task')).map((c) => c.textContent!.trim());

  // The cards are loaded on first opening, hence async.
  const expand = async (): Promise<DebugElement> => {
    el.querySelector<HTMLElement>('.collapsible-header')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.debugElement;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        ScheduleDayOverdueComponent,
        TranslateModule.forRoot(),
        NoopAnimationsModule,
      ],
      providers: [
        {
          provide: TaskService,
          useValue: { getByIdWithSubTaskData$: () => of(taskWithSubTasks) },
        },
      ],
    });
    TestBed.overrideComponent(ScheduleDayOverdueComponent, {
      remove: { imports: [PlannerTaskComponent] },
      add: { imports: [PlannerTaskStubComponent] },
    });
    TestBed.inject(TranslateService).setTranslation('en', {
      G: { OVERDUE: 'From previous days' },
    });
    TestBed.inject(TranslateService).use('en');
    externalDragService = TestBed.inject(ScheduleExternalDragService);

    fixture = TestBed.createComponent(ScheduleDayOverdueComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('tasks', tasks);
    fixture.detectChanges();
    el = fixture.nativeElement;
  });

  it('is one collapsed line with the number of tasks', () => {
    expect(el.querySelector('.collapsible-title')!.textContent!.trim()).toBe(
      'From previous days',
    );
    expect(el.querySelector('.collapsible-count')!.textContent!.trim()).toBe('2');
    expect(cardTitles()).toEqual([]);
  });

  it('lists the tasks once its header is clicked', async () => {
    await expand();

    expect(component.isExpanded()).toBe(true);
    expect(cardTitles()).toEqual(['Call Anna', 'Write report']);
  });

  it('hands a dragged card to the schedule panel, with its subtasks', async () => {
    const dragRef = {} as DragRef;
    const firstCard = (await expand()).query(By.css('planner-task'));

    firstCard.triggerEventHandler('cdkDragStarted', {
      source: { _dragRef: dragRef },
    } as unknown as CdkDragStart);

    expect(externalDragService.activeTask()).toBe(taskWithSubTasks);
    expect(externalDragService.activeDragRef()).toBe(dragRef);

    firstCard.triggerEventHandler('cdkDragEnded');

    expect(externalDragService.activeTask()).toBeNull();
  });

  it('clears the cancel-next-drop flag the panel sets when it places a card', async () => {
    externalDragService.setCancelNextDrop(true);

    (await expand()).query(By.css('.tasks')).triggerEventHandler('cdkDropListDropped');

    expect(externalDragService.isCancelNextDrop()).toBe(false);
  });
});
