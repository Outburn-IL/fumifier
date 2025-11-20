#!/usr/bin/env node

/**
 * Post-process TypeScript declaration files after tsc compilation
 *
 * This script:
 * 1. Locates the main index.d.ts file from various possible locations in `dist`
 * 2. Locates the browser.d.ts file from various possible locations in `dist`
 * 3. Moves them to the dist root as index.d.ts and browser.d.ts
 * 4. Cleans up any remaining .d.ts files except the ones we want to keep
 * 5. Removes empty directories
 */

import fs from 'fs';
import path from 'path';

const root = 'dist';

/**
 * Find and move the main index.d.ts file to the correct location
 * @returns {string} The path to the final index.d.ts file
 */
function ensureIndex() {
  const candidates = [
    'dist/types/index.d.ts',
    'dist/fumifier.d.ts',
    'dist/src/fumifier.d.ts'
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const outputPath = path.join(root, 'index.d.ts');

      if (candidate !== outputPath) {
        fs.mkdirSync(root, { recursive: true });
        fs.renameSync(candidate, outputPath);
      }

      return outputPath;
    }
  }

  return path.join(root, 'index.d.ts');
}

/**
 * Find and move the browser.d.ts file to the correct location
 * @returns {string|undefined} The path to the final browser.d.ts file if found
 */
function ensureBrowser() {
  const candidates = [
    'dist/types/browser.d.ts',
    'dist/browser.d.ts',
    'dist/src/browser.d.ts'
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const outputPath = path.join(root, 'browser.d.ts');

      if (candidate !== outputPath) {
        fs.mkdirSync(root, { recursive: true });
        fs.renameSync(candidate, outputPath);
      }

      return outputPath;
    }
  }

  return undefined;
}

/**
 * Recursively walk directory and clean up unwanted .d.ts files and empty directories
 * @param {string} dir - Directory to walk
 * @param {string} keepMain - Main .d.ts file to preserve
 */
function walkAndClean(dir, keepMain) {
  if (!fs.existsSync(dir)) {
    return;
  }

  const entries = fs.readdirSync(dir);

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stats = fs.statSync(fullPath);

    if (stats.isDirectory()) {
      // Recursively clean subdirectories
      walkAndClean(fullPath, keepMain);

      // Try to remove directory if it's empty
      try {
        const remaining = fs.readdirSync(fullPath);
        if (remaining.length === 0) {
          fs.rmdirSync(fullPath);
        }
      } catch (error) {
        // Directory not empty or other error, ignore
      }
    } else if (fullPath.endsWith('.d.ts') &&
               fullPath !== keepMain &&
               !fullPath.endsWith('browser.d.ts')) {
      // Remove unwanted .d.ts files
      fs.unlinkSync(fullPath);
    }
  }
}

// Main execution
try {
  const keepMain = ensureIndex();
  ensureBrowser();
  walkAndClean(root, keepMain);
} catch (error) {
  process.exit(1);
}