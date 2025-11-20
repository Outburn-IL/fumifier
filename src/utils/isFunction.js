/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

This file includes and modifies code from JSONata (https://github.com/jsonata-js/jsonata).
JSONata portions: © IBM Corp. 2016–2018, licensed under the MIT License.
See NOTICE and LICENSES/MIT-JSONata.txt for details.

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

/**
 * Check if a value is a function (lambda or built-in)
 * Browser-compatible implementation without Node.js dependencies
 * @param {*} arg - expression to test
 * @returns {boolean} - true if it is a function (lambda or built-in)
 */
function isFunction(arg) {
  return ((arg && (arg._fumifier_function === true || arg._fumifier_lambda === true)) || typeof arg === 'function');
}

export default isFunction;