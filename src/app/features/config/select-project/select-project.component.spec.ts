import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { FormControl } from '@angular/forms';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { TranslateService } from '@ngx-translate/core';
import { SelectProjectComponent, SelectProjectProps } from './select-project.component';
import { ProjectService } from '../../project/project.service';
import { MenuTreeService } from '../../menu-tree/menu-tree.service';
import { Project } from '../../project/project.model';

const project = (id: string, title: string): Project =>
  ({ id, title, icon: 'list_alt' }) as Project;

const PROJECTS = [project('p-1', 'Mlsna'), project('p-2', 'Second')];

describe('SelectProjectComponent', () => {
  let fixture: ComponentFixture<SelectProjectComponent>;
  let component: SelectProjectComponent;

  /** Attach a formly field + control, the way the formly wrapper would. */
  const setUp = (
    props: Partial<SelectProjectProps>,
    value: string | string[] | false,
  ): void => {
    const formControl = new FormControl(value);
    component.field = {
      key: 'defaultProjectId',
      formControl,
      props: props as SelectProjectProps,
    } as FormlyFieldConfig<SelectProjectProps>;
    component.ngOnInit();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SelectProjectComponent],
      providers: [
        { provide: ProjectService, useValue: { listInTreeOrder$: of(PROJECTS) } },
        { provide: MenuTreeService, useValue: { projectFolderMap: () => new Map() } },
        {
          provide: TranslateService,
          useValue: { instant: (key: string) => key, get: () => of('') },
        },
      ],
    })
      // The template pulls in Material + select-option-row; these tests are about
      // the trigger label the component computes, not the rendering.
      .overrideComponent(SelectProjectComponent, { set: { template: '', imports: [] } })
      .compileComponents();

    fixture = TestBed.createComponent(SelectProjectComponent);
    component = fixture.componentInstance;
  });

  describe('single select', () => {
    // Each option renders a `select-option-row` (icon + title). With no explicit
    // `mat-select-trigger`, Material falls back to the option's text content —
    // which includes the mat-icon ligature, so a chosen project displayed as
    // "list_alt Mlsna".
    it('shows the project title alone', () => {
      setUp({}, 'p-1');
      expect(component.triggerLabel()).toBe('Mlsna');
    });

    it('leaves the empty selection to Material, which renders "None" itself', () => {
      setUp({}, '');
      expect(component.triggerLabel()).toBeNull();
    });

    it('leaves the `false` default alone', () => {
      // ISSUE_PROVIDER_FF_DEFAULT_PROJECT uses `defaultValue: false`.
      setUp({}, false);
      expect(component.triggerLabel()).toBeNull();
    });

    it('overrides nothing while the id matches no known project', () => {
      // e.g. a deleted project still referenced by a saved provider.
      setUp({}, 'p-gone');
      expect(component.triggerLabel()).toBeNull();
    });

    it('follows the control when the selection changes', () => {
      setUp({}, 'p-1');
      component.field.formControl!.setValue('p-2');
      expect(component.triggerLabel()).toBe('Second');
    });
  });

  describe('multi select', () => {
    it('joins the selected titles', () => {
      setUp({ multiple: true }, ['p-1', 'p-2']);
      expect(component.triggerLabel()).toBe('Mlsna, Second');
    });

    it('reports the default label when the "all" entry is selected', () => {
      setUp({ multiple: true, defaultLabel: 'ALL_PROJECTS' }, ['', 'p-1']);
      expect(component.triggerLabel()).toBe('ALL_PROJECTS');
    });

    it('renders nothing when nothing is selected', () => {
      setUp({ multiple: true }, []);
      expect(component.triggerLabel()).toBeNull();
    });

    it('skips ids that match no project', () => {
      setUp({ multiple: true }, ['p-1', 'p-gone']);
      expect(component.triggerLabel()).toBe('Mlsna');
    });
  });
});
