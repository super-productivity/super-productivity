// Named import so esbuild inlines only `version`, not the whole manifest.
// (environment.ts keeps the default import: Karma's webpack rejects named
// JSON imports.)
import { version } from '../../package.json';

export const environment = {
  production: true,
  stage: true,
  version,
};
