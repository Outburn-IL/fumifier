/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

/**
 * @module ResultProcessor
 * @description Handles FHIR result object processing, manipulation, and formatting
 */

import fn from '../utils/functions.js';
import utils from '../utils/utils.js';
import { isFhirPrimitive } from './FhirPrimitive.js';

const { boolize } = fn;

/**
 * Result processor utility for FHIR evaluation results
 */
class ResultProcessor {

  /**
   * Flatten FHIR primitive values in an object.
   * Converts intermediate FHIR primitive representation object to actual primitive and sibling.
   * e.g {
   *    "value": "primitive",
   *    "id": "123",
   *    "@@__fhirPrimitive": true
   * } ---> "primitive" with sibling "_key": {"id": "123"}
   * @param {Object} obj - Object to flatten
   * @returns {Object} Flattened object
   */
  static flattenPrimitiveValues(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return obj;
    }

    const result = { ...obj };

    for (const [key, value] of Object.entries(result)) {
      // Skip keys that already start with underscore to avoid double processing
      if (key.startsWith('_')) {
        continue;
      }

      if (Array.isArray(value)) {
        // Check first entry to determine if array contains primitives
        if (value.length > 0 && isFhirPrimitive(value[0])) {
          const primitiveValues = [];
          const siblingProperties = [];

          for (const item of value) {
            if (isFhirPrimitive(item)) {
              // Only add primitive value if it's not undefined
              if (item.value !== undefined) {
                primitiveValues.push(item.value);
              } else {
                primitiveValues.push(null);
              }

              // Extract sibling properties (everything except 'value')
              const props = Object.keys(item).filter(k => k !== 'value');
              if (props.length > 0) {
                const propObj = {};
                for (const prop of props) {
                  propObj[prop] = item[prop];
                }
                siblingProperties.push(propObj);
              } else {
                siblingProperties.push(null);
              }
            } else {
              primitiveValues.push(item);
              siblingProperties.push(null);
            }
          }

          // Remove trailing nulls from primitive values
          while (primitiveValues.length > 0 && primitiveValues[primitiveValues.length - 1] === null) {
            primitiveValues.pop();
            siblingProperties.pop();
          }

          // Remove trailing nulls from sibling properties
          while (siblingProperties.length > 0 && siblingProperties[siblingProperties.length - 1] === null) {
            siblingProperties.pop();
          }

          // Only assign primitive array if there are actual values (not all null/undefined)
          if (primitiveValues.length > 0 && primitiveValues.some(v => v !== null && v !== undefined)) {
            result[key] = primitiveValues;
          } else {
            delete result[key];
          }

          // Only assign sibling array if there are actual properties (not all null)
          if (siblingProperties.length > 0 && siblingProperties.some(p => p !== null)) {
            result['_' + key] = siblingProperties;
          }
        }
      } else if (isFhirPrimitive(value)) {
        // Single primitive object

        // Only assign actual value to the key if it's not undefined
        if (value.value !== undefined) {
          result[key] = value.value;
        } else {
          delete result[key]; // remove key if no value
        }

        // Extract sibling properties
        const props = Object.keys(value).filter(k => k !== 'value');
        if (props.length > 0) {
          const siblingObj = {};
          for (const prop of props) {
            siblingObj[prop] = value[prop];
          }
          result['_' + key] = siblingObj;
        }
      }
    }

    return result;
  }

  /**
   * Assign processed values to the result object
   * @param {Object} result - Result object to modify
   * @param {Object} child - Child element definition
   * @param {Array} values - Processed values
   */
  static assignValuesToResult(result, child, values) {
    // values now contain all collected values for this child element, each wrapped in an object containing the json element name.
    // since arrays and polymorphics are mutually exclusive, we can safely take the last value if it's polymorphic,
    // and all values if it's an array.

    let finalValue;
    if (child.__name.length > 1) {
      // polymorphic element - take the last value (only one type is allowed)
      finalValue = values[values.length - 1];
    } else {
      // this element has only one possible name, so we can safely take the first value - it should be the only one
      finalValue = values[0];
    }

    // assign the value to the result object
    if (finalValue.value) {
      if (finalValue.kind !== 'primitive-type') {
        this.assignNonPrimitiveValue(result, finalValue, child);
      } else {
        this.assignPrimitiveValue(result, finalValue, child);
      }
    }
  }

  /**
   * Assign non-primitive values to result
   * @param {Object} result - Result object
   * @param {Object} finalValue - Final processed value
   * @param {Object} child - Child element definition
   */
  static assignNonPrimitiveValue(result, finalValue, child) {
    // if it's not a fhir primitive, we can assign the value directly to the key
    // if the element has max 1, take last value only
    if (child.max === '1' && !child.__isArray) {
      finalValue.value = finalValue.value[finalValue.value.length - 1];
    } else if (child.max === '1' && child.__isArray) {
      finalValue.value = [finalValue.value[finalValue.value.length - 1]];
    }

    // Filter out empty objects from arrays before assignment
    if (Array.isArray(finalValue.value)) {
      finalValue.value = finalValue.value.filter(item => {
        // Keep the item if it's not an object, or if it's an object with meaningful content
        if (typeof item !== 'object' || item === null) {
          return true; // Keep non-objects and null values
        }
        // For objects, check if they have any non-undefined, non-null properties
        const keys = Object.keys(item);
        return keys.length > 0 && keys.some(key => item[key] !== undefined && item[key] !== null);
      });

      // If the array is now empty after filtering, don't assign it
      if (finalValue.value.length === 0) {
        return;
      }
    } else if (typeof finalValue.value === 'object' && finalValue.value !== null) {
      // For single objects, check if they're empty
      const keys = Object.keys(finalValue.value);
      if (keys.length === 0 || keys.every(key => finalValue.value[key] === undefined || finalValue.value[key] === null)) {
        return; // Don't assign empty objects
      }
    }

    if (typeof finalValue.value !== 'undefined' && (typeof finalValue.value === 'boolean' || boolize(finalValue.value))) {
      result[finalValue.name] = finalValue.value;
    }
  }

  /**
   * Assign primitive values to result (handles both value and sibling properties)
   * @param {Object} result - Result object
   * @param {Object} finalValue - Final processed value
   * @param {Object} child - Child element definition
   */
  static assignPrimitiveValue(result, finalValue, child) {
    // if it's a fhir primitive, we need to convert the array to two arrays -
    // one with the primitive values themselves, and one with the properties.
    // to keep these arrays in sync, we will use the same index for both and fill-in missing values with null
    let primitiveValues = [];
    let properties = [];

    for (let i = 0; i < finalValue.value.length; i++) {
      const value = finalValue.value[i];
      if (value === undefined) continue; // skip undefined values

      if (value.value !== undefined) {
        primitiveValues.push(value.value);
      } else {
        primitiveValues.push(null);
      }

      // copy all properties to the properties array (excluding the special flags)
      const props = Object.keys(value).filter(key => key !== 'value');
      if (props.length > 0) {
        properties.push(props.reduce((acc, key) => {
          acc[key] = value[key];
          return acc;
        }, {}));
      } else {
        properties.push(null);
      }
    }

    // if the element has max 1, take last value only
    if (!child.__isArray) {
      primitiveValues = primitiveValues[primitiveValues.length - 1];
      properties = properties[properties.length - 1];
    } else if (child.max === '1' && child.__isArray) {
      primitiveValues = [primitiveValues[primitiveValues.length - 1]];
      properties = [properties[properties.length - 1]];
    }

    // Remove trailing nulls from properties array to avoid unnecessary sibling array entries
    if (Array.isArray(properties)) {
      while (properties.length > 0 && properties[properties.length - 1] === null) {
        properties.pop();
      }
    }

    // Check if we have actual primitive values (not just auto-generated nulls)
    const hasActualPrimitiveValues = primitiveValues !== undefined && primitiveValues !== null && (
      !Array.isArray(primitiveValues) ? true :
        (primitiveValues.length > 0 && primitiveValues.some(v => v !== null && v !== undefined))
    );

    // Only assign primitive values if they exist and aren't all null/undefined
    if (hasActualPrimitiveValues) {
      result[finalValue.name] = primitiveValues;
    }

    // Only assign sibling array if there are actual properties (not all nulls)
    const hasActualProperties = properties && (
      !Array.isArray(properties) ? Object.keys(properties).length > 0 :
        (properties.length > 0 && properties.some(p => p !== null && p !== undefined && Object.keys(p || {}).length > 0))
    );

    if (hasActualProperties) {
      result['_' + finalValue.name] = properties;
    }
  }

  /**
   * Append slices into the base array
   * @param {Object} result - Result object to modify
   */
  static appendSlices(result) {
    // append slices into their parent element
    // we will do this by looping through the keys of result, and if any of them has a ':' suffix,
    // we will append it to the parent element with the same name (without the sliceName)
    // TODO: look for ways to optimize this, performance is critical here
    for (const key of Object.keys(result)) {
      const colonIndex = key.indexOf(':');
      if (colonIndex === -1) continue; // not a slice, skip
      const baseKey = key.slice(0, colonIndex);
      let sliceValue = result[key];
      result[baseKey] = fn.append(result[baseKey], sliceValue);
      // delete the slice key from the result
      delete result[key];
    }
  }

  /**
   * Reorder object keys according to FHIR element definition order
   * @param {Object} result - Result object to reorder
   * @param {Array} children - FHIR children definitions in order
   * @returns {Object} Reordered result object
   */
  static reorderResultByFhirDefinition(result, children) {
    if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).length === 0 || !children || children.length === 0) {
      return result;
    }

    const existingKeys = Object.keys(result);

    // Create a key-to-index map for faster lookups
    const existingKeySet = new Set(existingKeys);
    const orderedKeys = [];
    const processedKeys = new Set();

    // First, add resourceType if it exists (should always be first)
    if (existingKeySet.has('resourceType')) {
      orderedKeys.push('resourceType');
      processedKeys.add('resourceType');
    }

    // Then, add keys in the order defined by FHIR children definitions
    for (const child of children) {
      if (!child.__name || child.sliceName) {
        // Skip elements with no name or slices (slices are gone by now - appended into their base array)
        continue;
      }

      // Check all possible names for this child (handles polymorphic elements)
      for (const possibleName of child.__name) {
        // Main element key
        if (existingKeySet.has(possibleName) && !processedKeys.has(possibleName)) {
          orderedKeys.push(possibleName);
          processedKeys.add(possibleName);
        }

        // Primitive sibling keys (e.g., "_elementName")
        const siblingKey = '_' + possibleName;
        if (existingKeySet.has(siblingKey) && !processedKeys.has(siblingKey)) {
          orderedKeys.push(siblingKey);
          processedKeys.add(siblingKey);
        }
      }
    }

    // Finally, add any remaining keys that weren't in the FHIR definition's children array.
    // This happens with inline resources, since the resource datatype only defines id and meta,
    // but the inline resource has properties of a specific resource type.
    // If it is not a resource, we should ignore any extra keys.
    if (result.resourceType) {
      for (const key of existingKeys) {
        if (!processedKeys.has(key)) {
          orderedKeys.push(key);
        }
      }
    }

    // Create new object with reordered keys
    const reorderedResult = {};
    for (const key of orderedKeys) {
      reorderedResult[key] = result[key];
    }

    return reorderedResult;
  }

  /**
   * Inject fullUrl fields for Bundle entries that need them
   * @param {Object} bundle - Bundle resource with type 'transaction'
   * @returns {Object} Bundle with injected fullUrl fields
   */
  /* eslint-disable-next-line require-jsdoc, no-unused-vars */
  static injectBundleFullUrls(bundle) {
    // Create a deep copy to avoid mutating the original
    const result = { ...bundle };

    // Check if bundle has entry array
    if (!result.entry || !Array.isArray(result.entry)) {
      return result;
    }

    // Process each entry
    result.entry = result.entry.map(entry => {
      // Skip if entry has no resource
      if (!entry.resource || typeof entry.resource !== 'object') {
        return entry;
      }

      // Skip if entry already has a non-empty fullUrl
      if (entry.fullUrl && typeof entry.fullUrl === 'string' && entry.fullUrl.trim() !== '') {
        return entry;
      }

      // Generate fullUrl using the same logic as $reference()
      try {
        const fullUrl = utils.generateReference(entry.resource);
        // now we need to make sure the url is in the correct place regarding element ordering.
        // according to the spec, it is the second element - after `link`. So if there is a link,
        // we inject the fullUrl between it and the rest of the elements.
        // If there isn't a link, we put the fullUrl as first key and then all other elements.
        if (entry.link) {
          // If there is `link`, insert fullUrl after it
          return { link: entry.link, fullUrl, ...entry };
        } else return { fullUrl, ...entry };
      } catch (error) {
        // If reference generation fails (invalid resource), skip this entry
        return entry;
      }
    });

    return result;
  }
}

export default ResultProcessor;
