import { FOCUS_MODE_FORM_CFG } from './focus-mode-form.const';

describe('FOCUS_MODE_FORM_CFG', () => {
  it('should keep focusModeSoundVolume while hidden (resetOnHide:false)', () => {
    const field = FOCUS_MODE_FORM_CFG.items!.find(
      (item) => item.key === 'focusModeSoundVolume',
    );
    expect(field?.hideExpression).toBeDefined();
    expect(field?.resetOnHide).toBe(false);
  });
});
