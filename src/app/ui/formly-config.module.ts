import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MarkdownModule } from 'ngx-markdown';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FORMLY_CONFIG, FormlyModule } from '@ngx-formly/core';
import { InputDurationFormlyComponent } from './duration/input-duration-formly/input-duration-formly.component';
import { ValidationModule } from './validation/validation.module';
import { TranslateService } from '@ngx-translate/core';
import { FormlyMaterialModule } from '@ngx-formly/material';
import { FormlyJsonschema } from '@ngx-formly/core/json-schema';
import { registerTranslateExtension } from './formly-translate-extension/formly-translate-extension';
import { FormlyTranslatedTemplateComponent } from './formly-translated-template/formly-translated-template.component';
import { FormlyMatToggleModule } from '@ngx-formly/material/toggle';
import { FormlyLinkWidgetComponent } from './formly-link-widget/formly-link-widget.component';
import { FormlyMatDatepickerModule } from '@ngx-formly/material/datepicker';
import { FormlyCollapsibleComponent } from './formly-collapsible/formly-collapsible.component';
import { KeyboardInputComponent } from '../features/config/keyboard-input/keyboard-input.component';
import { IconInputComponent } from '../features/config/icon-input/icon-input.component';
import { SelectProjectComponent } from '../features/config/select-project/select-project.component';
import { RepeatSectionTypeComponent } from '../features/config/repeat-section-type/repeat-section-type.component';
import { FormlySliderComponent } from './formly-slider/formly-slider.component';
import { FormlyTagSelectionComponent } from './formly-tag-selection/formly-tag-selection.component';
import { FormlyBtnComponent } from './formly-button/formly-btn.component';
import { FormlyImageInputComponent } from './formly-image-input/formly-image-input.component';
import { ColorInputComponent } from '../features/config/color-input/color-input.component';
import { FormlySlideToggleComponent } from './formly-slide-toggle/formly-slide-toggle.component';
import { FormlyDatePickerComponent } from './formly-date-picker/formly-date-picker.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    FormlySliderComponent,
    ReactiveFormsModule,
    FormlyModule.forRoot({
      validationMessages: [
        { name: 'pattern', message: 'Invalid input' },
        { name: 'required', message: 'This field is required' },
        { name: 'min', message: 'Value is too low' },
        { name: 'max', message: 'Value is too high' },
        { name: 'minLength', message: 'Value is too short' },
        { name: 'maxLength', message: 'Value is too long' },
      ],
      types: [
        { name: 'slider', component: FormlySliderComponent },
        { name: 'link', component: FormlyLinkWidgetComponent },
        { name: 'slide-toggle', component: FormlySlideToggleComponent },
        {
          name: 'duration',
          component: InputDurationFormlyComponent,
          extends: 'input',
          wrappers: ['form-field'],
        },
        {
          name: 'tpl',
          component: FormlyTranslatedTemplateComponent,
        },
        { name: 'collapsible', component: FormlyCollapsibleComponent, wrappers: [] },
        { name: 'btn', component: FormlyBtnComponent, wrappers: [] },
        {
          name: 'keyboard',
          component: KeyboardInputComponent,
          extends: 'input',
          wrappers: ['form-field'],
        },
        {
          name: 'icon',
          component: IconInputComponent,
          extends: 'input',
          wrappers: ['form-field'],
        },
        {
          name: 'color',
          component: ColorInputComponent,
        },
        {
          name: 'project-select',
          component: SelectProjectComponent,
          // technically no input, but as the properties get us what we need...
          extends: 'input',
          wrappers: ['form-field'],
        },
        {
          name: 'tag-select',
          component: FormlyTagSelectionComponent,
          // technically no input, but as the properties get us what we need...
          extends: 'input',
          wrappers: ['form-field'],
        },
        {
          name: 'repeat',
          component: RepeatSectionTypeComponent,
        },
        {
          name: 'image-input',
          component: FormlyImageInputComponent,
          extends: 'input',
          wrappers: ['form-field'],
        },
        {
          name: 'date',
          component: FormlyDatePickerComponent,
        },
      ],
      extras: {
        immutable: true,
        // Show errors when field is touched or form is submitted
        showError: (field) => {
          return !!(
            field.formControl &&
            field.formControl.invalid &&
            (field.formControl.touched || field.options?.parentForm?.submitted)
          );
        },
      },
    }),
    FormlyMatToggleModule,
    FormlyMaterialModule,
    // my modules
    // might be needed for formly to pick up on directives
    ValidationModule,
    FormlyLinkWidgetComponent,
    FormlyMatDatepickerModule,
  ],
  exports: [
    FormlyMaterialModule,
    FormlyModule,
    MarkdownModule,
    ReactiveFormsModule,
    ValidationModule,
  ],
  providers: [
    {
      provide: FORMLY_CONFIG,
      multi: true,
      useFactory: registerTranslateExtension,
      deps: [TranslateService],
    },
    FormlyJsonschema,
  ],
})
export class FormlyConfigModule {}
