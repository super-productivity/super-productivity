import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { BehaviorSubject } from 'rxjs';
import { ExactAlarmStatusService } from '../exact-alarm-status.service';
import { ExactAlarmHintComponent } from './exact-alarm-hint.component';

describe('ExactAlarmHintComponent', () => {
  let fixture: ComponentFixture<ExactAlarmHintComponent>;
  let isDenied$: BehaviorSubject<boolean>;
  let statusSpy: jasmine.SpyObj<ExactAlarmStatusService>;

  beforeEach(() => {
    isDenied$ = new BehaviorSubject(false);
    statusSpy = jasmine.createSpyObj('ExactAlarmStatusService', ['openSettings'], {
      isDenied$,
    });
    statusSpy.openSettings.and.resolveTo();

    TestBed.configureTestingModule({
      imports: [ExactAlarmHintComponent, TranslateModule.forRoot()],
      providers: [{ provide: ExactAlarmStatusService, useValue: statusSpy }],
    });
    fixture = TestBed.createComponent(ExactAlarmHintComponent);
    fixture.detectChanges();
  });

  it('renders nothing while exact alarms are allowed', () => {
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

  it('hides the hint again once the permission is granted', () => {
    isDenied$.next(true);
    fixture.detectChanges();
    isDenied$.next(false);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.callout')).toBeNull();
  });
});
