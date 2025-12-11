/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

import createPolicy from './policy.js';
import { populateMessage } from './errorCodes.js';

/**
 * Creates user-facing wrapper functions for FHIR client operations.
 * These functions are bound to the environment and provide controlled access to the FHIR client.
 * @param {Function} getFhirClient - Function that retrieves the current FHIR client from environment
 * @returns {Object} Object containing wrapper functions
 */
function createFhirClientWrappers(getFhirClient) {
  /**
   * Helper to handle errors through policy system
   * Respects throwLevel to decide whether to throw or return undefined
   * @param {Object} err - Error object with code
   * @param {Object} environment - Execution environment
   * @returns {undefined} Returns undefined if error should not throw
   * @throws {Object} Throws error if severity < throwLevel
   */
  function handleError(err, environment) {
    try { populateMessage(err); } catch (_) { /* ignore */ }
    const policy = createPolicy(environment);
    if (policy.enforce(err)) {
      throw err;
    }
    // Error was collected but should not throw - return undefined
    return undefined;
  }

  /**
   * Helper to get FHIR client or throw appropriate error (respects policy)
   * @param {Object} environment - Execution environment
   * @param {string} operationName - Name of operation for error messages
   * @returns {Object} FHIR client instance or undefined if error should not throw
   * @throws {Object} Error with code F5200 if client not configured (and severity < throwLevel)
   */
  function getClientOrThrow(environment, operationName) {
    const client = getFhirClient(environment);
    if (!client) {
      const err = {
        code: 'F5200',
        stack: (new Error()).stack,
        operation: operationName
      };
      return handleError(err, environment);
    }
    return client;
  }

  /**
   * Wraps FHIR client operations to handle errors consistently
   * @param {Function} operation - The FHIR client operation to call
   * @param {string} operationName - Name of operation for error messages
   * @returns {Function} Wrapped operation
   */
  function wrapOperation(operation, operationName) {
    return async function(...args) {
      const client = getClientOrThrow(this.environment, operationName);
      if (!client) return undefined; // Client not configured and error was suppressed
      try {
        return await operation.call(client, ...args);
      } catch (err) {
        // Check if it's a timeout error
        if (err.name === 'AbortError' || (err.message && err.message.includes('timeout'))) {
          return handleError({
            code: 'F5202',
            operation: operationName,
            timeout: client.config?.timeout || 30000,
            stack: err.stack || (new Error()).stack,
            sourceError: err
          }, this.environment);
        }

        // Check for resource not found (404)
        if (err.response && err.response.status === 404) {
          // Try to extract resource type and ID from error or args
          const resourceType = args[0];
          const resourceId = args[1];
          if (resourceType && resourceId) {
            return handleError({
              code: 'F5210',
              resourceType,
              resourceId,
              stack: err.stack || (new Error()).stack,
              sourceError: err
            }, this.environment);
          }
        }

        // Generic FHIR client error
        return handleError({
          code: 'F5203',
          operation: operationName,
          errorMessage: err.message || String(err),
          stack: err.stack || (new Error()).stack,
          sourceError: err
        }, this.environment);
      }
    };
  }

  return {
    /**
     * $search(resourceType, params?, options?) - Search for FHIR resources
     * @param {string} resourceType - Resource type to search
     * @param {Object} params - Search parameters
     * @param {Object} options - Search options
     * @returns {Promise<Object>} Search results
     */
    search: wrapOperation(async function(resourceType, params, options) {
      return await this.search(resourceType, params, options);
    }, 'search'),

    /**
     * $capabilities() - Get server capabilities
     * @returns {Promise<Object>} Capability statement
     */
    capabilities: wrapOperation(async function() {
      return await this.getCapabilities();
    }, 'getCapabilities'),

    /**
     * $resourceId(resourceType, params, options?) - Get resource ID from search
     * @param {string} resourceType - Resource type to search
     * @param {Object} params - Search parameters
     * @param {Object} options - Search options
     * @returns {Promise<string>} Resource ID
     */
    resourceId: async function(resourceType, params, options) {
      const client = getClientOrThrow(this.environment, 'resourceId');
      if (!client) return undefined; // Client not configured and error was suppressed
      try {
        return await client.resourceId(resourceType, params, options);
      } catch (err) {
        // Handle specific error messages from FHIR client
        if (err.message && err.message.includes('No resources found')) {
          return handleError({
            code: 'F5211',
            resourceType,
            searchParams: JSON.stringify(params),
            stack: err.stack || (new Error()).stack,
            sourceError: err
          }, this.environment);
        }
        if (err.message && err.message.includes('Multiple resources found')) {
          const match = err.message.match(/\((\d+) found\)/);
          const resultCount = match ? match[1] : 'multiple';
          return handleError({
            code: 'F5212',
            resourceType,
            searchParams: JSON.stringify(params),
            resultCount,
            stack: err.stack || (new Error()).stack,
            sourceError: err
          }, this.environment);
        }
        // Generic error
        return handleError({
          code: 'F5203',
          operation: 'resourceId',
          errorMessage: err.message || String(err),
          stack: err.stack || (new Error()).stack,
          sourceError: err
        }, this.environment);
      }
    },

    /**
     * $searchSingle(resourceTypeOrRef, params?, options?) - Resolve single resource
     * @param {string} resourceTypeOrRef - Resource type or reference
     * @param {Object} params - Search parameters
     * @param {Object} options - Search options
     * @returns {Promise<Object>} Resolved resource
     */
    searchSingle: async function(resourceTypeOrRef, params, options) {
      const client = getClientOrThrow(this.environment, 'searchSingle');
      if (!client) return undefined; // Client not configured and error was suppressed
      try {
        return await client.resolve(resourceTypeOrRef, params, options);
      } catch (err) {
        if (err.response && err.response.status === 404) {
          const ref = resourceTypeOrRef;
          const [resourceType, resourceId] = ref.split('/');
          return handleError({
            code: 'F5210',
            resourceType,
            resourceId,
            stack: err.stack || (new Error()).stack,
            sourceError: err
          }, this.environment);
        }
        if (err.message && err.message.includes('No resources found')) {
          const resourceType = typeof params === 'object' ? resourceTypeOrRef : resourceTypeOrRef.split('/')[0];
          const searchParams = typeof params === 'object' ? params : {};
          return handleError({
            code: 'F5211',
            resourceType,
            searchParams: JSON.stringify(searchParams),
            stack: err.stack || (new Error()).stack,
            sourceError: err
          }, this.environment);
        }
        if (err.message && err.message.includes('Multiple resources found')) {
          const resourceType = typeof params === 'object' ? resourceTypeOrRef : resourceTypeOrRef.split('/')[0];
          const searchParams = typeof params === 'object' ? params : {};
          const match = err.message.match(/\((\d+) found\)/);
          const resultCount = match ? match[1] : 'multiple';
          return handleError({
            code: 'F5212',
            resourceType,
            searchParams: JSON.stringify(searchParams),
            resultCount,
            stack: err.stack || (new Error()).stack,
            sourceError: err
          }, this.environment);
        }
        return handleError({
          code: 'F5203',
          operation: 'searchSingle',
          errorMessage: err.message || String(err),
          stack: err.stack || (new Error()).stack,
          sourceError: err
        }, this.environment);
      }
    },

    /**
     * $resolve(resourceTypeOrRef, params?, options?) - Resolve resource by reference or search
     * @param {string} resourceTypeOrRef - Resource type or reference
     * @param {Object} params - Search parameters
     * @param {Object} options - Search options
     * @returns {Promise<Object>} Resolved resource
     */
    resolve: async function(resourceTypeOrRef, params, options) {
      const client = getClientOrThrow(this.environment, 'resolve');
      if (!client) return undefined; // Client not configured and error was suppressed
      try {
        return await client.resolve(resourceTypeOrRef, params, options);
      } catch (err) {
        if (err.response && err.response.status === 404) {
          const ref = resourceTypeOrRef;
          const [resourceType, resourceId] = ref.split('/');
          return handleError({
            code: 'F5210',
            resourceType,
            resourceId,
            stack: err.stack || (new Error()).stack,
            sourceError: err
          }, this.environment);
        }
        if (err.message && err.message.includes('No resources found')) {
          const resourceType = typeof params === 'object' ? resourceTypeOrRef : resourceTypeOrRef.split('/')[0];
          const searchParams = typeof params === 'object' ? params : {};
          return handleError({
            code: 'F5211',
            resourceType,
            searchParams: JSON.stringify(searchParams),
            stack: err.stack || (new Error()).stack,
            sourceError: err
          }, this.environment);
        }
        if (err.message && err.message.includes('Multiple resources found')) {
          const resourceType = typeof params === 'object' ? resourceTypeOrRef : resourceTypeOrRef.split('/')[0];
          const searchParams = typeof params === 'object' ? params : {};
          const match = err.message.match(/\((\d+) found\)/);
          const resultCount = match ? match[1] : 'multiple';
          return handleError({
            code: 'F5212',
            resourceType,
            searchParams: JSON.stringify(searchParams),
            resultCount,
            stack: err.stack || (new Error()).stack,
            sourceError: err
          }, this.environment);
        }
        return handleError({
          code: 'F5203',
          operation: 'resolve',
          errorMessage: err.message || String(err),
          stack: err.stack || (new Error()).stack,
          sourceError: err
        }, this.environment);
      }
    },

    /**
     * $literal(resourceType, params, options?) - Get literal reference from search
     * @param {string} resourceType - Resource type to search
     * @param {Object} params - Search parameters
     * @param {Object} options - Search options
     * @returns {Promise<string>} Literal reference (resourceType/id)
     */
    literal: async function(resourceType, params, options) {
      const client = getClientOrThrow(this.environment, 'literal');
      if (!client) return undefined; // Client not configured and error was suppressed
      try {
        return await client.toLiteral(resourceType, params, options);
      } catch (err) {
        if (err.message && err.message.includes('No resources found')) {
          return handleError({
            code: 'F5211',
            resourceType,
            searchParams: JSON.stringify(params),
            stack: err.stack || (new Error()).stack,
            sourceError: err
          }, this.environment);
        }
        if (err.message && err.message.includes('Multiple resources found')) {
          const match = err.message.match(/\((\d+) found\)/);
          const resultCount = match ? match[1] : 'multiple';
          return handleError({
            code: 'F5212',
            resourceType,
            searchParams: JSON.stringify(params),
            resultCount,
            stack: err.stack || (new Error()).stack,
            sourceError: err
          }, this.environment);
        }
        return handleError({
          code: 'F5203',
          operation: 'literal',
          errorMessage: err.message || String(err),
          stack: err.stack || (new Error()).stack,
          sourceError: err
        }, this.environment);
      }
    }
  };
}

export default createFhirClientWrappers;
