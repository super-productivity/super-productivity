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
    const trigger = document.createElement('button');

    component.open(event, true, trigger);

    expect(innerMenu.open as jasmine.Spy).toHaveBeenCalledWith(event, true, trigger);
    expect(component.isOpen()).toBeTrue();
  });

  it('closes without scheduling a second focus handoff', fakeAsync(() => {
    const trigger = document.createElement('button');
    const focusSpy = spyOn(trigger, 'focus');
    document.body.append(trigger);

    component.open(undefined, false, trigger);
    component.onClose();
    tick();

    expect(component.isOpen()).toBeFalse();
    expect(focusSpy).not.toHaveBeenCalled();

    trigger.remove();
  }));
});
