import { defineConfig } from 'tsup';

const sharedConfig = {
  outDir: 'dist',
  sourcemap: true,
  target: 'node20',
  minify: false,
  treeshake: true,
  skipNodeModulesBundle: true,
  splitting: false,
  // Since this is a JS-only package, we don't need dts generation from tsup
  // We'll keep the existing TypeScript-based type generation
  dts: false
};

export default defineConfig([
  {
    ...sharedConfig,
    entry: {
      index: 'src/fumifier.js',
      browser: 'src/browser.js'
    },
    format: ['esm'],
    clean: true,
    outExtension() {
      return { js: '.mjs' };
    },
  },
  {
    ...sharedConfig,
    entry: {
      index: 'src/cjs/index.js',
      browser: 'src/cjs/browser.js'
    },
    format: ['cjs'],
    clean: false,
    outExtension() {
      return { js: '.cjs' };
    },
  }
]);