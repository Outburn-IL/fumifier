#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
const packageJsonPath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
const version = packageJson.version;

// Generate version.js file
const versionJs = `// This file is auto-generated during build. Do not edit manually.
export const VERSION = '${version}';
`;

// Write to src/version.js
const versionFilePath = join(__dirname, '..', 'src', 'version.js');
writeFileSync(versionFilePath, versionJs, 'utf-8');

// eslint-disable-next-line no-console
console.log(`Generated version.js with version ${version}`);