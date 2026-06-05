import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import {
  DialogProjectCompleteComponent,
  DialogProjectCompleteData,
} from './dialog-project-complete.component';
import { ConfettiService } from '../../../core/confetti/confetti.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { createProject } from '../project.test-helper';
import { ProjectService } from '../project.service';

describe('DialogProjectCompleteComponent', () => {
  let fixture: ComponentFixture<DialogProjectCompleteComponent>;
  let component: DialogProjectCompleteComponent;
  let confettiService: jasmine.SpyObj<ConfettiService>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<DialogProjectCompleteComponent>>;
  let projectService: jasmine.SpyObj<ProjectService>;
  let router: Router;
  let misc: { isDisableCelebration?: boolean; isDisableAnimations?: boolean };

  const data: DialogProjectCompleteData = {
    project: createProject({ id: 'project-1', title: 'Completed Project' }),
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

  beforeEach(() => {
    misc = { isDisableCelebration: false, isDisableAnimations: false };
    confettiService = jasmine.createSpyObj('ConfettiService', ['createConfettiOnCanvas']);
    confettiService.createConfettiOnCanvas.and.returnValue(Promise.resolve());
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    projectService = jasmine.createSpyObj('ProjectService', ['reopen']);

    TestBed.configureTestingModule({
      imports: [DialogProjectCompleteComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: ConfettiService, useValue: confettiService },
        { provide: GlobalConfigService, useValue: { misc: () => misc } },
        { provide: ProjectService, useValue: projectService },
      ],
    });

    fixture = TestBed.createComponent(DialogProjectCompleteComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.returnValue(Promise.resolve(true));
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

  it('closes the dialog', () => {
    component.close();

    expect(dialogRef.close).toHaveBeenCalled();
  });

  it('closes and navigates to completed projects', () => {
    component.viewCompleted();

    expect(dialogRef.close).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/archived-projects');
  });

  it('closes and reopens the project from Undo', () => {
    component.undo();

    expect(dialogRef.close).toHaveBeenCalled();
    expect(projectService.reopen).toHaveBeenCalledWith('project-1', data.project);
  });
});
