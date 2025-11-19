import { defineConfig } from 'tsup';

export default defineConfig([
  // Main Node.js build
  {
    entry: { index: 'src/fumifier.js' },
    format: ['cjs', 'esm'],
    outDir: 'dist',
    sourcemap: true,
    clean: true,
    target: 'node20',
    minify: false,
    treeshake: true,
    skipNodeModulesBundle: true,
    splitting: false,
    platform: 'node',
    outExtension({ format }) {
      if (format === 'esm') return { js: '.mjs' };
      return { js: '.cjs' };
    },
    // Since this is a JS-only package, we don't need dts generation from tsup
    // We'll keep the existing TypeScript-based type generation
    dts: false
  },
  // Browser build
  {
    entry: { browser: 'src/browser.js' },
    format: ['cjs', 'esm'],
    outDir: 'dist',
    sourcemap: true,
    clean: false, // Don't clean when building browser version
    target: 'es2020', // Modern browser target
    minify: false,
    treeshake: true,
    skipNodeModulesBundle: true,
    splitting: false,
    platform: 'browser',
    external: ['lru-cache'], // External browser-incompatible dependencies
    outExtension({ format }) {
      if (format === 'esm') return { js: '.mjs' };
      return { js: '.cjs' };
    },
    dts: false
  }
]);