import { isNewerVersion } from './is-newer-version';

describe('isNewerVersion()', () => {
  it('should return true for a newer patch/minor/major version', () => {
    expect(isNewerVersion('18.12.1', '18.12.0')).toBe(true);
    expect(isNewerVersion('18.13.0', '18.12.9')).toBe(true);
    expect(isNewerVersion('19.0.0', '18.99.99')).toBe(true);
  });

  it('should return false for an equal version', () => {
    expect(isNewerVersion('18.12.0', '18.12.0')).toBe(false);
  });

  it('should return false for an older version (dev build ahead of latest release)', () => {
    expect(isNewerVersion('18.12.0', '18.12.1')).toBe(false);
    expect(isNewerVersion('18.9.9', '18.10.0')).toBe(false);
    expect(isNewerVersion('17.99.99', '18.0.0')).toBe(false);
  });

  it('should tolerate a leading v on either side', () => {
    expect(isNewerVersion('v18.12.1', '18.12.0')).toBe(true);
    expect(isNewerVersion('V18.12.0', 'v18.12.0')).toBe(false);
  });

  it('should compare numerically, not lexically', () => {
    expect(isNewerVersion('18.10.0', '18.9.0')).toBe(true);
    expect(isNewerVersion('18.9.0', '18.10.0')).toBe(false);
  });

  it('should treat a stable release as newer than a prerelease of the same version', () => {
    expect(isNewerVersion('18.13.0', '18.13.0-RC1')).toBe(true);
  });

  it('should not treat a prerelease as newer than the stable release of the same version', () => {
    expect(isNewerVersion('18.13.0-RC1', '18.13.0')).toBe(false);
  });

  it('should not compare prereleases against each other', () => {
    expect(isNewerVersion('18.13.0-RC2', '18.13.0-RC1')).toBe(false);
  });

  it('should tolerate display-only channel suffixes on the current version', () => {
    expect(isNewerVersion('18.12.1', '18.12.0AI')).toBe(true);
    expect(isNewerVersion('18.12.0', '18.12.0MAS')).toBe(false);
  });

  it('should return false for unparseable input', () => {
    expect(isNewerVersion('', '18.12.0')).toBe(false);
    expect(isNewerVersion('18.12.0', '')).toBe(false);
    expect(isNewerVersion('latest', '18.12.0')).toBe(false);
    expect(isNewerVersion('18.12', '18.12.0')).toBe(false);
  });
});
