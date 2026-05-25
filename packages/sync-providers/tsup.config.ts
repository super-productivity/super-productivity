import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
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
  dts: true,
  sourcemap: true,
  clean: true,
});
