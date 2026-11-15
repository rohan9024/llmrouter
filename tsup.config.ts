import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      adapters: 'src/adapters/index.ts',
      catalog: 'src/catalog/index.ts',
      benchmark: 'src/benchmark/index.ts'
    },
    format: ['cjs', 'esm'],
    dts: true,
    splitting: false,
    clean: false,
    sourcemap: true,
    minify: false,
    treeshake: true
  },
  {
    entry: { cli: 'src/cli/index.ts' },
    format: ['esm'],
    dts: false,
    splitting: false,
    clean: false,
    sourcemap: true,
    minify: false,
    treeshake: true,
    banner: { js: '#!/usr/bin/env node' }
  }
]);
