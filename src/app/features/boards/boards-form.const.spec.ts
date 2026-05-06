import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UntypedFormGroup } from '@angular/forms';
import {
  FieldType,
  FormlyFieldConfig,
  FormlyFormBuilder,
  FormlyModule,
} from '@ngx-formly/core';
import { BOARDS_FORM } from './boards-form.const';
import { DEFAULT_BOARDS, DEFAULT_PANEL_CFG } from './boards.const';
import { BoardPanelCfg } from './boards.model';

@Component({ selector: 'noop-formly-field', template: '', standalone: true })
class NoopFormlyFieldComponent extends FieldType {}

/**
 * Regression for #7380. Editing a default Eisenhower Matrix board left the
 * Save button disabled. Two compounding issues:
 *
 * 1. `defaultValue` was set inside `props` for the conditionally-required
 *    radios, but Formly only reads `field.defaultValue`. So the model never
 *    got `'all'`/`'any'` and `required: true` fails the form on open for
 *    any panel with >=2 included or excluded tags.
 * 2. Even with `defaultValue` lifted to field level, Formly skips the
 *    default for fields hidden at init AND when they later become visible
 *    (only `resetOnHide: true` triggers the late-apply path).
 *
 * The test exercises the inner panel fieldGroup directly so we don't need
 * the custom `repeat`/material widgets registered.
 */
describe('BOARDS_FORM panel behavior (#7380)', () => {
  const TYPE_STUBS = [
    'input',
    'select',
    'radio',
    'checkbox',
    'tag-select',
    'project-select',
    'repeat',
  ].map((name) => ({ name, component: NoopFormlyFieldComponent }));

  let builder: FormlyFormBuilder;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NoopFormlyFieldComponent, FormlyModule.forRoot({ types: TYPE_STUBS })],
    });
    builder = TestBed.inject(FormlyFormBuilder);
  });

  const panelFieldGroup = (): FormlyFieldConfig[] => {
    const panels = BOARDS_FORM.find((f) => f.key === 'panels')!;
    const fieldArray = panels.fieldArray as FormlyFieldConfig;
    // Deep clone so each test gets isolated field state.
    return JSON.parse(JSON.stringify(fieldArray.fieldGroup));
  };

  const eisenhowerPanel = (idx: number): BoardPanelCfg => {
    const src = DEFAULT_BOARDS.find((b) => b.id === 'EISENHOWER_MATRIX')!;
    return { ...DEFAULT_PANEL_CFG, ...src.panels[idx] };
  };

  const buildPanelForm = (
    panel: BoardPanelCfg,
  ): { form: UntypedFormGroup; fields: FormlyFieldConfig[]; model: BoardPanelCfg } => {
    const fields = panelFieldGroup();
    const form = new UntypedFormGroup({});
    const model = JSON.parse(JSON.stringify(panel));
    builder.buildForm(form, fields, model, {});
    return { form, fields, model };
  };

  const fieldByKey = (
    fields: FormlyFieldConfig[],
    key: keyof BoardPanelCfg,
  ): FormlyFieldConfig => fields.find((f) => f.key === key)!;

  it('starts valid for the URGENT_AND_IMPORTANT panel (2 included tags)', () => {
    const { form, model } = buildPanelForm(eisenhowerPanel(0));
    expect(form.valid).toBe(true);
    // includedTagsMatch is visible at init (length 2) so its defaultValue
    // ('all') is applied normally.
    expect(model.includedTagsMatch).toBe('all');
  });

  it('keeps the form valid after picking a sortBy (sortDir gets its default)', () => {
    const { form, fields, model } = buildPanelForm(eisenhowerPanel(0));
    expect(form.valid).toBe(true);

    const sortBy = fieldByKey(fields, 'sortBy');
    sortBy.formControl!.setValue('dueDate');
    model.sortBy = 'dueDate';

    // Re-evaluate hide expressions — what `(modelChange)` triggers in the
    // running dialog. `checkExpressions` walks the tree and flips hide.
    const opts = sortBy.options as any;
    opts.checkExpressions({ fieldGroup: fields, options: opts });

    expect(model.sortDir).toBe('asc');
    expect(form.valid).toBe(true);
  });

  it('clears sortDir and stays valid when sortBy reverts to manual', () => {
    const { form, fields, model } = buildPanelForm(eisenhowerPanel(0));
    const sortBy = fieldByKey(fields, 'sortBy');
    const opts = sortBy.options as any;

    sortBy.formControl!.setValue('dueDate');
    model.sortBy = 'dueDate';
    opts.checkExpressions({ fieldGroup: fields, options: opts });
    expect(model.sortDir).toBe('asc');

    sortBy.formControl!.setValue(null);
    model.sortBy = undefined;
    opts.checkExpressions({ fieldGroup: fields, options: opts });

    expect(model.sortDir).toBeUndefined();
    expect(form.valid).toBe(true);
  });

  it('reveals includedTagsMatch with its default when a 2nd tag is added', () => {
    // Single-tag panel: includedTagsMatch is hidden at init.
    const { form, fields, model } = buildPanelForm(eisenhowerPanel(2));
    expect(form.valid).toBe(true);
    expect(model.includedTagsMatch).toBeUndefined();

    const includedTagIds = fieldByKey(fields, 'includedTagIds');
    const opts = includedTagIds.options as any;
    const next = [...(model.includedTagIds ?? []), 'extra-tag'];
    includedTagIds.formControl!.setValue(next);
    model.includedTagIds = next;
    opts.checkExpressions({ fieldGroup: fields, options: opts });

    expect(model.includedTagsMatch).toBe('all');
    expect(form.valid).toBe(true);
  });
});
