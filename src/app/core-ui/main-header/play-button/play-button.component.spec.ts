import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { NEVER, Observable, of, Subject } from 'rxjs';
import { Task } from '../../../features/tasks/task.model';
import { TaskService } from '../../../features/tasks/task.service';
import { MagicNavConfigService } from '../../magic-side-nav/magic-nav-config.service';
import { PlayButtonComponent } from './play-button.component';

describe('PlayButtonComponent', () => {
  let taskService: jasmine.SpyObj<TaskService>;
  let navConfigService: jasmine.SpyObj<MagicNavConfigService>;
  let component: PlayButtonComponent;

  const createComponent = (
    currentTask$: Observable<Task | null>,
    currentTaskProgress$: Observable<number>,
  ): void => {
    taskService = jasmine.createSpyObj<TaskService>('TaskService', ['toggleStartTask'], {
      currentTask$,
      currentTaskProgress$,
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
  };

  beforeEach(() => {
    createComponent(of(null), NEVER);
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

  it('draws only the latest progress when several ticks arrive before a frame', () => {
    // A hidden window runs no animation frames; ticks must not queue up until it is shown.
    TestBed.resetTestingModule();
    const frames: FrameRequestCallback[] = [];
    spyOn(window, 'requestAnimationFrame').and.callFake((cb) => frames.push(cb));
    const progress$ = new Subject<number>();
    createComponent(of({ timeEstimate: 60000 } as Task), progress$);
    const setStyle = spyOn(component['_renderer'], 'setStyle').and.callThrough();

    progress$.next(0.1);
    progress$.next(0.2);
    progress$.next(0.3);
    frames.splice(0).forEach((cb) => cb(performance.now()));

    expect(setStyle).toHaveBeenCalledOnceWith(
      jasmine.any(SVGCircleElement),
      'stroke-dashoffset',
      10 * 2 * Math.PI * -0.3,
    );
  });
});
