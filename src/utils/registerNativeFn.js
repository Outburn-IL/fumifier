/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

This file includes and modifies code from JSONata (https://github.com/jsonata-js/jsonata).
JSONata portions: © IBM Corp. 2016–2018, licensed under the MIT License.
See NOTICE and LICENSES/MIT-JSONata.txt for details.

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

/* eslint-disable require-jsdoc */
import fn from './functions.js';
import datetime from './datetime.js';
import defineFunction from './defineFunction.js';

/**
 * Clones an object
 * @param {Object} arg - object to clone (deep copy)
 * @returns {*} - the cloned object
 */
function functionClone(arg) {
  // undefined inputs always return undefined
  if(typeof arg === 'undefined') {
    return undefined;
  }

  return JSON.parse(fn.string(arg));
}

// Function registration
function registerNativeFn(staticFrame, functionEval) {
  // Registering native functions with their signatures
  staticFrame.bind('sum', defineFunction(fn.sum, '<a<n>:n>'));
  staticFrame.bind('count', defineFunction(fn.count, '<a:n>'));
  staticFrame.bind('max', defineFunction(fn.max, '<a<n>:n>'));
  staticFrame.bind('min', defineFunction(fn.min, '<a<n>:n>'));
  staticFrame.bind('average', defineFunction(fn.average, '<a<n>:n>'));
  staticFrame.bind('string', defineFunction(fn.string, '<x-b?:s>'));
  staticFrame.bind('substring', defineFunction(fn.substring, '<s-nn?:s>'));
  staticFrame.bind('substringBefore', defineFunction(fn.substringBefore, '<s-s:s>'));
  staticFrame.bind('substringAfter', defineFunction(fn.substringAfter, '<s-s:s>'));
  staticFrame.bind('lowercase', defineFunction(fn.lowercase, '<s-:s>'));
  staticFrame.bind('uppercase', defineFunction(fn.uppercase, '<s-:s>'));
  staticFrame.bind('length', defineFunction(fn.length, '<s-:n>'));
  staticFrame.bind('trim', defineFunction(fn.trim, '<s-:s>'));
  staticFrame.bind('pad', defineFunction(fn.pad, '<s-ns?:s>'));
  staticFrame.bind('match', defineFunction(fn.match, '<s-f<s:o>n?:a<o>>'));
  staticFrame.bind('contains', defineFunction(fn.contains, '<s-(sf):b>')); // TODO <s-(sf<s:o>):b>
  staticFrame.bind('replace', defineFunction(fn.replace, '<s-(sf)(sf)n?:s>')); // TODO <s-(sf<s:o>)(sf<o:s>)n?:s>
  staticFrame.bind('split', defineFunction(fn.split, '<s-(sf)n?:a<s>>')); // TODO <s-(sf<s:o>)n?:a<s>>
  staticFrame.bind('join', defineFunction(fn.join, '<a<s>s?:s>'));
  staticFrame.bind('formatNumber', defineFunction(fn.formatNumber, '<n-so?:s>'));
  staticFrame.bind('formatBase', defineFunction(fn.formatBase, '<n-n?:s>'));
  staticFrame.bind('formatInteger', defineFunction(datetime.formatInteger, '<n-s:s>'));
  staticFrame.bind('parseInteger', defineFunction(datetime.parseInteger, '<s-s:n>'));
  staticFrame.bind('number', defineFunction(fn.number, '<(nsb)-:n>'));
  staticFrame.bind('floor', defineFunction(fn.floor, '<n-:n>'));
  staticFrame.bind('ceil', defineFunction(fn.ceil, '<n-:n>'));
  staticFrame.bind('round', defineFunction(fn.round, '<n-n?:n>'));
  staticFrame.bind('abs', defineFunction(fn.abs, '<n-:n>'));
  staticFrame.bind('sqrt', defineFunction(fn.sqrt, '<n-:n>'));
  staticFrame.bind('power', defineFunction(fn.power, '<n-n:n>'));
  staticFrame.bind('random', defineFunction(fn.random, '<:n>'));
  staticFrame.bind('boolean', defineFunction(fn.boolean, '<x-:b>'));
  staticFrame.bind('not', defineFunction(fn.not, '<x-:b>'));
  staticFrame.bind('map', defineFunction(fn.map, '<af>'));
  staticFrame.bind('zip', defineFunction(fn.zip, '<a+>'));
  staticFrame.bind('filter', defineFunction(fn.filter, '<af>'));
  // Parallel higher-order functions
  staticFrame.bind('pMap', defineFunction(fn.pMap, '<af>'));
  // signature: array, number, function (mapper), optional function (key)
  staticFrame.bind('pLimit', defineFunction(fn.pLimit, '<anff?>'));
  staticFrame.bind('first', defineFunction(fn.first, '<af>'));
  staticFrame.bind('single', defineFunction(fn.single, '<af?>'));
  staticFrame.bind('reduce', defineFunction(fn.foldLeft, '<afj?:j>')); // TODO <f<jj:j>a<j>j?:j>
  staticFrame.bind('sift', defineFunction(fn.sift, '<o-f?:o>'));
  staticFrame.bind('keys', defineFunction(fn.keys, '<x-:a<s>>'));
  staticFrame.bind('lookup', defineFunction(fn.lookup, '<x-s:x>'));
  staticFrame.bind('append', defineFunction(fn.append, '<xx:a>'));
  staticFrame.bind('exists', defineFunction(fn.exists, '<x:b>'));
  staticFrame.bind('spread', defineFunction(fn.spread, '<x-:a<o>>'));
  staticFrame.bind('merge', defineFunction(fn.merge, '<a<o>:o>'));
  staticFrame.bind('reverse', defineFunction(fn.reverse, '<a:a>'));
  staticFrame.bind('each', defineFunction(fn.each, '<o-f:a>'));
  staticFrame.bind('error', defineFunction(fn.error, '<s?:x>'));
  staticFrame.bind('assert', defineFunction(fn.assert, '<bs?:x>'));
  staticFrame.bind('type', defineFunction(fn.type, '<x:s>'));
  staticFrame.bind('sort', defineFunction(fn.sort, '<af?:a>'));
  staticFrame.bind('shuffle', defineFunction(fn.shuffle, '<a:a>'));
  staticFrame.bind('distinct', defineFunction(fn.distinct, '<x:x>'));
  staticFrame.bind('base64encode', defineFunction(fn.base64encode, '<s-:s>'));
  staticFrame.bind('base64decode', defineFunction(fn.base64decode, '<s-:s>'));
  staticFrame.bind('encodeUrlComponent', defineFunction(fn.encodeUrlComponent, '<s-:s>'));
  staticFrame.bind('encodeUrl', defineFunction(fn.encodeUrl, '<s-:s>'));
  staticFrame.bind('decodeUrlComponent', defineFunction(fn.decodeUrlComponent, '<s-:s>'));
  staticFrame.bind('decodeUrl', defineFunction(fn.decodeUrl, '<s-:s>'));
  staticFrame.bind('eval', defineFunction(functionEval, '<sx?:x>'));
  staticFrame.bind('toMillis', defineFunction(datetime.toMillis, '<s-s?:n>'));
  staticFrame.bind('fromMillis', defineFunction(datetime.fromMillis, '<n-s?s?:s>'));
  staticFrame.bind('clone', defineFunction(functionClone, '<(oa)-:o>'));
  // FUME functions added as native functions:
  staticFrame.bind('startsWith', defineFunction(fn.startsWith, '<s-s:b>'));
  staticFrame.bind('endsWith', defineFunction(fn.endsWith, '<s-s:b>'));
  staticFrame.bind('matches', defineFunction(fn.matches, '<s-sa<s>?:b>'));
  staticFrame.bind('isEmpty', defineFunction(fn.isEmpty, '<x-:b>'));
  staticFrame.bind('isNumeric', defineFunction(fn.isNumeric, '<j-:b>'));
  staticFrame.bind('wait', defineFunction(fn.wait), '<n->');
  staticFrame.bind('rightNow', defineFunction(fn.rightNow), '<:n>');
  staticFrame.bind('initCapOnce', defineFunction(fn.initCapOnce, '<s-:s>'));
  staticFrame.bind('initCap', defineFunction(fn.initCap, '<s-:s>'));
  staticFrame.bind('uuid', defineFunction(fn.uuid, '<j?:s>'));
  staticFrame.bind('reference', defineFunction(fn.reference, '<o-:s>'));
  staticFrame.bind('hash', defineFunction(fn.hash, '<j-:n>'));
}

export default registerNativeFn;