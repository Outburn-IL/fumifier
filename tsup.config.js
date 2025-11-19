import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/fumifier.js',
    browser: 'src/browser.js'
  },
  format: ['cjs', 'esm'],
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  target: 'node20',
  minify: false,
  treeshake: true,
  skipNodeModulesBundle: true,
  splitting: false,
  outExtension({ format }) {
    if (format === 'esm') return { js: '.mjs' };
    return { js: '.cjs' };
  },
  // Since this is a JS-only package, we don't need dts generation from tsup
  // We'll keep the existing TypeScript-based type generation
  dts: false
});