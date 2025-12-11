/* eslint-disable no-unused-vars */
/* eslint-disable valid-jsdoc */
/* eslint-disable require-jsdoc */
/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

/**
 * Mock FHIR Client for testing
 * Simulates the @outburn/fhir-client API with predictable responses
 */
export class MockFhirClient {
  constructor(config = {}) {
    this.config = {
      baseUrl: config.baseUrl || 'http://mock-server',
      fhirVersion: config.fhirVersion || 'R4',
      ...config
    };

    // Mock data storage
    this.mockData = {
      'Patient/123': {
        resourceType: 'Patient',
        id: '123',
        name: [{ family: 'Doe', given: ['John'] }]
      },
      'Patient/456': {
        resourceType: 'Patient',
        id: '456',
        name: [{ family: 'Smith', given: ['Jane'] }]
      },
      'Observation/obs1': {
        resourceType: 'Observation',
        id: 'obs1',
        status: 'final',
        code: {
          coding: [{
            system: 'http://loinc.org',
            code: '8480-6',
            display: 'Systolic blood pressure'
          }]
        },
        valueQuantity: {
          value: 120,
          unit: 'mmHg',
          system: 'http://unitsofmeasure.org',
          code: 'mm[Hg]'
        }
      }
    };

    // Search results
    this.searchResults = {
      'Patient': {
        'name=John': ['Patient/123'],
        'name=Jane': ['Patient/456'],
        'name=Nobody': [],
        'name=Duplicate': ['Patient/123', 'Patient/456'],
        'identifier=http://system|12345': ['Patient/123']
      },
      'Observation': {
        'subject=Patient/123': ['Observation/obs1']
      }
    };
  }

  /**
   * Read a resource by type and ID
   */
  async read(resourceType, id, options = {}) {
    const ref = `${resourceType}/${id}`;
    const resource = this.mockData[ref];

    if (!resource) {
      const error = new Error(`Resource not found: ${ref}`);
      error.response = { status: 404 };
      throw error;
    }

    return resource;
  }

  /**
   * Search for resources
   */
  async search(resourceType, params = {}, options = {}) {
    // Convert params to search key
    const searchKey = Object.entries(params)
      .map(([k, v]) => `${k}=${v}`)
      .join('&');

    const results = this.searchResults[resourceType]?.[searchKey];

    if (!results) {
      return {
        resourceType: 'Bundle',
        type: 'searchset',
        total: 0,
        entry: []
      };
    }

    const entries = results.map(ref => ({
      fullUrl: `${this.config.baseUrl}/${ref}`,
      resource: this.mockData[ref],
      search: { mode: 'match' }
    }));

    if (options.fetchAll) {
      // Return array of resources
      return entries.map(e => e.resource);
    }

    return {
      resourceType: 'Bundle',
      type: 'searchset',
      total: results.length,
      entry: entries
    };
  }

  /**
   * Get server capabilities
   */
  async getCapabilities() {
    return {
      resourceType: 'CapabilityStatement',
      status: 'active',
      date: '2025-12-11',
      kind: 'instance',
      fhirVersion: this.config.fhirVersion,
      format: ['application/fhir+json']
    };
  }

  /**
   * Get resource ID from search (expects exactly one result)
   */
  async resourceId(resourceType, params, options = {}) {
    const bundle = await this.search(resourceType, params, options);

    if (bundle.total === 0) {
      throw new Error(`No resources found for ${resourceType} with params ${JSON.stringify(params)}`);
    }

    if (bundle.total > 1) {
      throw new Error(`Multiple resources found for ${resourceType} (${bundle.total} found), expected exactly one`);
    }

    return bundle.entry[0].resource.id;
  }

  /**
   * Resolve resource by reference or search
   */
  async resolve(resourceTypeOrRef, params, options = {}) {
    // If params is undefined/null, treat as literal reference
    if (params === undefined || params === null || typeof params === 'string') {
      // Literal reference: "Patient/123"
      const ref = resourceTypeOrRef;
      const [resourceType, id] = ref.split('/');
      return await this.read(resourceType, id, options);
    }

    // Search mode
    const bundle = await this.search(resourceTypeOrRef, params, options);

    if (bundle.total === 0) {
      throw new Error(`No resources found for ${resourceTypeOrRef} with params ${JSON.stringify(params)}`);
    }

    if (bundle.total > 1) {
      throw new Error(`Multiple resources found for ${resourceTypeOrRef} (${bundle.total} found), expected exactly one`);
    }

    return bundle.entry[0].resource;
  }

  /**
   * Get literal reference from search
   */
  async toLiteral(resourceType, params, options = {}) {
    const id = await this.resourceId(resourceType, params, options);
    return `${resourceType}/${id}`;
  }
}
