/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

This file includes and modifies code from JSONata (https://github.com/jsonata-js/jsonata).
JSONata portions: © IBM Corp. 2016–2018, licensed under the MIT License.
See NOTICE and LICENSES/MIT-JSONata.txt for details.

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

import { randomUUID, createHash } from 'crypto';
import isFunction from './isFunction.js';

const utils = (() => {

  /**
     * Check if value is a finite number
     * @param {float} n - number to evaluate
     * @returns {boolean} True if n is a finite number
     */
  function isNumeric(n) {
    var isNum = false;
    if(typeof n === 'number') {
      isNum = !isNaN(n);
      if (isNum && !isFinite(n)) {
        throw {
          code: "D1001",
          value: n,
          stack: (new Error()).stack
        };
      }
    }
    return isNum;
  }

  /**
     * Returns true if the arg is an array of strings
     * @param {*} arg - the item to test
     * @returns {boolean} True if arg is an array of strings
     */
  function isArrayOfStrings(arg) {
    var result = false;
    /* c8 ignore else */
    if(Array.isArray(arg)) {
      result = (arg.filter(function(item){return typeof item !== 'string';}).length === 0);
    }
    return result;
  }

  /**
     * Returns true if the arg is an array of numbers
     * @param {*} arg - the item to test
     * @returns {boolean} True if arg is an array of numbers
     */
  function isArrayOfNumbers(arg) {
    var result = false;
    if(Array.isArray(arg)) {
      result = (arg.filter(function(item){return !isNumeric(item);}).length === 0);
    }
    return result;
  }

  /**
     * Create an empty sequence to contain query results
     * @returns {Array} - empty sequence
     */
  function createSequence() {
    var sequence = [];
    sequence.sequence = true;
    if (arguments.length === 1) {
      sequence.push(arguments[0]);
    }
    return sequence;
  }

  /**
     * Tests if a value is a sequence
     * @param {*} value the value to test
     * @returns {boolean} true if it's a sequence
     */
  function isSequence(value) {
    return value.sequence === true && Array.isArray(value);
  }



  /**
     * Returns the arity (number of arguments) of the function
     * @param {*} func - the function
     * @returns {*} - the arity
     */
  function getFunctionArity(func) {
    var arity = typeof func.arity === 'number' ? func.arity :
      typeof func.implementation === 'function' ? func.implementation.length :
        typeof func.length === 'number' ? func.length : func.arguments.length;
    return arity;
  }

  /**
     * Tests whether arg is a lambda function
     * @param {*} arg - the value to test
     * @returns {boolean} - true if it is a lambda function
     */
  function isLambda(arg) {
    return arg && arg._fumifier_lambda === true;
  }

  /* c8 ignore next */
  var iteratorSymbol = (typeof Symbol === "function" ? Symbol : {}).iterator || "@@iterator";

  /**
     * @param {Object} arg - expression to test
     * @returns {boolean} - true if it is iterable
     */
  function isIterable(arg) {
    return (
      typeof arg === 'object' &&
            arg !== null &&
            iteratorSymbol in arg &&
            'next' in arg &&
            typeof arg.next === 'function'
    );
  }

  /**
     * Compares two values for equality
     * @param {*} lhs first value
     * @param {*} rhs second value
     * @returns {boolean} true if they are deep equal
     */
  function isDeepEqual(lhs, rhs) {
    if (lhs === rhs) {
      return true;
    }
    if(typeof lhs === 'object' && typeof rhs === 'object' && lhs !== null && rhs !== null) {
      if(Array.isArray(lhs) && Array.isArray(rhs)) {
        // both arrays (or sequences)
        // must be the same length
        if(lhs.length !== rhs.length) {
          return false;
        }
        // must contain same values in same order
        for(var ii = 0; ii < lhs.length; ii++) {
          if(!isDeepEqual(lhs[ii], rhs[ii])) {
            return false;
          }
        }
        return true;
      }
      // both objects
      // must have the same set of keys (in any order)
      var lkeys = Object.getOwnPropertyNames(lhs);
      var rkeys = Object.getOwnPropertyNames(rhs);
      if(lkeys.length !== rkeys.length) {
        return false;
      }
      lkeys = lkeys.sort();
      rkeys = rkeys.sort();
      for(ii=0; ii < lkeys.length; ii++) {
        if(lkeys[ii] !== rkeys[ii]) {
          return false;
        }
      }
      // must have the same values
      for(ii=0; ii < lkeys.length; ii++) {
        var key = lkeys[ii];
        if(!isDeepEqual(lhs[key], rhs[key])) {
          return false;
        }
      }
      return true;
    }
    return false;
  }

  /**
     * @param {Object} arg - expression to test
     * @returns {boolean} - true if it is a promise
     */
  function isPromise(arg) {
    return (
      typeof arg === 'object' &&
                arg !== null &&
                'then' in arg &&
                typeof arg.then === 'function'
    );
  }

  /**
     * converts a string to an array of characters
     * @param {string} str - the input string
     * @returns {Array} - the array of characters
     */
  function stringToArray(str) {
    var arr = [];
    for (let char of str) {
      arr.push(char);
    }
    return arr;
  }

  var chainAST = {"type":"lambda","arguments":[{"value":"f","type":"variable","position":11,"line":1},{"value":"g","type":"variable","position":15,"line":1}],"position":9,"line":1,"body":{"type":"lambda","arguments":[{"value":"x","type":"variable","position":30,"line":1}],"position":28,"line":1,"body":{"type":"lambda","thunk":true,"arguments":[],"position":36,"line":1,"body":{"type":"function","value":"(","position":36,"line":1,"arguments":[{"type":"function","value":"(","position":39,"line":1,"arguments":[{"value":"x","type":"variable","position":41,"line":1}],"procedure":{"value":"f","type":"variable","position":38,"line":1}}],"procedure":{"value":"g","type":"variable","position":35,"line":1}}}}};

  /**
   * Generates a UUID v5-like identifier from a string using SHA-1.
   * RFC 4122 variant bits are set; version is set to 5.
   * @param {string} seedString - Input string to derive the UUID from
   * @returns {string} - Deterministic UUID string
   */
  function uuidFromString(seedString) {
    const hash = createHash('sha1').update(seedString).digest(); // Buffer (20 bytes)
    const b = Buffer.from(hash.slice(0, 16));
    // Set version 5 (0101)
    b[6] = (b[6] & 0x0f) | 0x50;
    // Set variant RFC 4122 (10xxxxxx)
    b[8] = (b[8] & 0x3f) | 0x80;
    const hex = b.toString('hex');
    return (
      hex.slice(0, 8) + '-' +
      hex.slice(8, 12) + '-' +
      hex.slice(12, 16) + '-' +
      hex.slice(16, 20) + '-' +
      hex.slice(20)
    );
  }

  /**
   * Generates a UUID based on a seed or random if no seed provided
   * @param {*} [seed] - optional seed value (will be stringified if not a string)
   * @returns {string} - UUID string
   */
  function generateUuid(seed) {
    if (typeof seed === 'undefined') {
      return randomUUID();
    }

    // Stringify the seed if it's not already a string
    const seedString = typeof seed === 'string' ? seed : JSON.stringify(seed);
    return uuidFromString(seedString);
  }

  /**
   * Internal UUID generation for Flash evaluator - always requires a seed
   * @param {*} seed - seed value (must be a FHIR resource object with resourceType)
   * @returns {string} - UUID string
   */
  function generateSeededUuid(seed) {
    if (typeof seed === 'undefined' || seed === null) {
      throw {
        code: "F3015",
        stack: (new Error()).stack
      };
    }

    // Must be an object (not array) with resourceType field
    if (typeof seed !== 'object' || Array.isArray(seed) || typeof seed.resourceType !== 'string') {
      throw {
        code: "F3015",
        stack: (new Error()).stack
      };
    }

    return generateUuid(seed);
  }

  /**
   * Generates a FHIR reference with urn:uuid: prefix
   * @param {Object} resource - FHIR resource object with resourceType
   * @returns {string} - FHIR reference string with urn:uuid: prefix
   */
  function generateReference(resource) {
    return 'urn:uuid:' + generateSeededUuid(resource);
  }

  return {
    isNumeric,
    isArrayOfStrings,
    isArrayOfNumbers,
    createSequence,
    isSequence,
    isFunction,
    isLambda,
    isIterable,
    getFunctionArity,
    isDeepEqual,
    stringToArray,
    isPromise,
    chainAST,
    generateUuid,
    generateSeededUuid,
    generateReference
  };
})();

export default utils;
