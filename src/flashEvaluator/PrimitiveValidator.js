/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

/**
 * @module PrimitiveValidator
 * @description Dispatcher for system primitive validation/canonicalization.
 * Centralizes policy gates and routes to specialized validators.
 */

import fn from '../utils/functions.js';
import FlashErrorGenerator from './FlashErrorGenerator.js';
import SystemPrimitiveValidator from './SystemPrimitiveValidator.js';
import DateLikeCanonicalizer from './DateLikeCanonicalizer.js';
import StringLikeValidator from './StringLikeValidator.js';
import createPolicy from '../utils/policy.js';

/**
 * Central entry-point for primitive validation that delegates to specialized modules.
 */
export default class PrimitiveValidator {
  /**
   * Validate and canonicalize a system primitive according to its FHIR type code.
   * Mirrors prior logic from flashEvaluator.parseSystemPrimitive, but routed via dedicated modules.
   *
   * @param {Object} expr Expression with FHIR context
   * @param {*} input Raw input (can be scalar or array)
   * @param {Object} elementDefinition Enriched ElementDefinition
   * @param {Object} environment Execution environment
   * @returns {*} Parsed/validated value, preserving array shape when input is array
   */
  static validate(expr, input, elementDefinition, environment) {
    const policy = createPolicy(environment);

    // Support array inputs by validating each item
    if (Array.isArray(input)) {
      return input.map(item => PrimitiveValidator.validate(expr, item, elementDefinition, environment));
    }

    // Validate input presence/visibility first
    const validation = SystemPrimitiveValidator.validateInput(input);
    if (!validation.isValid) {
      return undefined;
    }

    const rootFhirTypeId = expr.instanceof;
    const elementFlashPath = expr.flashPathRefKey.slice(rootFhirTypeId.length + 2);

    // Resolve FHIR type code
    const fhirTypeCode = elementDefinition.__fhirTypeCode;
    if (!fhirTypeCode) {
      /* c8 ignore next 5 */
      throw FlashErrorGenerator.createError('F3007', expr, {
        instanceOf: rootFhirTypeId,
        fhirElement: elementFlashPath
      });
    }

    // Type check (F5101 gated)
    let valueType;
    if (!policy.shouldValidate('F5101')) {
      valueType = fn.type(input);
    } else {
      valueType = SystemPrimitiveValidator.validateType(input, expr, elementFlashPath);
    }

    // Route: date-like canonicalization
    const isDateLike = fhirTypeCode === 'date' || fhirTypeCode === 'dateTime' || fhirTypeCode === 'instant';
    const isDateLikeInputType = valueType === 'string' || valueType === 'number';
    if (isDateLike && isDateLikeInputType) {
      return DateLikeCanonicalizer.canonicalize(
        expr,
        input,
        fhirTypeCode,
        elementFlashPath,
        environment,
        policy
      );
    }

    // Route: string-like validation
    const isStringLike = fhirTypeCode === 'string' || fhirTypeCode === 'markdown' || fhirTypeCode === 'code';
    if (isStringLike) {
      return StringLikeValidator.validate(expr, input, fhirTypeCode, elementFlashPath, policy, elementDefinition);
    }

    // Regex-level inhibition gate for remaining types
    if (!policy.shouldValidate('F5110')) {
      return input;
    }

    // Optional regex constraint (skip for boolean types like we do for dates and strings)
    const isBooleanLike = fhirTypeCode === 'boolean';
    if (!isDateLike && !isStringLike && !isBooleanLike && elementDefinition.__regexStr) {
      const regexTester = PrimitiveValidator.getRegexTester(environment, elementDefinition.__regexStr);
      if (regexTester && !regexTester.test(fn.string(input))) {
        const err = FlashErrorGenerator.createError('F5110', expr, {
          value: input,
          regex: elementDefinition.__regexStr,
          fhirElement: elementFlashPath,
          fhirType: fhirTypeCode
        });
        if (policy.enforce(err)) {
          throw err;
        }
        // downgraded: continue with the raw input
      }
    }

    // Optional maxLength constraint validation (applies to all string-convertible types)
    if (elementDefinition.__maxLength !== undefined) {
      input = SystemPrimitiveValidator.validateMaxLength(
        input,
        elementDefinition.__maxLength,
        expr,
        elementFlashPath,
        fhirTypeCode,
        policy
      );
    }

    // Convert to target JSON type
    return SystemPrimitiveValidator.convertValue(input, fhirTypeCode, valueType);
  }

  /**
   * Get compiled FHIR regex tester from environment (dispatcher-owned).
   * @param {Object} environment Execution environment
   * @param {string} regexStr Regex string
   * @returns {RegExp|undefined} Compiled regex instance or undefined when not available
   */
  static getRegexTester(environment, regexStr) {
    let compiled = environment.lookup(Symbol.for('fumifier.__compiledFhirRegex_GET'))(regexStr);
    if (compiled) return compiled;
    compiled = environment.lookup(Symbol.for('fumifier.__compiledFhirRegex_SET'))(regexStr);
    return compiled;
  }
}
