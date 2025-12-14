/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

/* eslint-disable require-jsdoc */
/** Takes a FHIR Structure Navigator and FHIR Terminology Runtime and returns helper functions used to fetch FHIR semantic data
 * @param {FhirStructureNavigator} navigator - FHIR structure navigator
 * @param {FhirTerminologyRuntime} terminologyRuntime - FHIR terminology runtime for valueset expansions
 * @returns {Object} An object containing functions to fetch FHIR data
 * @property {Function} getElement - Function to fetch element definitions
 * @property {Function} getChildren - Function to fetch the direct children of a FHIR element
 * @property {Function} getTypeMeta - Function to fetch metadata of type or profile definitions
 */

function createFhirFetchers(navigator, terminologyRuntime) {
  return {
    getElement: async function (snapshotId, path) {
      return await navigator.getElement(snapshotId, path);
    },
    getChildren: async function (snapshotId, path) {
      return await navigator.getChildren(snapshotId, path ?? '.');
    },
    getTypeMeta: async function (snapshotId) {
      return await navigator.getFsg().getMetadata(snapshotId);
    },
    getBaseTypeMeta: async function (typeCode, sourcePackage) {
      return await navigator.getFsg().getMetadata(typeCode, sourcePackage);
    },
    expandValueSet: async function (valueSetKey, sourcePackage) {
      // valueSetKey can be id | name | canonical URL
      // sourcePackage is expected to be provided in internal calls,
      // but may be omitted when user calls it from within expressions
      if (!terminologyRuntime) {
        throw new Error('Terminology runtime not configured. Cannot expand valueset.');
      }
      return await terminologyRuntime.expandValueSet(valueSetKey, sourcePackage);
    }
  };
}

export default createFhirFetchers;
