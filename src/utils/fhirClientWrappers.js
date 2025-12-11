/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

/**
 * Creates user-facing wrapper functions for FHIR client operations.
 * These functions are bound to the environment and provide controlled access to the FHIR client.
 * @param {Function} getFhirClient - Function that retrieves the current FHIR client from environment
 * @returns {Object} Object containing wrapper functions
 */
function createFhirClientWrappers(getFhirClient) {
  /**
   * Helper to get FHIR client or throw appropriate error
   * @param {Object} environment - Execution environment
   * @param {string} operationName - Name of operation for error messages
   * @returns {Object} FHIR client instance
   * @throws {Object} Error with code F5200 if client not configured
   */
  function getClientOrThrow(environment, operationName) {
    const client = getFhirClient(environment);
    if (!client) {
      throw {
        code: 'F5200',
        stack: (new Error()).stack,
        operation: operationName
      };
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
      try {
        return await operation.call(client, ...args);
      } catch (err) {
        // Check if it's a timeout error
        if (err.name === 'AbortError' || (err.message && err.message.includes('timeout'))) {
          throw {
            code: 'F5202',
            operation: operationName,
            timeout: client.config?.timeout || 30000,
            stack: err.stack || (new Error()).stack,
            sourceError: err
          };
        }

        // Check for resource not found (404)
        if (err.response && err.response.status === 404) {
          // Try to extract resource type and ID from error or args
          const resourceType = args[0];
          const resourceId = args[1];
          if (resourceType && resourceId) {
            throw {
              code: 'F5210',
              resourceType,
              resourceId,
              stack: err.stack || (new Error()).stack,
              sourceError: err
            };
          }
        }

        // Generic FHIR client error
        throw {
          code: 'F5203',
          operation: operationName,
          errorMessage: err.message || String(err),
          stack: err.stack || (new Error()).stack,
          sourceError: err
        };
      }
    };
  }

  return {
    /**
     * $search(resourceType, params?, options?) - Search for FHIR resources
     * Signature: <s-o?o?:x>
     */
    search: wrapOperation(async function(resourceType, params, options) {
      return await this.search(resourceType, params, options);
    }, 'search'),

    /**
     * $capabilities() - Get server capabilities
     * Signature: <:o>
     */
    capabilities: wrapOperation(async function() {
      return await this.getCapabilities();
    }, 'getCapabilities'),

    /**
     * $resourceId(resourceType, params, options?) - Get resource ID from search
     * Signature: <so-o?:s>
     */
    resourceId: wrapOperation(async function(resourceType, params, options) {
      try {
        return await this.resourceId(resourceType, params, options);
      } catch (err) {
        // If the underlying method throws about multiple/no results, convert to our error codes
        if (err.message && err.message.includes('No resources found')) {
          throw {
            code: 'F5211',
            resourceType,
            searchParams: JSON.stringify(params),
            stack: err.stack || (new Error()).stack,
            sourceError: err
          };
        }
        if (err.message && err.message.includes('Multiple resources found')) {
          const match = err.message.match(/(\d+) found/);
          const resultCount = match ? match[1] : 'multiple';
          throw {
            code: 'F5212',
            resourceType,
            searchParams: JSON.stringify(params),
            resultCount,
            stack: err.stack || (new Error()).stack,
            sourceError: err
          };
        }
        throw err; // Re-throw if not a specific error we handle
      }
    }, 'resourceId'),

    /**
     * $searchSingle(resourceTypeOrRef, params?, options?) - Resolve single resource
     * Alias for $resolve
     * Signature: <s-x?o?:o>
     */
    searchSingle: wrapOperation(async function(resourceTypeOrRef, params, options) {
      try {
        return await this.resolve(resourceTypeOrRef, params, options);
      } catch (err) {
        // Handle specific resolve errors
        if (err.message && err.message.includes('No resources found')) {
          const resourceType = typeof params === 'object' ? resourceTypeOrRef : resourceTypeOrRef.split('/')[0];
          const searchParams = typeof params === 'object' ? params : {};
          throw {
            code: 'F5211',
            resourceType,
            searchParams: JSON.stringify(searchParams),
            stack: err.stack || (new Error()).stack,
            sourceError: err
          };
        }
        if (err.message && err.message.includes('Multiple resources found')) {
          const resourceType = typeof params === 'object' ? resourceTypeOrRef : resourceTypeOrRef.split('/')[0];
          const searchParams = typeof params === 'object' ? params : {};
          const match = err.message.match(/(\d+) found/);
          const resultCount = match ? match[1] : 'multiple';
          throw {
            code: 'F5212',
            resourceType,
            searchParams: JSON.stringify(searchParams),
            resultCount,
            stack: err.stack || (new Error()).stack,
            sourceError: err
          };
        }
        throw err;
      }
    }, 'resolve'),

    /**
     * $resolve(resourceTypeOrRef, params?, options?) - Resolve resource by reference or search
     * Signature: <s-x?o?:o>
     */
    resolve: wrapOperation(async function(resourceTypeOrRef, params, options) {
      try {
        return await this.resolve(resourceTypeOrRef, params, options);
      } catch (err) {
        // Handle specific resolve errors
        if (err.message && err.message.includes('No resources found')) {
          const resourceType = typeof params === 'object' ? resourceTypeOrRef : resourceTypeOrRef.split('/')[0];
          const searchParams = typeof params === 'object' ? params : {};
          throw {
            code: 'F5211',
            resourceType,
            searchParams: JSON.stringify(searchParams),
            stack: err.stack || (new Error()).stack,
            sourceError: err
          };
        }
        if (err.message && err.message.includes('Multiple resources found')) {
          const resourceType = typeof params === 'object' ? resourceTypeOrRef : resourceTypeOrRef.split('/')[0];
          const searchParams = typeof params === 'object' ? params : {};
          const match = err.message.match(/(\d+) found/);
          const resultCount = match ? match[1] : 'multiple';
          throw {
            code: 'F5212',
            resourceType,
            searchParams: JSON.stringify(searchParams),
            resultCount,
            stack: err.stack || (new Error()).stack,
            sourceError: err
          };
        }
        throw err;
      }
    }, 'resolve'),

    /**
     * $literal(resourceType, params, options?) - Get literal reference from search
     * Signature: <so-o?:s>
     */
    literal: wrapOperation(async function(resourceType, params, options) {
      try {
        return await this.toLiteral(resourceType, params, options);
      } catch (err) {
        // Handle specific toLiteral errors
        if (err.message && err.message.includes('No resources found')) {
          throw {
            code: 'F5211',
            resourceType,
            searchParams: JSON.stringify(params),
            stack: err.stack || (new Error()).stack,
            sourceError: err
          };
        }
        if (err.message && err.message.includes('Multiple resources found')) {
          const match = err.message.match(/(\d+) found/);
          const resultCount = match ? match[1] : 'multiple';
          throw {
            code: 'F5212',
            resourceType,
            searchParams: JSON.stringify(params),
            resultCount,
            stack: err.stack || (new Error()).stack,
            sourceError: err
          };
        }
        throw err;
      }
    }, 'toLiteral')
  };
}

export default createFhirClientWrappers;
