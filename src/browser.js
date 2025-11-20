/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

This file includes and modifies code from JSONata (https://github.com/jsonata-js/jsonata).
JSONata portions: © IBM Corp. 2016–2018, licensed under the MIT License.
See NOTICE and LICENSES/MIT-JSONata.txt for details.

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

/**
 * @module Fumifier/Browser
 * @description Browser-friendly FUME parser entry point
 *
 * This module provides light-weight syntax parsing capabilities for browsers.
 * It includes tokenization, AST generation, and basic AST processing without
 * FHIR definition resolution, evaluation, or Node.js-specific dependencies.
 *
 * Suitable for:
 * - Syntax highlighting in editors
 * - Real-time syntax validation
 * - Interactive debugging tools
 * - Educational/demonstration purposes
 *
 * Does NOT include:
 * - FHIR structure navigation
 * - Expression evaluation
 * - AST caching mechanisms
 * - Node.js-only functionality
 */

/**
 * @typedef {Object} TokenInfo
 * @description Token information for syntax highlighting and editor features
 * @property {string} type - Token type (e.g., 'name', 'operator', 'string')
 * @property {string|number} value - Token value
 * @property {number} start - Start position in source
 * @property {number} end - End position in source
 * @property {number} line - Line number (1-based)
 */

/**
 * @typedef {Object} ParseError
 * @description Parse error information
 * @property {string} code - Error code
 * @property {string} [message] - Error message
 * @property {number} position - Error position in source
 * @property {number} start - Error start position
 * @property {number} line - Line number where error occurred
 * @property {string} [token] - Token that caused the error
 * @property {string} [value] - Error value
 * @property {any[]} [remaining] - Remaining tokens
 * @property {string} [type] - Error type
 * @property {string} [stack] - Error stack trace
 */

/**
 * @typedef {Object} ValidationResult
 * @description Validation result
 * @property {boolean} isValid - Whether the expression is valid
 * @property {ParseError[]} errors - Array of validation errors
 */

/**
 * @typedef {Object} ASTNode
 * @description Abstract Syntax Tree node (simplified interface)
 * @property {string} type - Node type
 * @property {*} [value] - Node value
 * @property {number} [position] - Position in source
 * @property {number} [start] - Start position
 * @property {number} [line] - Line number
 * @property {ParseError[]} [errors] - Parse errors
 * @property {*} [key] - Additional properties
 */

import parser from './parser.js';
import { populateMessage } from './utils/errorCodes.js';
import tokenizer from './utils/tokenizer.js';

/**
 * Parse a FUME expression into an Abstract Syntax Tree (AST)
 * @param {string} expression - The FUME expression string to parse
 * @param {boolean} [recover=false] - Whether to attempt error recovery during parsing
 * @returns {ASTNode} The parsed AST with syntax structure and error information
 * @throws {Error} Syntax errors when recover=false, or returns error info in AST when recover=true
 *
 * @example
 * ```javascript
 * import { parse } from 'fumifier/browser';
 *
 * // Basic parsing
 * const ast = parse('name.first & " " & name.family');
 * console.log(ast.type); // 'binary'
 *
 * // Parse with error recovery
 * const result = parse('name.first &', true);
 * if (result.errors && result.errors.length > 0) {
 *   console.log('Syntax errors found:', result.errors);
 * }
 *
 * // Parse FLASH syntax
 * const flashAst = parse(`
 *   InstanceOf: Patient
 *   * name.given = "John"
 *   * name.family = "Doe"
 * `);
 * console.log(flashAst.type); // 'flashblock'
 * ```
 */
export function parse(expression, recover = false) {
  if (typeof expression !== 'string') {
    throw new TypeError('Expression must be a string');
  }

  try {
    const ast = parser(expression, recover);

    // Populate error messages if errors exist
    if (ast.errors) {
      ast.errors.forEach(error => {
        populateMessage(error);
      });
    }

    return ast;
  } catch (error) {
    // Ensure error has a readable message
    populateMessage(error);
    throw error;
  }
}

/**
 * Validate a FUME expression for syntax correctness
 * @param {string} expression - The FUME expression string to validate
 * @returns {ValidationResult} Validation result with isValid flag and errors array
 *
 * @example
 * ```javascript
 * import { validate } from 'fumifier/browser';
 *
 * const result = validate('name.first & " " & name.family');
 * console.log(result.isValid); // true
 * console.log(result.errors); // []
 *
 * const invalid = validate('name.first &');
 * console.log(invalid.isValid); // false
 * console.log(invalid.errors); // [{ code: 'S0203', message: '...' }]
 * ```
 */
export function validate(expression) {
  if (typeof expression !== 'string') {
    return {
      isValid: false,
      errors: [{
        code: 'T0001',
        message: 'Expression must be a string',
        position: 0,
        start: 0,
        line: 1
      }]
    };
  }

  try {
    const ast = parse(expression, true); // Use recovery mode for validation
    const errors = ast.errors || [];

    return {
      isValid: errors.length === 0,
      errors: errors
    };
  } catch (error) {
    // Handle raw JavaScript errors that don't have FUME error structure
    let message = error.message || 'Parse error occurred';
    let code = error.code || 'FATAL';

    const fumeError = {
      code: code,
      message: message,
      position: error.position || 0,
      start: error.start || 0,
      line: error.line || 1,
      token: error.token,
      value: error.value,
      type: error.type || 'ParseError'
    };

    populateMessage(fumeError);
    return {
      isValid: false,
      errors: [fumeError]
    };
  }
}

/**
 * Get information about token positions and types in an expression
 * Useful for syntax highlighting and editor features
 * @param {string} expression - The FUME expression string to tokenize
 * @returns {TokenInfo[]} Array of token information objects
 *
 * @example
 * ```javascript
 * import { tokenize } from 'fumifier/browser';
 *
 * const tokens = tokenize('name.first');
 * // Returns: [
 * //   { type: 'name', value: 'name', start: 0, end: 4, line: 1 },
 * //   { type: 'operator', value: '.', start: 4, end: 5, line: 1 },
 * //   { type: 'name', value: 'first', start: 5, end: 10, line: 1 }
 * // ]
 * ```
 */
export function tokenize(expression) {
  if (typeof expression !== 'string') {
    throw new TypeError('Expression must be a string');
  }

  try {
    const lexer = tokenizer(expression);
    const tokens = [];

    // Get all tokens from the tokenizer directly
    let token = lexer.next();
    while (token !== null) {
      // Convert position (end) to end for consistency
      tokens.push({
        type: token.type,
        value: token.value,
        start: token.start,
        end: token.position,
        line: token.line || 1
      });
      token = lexer.next();
    }

    return tokens;
  } catch (error) {
    // Return empty array on tokenization errors
    return [];
  }
}

/**
 * Core parser function - advanced usage
 * @param {string} source - Source expression to parse
 * @param {boolean} [recover] - Whether to use recovery mode
 * @returns {ASTNode} Parsed AST
 */
export { parser };

/**
 * Populate error messages for error codes
 * @param {ParseError} error - Error object to populate
 * @returns {void}
 */
export { populateMessage } from './utils/errorCodes.js';

// Default export for convenience
export default {
  parse,
  validate,
  tokenize,
  parser,
  populateMessage
};