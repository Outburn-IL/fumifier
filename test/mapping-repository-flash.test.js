/* eslint-disable require-jsdoc */
import fumifier from '../src/fumifier.js';
import assert from 'assert';
import { FhirStructureNavigator } from "@outburn/structure-navigator";
import { FhirSnapshotGenerator } from "fhir-snapshot-generator";
import { FhirTerminologyRuntime } from "fhir-terminology-runtime";
import { FhirPackageExplorer } from "fhir-package-explorer";

describe('Mapping Repository with FLASH Expressions', function() {
  let navigator;
  let terminologyRuntime;

  before(async function() {
    this.timeout(180000); // Set timeout to 180 seconds (3 minutes)

    // Create shared FhirPackageExplorer instance
    const fpe = await FhirPackageExplorer.create({
      context: ['il.core.fhir.r4#0.17.0', 'fumifier.test.pkg#0.1.0'],
      cachePath: './test/.test-cache',
      fhirVersion: '4.0.1',
      cacheMode: 'lazy'
    });

    // Create FhirSnapshotGenerator with shared FPE
    const fsg = await FhirSnapshotGenerator.create({ fpe, fhirVersion: '4.0.1', cacheMode: 'lazy' });
    navigator = new FhirStructureNavigator(fsg);

    // Create FhirTerminologyRuntime with shared FPE
    terminologyRuntime = await FhirTerminologyRuntime.create({ fpe });
  });

  describe('FLASH Expressions in Mappings', function() {
    let flashMappingCache;

    beforeEach(function() {
      // Create mappings that use FLASH expressions
      const mappings = {
        'validatePatient': `
InstanceOf: Patient
* id = 'mapping-validated-patient'
        `,
        'transformPatientName': `
InstanceOf: Patient  
* id = name.given[0] & "-" & name.family
        `,
        'extractIdentifier': `
InstanceOf: Patient
* id = mrn
        `,
        'validateAndTransform': `
InstanceOf: Patient
* id = patientId
* active = isActive
        `,
        'nestedFlashMapping': `
InstanceOf: Patient
* id = $prefix & "-patient"
        `
      };

      flashMappingCache = {
        async getKeys() {
          return Object.keys(mappings);
        },
        async get(key) {
          if (!(key in mappings)) {
            throw new Error(`Mapping '${key}' not found`);
          }
          return mappings[key];
        }
      };
    });

    it('should handle FLASH validation mappings', async function() {
      const expr = '$validatePatient($)';
      const compiled = await fumifier(expr, {
        navigator,
        terminologyRuntime,
        mappingCache: flashMappingCache
      });

      const patient = {
        resourceType: 'Patient'
      };

      const result = await compiled.evaluate(patient);
      assert.strictEqual(result.resourceType, 'Patient');
      assert.strictEqual(result.id, 'mapping-validated-patient');
    });

    it('should handle FLASH transformation mappings', async function() {
      const expr = '$transformPatientName($)';
      const compiled = await fumifier(expr, {
        navigator,
        terminologyRuntime,
        mappingCache: flashMappingCache
      });

      const patient = {
        resourceType: 'Patient',
        name: [{
          given: ['John'],
          family: 'Doe'
        }]
      };

      const result = await compiled.evaluate(patient);
      assert.strictEqual(result.resourceType, 'Patient');
      assert.strictEqual(result.id, 'John-Doe');
    });

    it('should handle FLASH path extraction mappings', async function() {
      const expr = '$extractIdentifier($)';
      const compiled = await fumifier(expr, {
        navigator,
        terminologyRuntime,
        mappingCache: flashMappingCache
      });

      const patient = {
        resourceType: 'Patient',
        mrn: '12345'
      };

      const result = await compiled.evaluate(patient);
      assert.strictEqual(result.resourceType, 'Patient');
      assert.strictEqual(result.id, '12345');
    });

    it('should handle complex FLASH mappings with multiple operations', async function() {
      const expr = '$validateAndTransform($)';
      const compiled = await fumifier(expr, {
        navigator,
        terminologyRuntime,
        mappingCache: flashMappingCache
      });

      const patient = {
        resourceType: 'Patient',
        patientId: 'test-123',
        isActive: true
      };

      const result = await compiled.evaluate(patient);
      assert.strictEqual(result.resourceType, 'Patient');
      assert.strictEqual(result.id, 'test-123');
      assert.strictEqual(result.active, true);
    });

    it('should handle FLASH mappings with bindings', async function() {
      const mappings = {
        'formatWithPrefix': `
InstanceOf: Patient
* id = $prefix & "-formatted"
        `
      };

      const testCache = {
        async getKeys() {
          return Object.keys(mappings);
        },
        async get(key) {
          if (!(key in mappings)) {
            throw new Error(`Mapping '${key}' not found`);
          }
          return mappings[key];
        }
      };

      const expr = '$formatWithPrefix($, {"prefix": "Dr"})';
      const compiled = await fumifier(expr, {
        navigator,
        terminologyRuntime,
        mappingCache: testCache
      });

      const patient = {
        resourceType: 'Patient'
      };

      const result = await compiled.evaluate(patient);
      assert.strictEqual(result.resourceType, 'Patient');
      assert.strictEqual(result.id, 'Dr-formatted');
    });

    it('should handle nested FLASH mapping calls', async function() {
      // This test requires the nestedFlashMapping which calls validatePatient
      const expr = '$nestedFlashMapping($)';
      const compiled = await fumifier(expr, {
        navigator,
        terminologyRuntime,
        mappingCache: flashMappingCache
      });

      const patient = {
        resourceType: 'Patient'
      };

      const result = await compiled.evaluate(patient, { prefix: 'nested' });
      assert.strictEqual(result.resourceType, 'Patient');
      assert.strictEqual(result.id, 'nested-patient');
    });
  });

  describe('FLASH Error Handling in Mappings', function() {
    let errorMappingCache;

    beforeEach(function() {
      const mappings = {
        'invalidFlashSyntax': `
          [Patient
          name.given[0]
        `, // Missing closing bracket
        'invalidResourceType': `
          [InvalidResource]
          name.given[0]
        `,
        'validMapping': `
InstanceOf: Patient
* id = "valid-flash-result"
        `
      };

      errorMappingCache = {
        async getKeys() {
          return Object.keys(mappings);
        },
        async get(key) {
          if (!(key in mappings)) {
            throw new Error(`Mapping '${key}' not found`);
          }
          return mappings[key];
        }
      };
    });

    it('should handle FLASH syntax errors in mappings', async function() {
      const expr = '$invalidFlashSyntax($)';
      const compiled = await fumifier(expr, {
        navigator,
        terminologyRuntime,
        mappingCache: errorMappingCache
      });

      const patient = {
        resourceType: 'Patient',
        name: [{
          given: ['John']
        }]
      };

      try {
        await compiled.evaluate(patient);
        assert.fail('Should have thrown an error');
      } catch (err) {
        assert.strictEqual(err.code, 'F3002');
        assert(err.value.includes('invalidFlashSyntax'));
      }
    });

    it('should handle invalid resource types in FLASH mappings', async function() {
      const expr = '$invalidResourceType($)';
      const compiled = await fumifier(expr, {
        navigator,
        terminologyRuntime,
        mappingCache: errorMappingCache
      });

      const patient = {
        resourceType: 'Patient'
      };

      try {
        await compiled.evaluate(patient);
        assert.fail('Should have thrown an error');
      } catch (err) {
        // Should fail during FLASH resolution/evaluation
        assert(err.code === 'F3002');
      }
    });

    it('should work with valid FLASH mappings after errors', async function() {
      const expr = '$validMapping($)';
      const compiled = await fumifier(expr, {
        navigator,
        terminologyRuntime,
        mappingCache: errorMappingCache
      });

      const patient = {
        resourceType: 'Patient'
      };

      const result = await compiled.evaluate(patient);
      assert.strictEqual(result.resourceType, 'Patient');
      assert.strictEqual(result.id, 'valid-flash-result');
    });
  });

  describe('FLASH Mappings without Navigator', function() {
    let flashMappingCache;

    beforeEach(function() {
      const mappings = {
        'flashMapping': `
InstanceOf: Patient
* id = testValue
        `
      };

      flashMappingCache = {
        async getKeys() {
          return Object.keys(mappings);
        },
        async get(key) {
          return mappings[key];
        }
      };
    });

    it('should handle FLASH mappings without navigator', async function() {
      const expr = '$flashMapping($)';
      const compiled = await fumifier(expr, {
        // No navigator provided
        mappingCache: flashMappingCache
      });

      const patient = {
        resourceType: 'Patient'
      };

      try {
        await compiled.evaluate(patient);
        assert.fail('Should have thrown an error');
      } catch (err) {
        assert.strictEqual(err.code, 'F3002');
        assert(err.value.includes('flashMapping'));
      }
    });
  });

  describe('Mixed FLASH and Regular Mappings', function() {
    let mixedMappingCache;

    beforeEach(function() {
      const mappings = {
        'regularMapping': '"Regular result"',
        'flashMapping': `
InstanceOf: Patient
* id = simpleId
        `,
        'combinedMapping': '"Combined: " & $regularMapping()'
      };

      mixedMappingCache = {
        async getKeys() {
          return Object.keys(mappings);
        },
        async get(key) {
          if (!(key in mappings)) {
            throw new Error(`Mapping '${key}' not found`);
          }
          return mappings[key];
        }
      };
    });

    it('should handle mixed regular and FLASH mappings', async function() {
      const expr = '$combinedMapping($)';
      const compiled = await fumifier(expr, {
        navigator,
        terminologyRuntime,
        mappingCache: mixedMappingCache
      });

      const patient = {
        resourceType: 'Patient',
        name: [{
          given: ['John'],
          family: 'Doe'
        }]
      };

      const result = await compiled.evaluate(patient);
      assert.strictEqual(result, 'Combined: Regular result');
    });

    it('should work with regular mappings when no navigator provided', async function() {
      const expr = '$regularMapping()';
      const compiled = await fumifier(expr, {
        // No navigator provided
        mappingCache: mixedMappingCache
      });

      const result = await compiled.evaluate({});
      assert.strictEqual(result, 'Regular result');
    });
  });
});