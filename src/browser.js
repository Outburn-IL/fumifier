/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

/**
 * @module Fumifier Browser
 * @description FUME transformation evaluator - Browser Mode
 * Provides basic syntax parsing capabilities with or without recovery mode.
 * Does NOT support FHIR definition resolution or FLASH evaluation - only vanilla JSONata.
 */

import parser from './parser.js';
import { createExpressionIdentity } from './utils/cacheUtils.js';
import { getDefaultBrowserCache } from './utils/browserCache.js';
import { populateMessage } from './utils/errorCodes.js';
import fumifier from './fumifier.js';

/**
 * @typedef BrowserFumifierOptions
 * @property {boolean} [recover] Attempt to recover on parse error.
 * @property {AstCacheInterface} [astCache] Optional AST cache implementation for parsed expressions. Defaults to browser-compatible cache.
 */

/**
 * @typedef BrowserFumifierCompiled
 * @property {(input: any, bindings?: Record<string, any>, callback?: (err: any, resp: any) => void) => Promise<any>} evaluate
 *   Evaluate the compiled expression against input. If provided, callback will be called with (err, result).
 *   Note: In browser mode, only vanilla JSONata expressions are supported (no FLASH/FHIR functionality).
 * @property {(input: any, bindings?: Record<string, any>) => Promise<{ ok: boolean, status: number, result: any, diagnostics: any }>} evaluateVerbose
 *   Like evaluate(), but never throws for handled errors; returns a report with diagnostics and HTTP-like status.
 * @property {(name: string | symbol, value: any) => void} assign Assign a value to a variable in the compilation scope.
 * @property {(name: string, implementation: (this: {environment:any, input:any}, ...args: any[]) => any, signature?: string) => void} registerFunction
 *   Register a custom function available to the expression. Optional JSONata signature string is supported.
 * @property {(newLogger: {debug: Function, info: Function, warn: Function, error: Function}) => void} setLogger
 *   Provide a logger implementation; defaults to console-based logger.
 * @property {() => any} ast Get the parsed AST (without FHIR processing).
 * @property {() => any} errors Get parse-time errors if compiled with recover=true.
 */

/**
 * Browser Fumifier - Wrapper around main fumifier with browser-specific restrictions
 * @param {string|Object} expr - JSONata expression as text, or pre-parsed AST object
 * @param {BrowserFumifierOptions} [options] - Optional configuration for browser fumifier
 * @returns {Promise<BrowserFumifierCompiled>} Compiled expression object
 */
async function browserFumifier(expr, options) {
  const recover = options && options.recover;

  // Use browser cache if not provided
  const astCache = (options && options.astCache) || getDefaultBrowserCache();

  // Parse or use the provided AST - let parser handle FLASH content naturally
  let ast;
  try {
    if (typeof expr === 'string') {
      // Create expression identity for caching (no navigator in browser mode)
      const identity = createExpressionIdentity(expr, recover, undefined);

      // Try to get from AST cache first
      try {
        ast = await astCache.get(identity);
      } catch (cacheError) {
        // If AST cache fails, proceed without caching
        ast = null;
      }

      if (!ast) {
        // Parse the expression - parser will handle FLASH content appropriately
        // based on recovery mode and navigator availability
        ast = parser(expr, recover);

        // Ensure errors array exists - this is required for fumifier to work properly
        if (!ast.errors) {
          ast.errors = [];
        }

        // Cache the parsed AST
        try {
          await astCache.set(identity, ast);
        } catch (cacheError) {
          // If AST cache fails, continue without caching
        }
      }
    } else {
      ast = expr;
      // Ensure errors array exists for pre-parsed AST as well
      if (!ast.errors) {
        ast.errors = [];
      }
    }
    // No special handling for FLASH content - let the main fumifier handle it
  } catch (err) {
    populateMessage(err);
    throw err;
  }

  // Use the main fumifier but with browser-specific cache and no navigator
  const mainFumifierOptions = {
    recover: recover,
    navigator: undefined, // No navigator in browser mode
    astCache: astCache  // Already an AstCacheInterface-compatible object
  };

  // Create the fumifier instance using the main implementation
  const fumifierInstance = await fumifier(ast, mainFumifierOptions);

  // Wrap the fumifier instance to add browser-specific error handling
  const browserInstance = {
    evaluate: async function(input, bindings, callback) {
      // Simply delegate to the main fumifier - it will handle FLASH errors appropriately
      return await fumifierInstance.evaluate(input, bindings, callback);
    },

    evaluateVerbose: async function(input, bindings) {
      // Simply delegate to the main fumifier - it will handle FLASH errors appropriately
      return await fumifierInstance.evaluateVerbose(input, bindings);
    },

    assign: fumifierInstance.assign.bind(fumifierInstance),
    registerFunction: fumifierInstance.registerFunction.bind(fumifierInstance),
    setLogger: fumifierInstance.setLogger.bind(fumifierInstance),

    ast: function() {
      const originalAst = fumifierInstance.ast();
      // Return AST with browser-specific markers for debugging
      return {
        ...originalAst,
        browserMode: true
      };
    },

    errors: fumifierInstance.errors.bind(fumifierInstance)
  };

  return browserInstance;
}

export default browserFumifier;