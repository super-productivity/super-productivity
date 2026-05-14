import { decideNodeExecutionConsent } from './plugin-consent.util';

describe('decideNodeExecutionConsent', () => {
  it('grants and stores when user grants + remembers', () => {
    expect(decideNodeExecutionConsent({ granted: true, remember: true })).toEqual({
      granted: true,
      consentToStore: true,
    });
  });

  it('grants but does not store when user grants without remembering', () => {
    expect(decideNodeExecutionConsent({ granted: true, remember: false })).toEqual({
      granted: true,
      consentToStore: false,
    });
  });

  it('grants but does not store when remember is omitted', () => {
    expect(decideNodeExecutionConsent({ granted: true })).toEqual({
      granted: true,
      consentToStore: false,
    });
  });

  it('denies and clears storage when user denies', () => {
    expect(decideNodeExecutionConsent({ granted: false, remember: true })).toEqual({
      granted: false,
      consentToStore: false,
    });
  });

  it('denies and clears storage when dialog is dismissed (undefined)', () => {
    expect(decideNodeExecutionConsent(undefined)).toEqual({
      granted: false,
      consentToStore: false,
    });
  });

  it('denies and clears storage when dialog is dismissed (null)', () => {
    expect(decideNodeExecutionConsent(null)).toEqual({
      granted: false,
      consentToStore: false,
    });
  });
});
