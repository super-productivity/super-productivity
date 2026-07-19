import { addOAuthState, validateOAuthState } from './oauth-state.util';

describe('oauth-state.util', () => {
  it('should validate a matching state only once', () => {
    spyOn(Date, 'now').and.returnValue(1000);
    addOAuthState('onedrive', 'state-once');

    expect(validateOAuthState('onedrive', 'state-once')).toBeTrue();
    expect(validateOAuthState('onedrive', 'state-once')).toBeFalse();
  });

  it('should reject mismatched provider without consuming the state', () => {
    spyOn(Date, 'now').and.returnValue(2000);
    addOAuthState('onedrive', 'state-provider-check');

    expect(validateOAuthState('googleDrive', 'state-provider-check')).toBeFalse();
    expect(validateOAuthState('onedrive', 'state-provider-check')).toBeTrue();
  });

  it('should reject expired states', () => {
    const dateNowSpy = spyOn(Date, 'now');
    dateNowSpy.and.returnValue(0);
    addOAuthState('onedrive', 'state-expired');

    const justAfterExpiryMs = 600001;
    dateNowSpy.and.returnValue(justAfterExpiryMs);
    expect(validateOAuthState('onedrive', 'state-expired')).toBeFalse();
  });

  it('should reject missing state values', () => {
    expect(validateOAuthState('onedrive', null)).toBeFalse();
  });
});
