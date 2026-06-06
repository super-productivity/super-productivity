import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import {
  DialogProjectCompleteComponent,
  DialogProjectCompleteData,
} from './dialog-project-complete.component';
import { ConfettiService } from '../../../core/confetti/confetti.service';
import { ConfettiInstance } from '../../../core/confetti/confetti.model';
import { GlobalConfigService } from '../../config/global-config.service';
import { createProject } from '../project.test-helper';
import { GlobalThemeService } from '../../../core/theme/global-theme.service';

describe('DialogProjectCompleteComponent', () => {
  let fixture: ComponentFixture<DialogProjectCompleteComponent>;
  let component: DialogProjectCompleteComponent;
  let confettiService: jasmine.SpyObj<ConfettiService>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<DialogProjectCompleteComponent>>;
  let misc: { isDisableCelebration?: boolean; isDisableAnimations?: boolean };
  let isDarkTheme: WritableSignal<boolean>;

  let data: DialogProjectCompleteData;

  beforeEach(() => {
    misc = { isDisableCelebration: false, isDisableAnimations: false };
    isDarkTheme = signal(false);
    data = {
      project: createProject({
        id: 'project-1',
        title: 'Completed Project',
        theme: {
          primary: '#123456',
          backgroundImageLight:
            'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
          backgroundImageDark:
            'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
          backgroundOverlayOpacity: 65,
          backgroundImageBlur: 4,
        },
      }),
      stats: {
        nrOfTasksDone: 2,
        nrOfTasksTotal: 2,
        timeSpent: 0,
        nrOfDaysWorked: 0,
        startedOn: null,
        doneOn: new Date(2026, 5, 5).getTime(),
        durationDays: 0,
      },
    };
    confettiService = jasmine.createSpyObj('ConfettiService', ['createConfettiOnCanvas']);
    confettiService.createConfettiOnCanvas.and.returnValue(Promise.resolve(undefined));
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);

    TestBed.configureTestingModule({
      imports: [DialogProjectCompleteComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: ConfettiService, useValue: confettiService },
        { provide: GlobalConfigService, useValue: { misc: () => misc } },
        { provide: GlobalThemeService, useValue: { isDarkTheme } },
      ],
    });

    fixture = TestBed.createComponent(DialogProjectCompleteComponent);
    component = fixture.componentInstance;
  });

  it('creates confetti on the component canvas', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    expect(confettiService.createConfettiOnCanvas).toHaveBeenCalledWith(
      jasmine.any(HTMLCanvasElement),
      jasmine.objectContaining({ particleCount: 160 }),
    );
  });

  it('does not create confetti when celebration is disabled', async () => {
    misc.isDisableCelebration = true;

    fixture.detectChanges();
    await fixture.whenStable();

    expect(confettiService.createConfettiOnCanvas).not.toHaveBeenCalled();
  });

  it('resets confetti that finishes loading after the dialog is destroyed', async () => {
    const resetSpy = jasmine.createSpy('reset');
    const instance: ConfettiInstance = Object.assign(() => Promise.resolve(), {
      reset: resetSpy,
    });
    confettiService.createConfettiOnCanvas.and.returnValue(Promise.resolve(instance));

    fixture.detectChanges(); // kicks off ngAfterViewInit's async confetti load
    component.ngOnDestroy(); // dialog closed before the load resolves
    await fixture.whenStable();

    expect(resetSpy).toHaveBeenCalled();
  });

  it('uses the completed project background image and theme values', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    // Background image now resolves asynchronously; flush the resolved signal
    // into the DOM before asserting.
    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;
    const overlay = nativeElement.querySelector('.complete-overlay') as HTMLElement;
    const bgImage = nativeElement.querySelector('.project-bg-image') as HTMLElement;
    const bgOverlay = nativeElement.querySelector('.project-bg-overlay') as HTMLElement;

    expect(overlay.style.getPropertyValue('--project-complete-primary')).toBe('#123456');
    expect(bgImage.style.background).toContain('data:image/gif');
    expect(bgImage.style.filter).toBe('blur(4px)');
    expect(bgImage.classList).toContain('is-blurred');
    expect(bgOverlay.style.opacity).toBe('0.65');
  });

  it('closes the dialog', () => {
    component.close();

    expect(dialogRef.close).toHaveBeenCalled();
  });

  it('renders only a close action', () => {
    fixture.detectChanges();

    const actionButtons = fixture.debugElement.queryAll(By.css('.actions button'));

    expect(actionButtons.length).toBe(1);
  });
});
