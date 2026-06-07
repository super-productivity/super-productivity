import { AZURE_DEVOPS_CONFIG_FORM_SECTION } from './azure-devops-cfg-form.const';

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
});
