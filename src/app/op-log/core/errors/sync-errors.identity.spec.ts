import {
  AuthFailSPError as PackageAuthFailSPError,
  EmptyRemoteBodySPError as PackageEmptyRemoteBodySPError,
  HttpNotOkAPIError as PackageHttpNotOkAPIError,
  InvalidDataSPError as PackageInvalidDataSPError,
  MissingCredentialsSPError as PackageMissingCredentialsSPError,
  MissingRefreshTokenAPIError as PackageMissingRefreshTokenAPIError,
  NoRevAPIError as PackageNoRevAPIError,
  PotentialCorsError as PackagePotentialCorsError,
  RemoteFileChangedUnexpectedly as PackageRemoteFileChangedUnexpectedly,
  RemoteFileNotFoundAPIError as PackageRemoteFileNotFoundAPIError,
  TooManyRequestsAPIError as PackageTooManyRequestsAPIError,
  UploadRevToMatchMismatchAPIError as PackageUploadRevToMatchMismatchAPIError,
} from '@sp/sync-providers';
import {
  AuthFailSPError,
  EmptyRemoteBodySPError,
  HttpNotOkAPIError,
  InvalidDataSPError,
  MissingCredentialsSPError,
  MissingRefreshTokenAPIError,
  NoRevAPIError,
  PotentialCorsError,
  RemoteFileChangedUnexpectedly,
  RemoteFileNotFoundAPIError,
  TooManyRequestsAPIError,
  UploadRevToMatchMismatchAPIError,
} from './sync-errors';

// Regression guard against ESM/CJS dual-realm and barrel/dist mis-resolution.
// `instanceof` correctness in catch blocks across imex/sync, file-based
// sync adapter, sync-wrapper, WebDAV, SuperSync depends on every import
// path resolving to ONE constructor. The app-side `sync-errors.ts` is a
// pure re-export shim over `@sp/sync-providers`; this spec is a safety
// net that fails immediately if a future bundler/tsconfig change loads
// two copies of the package.
describe('sync-errors identity (single class definition across import paths)', () => {
  const PAIRS: ReadonlyArray<readonly [string, unknown, unknown]> = [
    ['AuthFailSPError', AuthFailSPError, PackageAuthFailSPError],
    ['InvalidDataSPError', InvalidDataSPError, PackageInvalidDataSPError],
    ['EmptyRemoteBodySPError', EmptyRemoteBodySPError, PackageEmptyRemoteBodySPError],
    [
      'RemoteFileNotFoundAPIError',
      RemoteFileNotFoundAPIError,
      PackageRemoteFileNotFoundAPIError,
    ],
    ['NoRevAPIError', NoRevAPIError, PackageNoRevAPIError],
    ['HttpNotOkAPIError', HttpNotOkAPIError, PackageHttpNotOkAPIError],
    [
      'MissingCredentialsSPError',
      MissingCredentialsSPError,
      PackageMissingCredentialsSPError,
    ],
    [
      'MissingRefreshTokenAPIError',
      MissingRefreshTokenAPIError,
      PackageMissingRefreshTokenAPIError,
    ],
    ['TooManyRequestsAPIError', TooManyRequestsAPIError, PackageTooManyRequestsAPIError],
    [
      'UploadRevToMatchMismatchAPIError',
      UploadRevToMatchMismatchAPIError,
      PackageUploadRevToMatchMismatchAPIError,
    ],
    ['PotentialCorsError', PotentialCorsError, PackagePotentialCorsError],
    [
      'RemoteFileChangedUnexpectedly',
      RemoteFileChangedUnexpectedly,
      PackageRemoteFileChangedUnexpectedly,
    ],
  ];

  PAIRS.forEach(([name, appCtor, packageCtor]) => {
    it(`${name} app-side === package-side constructor`, () => {
      expect(appCtor).toBe(packageCtor);
    });
  });
});
