/* eslint-disable no-console */
/**
 * Browser entry point integration tests
 * Tests the browser-friendly parser module imports and basic functionality
 */

import { createRequire } from 'module';
import assert from 'assert';

describe('Browser Entry Point', function() {
  let browserModuleEsm;
  let browserModuleCjs;

  before(async function() {
    // Load both ES Module and CommonJS versions
    const require = createRequire(import.meta.url);
    browserModuleCjs = require('../dist/browser.cjs');
    browserModuleEsm = await import('../dist/browser.mjs');
  });

  describe('Module Loading', function() {
    it('should load CommonJS module successfully', function() {
      assert(browserModuleCjs, 'CommonJS module should load');
      assert(browserModuleCjs.default || browserModuleCjs.parse, 'CommonJS module should have expected exports');
    });

    it('should load ES Module successfully', function() {
      assert(browserModuleEsm, 'ES Module should load');
      assert(typeof browserModuleEsm.parse === 'function', 'ES Module should export parse function');
      assert(typeof browserModuleEsm.validate === 'function', 'ES Module should export validate function');
      assert(typeof browserModuleEsm.tokenize === 'function', 'ES Module should export tokenize function');
    });

    it('should have consistent API between CommonJS and ES Module', function() {
      const cjsApi = browserModuleCjs.default || browserModuleCjs;
      assert(typeof cjsApi.parse === 'function', 'CommonJS should have parse function');
      assert(typeof cjsApi.validate === 'function', 'CommonJS should have validate function');
      assert(typeof cjsApi.tokenize === 'function', 'CommonJS should have tokenize function');
    });
  });

  describe('Parse Function', function() {
    it('should parse simple expressions correctly', function() {
      const { parse } = browserModuleEsm;
      const ast = parse('name.first');

      assert(ast, 'Parse should return an AST');
      assert(ast.type, 'AST should have a type property');
      assert.equal(ast.type, 'path', 'Simple path expression should have type "path"');
    });

    it('should parse complex expressions correctly', function() {
      const { parse } = browserModuleEsm;
      const ast = parse('name.first & " " & name.family');

      assert(ast, 'Parse should return an AST');
      assert.equal(ast.type, 'binary', 'String concatenation should have type "binary"');
    });

    it('should handle FLASH syntax', function() {
      const { parse } = browserModuleEsm;
      const flashAst = parse(`InstanceOf: Patient
* name.given = "John"`, true);

      assert(flashAst, 'Parse should return an AST for FLASH');
      assert(flashAst.containsFlash === true, 'Should detect FLASH syntax');
    });

    it('should throw on invalid syntax when recover=false', function() {
      const { parse } = browserModuleEsm;

      assert.throws(() => {
        parse('name.first &');
      }, 'Should throw on incomplete expression');
    });

    it('should return errors in AST when recover=true', function() {
      const { parse } = browserModuleEsm;
      const ast = parse('name.first &', true);

      assert(ast, 'Should return AST even with errors');
      assert(Array.isArray(ast.errors), 'Should have errors array');
      assert(ast.errors.length > 0, 'Should have error entries');
    });
  });

  describe('Validate Function', function() {
    it('should validate correct expressions as valid', function() {
      const { validate } = browserModuleEsm;
      const result = validate('name.first & " " & name.family');

      assert(typeof result === 'object', 'Should return an object');
      assert(typeof result.isValid === 'boolean', 'Should have isValid boolean');
      assert(Array.isArray(result.errors), 'Should have errors array');
      assert(result.isValid === true, 'Valid expression should be marked as valid');
      assert.equal(result.errors.length, 0, 'Valid expression should have no errors');
    });

    it('should validate incorrect expressions as invalid', function() {
      const { validate } = browserModuleEsm;
      const result = validate('name.first &');

      assert(typeof result === 'object', 'Should return an object');
      assert(result.isValid === false, 'Invalid expression should be marked as invalid');
      assert(result.errors.length > 0, 'Invalid expression should have errors');
      assert(typeof result.errors[0].code === 'string', 'Errors should have error codes');
    });

    it('should handle non-string input gracefully', function() {
      const { validate } = browserModuleEsm;
      const result = validate(123);

      assert(result.isValid === false, 'Non-string input should be invalid');
      assert(result.errors.length > 0, 'Should have error for non-string input');
    });
  });

  describe('Tokenize Function', function() {
    it('should tokenize simple expressions correctly', function() {
      const { tokenize } = browserModuleEsm;
      const tokens = tokenize('name.first');

      assert(Array.isArray(tokens), 'Should return an array');
      assert(tokens.length > 0, 'Should return tokens');

      // Check first token (name)
      assert(tokens[0].type, 'Tokens should have type');
      assert(tokens[0].value, 'Tokens should have value');
      assert(typeof tokens[0].start === 'number', 'Tokens should have start position');
      assert(typeof tokens[0].end === 'number', 'Tokens should have end position');
    });

    it('should tokenize complex expressions correctly', function() {
      const { tokenize } = browserModuleEsm;
      const tokens = tokenize('$patient.name[0].given');

      assert(Array.isArray(tokens), 'Should return an array');
      assert(tokens.length > 0, 'Should return tokens for complex expression');

      // Should have various token types
      const types = tokens.map(t => t.type);
      assert(types.includes('variable') || types.includes('name'), 'Should have name/variable tokens');
    });

    it('should handle empty expressions', function() {
      const { tokenize } = browserModuleEsm;
      const tokens = tokenize('');

      assert(Array.isArray(tokens), 'Should return an array for empty input');
    });

    it('should handle non-string input gracefully', function() {
      const { tokenize } = browserModuleEsm;

      assert.throws(() => {
        tokenize(123);
      }, TypeError, 'Should throw TypeError for non-string input');
    });
  });

  describe('Browser Isolation', function() {
    it('should not include Node.js-only functionality', function() {
      const { default: defaultExport } = browserModuleEsm;

      // Should not have evaluation capabilities
      assert(!browserModuleEsm.evaluate, 'Should not export evaluate function');
      assert(!browserModuleEsm.compile, 'Should not export compile function');
      if (defaultExport) {
        assert(!defaultExport.evaluate, 'Default export should not include evaluate');
        assert(!defaultExport.compile, 'Default export should not include compile');
      }
    });

    it('should have only parsing-related exports', function() {
      const exports = Object.keys(browserModuleEsm);
      const expectedExports = ['parse', 'validate', 'tokenize', 'parser', 'populateMessage', 'default'];

      exports.forEach(exportName => {
        if (exportName !== 'default') {
          assert(expectedExports.includes(exportName),
            `Unexpected export: ${exportName}. Browser module should only export parsing functions.`);
        }
      });
    });
  });
});