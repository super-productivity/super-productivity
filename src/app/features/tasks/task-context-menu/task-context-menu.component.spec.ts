import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { TaskContextMenuComponent } from './task-context-menu.component';
import { TaskContextMenuInnerComponent } from './task-context-menu-inner/task-context-menu-inner.component';
import { DEFAULT_TASK, Task } from '../task.model';

describe('TaskContextMenuComponent', () => {
  let component: TaskContextMenuComponent;
  let fixture: ComponentFixture<TaskContextMenuComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaskContextMenuComponent],
    })
      .overrideComponent(TaskContextMenuComponent, {
        set: { template: '', imports: [] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(TaskContextMenuComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('task', {
      ...DEFAULT_TASK,
      id: 'task-id',
    } as Task);
    fixture.detectChanges();
  });

  it('forwards keyboard activation to the inner menu through the view child', () => {
    const innerMenu = jasmine.createSpyObj<TaskContextMenuInnerComponent>('innerMenu', [
      'open',
    ]);
    (
      component as unknown as {
        taskContextMenuInner: () => TaskContextMenuInnerComponent;
      }
    ).taskContextMenuInner = () => innerMenu;
    const event = new MouseEvent('click');

    component.open(event, true);

    expect(innerMenu.open).toHaveBeenCalledWith(event, true);
    expect(component.isOpen()).toBeTrue();
  });

  it('restores focus to the supplied trigger after the inner menu closes', fakeAsync(() => {
    const trigger = document.createElement('button');
    const taskRow = document.createElement('button');
    document.body.append(taskRow, trigger);

    component.open(undefined, false, trigger);
    setTimeout(() => taskRow.focus());
    component.onClose();
    tick();

    expect(component.isOpen()).toBeFalse();
    expect(document.activeElement).toBe(trigger);

    taskRow.remove();
    trigger.remove();
  }));
});
