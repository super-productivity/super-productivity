import { AZURE_DEVOPS_CONFIG_FORM_SECTION } from './azure-devops-cfg-form.const';
import { AZURE_DEVOPS_MAX_WORK_ITEM_LIMIT } from './azure-devops.const';

describe('AZURE_DEVOPS_CONFIG_FORM_SECTION', () => {
  it('does not require a separate organization field when host is the full Azure DevOps URL (#7672)', () => {
    const fields = AZURE_DEVOPS_CONFIG_FORM_SECTION.items ?? [];
    const keys = fields.map((field) => field.key);
    const hostField = fields.find((field) => field.key === 'host');

    expect(keys).toContain('host');
    expect(keys).not.toContain('organization');
    expect(hostField?.templateOptions?.required).toBeTrue();
    expect(hostField?.templateOptions?.label).toBe('F.AZURE_DEVOPS.FORM.HOST');
    expect(hostField?.templateOptions?.description).toBe(
      'F.AZURE_DEVOPS.FORM.HOST_DESCRIPTION',
    );
  });

  it('uses translations and interpolation params for the auto import limit field', () => {
    const advancedField = (AZURE_DEVOPS_CONFIG_FORM_SECTION.items ?? []).find(
      (field) => field.type === 'collapsible',
    );
    const autoImportLimitField = advancedField?.fieldGroup?.find(
      (field) => field.key === 'autoImportLimit',
    );

    expect(autoImportLimitField?.templateOptions?.label).toBe(
      'F.AZURE_DEVOPS.FORM.AUTO_IMPORT_LIMIT',
    );
    expect(autoImportLimitField?.templateOptions?.description).toBe(
      'F.AZURE_DEVOPS.FORM.AUTO_IMPORT_LIMIT_DESCRIPTION',
    );
    expect(autoImportLimitField?.templateOptions?.descriptionTranslateParams).toEqual({
      max: AZURE_DEVOPS_MAX_WORK_ITEM_LIMIT,
    });
  });
});
