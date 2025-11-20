/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

/**
 * @module ChildValueProcessor
 * @description Handles child value processing within flash evaluation
 */

import fn from '../utils/functions.js';
import { createFhirPrimitive } from './FhirPrimitive.js';
import PrimitiveValidator from './PrimitiveValidator.js';

// Import utility functions directly since they are simple utilities
const { initCap } = fn;

// Whitelist of decorative elements that can be safely injected if they have fixed values, even if they are optional.
// These elements cannot change semantic meaning, only add human-readable information to their sibling properties.
const DECORATIVE_ELEMENTS = new Set([
  'Coding.display',
  'CodeableConcept.text',
  'Quantity.unit'
]);

/**
 * Handles child value processing within flash evaluation
 */
class ChildValueProcessor {
  /**
   * Constructor for ChildValueProcessor
   * @param {Object} environment - Environment with FHIR definitions
   * @param {Function} evaluate - Evaluate function from fumifier
   */
  constructor(environment, evaluate) {
    this.environment = environment;
    this.evaluate = evaluate;
  }

  /**
   * Generate possible names for a child element (handles polymorphic and slice cases)
   * @param {Object} child - Child element definition
   * @returns {Array} Array of possible names
   */
  generateChildNames(child) {
    const names = [];

    if (child.__name.length === 1) {
      // single name - check if poly
      const isPoly = child.base?.path?.endsWith('[x]'); // is it a base poly element?
      if (!isPoly) {
        // single type element from the base.
        // if there's a sliceName, we will use it to create the grouping key
        if (child.sliceName) {
          names.push(`${child.__name[0]}:${child.sliceName}`);
        } else {
          // no sliceName, just use the __name as the grouping key
          names.push(child.__name[0]);
        }
      } else {
        // it's a polymorphic element, narrowed to a single type.
        // we will use the single __name and ignore sliceName if it exists,
        // since the base name already includes the type, and sliceName (if there is one) is redundant
        // NOTE: polymorphic elements can only be sliced by type,
        //       so sliceName is actually identical to the JSON element name (e.g. valueString)
        names.push(child.__name[0]);
      }
    } else {
      // it's a polymorphic element with multiple types (and hence, names). it was not narrowed to a single type.
      // we will use the entire __name array as possible grouping keys (ignoring sliceName)
      names.push(...child.__name);
    }

    return names;
  }

  /**
   * Process all values for a specific child element
   * @param {Object} child - Child element definition
   * @param {*} inlineResult - Inline expression result
   * @param {Object} subExpressionResults - Sub-expression results
   * @param {Object} expr - Original flash expression
   * @param {Object} parentPatternValue - Parent pattern value if applicable
   * @returns {Promise<Object>} Promise resolving to processed child values
   */
  async processChild(child, inlineResult, subExpressionResults, expr, parentPatternValue) {
    // we will first normalize the possible names of this element into an array of grouping keys
    const names = this.generateChildNames(child);

    // start by keeping all the matching values for this element in an array
    const values = [];
    for (const name of names) {
      const valuesForName = this.processValuesForName(
        name, child, inlineResult, subExpressionResults, parentPatternValue
      );

      // if we have no values for this name, skip it
      if (valuesForName.length === 0) {
        continue;
      }

      const kindForName = child.type.length === 1 ?
        child.type[0].__kind :
        child.type.find(type => name.endsWith(initCap(type.code))).__kind;

      if (child.max !== '1') {
        // if it's an array, we take all of the values and push them to the values array
        values.push({ name, kind: kindForName, value: valuesForName });
      } else if (kindForName === 'system') {
        // system primitive - just take the last value
        if (valuesForName.length > 0) {
          values.push({ name, kind: kindForName, value: [valuesForName[valuesForName.length - 1]] });
        }
      } else {
        // complex type or primitive type - merge all objects into one
        const mergedValue = fn.merge(valuesForName);
        if (Object.keys(mergedValue).length > 0) {
          values.push({ name, kind: kindForName, value: [mergedValue] });
        }
      }
    }

    // at this point, if we have no collected values for this element but it is mandatory or decorative,
    // we will try to evaluate it as a virtual rule.
    if (values.length === 0) {
      // skipping polymorphic elements, they cannot have actual values without having a specific type
      if (child.type.length > 1) return { values };

      if (child.min === 0) {
        // not mandatory.
        // check if it's decorative by looking up its base path in the whitelist
        const isDecorative = child.base?.path && DECORATIVE_ELEMENTS.has(child.base.path);

        // skip if not decorative
        if (!isDecorative) return { values };
      }

      // we are left with mandatory or decorative elements.
      // evaluating them as virtual rules may actually produce a value.

      try {
        const autoValue = await this.evaluate({
          type: 'unary',
          value: '[',
          isFlashRule: true,
          isVirtualRule: true,
          expressions: [],
          instanceof: expr.instanceof, // use the same instanceof as the parent flash block or rule
          flashPathRefKey: child.__flashPathRefKey,
          position: expr.position,
          start: expr.start,
          line: expr.line
        }, undefined, this.environment);

        // if the autoValue is not undefined, we add it to the values array
        if (typeof autoValue !== 'undefined') {
          values.push({ name: autoValue.key, kind: autoValue.kind, value: [autoValue.value] });
        }
      } catch (error) {
        // If the element failed to auto generate, we ignore the error and just don't add anything to the values array
      }
    }

    return { values };
  }

  /**
   * Process values for a specific name within child processing
   * @param {string} name - Element name
   * @param {Object} child - Child element definition
   * @param {*} inlineResult - Inline expression result
   * @param {Object} subExpressionResults - Sub-expression results
   * @param {Object} parentPatternValue - Parent pattern value if available
   * @returns {Array} Array of values for this name
   */
  processValuesForName(name, child, inlineResult, subExpressionResults, parentPatternValue) {
    // Determine the kind of this specific element name, accounting for polymorphic elements
    const kindForName = child.type.length === 1 ?
      child.type[0].__kind :
      child.type.find(type => name.endsWith(initCap(type.code))).__kind;

    // if the parent pattern has a value for this name, we will use it
    if (parentPatternValue && parentPatternValue.value && parentPatternValue.value[name] && typeof parentPatternValue.value[name] !== undefined) {
      const patternValue = parentPatternValue.value[name];

      // For primitive types, if the pattern value is a raw string, wrap it in proper FHIR primitive structure
      if (kindForName === 'primitive-type') {
        // if there are sibling attributes, merge them into the value object
        const siblingName = '_' + name;
        if (typeof parentPatternValue.value[siblingName] === 'object' && Object.keys(parentPatternValue.value[siblingName]).length > 0) {
          return [createFhirPrimitive({ value: patternValue, ...parentPatternValue.value[siblingName] })];
        }
        return [createFhirPrimitive({ value: patternValue })];
      }

      return [patternValue]; // return the value from the parent pattern as-is for other types
    }
    const valuesForName = []; // keep all values for this json element name    // check if the inline expression has a value for this name
    if (
      inlineResult &&
      !child.sliceName && // we skip this child if it's a slice since slices are not directly represented in the json
      (
        Object.prototype.hasOwnProperty.call(inlineResult, name) || // check if inlineResult has this name
        (
          kindForName === 'primitive-type' && // or if it's a primitive type check for sibling element
          Object.prototype.hasOwnProperty.call(inlineResult, '_' + name)
        )
      )
    ) {
      this.processInlineValues(name, kindForName, child, inlineResult, valuesForName);
    }

    // now check if the subExpressionResults has a value for this name
    if (Object.prototype.hasOwnProperty.call(subExpressionResults, name)) {
      valuesForName.push(...(subExpressionResults[name].map(item => item.value)));
    }

    return valuesForName;
  }

  /**
   * Process inline values for a specific name
   * @param {string} name - Element name
   * @param {string} kindForName - Element kind
   * @param {Object} child - Child element definition
   * @param {*} inlineResult - Inline expression result
   * @param {Array} valuesForName - Array to push values to
   */
  processInlineValues(name, kindForName, child, inlineResult, valuesForName) {
    let value;
    // if it's not a fhir primitive, we just take the value
    if (kindForName !== 'primitive-type') {
      value = inlineResult[name];
      // If the value is an array and this element can have multiple values,
      // spread the array items instead of treating the whole array as one value
      if (Array.isArray(value) && child.max !== '1') {
        valuesForName.push(...value);
      } else {
        valuesForName.push(value);
      }
    } else {
      // if it's a fhir primitive, we convert it to an object
      const rawValue = inlineResult[name];
      const siblingName = '_' + name;

      // Get the element definition for validation
      const elementDefinition = this.getElementDefinitionForChild(child);

      // If the value is an array and this element can have multiple values,
      // treat each array item as a separate primitive value
      if (Array.isArray(rawValue) && child.max !== '1') {
        for (const item of rawValue) {
          // Validate and convert the primitive value
          const validatedValue = elementDefinition ?
            PrimitiveValidator.validate(this.createExpressionForChild(child), item, elementDefinition, this.environment) :
            item;
          const primitiveValue = createFhirPrimitive({ value: validatedValue });
          if (typeof inlineResult[siblingName] === 'object' && Object.keys(inlineResult[siblingName]).length > 0) {
            // if there's a sibling element with the same name prefixed with '_',
            // we will copy its properties to the value object
            Object.assign(primitiveValue, inlineResult[siblingName]);
          }
          valuesForName.push(primitiveValue);
        }
      } else {
        // Single value or array treated as single value
        // Validate and convert the primitive value
        const validatedValue = elementDefinition ?
          PrimitiveValidator.validate(this.createExpressionForChild(child), rawValue, elementDefinition, this.environment) :
          rawValue;
        const primitiveValue = createFhirPrimitive({ value: validatedValue });
        if (typeof inlineResult[siblingName] === 'object' && Object.keys(inlineResult[siblingName]).length > 0) {
          // if there's a sibling element with the same name prefixed with '_',
          // we will copy its properties to the value object
          Object.assign(primitiveValue, inlineResult[siblingName]);
        }
        valuesForName.push(primitiveValue);
      }
    }
  }

  /**
   * Get element definition for a child element
   * @param {Object} child - Child element definition
   * @returns {Object|undefined} Element definition
   */
  getElementDefinitionForChild(child) {
    const definitions = this.environment.lookup(Symbol.for('fumifier.__resolvedDefinitions'));
    if (definitions && definitions.elementDefinitions && child.__flashPathRefKey) {
      return definitions.elementDefinitions[child.__flashPathRefKey];
    }
    return undefined;
  }

  /**
   * Create an expression object for child validation
   * @param {Object} child - Child element definition
   * @returns {Object} Expression object
   */
  createExpressionForChild(child) {
    return {
      flashPathRefKey: child.__flashPathRefKey,
      instanceof: child.__flashPathRefKey.split('::')[0]
    };
  }
}

export default ChildValueProcessor;
