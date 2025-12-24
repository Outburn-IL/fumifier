/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

/* eslint-disable require-jsdoc */
/* eslint-disable valid-jsdoc */

import createPolicy from './policy.js';
import { populateMessage } from './errorCodes.js';

function createTerminologyWrappers(getTerminologyRuntime) {
  function handleError(err, environment) {
    try { populateMessage(err); } catch (_) { /* ignore */ }
    const policy = createPolicy(environment);
    if (policy.enforce(err)) {
      throw err;
    }
    return undefined;
  }

  function getRuntimeOrThrow(environment, operationName) {
    const runtime = getTerminologyRuntime(environment);
    if (!runtime) {
      return handleError({
        code: 'F5305',
        operation: operationName,
        stack: (new Error()).stack
      }, environment);
    }
    return runtime;
  }

  function toCodingLike(target) {
    if (!target || typeof target !== 'object') return undefined;
    const { system, code, display, version } = target;
    if (!system || !code) return undefined;
    const coding = { system, code };
    if (typeof display === 'string' && display) coding.display = display;
    if (typeof version === 'string' && version) coding.version = version;
    return coding;
  }

  function maybeCollapseArray(items) {
    if (!Array.isArray(items) || items.length === 0) return undefined;
    return items.length === 1 ? items[0] : items;
  }

  return {
    /**
     * $inValueSet(codeOrCoding, valueSetKey, sourcePackage?) -> MembershipResult
     */
    inValueSet: async function(codeOrCoding, valueSetKey, sourcePackage) {
      const runtime = getRuntimeOrThrow(this.environment, 'inValueSet');
      if (!runtime) return undefined;
      return await runtime.inValueSet(codeOrCoding, valueSetKey, sourcePackage);
    },

    /**
     * $expandValueSet(valueSetKey, sourcePackage?) -> expanded ValueSet resource
     */
    expandValueSet: async function(valueSetKey, sourcePackage) {
      const runtime = getRuntimeOrThrow(this.environment, 'expandValueSet');
      if (!runtime) return undefined;
      return await runtime.expandValueSet(valueSetKey, sourcePackage);
    },

    /**
     * $translateCode(codeOrCoding, conceptMapKey, packageFilter?) -> code | code[] | undefined
     */
    translateCode: async function(codeOrCoding, conceptMapKey, packageFilter) {
      const runtime = getRuntimeOrThrow(this.environment, 'translateConceptMap');
      if (!runtime) return undefined;
      const result = await runtime.translateConceptMap(codeOrCoding, conceptMapKey, packageFilter);
      if (!result || result.status !== 'mapped') return undefined;
      const codes = (result.targets || []).map(t => t && t.code).filter(Boolean);
      return maybeCollapseArray(codes);
    },

    /**
     * $translateCoding(codeOrCoding, conceptMapKey, packageFilter?) -> Coding | Coding[] | undefined
     */
    translateCoding: async function(codeOrCoding, conceptMapKey, packageFilter) {
      const runtime = getRuntimeOrThrow(this.environment, 'translateConceptMap');
      if (!runtime) return undefined;
      const result = await runtime.translateConceptMap(codeOrCoding, conceptMapKey, packageFilter);
      if (!result || result.status !== 'mapped') return undefined;
      const codings = (result.targets || []).map(toCodingLike).filter(Boolean);
      return maybeCollapseArray(codings);
    },

    /**
     * $translate(codeOrCoding, conceptMapKey, packageFilter?) -> code|code[]|Coding|Coding[]|undefined
     */
    translate: async function(codeOrCoding, conceptMapKey, packageFilter) {
      if (typeof codeOrCoding === 'string') {
        return await this.translateCode(codeOrCoding, conceptMapKey, packageFilter);
      }
      return await this.translateCoding(codeOrCoding, conceptMapKey, packageFilter);
    }
  };
}

export default createTerminologyWrappers;
