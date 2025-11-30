/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

/**
 * @module FlashEvaluator
 * @description FLASH (FHIR-specific) evaluation functions for Fumifier
 */

import fn from './utils/functions.js';
import FlashErrorGenerator from './flashEvaluator/FlashErrorGenerator.js';
import ChildValueProcessor from './flashEvaluator/ChildValueProcessor.js';
import VirtualRuleEvaluator from './flashEvaluator/VirtualRuleEvaluator.js';
import MetaProfileInjector from './flashEvaluator/MetaProfileInjector.js';
import ResultProcessor from './flashEvaluator/ResultProcessor.js';
import { createFhirPrimitive, isFhirPrimitive } from './flashEvaluator/FhirPrimitive.js';
import { createFlashRuleResult, createFlashRuleResultArray } from './flashEvaluator/FlashRuleResult.js';
import createPolicy from './utils/policy.js';
import PrimitiveValidator from './flashEvaluator/PrimitiveValidator.js';
import validateMandatoryChildren from './utils/validateMandatoryChildren.js';

/**
 * Flash evaluation module that contains all FLASH-specific evaluation logic
 * @param {Function} evaluate - Main evaluate function from fumifier (jsonata)
 * @returns {Object} Flash evaluation functions
 */
function createFlashEvaluator(evaluate) {

  /**
   * Parse and validate system primitive values according to the type's constraints.
   * A system primitive is a type that is referred with a "code" that is a URI starting with `http://hl7.org/fhirpath/System.`.
   * For example, `http://hl7.org/fhirpath/System.String` is the system primitive for strings, found in Resource.id, Extension.url, etc.
   * This function also handles the actual primitive `value` of a FHIR primitive type (e.g. `string.value`, `boolean.value`), which is itself a system primitive.
   * @param {Object} expr - Expression with FHIR context
   * @param {*} input - Input value to parse
   * @param {Object} elementDefinition - FHIR element definition
   * @param {Object} environment - Environment with FHIR definitions
   * @returns {*} Parsed primitive value
   */
  function parseSystemPrimitive(expr, input, elementDefinition, environment) {
    return PrimitiveValidator.validate(expr, input, elementDefinition, environment);
  }

  /**
   * Ensure a Resource input is an object with a valid resourceType
   * @param {*} input - Input value to validate
   * @param {Object} expr - Expression with position info for errors
   * @param {Object} environment - Environment with policy/diagnostics
   * @returns {*} Validated resource input
   */
  function assertResourceInput(input, expr, environment) {
    const policy = createPolicy(environment);

    // Handle arrays of resources
    if (Array.isArray(input)) {
      return input.map(item => assertResourceInput(item, expr, environment));
    }

    // Input must be an object
    if (!input || typeof input !== 'object') {
      // Inhibition: skip this validation entirely when F5102 is outside validation band
      if (!policy.shouldValidate('F5102')) {
        return input; // inhibited: do not enforce object requirement
      }
      const err = {
        code: "F5102",
        stack: (new Error()).stack,
        position: expr.position,
        start: expr.start,
        line: expr.line,
        fhirParent: expr.instanceof,
        fhirElement: expr.flashPathRefKey.split('::')[1],
        valueType: typeof input
      };
      if (policy.enforce(err)) throw err;
      return input; // downgraded: keep invalid value visible
    }

    // Object must have resourceType attribute
    if (!input.resourceType || typeof input.resourceType !== 'string' || input.resourceType.trim() === '') {
      // Inhibition: skip this validation entirely when F5103 is outside validation band
      if (!policy.shouldValidate('F5103')) {
        return input; // inhibited: do not enforce resourceType requirement
      }
      const err = {
        code: "F5103",
        stack: (new Error()).stack,
        position: expr.position,
        start: expr.start,
        line: expr.line,
        fhirParent: expr.instanceof,
        fhirElement: expr.flashPathRefKey.split('::')[1]
      };
      if (policy.enforce(err)) throw err;
      return input; // downgraded: keep invalid value visible
    }

    return input;
  }

  /**
   * Once an expression flagged as a FLASH rule is evaluated, this function is called on the result
   * to validate it according to its element definition and return it as a flashrule result object.
   * @param {*} expr The AST node of the FLASH rule - includes references to FHIR definitions
   * @param {*} input The unsanitized results of evaluating just the expression. Could be anything, including arrays.
   * @param {*} environment The environment envelope that contains the FHIR definitions and variable scope
   * @returns {Promise<{Object}>} Evaluated, validated and wrapped flash rule
   */
  function finalizeFlashRuleResult(expr, input, environment) {
    // Ensure the expression refers to a valid FHIR element

    if (!expr.flashPathRefKey) {
      /* c8 ignore next 2 */
      throw FlashErrorGenerator.createSimpleError("F3000", expr);
    }
    // lookup the definition of the element
    const elementDefinition = getElementDefinition(environment, expr);

    if (!elementDefinition) {
      /* c8 ignore next 2 */
      throw FlashErrorGenerator.createSimpleError("F3003", expr);
    }

    if (
      !(elementDefinition?.__name) || // should have a name array set on the enriched definition
      !Array.isArray(elementDefinition.__name) || // should be an array
      elementDefinition.__name.length > 1 // no more than one option
    ) {
      /* c8 ignore next 2 */
      throw FlashErrorGenerator.createSimpleError("F3005", expr);
    }

    // get the kind of the element
    const kind = elementDefinition.__kind;
    /* c8 ignore next 3 */
    if (!kind) {
      throw FlashErrorGenerator.createSimpleError("F3004", expr);
    }

    // get the json element name. there can only be one name at this stage, otherwise we would have thrown earlier
    const jsonElementName = elementDefinition.__name[0];
    // is it a base poly element (reduced to a single type by profile or flash path disambiguation)?
    const isBasePoly = elementDefinition.base?.path?.endsWith('[x]');
    // if there's a slice name in the element definition,
    // it is an "official" slice and must be used in the grouping key.
    // UNLESS this is a polymorphic element at the base...
    // in which case slices can only correspond to a type, and the type is already represented in the jsonElementName.
    const sliceName = isBasePoly ? undefined : elementDefinition.sliceName || undefined;
    // generate the grouping key for the element
    const groupingKey = sliceName ? `${jsonElementName}:${sliceName}` : jsonElementName;

    // create a container object for the evaluated flash rule
    const result = createFlashRuleResult(groupingKey, kind);

    // handle system primitive's inline value
    // their value is just the primitive- no children are ever possible
    if (kind === 'system') {
      const resultValue = parseSystemPrimitive(expr, input, elementDefinition, environment);
      // if the result value is an array, take only the last one
      // (system primitives are never arrays in FHIR base definitions - confirmed from R4 core package scan)
      if (Array.isArray(resultValue)) {
        /* c8 ignore next */
        result.value = resultValue[resultValue.length - 1];
      } else {
        result.value = resultValue;
      }
      return result;
    }

    // handle FHIR primitives' inline value
    // this is treated as the primitive value of the 'value' child element
    // (we treat FHIR primitives as objects since they can have children)
    if (kind === 'primitive-type') {
      const evaluated = parseSystemPrimitive(
        expr,
        input.value, // input's `value` attribute is the primitive value we parse
        elementDefinition,
        environment
      );

      // handle array primitive inline assignments by returning multiple FlashRuleResults
      if (Array.isArray(input.value)) {
        // evaluated is an array of parsed primitive values (because parseSystemPrimitive maps arrays)
        const primitiveItems = evaluated.map(item => createFhirPrimitive({ value: item }));
        const resultsArray = createFlashRuleResultArray(groupingKey, kind, primitiveItems);
        resultsArray.forEach(r => validatePrimitiveBinding(r, elementDefinition, expr, environment));
        return resultsArray; // return early with array of FlashRuleResults
      }

      // For primitive types, result.value is always an object even if there's no value
      // This is necessary for elements that have children (extension or id) but no value
      result.value = createFhirPrimitive({
        ...input,
        value: evaluated // Assign the evaluated value to the 'value' key (can be undefined)
      });
      validatePrimitiveBinding(result, elementDefinition, expr, environment);
      return result;
    }

    // Handle complex types and Resource datatype.
    // NOTE: Arrays can reach this point in two ways:
    // 1. From child expressions (sub-rules) - handled here
    // 2. From inline array assignments - handled earlier in evaluateFlash with validation
    // This separation ensures proper validation timing for policy inhibition
    if (Array.isArray(input)) {
      // Return an array where each object becomes a separate FlashRuleResult
      return createFlashRuleResultArray(groupingKey, kind, input);
    } else {
      // Single object
      result.value = input;
    }

    return result;
  }

  /**
   * Retrieve resolved ValueSet expansions dictionary from environment
   * @param {Object} environment Execution environment
   * @returns {Object} Map of vsRefKey -> expansion dictionary
   */
  function getResolvedValueSetDict(environment) {
    const defs = getFhirDefinitionsDictinary(environment);
    return defs?.resolvedValueSetExpansions || {};
  }

  /**
   * Test if primitive value exists in any system bucket of expansion dict
   * @param {string} codeVal Primitive code string
   * @param {Object} expansionDict Expansion dictionary { system: { code: concept } }
   * @returns {boolean} True if found
   */
  function valueInExpansionPrimitive(codeVal, expansionDict) {
    if (codeVal === undefined || codeVal === null || codeVal === '') return false;
    for (const sys of Object.keys(expansionDict)) {
      if (expansionDict[sys] && expansionDict[sys][codeVal]) return true;
    }
    return false;
  }



  /**
   * Create structured binding validation error object
   * @param {string} code Error code
   * @param {Object} expr Expression node
   * @param {Object} elementDefinition ElementDefinition providing context
   * @param {Object} inserts Additional message inserts
   * @returns {Object} Error object
   */
  function createBindingError(code, expr, elementDefinition, inserts = {}) {
    return {
      code,
      stack: (new Error()).stack,
      position: expr.position,
      start: expr.start,
      line: expr.line,
      instanceOf: expr.instanceof,
      fhirElement: (expr.flashPathRefKey || '').slice(expr.instanceof.length + 2),
      bindingStrength: elementDefinition.__bindingStrength,
      expansionMode: elementDefinition.__vsExpansionMode,
      ...inserts
    };
  }

  /**
   * Validate a bound FHIR primitive (string|uri|code) against its ValueSet
   * @param {Object} resultObj FlashRuleResult for primitive
   * @param {Object} elementDefinition ElementDefinition
   * @param {Object} expr AST node
   * @param {Object} environment Execution environment
   */
  function validatePrimitiveBinding(resultObj, elementDefinition, expr, environment) {
    if (!elementDefinition.__bindingStrength) return; // no binding
    const strength = elementDefinition.__bindingStrength; // required | extensible
    const policy = createPolicy(environment);
    // Inhibit entire binding validation if outside validation band (performance optimization)
    const representativeCode = strength === 'required' ? 'F5120' : 'F5340';
    if (!policy.shouldValidate(representativeCode)) return;
    const typeCode = elementDefinition.__fhirTypeCode;
    if (!['string','uri','code'].includes(typeCode)) return; // only these primitives
    const valObj = resultObj.value; // FHIR primitive intermediate (object with value key)
    const val = valObj ? valObj.value : undefined;
    const mode = elementDefinition.__vsExpansionMode; // full | error | lazy
    const expansions = getResolvedValueSetDict(environment);
    const expansionDict = elementDefinition.__vsRefKey ? expansions[elementDefinition.__vsRefKey] : undefined;

    const hasValue = !(val === undefined || val === null || val === '');

    const codeMap = {
      required: { full: 'F5120', expansionError: 'F5310', expansionLazy: 'F5311' },
      extensible: { full: 'F5340', expansionError: 'F5330', expansionLazy: 'F5331' }
    };

    if (mode === 'error' || mode === 'lazy') {
      const errCode = mode === 'error' ? codeMap[strength].expansionError : codeMap[strength].expansionLazy;
      // Additional inhibition: if expansion error code itself is outside validation band, skip entirely
      if (!policy.shouldValidate(errCode)) return; // no diagnostic at all
      const err = createBindingError(errCode, expr, elementDefinition, { value: val, elementType: 'primitive' });
      if (policy.enforce(err)) throw err; // ensure throw honored
      return;
    }

    if (strength === 'required') {
      if (!hasValue || !valueInExpansionPrimitive(val, expansionDict || {})) {
        const err = createBindingError(codeMap.required.full, expr, elementDefinition, { value: val });
        if (policy.enforce(err)) throw err;
      }
    } else if (strength === 'extensible') {
      if (hasValue && !valueInExpansionPrimitive(val, expansionDict || {})) {
        const err = createBindingError(codeMap.extensible.full, expr, elementDefinition, { value: val });
        if (policy.enforce(err)) throw err;
      }
    }
  }

  /**
   * Find a concept in expansion by system and code
   * @param {string} system System URI
   * @param {string} code Code string
   * @param {Object} expansionDict Expansion dictionary
   * @returns {Object|null} The concept object or null if not found
   */
  function findConceptInExpansion(system, code, expansionDict) {
    if (!system || !code || !expansionDict) return null;
    const sysDict = expansionDict[system];
    return (sysDict && sysDict[code]) || null;
  }

  /**
   * Find a concept in expansion by code only (across all systems)
   * @param {string} code Code string
   * @param {Object} expansionDict Expansion dictionary
   * @returns {Object|null} The concept object if found in exactly one system, null otherwise
   */
  function findConceptByCode(code, expansionDict) {
    if (!code || !expansionDict) return null;
    let foundConcept = null;
    let matchCount = 0;

    for (const system of Object.keys(expansionDict)) {
      const sysDict = expansionDict[system];
      if (sysDict && sysDict[code]) {
        foundConcept = sysDict[code];
        matchCount++;
        if (matchCount > 1) return null; // Multiple matches, ambiguous
      }
    }

    return matchCount === 1 ? foundConcept : null;
  }

  /**
   * Helper function to reorder Coding/Quantity properties after context-dependent system/display injection
   * This is specifically for injections that happen when user provides code and system/display are derived from ValueSet
   * @param {Object} obj The Coding or Quantity object to reorder
   * @param {string} dataType The FHIR datatype name ('Coding' or 'Quantity')
   */
  function reorderCodingQuantityAfterContextInjection(obj, dataType) {
    if (!obj || typeof obj !== 'object') return;

    const elementOrder = dataType === 'Quantity' ?
      ['id', 'extension', 'value', 'comparator', 'unit', 'system', 'code'] :
      ['id', 'extension', 'system', 'version', 'code', 'display', 'userSelected']; // Coding

    const reordered = {};

    // Add properties in correct order, including their _ prefixed siblings
    for (const prop of elementOrder) {
      // Add the base property if it exists
      if (Object.prototype.hasOwnProperty.call(obj, prop)) {
        reordered[prop] = obj[prop];
      }

      // Add the corresponding _property if it exists (for FHIR primitive extensions)
      // Note: id and extension cannot have _ prefixed siblings since they are system/complex types
      const underscoreProp = `_${prop}`;
      if (prop !== 'id' && prop !== 'extension' && Object.prototype.hasOwnProperty.call(obj, underscoreProp)) {
        reordered[underscoreProp] = obj[underscoreProp];
      }
    }

    // Add any remaining properties not in the standard order
    for (const prop of Object.keys(obj)) {
      if (!elementOrder.includes(prop) && !elementOrder.some(baseProp => `_${baseProp}` === prop)) {
        reordered[prop] = obj[prop];
      }
    }

    // Replace object properties in place
    Object.keys(obj).forEach(key => delete obj[key]);
    Object.assign(obj, reordered);
  }

  /**
   * Process and validate complex Coding/Quantity/CodeableConcept binding with system/display injection
   * @param {string} kindCode Element type code (Coding|Quantity|CodeableConcept)
   * @param {Object} valueObj Evaluated value object (intermediate with primitives inside)
   * @param {Object} elementDefinition ElementDefinition
   * @param {Object} expr AST node
   * @param {Object} environment Execution environment
   * @returns {boolean} True if valueObj was modified (injection occurred)
   */
  function processCodingLike(kindCode, valueObj, elementDefinition, expr, environment) {
    const strength = elementDefinition.__bindingStrength;
    if (!strength) return false; // no binding

    const policy = createPolicy(environment);
    // Representative codes for inhibition decision - we always use required level for injection
    // since injection is performance-wise equivalent to validation
    const representativeCode = 'F5120'; // Use required validation threshold for all injection decisions
    if (!policy.shouldValidate(representativeCode)) return false; // skip entirely - both validation AND injection

    const mode = elementDefinition.__vsExpansionMode;
    const expansions = getResolvedValueSetDict(environment);
    const expansionDict = elementDefinition.__vsRefKey ? expansions[elementDefinition.__vsRefKey] : undefined;

    const codeMap = {
      Coding: { required: { full: 'F5121' }, extensible: { full: 'F5341' }, elementType: 'Coding' },
      Quantity: { required: { full: 'F5122' }, extensible: { full: 'F5342' }, elementType: 'Quantity' },
      CodeableConcept: { required: { full: 'F5123' }, extensible: { full: 'F5343' }, elementType: 'CodeableConcept' }
    };

    /**
     * Enforce a binding validation issue via policy.
     * @param {string} code Error code
     * @param {Object} inserts Additional inserts for message
     * @returns {void}
     */
    function enforce(code, inserts) {
      const err = createBindingError(code, expr, elementDefinition, inserts);
      if (policy.enforce(err)) throw err; // honor throwLevel
    }



    if (mode === 'error' || mode === 'lazy') {
      // Can't do injection without expansion, only validation errors
      let errCode;
      if (mode === 'error') {
        errCode = strength === 'required' ? 'F5310' : 'F5330';
      } else { // lazy
        errCode = strength === 'required' ? 'F5311' : 'F5331';
      }
      if (policy.shouldValidate(errCode)) {
        enforce(errCode, { elementType: codeMap[kindCode].elementType });
      }
      return false;
    }

    let injectionOccurred = false;

    if (kindCode === 'Coding' || kindCode === 'Quantity') {
      const system = valueObj?.system;
      const code = valueObj?.code;
      const display = valueObj?.display;
      const unit = valueObj?.unit;

      let concept = null;
      let validPair = false;

      // Try to find concept and validate
      if (system && code) {
        concept = findConceptInExpansion(system, code, expansionDict || {});
        validPair = !!concept;
      } else if (code && !system) {
        // Try system injection - find by code only if unambiguous
        concept = findConceptByCode(code, expansionDict || {});
        if (concept) {
          // Inject system
          valueObj.system = concept.system;
          injectionOccurred = true;
          validPair = true;

          // Reorder to maintain correct FHIR element order
          reorderCodingQuantityAfterContextInjection(valueObj, kindCode);
        }
      }

      // Inject display/unit if concept was found and display/unit not already set
      if (concept && validPair) {
        const displayField = kindCode === 'Quantity' ? 'unit' : 'display';
        const currentDisplayValue = kindCode === 'Quantity' ? unit : display;

        // Only inject if:
        // 1. No current display/unit value (not explicitly assigned by user)
        // 2. Concept has a display value from ValueSet expansion
        if (!currentDisplayValue && concept.display) {
          valueObj[displayField] = concept.display;
          injectionOccurred = true;

          // Reorder to maintain correct FHIR element order
          reorderCodingQuantityAfterContextInjection(valueObj, kindCode);
        }
      }      // Validation for required/extensible bindings only
      if (strength === 'required') {
        if (system && code && !validPair) {
          enforce(codeMap[kindCode].required.full, { system, code });
        }
      } else if (strength === 'extensible') {
        if (system && code && !validPair) {
          enforce(codeMap[kindCode].extensible.full, { system, code });
        }
      }
    } else if (kindCode === 'CodeableConcept') {
      const codings = Array.isArray(valueObj?.coding) ? valueObj.coding : [];
      let anyValid = false;

      for (const c of codings) {
        const system = c?.system;
        const code = c?.code;
        const display = c?.display;

        let concept = null;
        let validPair = false;

        // Try to find concept and validate
        if (system && code) {
          concept = findConceptInExpansion(system, code, expansionDict || {});
          validPair = !!concept;
          if (validPair) anyValid = true;
        } else if (code && !system) {
          // Try system injection - find by code only if unambiguous
          concept = findConceptByCode(code, expansionDict || {});
          if (concept) {
            // Inject system
            c.system = concept.system;
            injectionOccurred = true;
            validPair = true;
            anyValid = true;

            // Reorder to maintain correct FHIR element order
            reorderCodingQuantityAfterContextInjection(c, 'Coding');
          }
        }

        // Inject display if concept was found and display not already set
        if (concept && validPair && !display && concept.display) {
          c.display = concept.display;
          injectionOccurred = true;

          // Reorder to maintain correct FHIR element order
          reorderCodingQuantityAfterContextInjection(c, 'Coding');
        }
      }

      // Validation for required/extensible bindings only
      if (strength === 'required') {
        if (!anyValid && codings.length > 0) {
          enforce(codeMap.CodeableConcept.required.full, { codingCount: codings.length });
        }
      } else if (strength === 'extensible') {
        if (codings.length > 0 && !anyValid) {
          enforce(codeMap.CodeableConcept.extensible.full, { codingCount: codings.length });
        }
      }
    }

    return injectionOccurred;
  }



  /**
   * Handle inline array assignments for complex types and resources
   * This is a special case that bypasses normal child processing and returns early
   * @param {Object} expr - Flash rule expression
   * @param {Array} inlineArray - The inline array value
   * @param {string} kind - Element kind ('complex-type' or 'resource')
   * @param {Object} environment - Environment with FHIR definitions
   * @returns {Array} Array of FlashRuleResults
   */
  function handleInlineArrayAssignment(expr, inlineArray, kind, environment) {
    const elementDefinition = getElementDefinition(environment, expr);
    if (!elementDefinition) {
      return null; // Let normal processing handle this
    }

    const jsonElementName = elementDefinition.__name[0];
    const isBasePoly = elementDefinition.base?.path?.endsWith('[x]');
    const sliceName = isBasePoly ? undefined : elementDefinition.sliceName || undefined;
    const groupingKey = sliceName ? `${jsonElementName}:${sliceName}` : jsonElementName;

    // Special case: For Quantity arrays, wrap primitive values as { value: primitive }
    let processedInput = inlineArray;
    if (kind === 'complex-type' && elementDefinition.__fhirTypeCode === 'Quantity') {
      processedInput = inlineArray.map(item => {
        // If item is primitive (null or not an object), wrap it as { value: primitive }
        if (item === null || typeof item !== 'object') {
          // Validate and convert the primitive value
          const valueValueElementKey = `${expr.flashPathRefKey}.value.value`;
          const valueValueExpr = {
            ...expr,
            flashPathRefKey: valueValueElementKey,
            instanceof: expr.instanceof
          };
          const valueValueElementDefinition = getElementDefinition(environment, valueValueExpr);
          if (valueValueElementDefinition) {
            const validatedValue = PrimitiveValidator.validate(valueValueExpr, item, valueValueElementDefinition, environment);
            return { value: validatedValue };
          } else {
            return { value: item };
          }
        } else if (item.value !== undefined) {
          // If object already has a value property, validate/convert it
          const valueValueElementKey = `${expr.flashPathRefKey}.value.value`;
          const valueValueExpr = {
            ...expr,
            flashPathRefKey: valueValueElementKey,
            instanceof: expr.instanceof
          };
          const valueValueElementDefinition = getElementDefinition(environment, valueValueExpr);
          if (valueValueElementDefinition) {
            const validatedValue = PrimitiveValidator.validate(valueValueExpr, item.value, valueValueElementDefinition, environment);
            return { ...item, value: validatedValue };
          } else {
            return item;
          }
        }
        // Otherwise, keep the object as-is
        return item;
      });
    }

    // Apply resource validation if needed (CRITICAL: must happen before createFlashRuleResultArray)
    let validatedInput = processedInput;
    if (kind === 'resource') {
      validatedInput = assertResourceInput(processedInput, expr, environment);
    }

    return createFlashRuleResultArray(groupingKey, kind, validatedInput);
  }

  /**
   * Initialize FLASH context from expression metadata
   * @param {Object} expr - Flash expression
   * @param {Object} environment - Environment with FHIR definitions
   * @returns {Object} Flash context with kind, children, resourceType, profileUrl
   */
  function initializeFlashContext(expr, environment) {
    const policy = createPolicy(environment);
    let kind;
    let children = [];
    let resourceType;
    let profileUrl;

    if (expr.isFlashBlock) {
      // flash block - use the instanceof to get the structure definition's meta data
      const typeMeta = getTypeMetadata(environment, expr);
      kind = typeMeta?.kind;

      // kind can be a resource, complex-type, or primitive-type.
      // It cannot be a system primitive since those cannot be instantiated with InstanceOf
      if (kind === 'resource') {
        // resources must have a resourceType set
        resourceType = typeMeta.type;
        if (typeMeta.derivation === 'constraint') {
          // profiles on resources should have a mets.profile set to the profile URL
          profileUrl = typeMeta.url;
        }
      }
      children = getTypeChildren(environment, expr);
    } else {
      // flash rule - use the flashPathRefKey to get the element definition
      const def = getElementDefinition(environment, expr);
      // kind will almost laways be a system primitive, primitive-type, or complex-type.
      // kind = "resource" is rare but should be supported (Bundle.entry.resource, DomainResource.contained)
      // TODO: handle inline resources (will probably not have an element definition but a structure definition)
      kind = def.__kind;

      // Forbidden element check (F5131) – apply only if not inhibited by policy
      if (policy.shouldValidate('F5131') && def.max === '0') {
        // forbidden element
        const err = FlashErrorGenerator.createError("F5131", expr, {
          value: expr.flashPathRefKey?.slice(expr.instanceof.length + 2),
          fhirType: def.__fromDefinition
        });
        if (policy.enforce(err)) {
          throw err;
        }
        // downgraded: allow processing to continue; do not suppress the element
      }

      if (def.__fixedValue) {
        // short circuit if the element has a fixed value
        let fixed = def.__fixedValue;
        if (kind === 'primitive-type') {
          if (!isFhirPrimitive(fixed)) {
            fixed = createFhirPrimitive(fixed);
          }
        }
        return {
          kind,
          children,
          resourceType,
          profileUrl,
          fixedValue: createFlashRuleResult(def.__name[0], kind, fixed)
        };
      } else if (kind !== 'system') {
        children = getElementChildren(environment, expr);
        if (def.__patternValue) {
          let pattern = def.__patternValue;
          if (!isFhirPrimitive(pattern)) {
            pattern = createFhirPrimitive(pattern);
          }
          return {
            kind,
            children,
            resourceType,
            profileUrl,
            patternValue: createFlashRuleResult(def.__name[0], kind, pattern)
          };
        }
      }
    }

    return { kind, children, resourceType, profileUrl };
  }

  /**
   * Process all expressions within a flash block/rule and group results by key
   * @async
   * @param {Object} expr - Flash expression
   * @param {*} input - Input data
   * @param {Object} environment - Environment
   * @returns {Promise<Object>} Promise resolving to object with inlineResult and subExpressionResults
   */
  async function processFlashExpressions(expr, input, environment) {

    const subExpressionResults = {};
    let inlineResult;

    // Evaluate all expressions and group results by key
    for (const node of expr.expressions) {

      let res = await evaluate(node, input, environment);

      if (typeof res === 'undefined') {
        continue; // undefined results are ignored
      }

      // expressions can only be:
      // 1. a flash rule - returns a flashrule result object
      // 2. an inline expression - any value
      // 3. a variable assignment - evaluated but does not affect the result directly
      // 4. a path expression (contextualized rule) - a flashrule result object or an array of such

      if (node.isInlineExpression) {
        // inline expression - there can be only one :)
        // result is kept if it's truthy or explicitly false / 0
        if (fn.boolize(res) !== false || res === false || res === 0) {
          inlineResult = res;
        }
        // nothing more to do with this node, continue
        continue;
      } else if (node.type === 'bind') {
        // variable assignment inside a flash block or rule
        // we don't care about the result (the variale is assigned to the environment)
        continue;
      }

      // flash rule or contextualized rule - a flashrule result object or an array of such
      const groupingKey = Array.isArray(res) ? res[0].key : res.key;

      // we append to the gouping key in the subExpressionResults object
      const values = fn.append(subExpressionResults[groupingKey], res);
      subExpressionResults[groupingKey] = Array.isArray(values) ? values : [values];
    }

    return { inlineResult, subExpressionResults };
  }

  /**
   * Ensure that all mandatory slices are present and auto-generate missing ones
   * @param {Object} result - Result object
   * @param {Array} children - Children definitions
   * @param {Object} expr - Original expression
   * @param {Object} environment - Environment
   * @param {Array} collectedVirtualRuleErrors - Array to collect virtual rule errors
   */
  async function ensureMandatorySlices(result, children, expr, environment) {
    const policy = createPolicy(environment);

    // If result is null/undefined, no slice validation needed
    if (!result || typeof result !== 'object') {
      return;
    }

    // Find all sliced elements that are present in result
    const presentSliceElements = {};
    for (const key of Object.keys(result)) {
      const colonIndex = key.indexOf(':');
      if (colonIndex !== -1) {
        const parentKey = key.slice(0, colonIndex);
        const sliceName = key.slice(colonIndex + 1);
        if (!presentSliceElements[parentKey]) {
          presentSliceElements[parentKey] = new Set();
        }
        presentSliceElements[parentKey].add(sliceName);
      }
    }

    // For each parent element that has slices, check for missing mandatory slices
    for (const [parentKey, presentSlices] of Object.entries(presentSliceElements)) {
      // Find all slice definitions for this parent element
      const allSliceElements = children.filter(child =>
        child.__name &&
        child.__name.includes(parentKey) &&
        child.sliceName
      );

      // Check for missing mandatory slices
      for (const sliceElement of allSliceElements) {
        if (sliceElement.min > 0 && !presentSlices.has(sliceElement.sliceName)) {

          // Try to auto-generate the missing mandatory slice using virtual rule, unless inhibited
          let autoValue;
          if (policy.shouldValidate('F5140')) {
            autoValue = await VirtualRuleEvaluator.evaluateVirtualRule(
              evaluate,
              expr,
              sliceElement.__flashPathRefKey,
              environment
            );
          }

          if (typeof autoValue !== 'undefined') {
            // Add the auto-generated slice to the result
            result[autoValue.key] = autoValue.value;
          }

          // If result is still missing the mandatory slice, emit F5140 (policy will handle downgrade/inhibition)
          if (!result[`${parentKey}:${sliceElement.sliceName}`]) {
            const err = FlashErrorGenerator.createFhirContextError("F5140", expr, {
              fhirParent: (expr.flashPathRefKey || expr.instanceof).replace('::', '/'),
              fhirElement: parentKey,
              sliceName: sliceElement.sliceName
            });
            if (policy.enforce(err)) {
              throw err;
            }
            // downgraded/inhibited: continue without auto-creating slice
          }
        }
      }
    }
  }

  /**
   * Attach mandatory children list to flash result
   * @param {Object} result - Result object
   * @param {Array} children - Children definitions
   * @param {Object} expr - Original expression
   * @param {Object} environment - Environment with policy/diagnostics
   */
  function attachMandatoryChildren(result, children, expr, environment) {
    const policy = createPolicy(environment);
    // Inhibition: skip this validation entirely when F5130 is outside validation band
    if (!policy.shouldValidate('F5130')) {
      return; // do not perform mandatory-children checks
    }
    const mandatories = [];
    // collect list of mandatory children
    for (const child of children) {
      // skip non-mandatory children
      if (child.min === 0) continue;
      mandatories.push({ id: child.id, names: child.__name, min: child.min, kind: child.__kind, __flashPathRefKey: child.__flashPathRefKey });
    }
    if (mandatories.length > 0) {
      result[Symbol.for('fumifier.__mandatoryChildren')] = mandatories;
    }
  }

  /**
   * All FLASH blocks and rules evaluation is funneled through this function.
   * It evaluates the specialized unary operator AST node and returns the result.
   * The inline expression and any rules/sub-rules are evaluated and applied to the output.
   * Expressions in between sub-rules (variable assignments) are evaluated but their results are discarded.
   * If the element is a system primitive than result is just the inline expression.
   * All other element kinds return objects, where FHIR primitives have their inline value assigned to `value`.
   * @async
   * @param {Object} expr - Flash expression to evaluate
   * @param {*} input - Input data
   * @param {Object} environment - Environment with FHIR definitions
   * @returns {Promise<*>} Evaluated flash result
   */
  async function evaluateFlash(expr, input, environment) {

    // Initialize context and check for fixed values
    const context = initializeFlashContext(expr, environment);

    if (context.fixedValue) {
      // when evaluating a rule with a fixed value, we just return the fixed value
      // no processing of sub-expressions or inline expressions is relevant
      // NOTE: at this stage, fhir primitives are still objects with a `value` key and possibly other properties
      return context.fixedValue;
    }

    const { kind, children, resourceType, profileUrl, patternValue } = context;

    // Process all expressions (inline + sub-rules) - MUST remain sequential for variable binding
    const {
      inlineResult: rawInlineResult,
      subExpressionResults
    } = await processFlashExpressions(expr, input, environment);

    // declare inlineResult as a variable so we can override it if needed
    let inlineResult = rawInlineResult;

    // at this stage, result could be anything
    let result;
    if (kind === 'system') {
      // system primitive - the result is just the inline expression.
      // there could not be any child expressions (parsing would have failed if there were).
      result = inlineResult;
    } else {
      // result is going to be an object (including fhir primitives - they are still objects at this stage).
      result = {};

      // if it's a fhir primitive, wrap the inline result in an object with a 'value' key.
      // this is because unlike with complex-types (inline assignments are objects),
      // we expect the user to assing the primitive value itself in an inline expression,
      // not the intermediate object representation of a primitive (with the `value` as property).
      if (kind === 'primitive-type' && inlineResult !== undefined) {
        inlineResult = createFhirPrimitive({value: inlineResult});
        // FIX: preserve the inline primitive so finalizeFlashRuleResult can access it via input.value
        result.value = inlineResult; // inlineResult may be a single value or an array (user supplied)
      }

      // Handle inline primitive assignments to complex types - this is an error
      if (expr.isFlashRule && kind === 'complex-type' && inlineResult !== undefined && !Array.isArray(inlineResult)) {
        const policy = createPolicy(environment);
        // Check if we received a primitive when expecting a complex type
        if (inlineResult === null || typeof inlineResult !== 'object') {
          // Special case: Allow primitive assignments to Quantity types, wrap as { value: primitive }
          const elementDefinition = getElementDefinition(environment, expr);
          const typeCode = elementDefinition?.__fhirTypeCode;

          if (typeCode === 'Quantity') {
            // For Quantity, wrap primitive values as { value: primitiveValue }
            // But first validate the primitive value against Quantity.value.value (decimal) constraints
            const valueValueElementKey = `${expr.flashPathRefKey}.value.value`;
            const valueValueExpr = {
              ...expr,
              flashPathRefKey: valueValueElementKey,
              instanceof: expr.instanceof
            };
            const valueValueElementDefinition = getElementDefinition(environment, valueValueExpr);
            if (valueValueElementDefinition) {
              // Validate and convert the primitive value before wrapping
              const validatedValue = PrimitiveValidator.validate(valueValueExpr, inlineResult, valueValueElementDefinition, environment);
              result = { value: validatedValue };
            } else {
              result = { value: inlineResult };
            }
          } else if (!policy.shouldValidate('F5104')) {
            // inhibited: allow the primitive assignment without validation
            result = inlineResult;
          } else {
            const err = {
              code: "F5104",
              stack: (new Error()).stack,
              position: expr.position,
              start: expr.start,
              line: expr.line,
              fhirParent: expr.instanceof,
              fhirElement: expr.flashPathRefKey.split('::')[1],
              valueType: typeof inlineResult
            };
            if (policy.enforce(err)) throw err;
            // downgraded: allow the primitive assignment but continue
            result = inlineResult;
          }
        } else {
          // Valid object assignment to complex type - but check for Quantity with string value
          const elementDefinition = getElementDefinition(environment, expr);
          const typeCode = elementDefinition?.__fhirTypeCode;

          if (typeCode === 'Quantity' && inlineResult.value !== undefined) {
            // If this is a Quantity object with a value property, validate/convert the value
            const valueValueElementKey = `${expr.flashPathRefKey}.value.value`;
            const valueValueExpr = {
              ...expr,
              flashPathRefKey: valueValueElementKey,
              instanceof: expr.instanceof
            };
            const valueValueElementDefinition = getElementDefinition(environment, valueValueExpr);
            if (valueValueElementDefinition) {
              // Validate and convert the value property
              const validatedValue = PrimitiveValidator.validate(valueValueExpr, inlineResult.value, valueValueElementDefinition, environment);
              result = { ...inlineResult, value: validatedValue };
            } else {
              result = inlineResult;
            }
          } else {
            result = inlineResult;
          }
        }
      }

      // Handle inline array assignments for complex types and resources
      // IMPORTANT: This must happen early to ensure proper validation timing
      if (expr.isFlashRule && (kind === 'complex-type' || kind === 'resource') && Array.isArray(inlineResult)) {
        const arrayResult = handleInlineArrayAssignment(expr, inlineResult, kind, environment);
        if (arrayResult) {
          return arrayResult; // Early return bypasses normal child processing
        }
      }

      // Handle resourceType attribute for flash rules and blocks
      // NOTE: This handles single resource validation (arrays were handled above)
      if (expr.isFlashRule && kind === 'resource' && inlineResult !== undefined) {
        // For inline Resources with inline values, use the inline object as the base and ensure there is a resourceType
        result = assertResourceInput(inlineResult, expr, environment);
      } else if (expr.isFlashBlock && resourceType) {
        // if it's a standalone resource instance, set the resourceType as the first key
        result.resourceType = resourceType;
      }

      // OPTIMIZATION: Process all children in parallel since they are independent
      // Each child processes its own values without dependencies on other children
      const childProcessor = new ChildValueProcessor(environment, evaluate);
      const validChildren = children.filter(child => child.__name);

      const childProcessingPromises = validChildren.map(child =>
        childProcessor.processChild(child, inlineResult, subExpressionResults, expr, patternValue)
      );

      const allChildResults = await Promise.all(childProcessingPromises);

      // Apply results in the original order to maintain FHIR definition ordering
      for (let i = 0; i < validChildren.length; i++) {
        const child = validChildren[i];
        const childResult = allChildResults[i];

        if (childResult.values.length > 0) {
          ResultProcessor.assignValuesToResult(result, child, childResult.values);
        }
      }
    }

    // After processing all children, ensure mandatory slices exist or auto-generate them
    await ensureMandatorySlices(result, children, expr, environment);

    // Post-process result
    if (typeof result === 'undefined') {
      result = {};
    } else {
      ResultProcessor.appendSlices(result);
      if (resourceType && profileUrl) {
        // If this is a profiled resource, inject meta.profile
        result = MetaProfileInjector.injectMetaProfile(result, resourceType, profileUrl);
      }

      // Reorder result keys according to FHIR element definition order
      // This ensures that auto-injected values appear in the correct place and not at the end
      if (children && children.length > 0) {
        result = ResultProcessor.reorderResultByFhirDefinition(result, children);
      }
    }

    attachMandatoryChildren(result, children, expr, environment);

    // Validate mandatory children at root level - only for non-virtual flash blocks
    if (expr.isFlashBlock && !expr.isVirtualRule) {
      const mandatories = result[Symbol.for('fumifier.__mandatoryChildren')];
      if (mandatories && Array.isArray(mandatories)) {
        validateMandatoryChildren(result, mandatories, expr, environment);
      }
    }    // Flatten FHIR primitive values in the final result JUST BEFORE returning
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      result = ResultProcessor.flattenPrimitiveValues(result);
    }

    if (expr.isFlashRule) {
      // if it's a flash rule, process and return the result as a flash rule
      result = finalizeFlashRuleResult(expr, result, environment);
      // Perform complex-type binding validation if applicable
      if (result && result.kind === 'complex-type') {
        const elDef = getElementDefinition(environment, expr);
        if (elDef) {
          const typeCode = elDef.__fhirTypeCode;
          if (['Coding','Quantity','CodeableConcept'].includes(typeCode)) {
            processCodingLike(typeCode, result.value, elDef, expr, environment);
          }
        }
      }
    }    // flashblock result finalization
    if (expr.isFlashBlock) {
      if (Object.keys(result).length === 0 || (Object.keys(result).length === 1 && result.resourceType)) {
        // if the result is empty or has only resourceType, return undefined
        result = undefined;
      } else if (result && typeof result === 'object' && result.resourceType === 'Bundle' && result.type === 'transaction') {
        // if the result is a Bundle resource with type === 'transaction', inject fullUrl to each entry
        result = ResultProcessor.injectBundleFullUrls(result);
      }
    }

    return result;
  }

  /**
   * Get FHIR definitions dictionary from environment
   * @param {Object} environment - Environment with FHIR definitions
   * @returns {Object} FHIR definitions dictionary
   */
  function getFhirDefinitionsDictinary(environment) {
    return environment.lookup(Symbol.for('fumifier.__resolvedDefinitions'));
  }

  /**
   * Get FHIR element definition by reference key
   * @param {Object} environment - Environment with FHIR definitions
   * @param {Object} expr - Expression node, containing reference key for element
   * @returns {Object} Element definition
   */
  function getElementDefinition(environment, expr) {
    const definitions = getFhirDefinitionsDictinary(environment);
    if (definitions && definitions.elementDefinitions && expr && expr.flashPathRefKey) {
      return definitions.elementDefinitions[expr.flashPathRefKey];
    }
    /* c8 ignore next */
    return undefined;
  }

  /**
   * Get FHIR type metadata
   * @param {Object} environment - Environment with FHIR definitions
   * @param {Object} expr - Expression node, containing type information in `instanceof`
   * @returns {Object} Type metadata
   */
  function getTypeMetadata(environment, expr) {
    const definitions = getFhirDefinitionsDictinary(environment);
    if (definitions && definitions.typeMeta && expr && expr.instanceof) {
      return definitions.typeMeta[expr.instanceof];
    }
    /* c8 ignore next */
    return undefined;
  }

  /**
   * Get FHIR type children definitions
   * @param {Object} environment - Environment with FHIR definitions
   * @param {Object} expr - Expression node, containing type information in `instanceof`
   * @returns {Array} Type children definitions
   */
  function getTypeChildren(environment, expr) {
    const definitions = getFhirDefinitionsDictinary(environment);
    if (definitions && definitions.typeChildren && expr && expr.instanceof) {
      return definitions.typeChildren[expr.instanceof];
    }
    /* c8 ignore next */
    return undefined;
  }

  /**
   * Get FHIR element children definitions
   * @param {Object} environment - Environment with FHIR definitions
   * @param {string} expr - expression node, containing reference key for element
   * @returns {Array} Element children definitions
   */
  function getElementChildren(environment, expr) {
    const flashPathRefKey = expr.flashPathRefKey;
    const definitions = getFhirDefinitionsDictinary(environment);
    let children;
    if (definitions && definitions.elementChildren) {
      children = definitions.elementChildren[flashPathRefKey];
      return children;
    }
    /* c8 ignore next 4 */
    throw FlashErrorGenerator.createError("F3013", expr, {
      instanceOf: expr.instanceof,
      fhirElement: flashPathRefKey
    });
  }

  return evaluateFlash;
}

export default createFlashEvaluator;
