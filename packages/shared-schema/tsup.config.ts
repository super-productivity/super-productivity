import { defineConfig } from 'tsup';

// tsup's DTS build injects the deprecated `baseUrl`; TypeScript 6 errors on it.
const DTS_COMPILER_OPTIONS = { ignoreDeprecations: '6.0' };

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: { compilerOptions: DTS_COMPILER_OPTIONS },
  sourcemap: true,
  clean: true,
});
