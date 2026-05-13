import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/dropbox.ts',
    'src/webdav.ts',
    'src/local-file.ts',
    'src/super-sync.ts',
    'src/http.ts',
    'src/errors.ts',
    'src/credential-store.ts',
    'src/file-based.ts',
    'src/pkce.ts',
    'src/platform.ts',
    'src/provider-types.ts',
  ],
  format: ['esm', 'cjs'],
  tsconfig: 'tsconfig.build.json',
  dts: { tsconfig: 'tsconfig.build.json' },
  sourcemap: true,
  clean: true,
});
