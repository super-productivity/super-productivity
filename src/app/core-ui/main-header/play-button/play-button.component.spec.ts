import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { TaskService } from '../../../features/tasks/task.service';
import { MagicNavConfigService } from '../../magic-side-nav/magic-nav-config.service';
import { TrackingPresenceService } from '../../../features/tracking-presence/tracking-presence.service';
import { RemoteSessionView } from '../../../features/tracking-presence/tracking-presence.model';
import { PlayButtonComponent } from './play-button.component';

const remoteView = (showStop: boolean): RemoteSessionView =>
  ({
    session: { payload: { deviceLabel: 'Pixel 8' } },
    showStop,
  }) as unknown as RemoteSessionView;

describe('PlayButtonComponent', () => {
  let taskService: jasmine.SpyObj<TaskService>;
  let navConfigService: jasmine.SpyObj<MagicNavConfigService>;
  let component: PlayButtonComponent;
  let fixture: ComponentFixture<PlayButtonComponent>;
  let remoteSessionView: ReturnType<typeof signal<RemoteSessionView | null>>;

  beforeEach(() => {
    taskService = jasmine.createSpyObj<TaskService>('TaskService', ['toggleStartTask'], {
      currentTask$: of(null),
      currentTaskProgress$: of(0),
    });
    navConfigService = jasmine.createSpyObj<MagicNavConfigService>(
      'MagicNavConfigService',
      ['disableFeature'],
    );

    remoteSessionView = signal<RemoteSessionView | null>(null);

    TestBed.configureTestingModule({
      imports: [PlayButtonComponent, TranslateModule.forRoot(), NoopAnimationsModule],
      providers: [
        { provide: TaskService, useValue: taskService },
        { provide: MagicNavConfigService, useValue: navConfigService },
        { provide: TrackingPresenceService, useValue: { remoteSessionView } },
      ],
    });
    fixture = TestBed.createComponent(PlayButtonComponent);
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

  describe('remote tracking indicator', () => {
    const wrapper = (): HTMLElement =>
      fixture.nativeElement.querySelector('.play-btn-wrapper');
    const badge = (): HTMLElement | null =>
      fixture.nativeElement.querySelector('.remote-badge');

    it('marks the button when another device is actively tracking', () => {
      remoteSessionView.set(remoteView(true));
      fixture.detectChanges();

      expect(wrapper().classList).toContain('isRemote');
      expect(badge()).not.toBeNull();
      expect(component.remoteDeviceLabel()).toBe('Pixel 8');
    });

    it('stays plain when the remote session is stale or not tracking', () => {
      remoteSessionView.set(remoteView(false));
      fixture.detectChanges();

      expect(wrapper().classList).not.toContain('isRemote');
      expect(badge()).toBeNull();
    });

    it('stays plain when no other device tracks', () => {
      expect(wrapper().classList).not.toContain('isRemote');
      expect(badge()).toBeNull();
    });

    it('names the tracking device in the tooltip and aria-label', () => {
      const translate = TestBed.inject(TranslateService);
      translate.setTranslation('en', {
        F: { TRACKING_PRESENCE: { PLAY_BTN: { TOOLTIP: 'Tracking on {{device}}' } } },
      });
      translate.use('en');
      remoteSessionView.set(remoteView(true));
      fixture.detectChanges();

      const btn: HTMLElement = fixture.nativeElement.querySelector('.play-btn');
      expect(btn.getAttribute('aria-label')).toBe('Tracking on Pixel 8');
    });

    it('stays plain while the button is disabled, as no takeover is possible', () => {
      fixture.componentRef.setInput('hasTrackableTasks', false);
      remoteSessionView.set(remoteView(true));
      fixture.detectChanges();

      expect(wrapper().classList).not.toContain('isRemote');
      expect(badge()).toBeNull();
    });
  });
});
