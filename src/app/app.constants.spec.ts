import { isDonationUiRestricted } from './app.constants';

describe('isDonationUiRestricted', () => {
  const cases: Array<
    [
      label: string,
      context: Parameters<typeof isDonationUiRestricted>[0],
      expected: boolean,
    ]
  > = [
    ['native iOS', { isIosNative: true, isElectron: false, isMacOS: false }, true],
    ['macOS Electron DMG', { isIosNative: false, isElectron: true, isMacOS: true }, true],
    [
      'macOS Electron App Store',
      { isIosNative: false, isElectron: true, isMacOS: true },
      true,
    ],
    [
      'macOS Electron development build',
      { isIosNative: false, isElectron: true, isMacOS: true },
      true,
    ],
    [
      'Windows or Linux Electron',
      { isIosNative: false, isElectron: true, isMacOS: false },
      false,
    ],
    [
      'macOS web browser',
      { isIosNative: false, isElectron: false, isMacOS: true },
      false,
    ],
    ['native Android', { isIosNative: false, isElectron: false, isMacOS: false }, false],
  ];

  cases.forEach(([label, context, expected]) => {
    it(`${expected ? 'restricts' : 'allows'} donation UI on ${label}`, () => {
      expect(isDonationUiRestricted(context)).toBe(expected);
    });
  });
});
