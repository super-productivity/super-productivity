import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { TaskService } from '../../../features/tasks/task.service';
import { MagicNavConfigService } from '../../magic-side-nav/magic-nav-config.service';
import { PlayButtonComponent } from './play-button.component';

describe('PlayButtonComponent', () => {
  let taskService: jasmine.SpyObj<TaskService>;
  let navConfigService: jasmine.SpyObj<MagicNavConfigService>;
  let component: PlayButtonComponent;

  beforeEach(() => {
    taskService = jasmine.createSpyObj<TaskService>('TaskService', ['toggleStartTask'], {
      currentTask$: of(null),
      currentTaskProgress$: of(0),
    });
    navConfigService = jasmine.createSpyObj<MagicNavConfigService>(
      'MagicNavConfigService',
      ['disableFeature'],
    );

    TestBed.configureTestingModule({
      imports: [PlayButtonComponent, TranslateModule.forRoot(), NoopAnimationsModule],
      providers: [
        { provide: TaskService, useValue: taskService },
        { provide: MagicNavConfigService, useValue: navConfigService },
      ],
    });
    const fixture = TestBed.createComponent(PlayButtonComponent);
    fixture.detectChanges();
    component = fixture.componentInstance;
  });

  it('toggles tracking on a normal click', () => {
    component.onPlayPointerDown();
    component.onPlayClick();
    expect(taskService.toggleStartTask).toHaveBeenCalledTimes(1);
  });

  it('ignores the click that ends a long press', () => {
    component.onPlayPointerDown();
    component.onLongPress();
    component.onPlayClick();
    expect(taskService.toggleStartTask).not.toHaveBeenCalled();
  });

  it('does not swallow the next tap when the long press ended without a click', () => {
    // e.g. the menu backdrop took the release, then the menu was closed
    component.onPlayPointerDown();
    component.onLongPress();

    component.onPlayPointerDown();
    component.onPlayClick();
    expect(taskService.toggleStartTask).toHaveBeenCalledTimes(1);
  });

  it('disables time tracking like the side nav disables its features', () => {
    component.disableTimeTracking();
    expect(navConfigService.disableFeature).toHaveBeenCalledOnceWith(
      'isTimeTrackingEnabled',
      jasmine.any(String),
    );
  });
});
