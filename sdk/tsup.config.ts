import { defineConfig } from 'tsup'

// Bundle everything (logic + vendored modules + snapshot.json) into single
// self-contained ESM and CJS files. Bundling resolves the relative imports
// that a plain `tsc` build would leave extensionless — which break native
// ESM and CommonJS consumers alike.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  treeshake: true,
  sourcemap: false,
  target: 'node18'
})
