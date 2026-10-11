/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

This file includes and modifies code from JSONata (https://github.com/jsonata-js/jsonata).
JSONata portions: © IBM Corp. 2016–2018, licensed under the MIT License.
See NOTICE and LICENSES/MIT-JSONata.txt for details.

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

import compileArgumentValidator from './signature.js';

/**
     * Creates a function definition
     * @param {Function} func - function implementation in Javascript
     * @param {string} signature - JSONata function signature definition
     * @returns {{implementation: *, signature: *}} function definition
     */
function defineFunction(func, signature) {
  var definition = {
    _fumifier_function: true,
    implementation: func
  };
  if(typeof signature !== 'undefined') {
    definition.signature = compileArgumentValidator(signature);
  }
  return definition;
}

export default defineFunction;