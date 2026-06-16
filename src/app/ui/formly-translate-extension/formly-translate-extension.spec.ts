import { FormlyFieldConfig } from '@ngx-formly/core';
import { of } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { TranslateExtension } from './formly-translate-extension';

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
