import { defineConfig } from 'tsup';

// tsup's DTS build injects the deprecated `baseUrl`; TypeScript 6 errors on it.
const DTS_COMPILER_OPTIONS = { ignoreDeprecations: '6.0' };

export default defineConfig({
  entry: [
    'src/dropbox.ts',
    'src/webdav.ts',
    'src/local-file.ts',
    'src/super-sync.ts',
    'src/onedrive.ts',
    'src/http.ts',
    'src/errors.ts',
    'src/credential-store.ts',
    'src/file-based.ts',
    'src/pkce.ts',
    'src/platform.ts',
    'src/provider-types.ts',
    'src/log.ts',
  ],
  format: ['esm', 'cjs'],
  tsconfig: 'tsconfig.build.json',
  dts: { tsconfig: 'tsconfig.build.json', compilerOptions: DTS_COMPILER_OPTIONS },
  sourcemap: true,
  clean: true,
});
