import { FormlyFieldConfig } from '@ngx-formly/core';
import { of } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import {
  registerTranslateExtension,
  TranslateExtension,
} from './formly-translate-extension';
import { T } from '../../t.const';

describe('TranslateExtension', () => {
  it('passes description translate params to translated form descriptions', () => {
    const translateService = jasmine.createSpyObj<TranslateService>('TranslateService', [
      'stream',
    ]);
    translateService.stream.and.returnValue(of('translated'));
    const extension = new TranslateExtension(translateService);
    const field: FormlyFieldConfig = {
      templateOptions: {
        label: 'LABEL_KEY',
        description: 'DESCRIPTION_KEY',
        descriptionTranslateParams: { max: 200 },
        placeholder: 'PLACEHOLDER_KEY',
      },
    };

    extension.prePopulate(field);

    expect(translateService.stream).toHaveBeenCalledWith('LABEL_KEY');
    expect(translateService.stream).toHaveBeenCalledWith('DESCRIPTION_KEY', {
      max: 200,
    });
    expect(translateService.stream).toHaveBeenCalledWith('PLACEHOLDER_KEY');
  });
});

describe('min/max validation messages', () => {
  let translateService: jasmine.SpyObj<TranslateService>;

  const renderMessage = (name: 'min' | 'max', field: FormlyFieldConfig): void => {
    const option = registerTranslateExtension(translateService).validationMessages?.find(
      (m) => m.name === name,
    );
    if (typeof option?.message !== 'function') {
      throw new Error(`no '${name}' validation message registered`);
    }
    option.message({}, field);
  };

  beforeEach(() => {
    translateService = jasmine.createSpyObj<TranslateService>('TranslateService', [
      'stream',
    ]);
    translateService.stream.and.returnValue(of('translated'));
  });

  // #9349: duration bounds are milliseconds, so the raw number is unreadable.
  it('renders a duration min as a duration', () => {
    renderMessage('min', { type: 'duration', templateOptions: { min: 60000 } });

    expect(translateService.stream).toHaveBeenCalledWith(T.V.E_MIN, { val: '1m' });
  });

  it('renders a duration max as a duration', () => {
    renderMessage('max', { type: 'duration', templateOptions: { max: 5400000 } });

    expect(translateService.stream).toHaveBeenCalledWith(T.V.E_MAX, { val: '1h 30m' });
  });

  it('leaves the bound untouched for non-duration fields', () => {
    renderMessage('min', { type: 'number', templateOptions: { min: 10 } });

    expect(translateService.stream).toHaveBeenCalledWith(T.V.E_MIN, { val: 10 });
  });

  it('falls back to null when no bound is configured', () => {
    renderMessage('min', { type: 'duration', templateOptions: {} });

    expect(translateService.stream).toHaveBeenCalledWith(T.V.E_MIN, { val: null });
  });
});
