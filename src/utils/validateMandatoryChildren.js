/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

/**
 * @module validateMandatoryChildren
 * @description Utility for validating mandatory FHIR children elements
 */

import FlashErrorGenerator from '../flashEvaluator/FlashErrorGenerator.js';
import createPolicy from './policy.js';

/**
 * Validate mandatory children for a given result object
 * @param {Object} result - Result object to validate
 * @param {Array} mandatories - Array of mandatory element definitions
 * @param {Object} expr - Original expression for error context
 * @param {Object} environment - Environment with policy/diagnostics
 * @param {string} [customParentPath] - Optional custom parent path for error context
 */
export default function validateMandatoryChildren(result, mandatories, expr, environment, customParentPath) {
  if (!result || typeof result !== 'object' || !mandatories || !Array.isArray(mandatories)) {
    return; // nothing to validate
  }

  const policy = createPolicy(environment);

  // Check each mandatory element
  for (const mandatory of mandatories) {
    const isSatisfied = mandatory.kind ?
      // non-polymorphic
      mandatory.names.some(mandatoryName =>
        Object.prototype.hasOwnProperty.call(result, mandatoryName) ||
        (mandatory.kind === 'primitive-type' && Object.prototype.hasOwnProperty.call(result, `_${mandatoryName}`))
      ) :
      // polymorphic
      mandatory.names.some(mandatoryName =>
        Object.prototype.hasOwnProperty.call(result, mandatoryName) ||
        Object.prototype.hasOwnProperty.call(result, `_${mandatoryName}`)
      );

    if (!isSatisfied) {
      const parentPath = customParentPath || (expr.flashPathRefKey || expr.instanceof);
      const err = FlashErrorGenerator.createFhirContextError("F5130", expr, {
        fhirParent: parentPath.replace('::', '/'),
        fhirElement: mandatory.__flashPathRefKey.split('::')[1],
      });
      if (policy.enforce(err)) {
        throw err;
      }
    }
  }
}