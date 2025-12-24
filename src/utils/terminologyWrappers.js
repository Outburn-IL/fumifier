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

  function normalizeErrorMessage(e) {
    if (!e) return 'Unknown error';
    if (typeof e === 'string') return e;
    if (typeof e.message === 'string' && e.message) return e.message;
    try { return JSON.stringify(e); } catch (_) { return String(e); }
  }

  function stringifyCodeOrCoding(codeOrCoding) {
    if (typeof codeOrCoding === 'string') return codeOrCoding;
    if (!codeOrCoding || typeof codeOrCoding !== 'object') return String(codeOrCoding);
    if (typeof codeOrCoding.code === 'string') {
      const sys = (typeof codeOrCoding.system === 'string' && codeOrCoding.system) ? codeOrCoding.system : undefined;
      return sys ? `${sys}|${codeOrCoding.code}` : codeOrCoding.code;
    }
    if (typeof codeOrCoding.value === 'string') return codeOrCoding.value;
    try { return JSON.stringify(codeOrCoding); } catch (_) { return String(codeOrCoding); }
  }

  function getRuntimeOrThrow(environment, operationName) {
    const runtime = getTerminologyRuntime(environment);
    if (!runtime) {
      return handleError({
        code: 'F5215',
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

  function isSuccessfulConceptMapTranslationResult(result) {
    return !!result && result.status === 'mapped';
  }

  async function translateConceptMapSafe(environment, codeOrCoding, conceptMapKey, packageFilter) {
    const runtime = getRuntimeOrThrow(environment, 'translateConceptMap');
    if (!runtime) return undefined;

    let result;
    try {
      result = await runtime.translateConceptMap(codeOrCoding, conceptMapKey, packageFilter);
    } catch (e) {
      handleError({
        code: 'F5214',
        operation: 'translateConceptMap',
        conceptMapKey,
        errorMessage: normalizeErrorMessage(e),
        stack: (e && e.stack) ? e.stack : (new Error()).stack
      }, environment);
      return undefined;
    }

    // Emit a debug diagnostic if no translation was performed.
    // (Keep this non-fatal; caller still receives undefined for unmapped.)
    if (result && result.status === 'unmapped') {
      handleError({
        code: 'F5321',
        operation: 'translateConceptMap',
        conceptMapKey,
        value: stringifyCodeOrCoding(codeOrCoding),
        status: result.status,
        reason: result.reason,
        stack: (new Error()).stack
      }, environment);
    }

    return result;
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
      const result = await translateConceptMapSafe(this.environment, codeOrCoding, conceptMapKey, packageFilter);
      if (!isSuccessfulConceptMapTranslationResult(result)) return undefined;
      const codes = (result.targets || []).map(t => t && t.code).filter(Boolean);
      return maybeCollapseArray(codes);
    },

    /**
     * $translateCoding(codeOrCoding, conceptMapKey, packageFilter?) -> Coding | Coding[] | undefined
     */
    translateCoding: async function(codeOrCoding, conceptMapKey, packageFilter) {
      const result = await translateConceptMapSafe(this.environment, codeOrCoding, conceptMapKey, packageFilter);
      if (!isSuccessfulConceptMapTranslationResult(result)) return undefined;
      const codings = (result.targets || []).map(toCodingLike).filter(Boolean);
      return maybeCollapseArray(codings);
    },

    /**
     * $translate(codeOrCoding, conceptMapKey, packageFilter?) -> code|code[]|Coding|Coding[]|undefined
     */
    translate: async function(codeOrCoding, conceptMapKey, packageFilter) {
      const environment = this.environment;
      const isCode =
        (typeof codeOrCoding === 'string') ||
        (
          codeOrCoding &&
          typeof codeOrCoding === 'object' &&
          typeof codeOrCoding.value === 'string' &&
          !('code' in codeOrCoding)
        );

      const normalized =
        (isCode && codeOrCoding && typeof codeOrCoding === 'object') ?
          codeOrCoding.value :
          codeOrCoding;

      const result = await translateConceptMapSafe(environment, normalized, conceptMapKey, packageFilter);
      if (!isSuccessfulConceptMapTranslationResult(result)) return undefined;

      if (isCode) {
        const codes = (result.targets || []).map(t => t && t.code).filter(Boolean);
        return maybeCollapseArray(codes);
      }

      const codings = (result.targets || []).map(toCodingLike).filter(Boolean);
      return maybeCollapseArray(codings);
    }
  };
}

export default createTerminologyWrappers;
