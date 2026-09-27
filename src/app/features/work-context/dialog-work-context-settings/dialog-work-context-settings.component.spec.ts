import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import {
  DialogWorkContextSettingsComponent,
  WorkContextSettingsDialogData,
} from './dialog-work-context-settings.component';
import { ProjectService } from '../../project/project.service';
import { TagService } from '../../tag/tag.service';
import { SnackService } from '../../../core/snack/snack.service';
import { DEFAULT_PROJECT } from '../../project/project.const';
import { DEFAULT_TAG, TODAY_TAG } from '../../tag/tag.const';
import { Project } from '../../project/project.model';
import { Tag } from '../../tag/tag.model';

describe('DialogWorkContextSettingsComponent', () => {
  let projectService: jasmine.SpyObj<ProjectService>;
  let tagService: jasmine.SpyObj<TagService>;

  const setup = (
    data: WorkContextSettingsDialogData,
  ): DialogWorkContextSettingsComponent => {
    projectService = jasmine.createSpyObj<ProjectService>('ProjectService', ['update']);
    tagService = jasmine.createSpyObj<TagService>('TagService', ['updateTag']);
    TestBed.configureTestingModule({
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: ProjectService, useValue: projectService },
        { provide: TagService, useValue: tagService },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
        {
          provide: MatDialogRef,
          useValue: jasmine.createSpyObj('MatDialogRef', ['close']),
        },
      ],
    });
    return TestBed.runInInjectionContext(() => new DialogWorkContextSettingsComponent());
  };

  it('should write the default theme when cancelling on a project without one', () => {
    const entity = {
      ...DEFAULT_PROJECT,
      id: 'p1',
      theme: undefined,
    } as unknown as Project;

    setup({ isProject: true, entity }).cancelEdit();

    expect(projectService.update).toHaveBeenCalledWith(
      'p1',
      jasmine.objectContaining({ theme: DEFAULT_PROJECT.theme }),
      true,
    );
  });

  it('should write the TODAY theme when renaming the TODAY tag without one', () => {
    const entity = { ...TODAY_TAG, theme: undefined } as unknown as Tag;
    const dialog = setup({ isProject: false, entity });

    dialog.onModelChange({ ...dialog.entityData, title: 'Renamed' });

    expect(tagService.updateTag).toHaveBeenCalledWith(
      'TODAY',
      jasmine.objectContaining({ theme: TODAY_TAG.theme }),
    );
  });

  it('should keep a coloured tag without a theme following its color when renaming', () => {
    const entity = {
      ...DEFAULT_TAG,
      id: 't1',
      color: '#123456',
      theme: undefined,
    } as unknown as Tag;
    const dialog = setup({ isProject: false, entity });

    dialog.onModelChange({ ...dialog.entityData, title: 'Renamed' });

    expect(tagService.updateTag).toHaveBeenCalledWith(
      't1',
      jasmine.objectContaining({ theme: DEFAULT_TAG.theme }),
    );
  });
});
