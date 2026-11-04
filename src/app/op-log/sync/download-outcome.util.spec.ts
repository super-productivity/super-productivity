import { isKeptPrefixDecryptErrorSuperseded } from './download-outcome.util';

describe('isKeptPrefixDecryptErrorSuperseded (#9256)', () => {
  const atPrefix = { prefixCursor: 17, persistedCursor: 17 };

  it('keeps the error when the prefix was applied and its cursor persisted', () => {
    expect(isKeptPrefixDecryptErrorSuperseded({ kind: 'no_new_ops' }, atPrefix)).toBe(
      false,
    );
  });

  it('keeps the error when the cursor stayed behind the prefix', () => {
    expect(
      isKeptPrefixDecryptErrorSuperseded(
        { kind: 'no_new_ops' },
        { prefixCursor: 17, persistedCursor: 5 },
      ),
    ).toBe(false);
  });

  it('drops the error when the cursor moved past the prefix (server replaced)', () => {
    expect(
      isKeptPrefixDecryptErrorSuperseded(
        { kind: 'no_new_ops' },
        { prefixCursor: 17, persistedCursor: 40 },
      ),
    ).toBe(true);
  });

  it('drops the error when the user cancelled or an incompatible op blocked', () => {
    expect(isKeptPrefixDecryptErrorSuperseded({ kind: 'cancelled' }, atPrefix)).toBe(
      true,
    );
    expect(
      isKeptPrefixDecryptErrorSuperseded({ kind: 'blocked_incompatible' }, atPrefix),
    ).toBe(true);
  });
});
