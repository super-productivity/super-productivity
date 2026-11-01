import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { BehaviorSubject } from 'rxjs';
import { ReminderOverlayPermissionStatusService } from '../reminder-overlay-permission-status.service';
import { ReminderOverlayHintComponent } from './reminder-overlay-hint.component';

describe('ReminderOverlayHintComponent', () => {
  let fixture: ComponentFixture<ReminderOverlayHintComponent>;
  let isDenied$: BehaviorSubject<boolean>;
  let statusSpy: jasmine.SpyObj<ReminderOverlayPermissionStatusService>;

  beforeEach(() => {
    isDenied$ = new BehaviorSubject(false);
    statusSpy = jasmine.createSpyObj(
      'ReminderOverlayPermissionStatusService',
      ['openSettings'],
      { isDenied$ },
    );

    TestBed.configureTestingModule({
      imports: [ReminderOverlayHintComponent, TranslateModule.forRoot()],
      providers: [
        { provide: ReminderOverlayPermissionStatusService, useValue: statusSpy },
      ],
    });
    fixture = TestBed.createComponent(ReminderOverlayHintComponent);
    fixture.detectChanges();
  });

  it('renders nothing while the overlay permission is granted', () => {
    expect(fixture.nativeElement.querySelector('.callout')).toBeNull();
  });

  it('shows the hint and opens settings only on click', () => {
    isDenied$.next(true);
    fixture.detectChanges();

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(fixture.nativeElement.querySelector('.callout')).not.toBeNull();
    expect(statusSpy.openSettings).not.toHaveBeenCalled();

    button.click();
    expect(statusSpy.openSettings).toHaveBeenCalledTimes(1);
  });

  it('hides the hint after returning from settings with the permission granted', () => {
    isDenied$.next(true);
    fixture.detectChanges();
    isDenied$.next(false);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.callout')).toBeNull();
  });
});
