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
import { WorkContextThemeCfg } from '../work-context.model';

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

  it('should write an empty theme back as the default theme on cancel', () => {
    const entity = { ...DEFAULT_PROJECT, id: 'p1', theme: {} } as unknown as Project;

    setup({ isProject: true, entity }).cancelEdit();

    expect(projectService.update).toHaveBeenCalledWith(
      'p1',
      jasmine.objectContaining({ theme: DEFAULT_PROJECT.theme }),
      true,
    );
  });

  it('should write a theme holding only undefined values back as the default on cancel', () => {
    // Older versions of this dialog stored this for a theme-less tag without a
    // color; sync JSON drops it to `{}`.
    const entity = {
      ...DEFAULT_TAG,
      id: 't1',
      color: undefined,
      theme: { primary: undefined },
    } as unknown as Tag;

    setup({ isProject: false, entity }).cancelEdit();

    expect(tagService.updateTag).toHaveBeenCalledWith(
      't1',
      jasmine.objectContaining({ theme: DEFAULT_TAG.theme }),
    );
  });

  it('should write a partial theme back unchanged on cancel', () => {
    // Legacy TODAY theme from before `isDisableBackgroundTint` existed: merging
    // TODAY's default into it would switch the background tint off.
    const legacyTheme: WorkContextThemeCfg = {
      isAutoContrast: true,
      primary: TODAY_TAG.theme.primary,
      huePrimary: '400',
    };
    const entity = { ...TODAY_TAG, theme: legacyTheme } as unknown as Tag;

    setup({ isProject: false, entity }).cancelEdit();

    const written = tagService.updateTag.calls.mostRecent().args[1].theme;
    expect(written).toEqual(legacyTheme);
    expect(written).not.toEqual(
      jasmine.objectContaining({ isDisableBackgroundTint: true }),
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
