/* eslint-disable require-jsdoc */
import fumifier from '../src/fumifier.js';
import assert from 'assert';
import { FhirStructureNavigator } from "@outburn/structure-navigator";
import { FhirSnapshotGenerator } from "fhir-snapshot-generator";
import { FhirTerminologyRuntime } from "fhir-terminology-runtime";

describe('AST Mobility Feature', function() {
  let navigator;
  let terminologyRuntime;

  before(async function() {
    this.timeout(180000); // Set timeout to 180 seconds (3 minutes)
    const fsg = await FhirSnapshotGenerator.create({
      context: ['il.core.fhir.r4#0.17.0', 'fumifier.test.pkg#0.1.0'],
      cachePath: './test/.test-cache',
      fhirVersion: '4.0.1',
      cacheMode: 'lazy'
    });
    // Create a FhirStructureNavigator instance using the FhirSnapshotGenerator
    navigator = new FhirStructureNavigator(fsg);
    terminologyRuntime = await FhirTerminologyRuntime.create({
      context: ['il.core.fhir.r4#0.17.0', 'fumifier.test.pkg#0.1.0'],
      cachePath: './test/.test-cache',
      fhirVersion: '4.0.1'
    });
  });
  it('should create fumifier object from AST JSON', async function() {
    // Create original expression
    const originalExpr = await fumifier('1 + 2');
    const originalAst = originalExpr.ast();

    // Create new fumifier object from AST
    const recreatedExpr = await fumifier(originalAst);

    // Both should have same AST
    assert.deepEqual(recreatedExpr.ast(), originalAst);

    // Both should evaluate to same result
    const originalResult = await originalExpr.evaluate({});
    const recreatedResult = await recreatedExpr.evaluate({});
    assert.equal(originalResult, recreatedResult);
  });

  it('should handle complex expressions with variables', async function() {
    const originalExpr = await fumifier('$x + $y * 2');
    const originalAst = originalExpr.ast();

    const recreatedExpr = await fumifier(originalAst);

    const testData = {};
    const bindings = { x: 5, y: 3 };

    const originalResult = await originalExpr.evaluate(testData, bindings);
    const recreatedResult = await recreatedExpr.evaluate(testData, bindings);

    assert.equal(originalResult, recreatedResult);
    assert.equal(originalResult, 11); // 5 + 3 * 2 = 11
  });

  it('should handle FLASH expressions with real navigator', async function() {
    // Test a FLASH expression that creates a Patient resource
    const flashExpr = `InstanceOf: il-core-patient
* id = 'test-patient-123'
* identifier
  * system = 'urn:ietf:rfc:4122'
  * value = 'test-patient-123'
* name
  * given = "John"
  * family = "Doe"
* gender = "male"
* birthDate = '1980-01-01'`;

    const originalExpr = await fumifier(flashExpr, { navigator, terminologyRuntime });
    const originalAst = originalExpr.ast();

    // Create new fumifier object from AST with navigator
    const recreatedExpr = await fumifier(originalAst, { navigator, terminologyRuntime });

    // Verify both are FLASH expressions (FHIR definition ordering may differ)
    const recreatedAst = recreatedExpr.ast();
    assert.equal(recreatedAst.containsFlash, originalAst.containsFlash, 'Both should be FLASH expressions');

    // Both should evaluate to same result
    const originalResult = await originalExpr.evaluate({});
    const recreatedResult = await recreatedExpr.evaluate({});

    assert.deepEqual(originalResult, recreatedResult);

    // Verify the structure is a proper Patient resource
    assert.equal(originalResult.resourceType, "Patient");
    assert.equal(originalResult.id, "test-patient-123");

    // il-core-patient profile combines given and family into a single name object
    assert.ok(Array.isArray(originalResult.name), "name should be an array");
    assert.equal(originalResult.name.length, 1, "should have 1 name entry");

    const nameEntry = originalResult.name[0];
    assert.equal(nameEntry.given[0], "John");
    assert.equal(nameEntry.family, "Doe");

    assert.equal(originalResult.gender, "male");
  });

  it('should handle FLASH expressions with data binding', async function() {
    // Test a FLASH expression that uses input data
    const flashExpr = `InstanceOf: us-core-patient
* id = patientId & '-processed'
* identifier
  * system = 'urn:ietf:rfc:4122'
  * value = patientId
* name
  * given = firstName
  * family = lastName
* gender = 'other'`;

    const originalExpr = await fumifier(flashExpr, { navigator, terminologyRuntime });
    const originalAst = originalExpr.ast();

    // Create new fumifier object from AST with navigator
    const recreatedExpr = await fumifier(originalAst, { navigator, terminologyRuntime });

    // Verify both are FLASH expressions (FHIR definition ordering may differ)
    const recreatedAst = recreatedExpr.ast();
    assert.equal(recreatedAst.containsFlash, originalAst.containsFlash, 'Both should be FLASH expressions');

    // Both should evaluate to same result when given input data
    const testData = {
      patientId: "patient-123",
      firstName: "Jane",
      lastName: "Smith"
    };

    const originalResult = await originalExpr.evaluate(testData);
    const recreatedResult = await recreatedExpr.evaluate(testData);

    assert.deepEqual(originalResult, recreatedResult);

    // Verify the structure is a proper Patient resource with data binding
    assert.equal(originalResult.resourceType, "Patient");
    assert.equal(originalResult.id, "patient-123-processed");

    // FLASH creates separate name entries for given and family
    assert.ok(Array.isArray(originalResult.name), "name should be an array");

    // Find the name entry with given name
    const givenNameEntry = originalResult.name.find(n => n.given);
    assert.ok(givenNameEntry, "should have given name entry");
    assert.equal(givenNameEntry.given[0], "Jane");

    // Find the name entry with family name
    const familyNameEntry = originalResult.name.find(n => n.family);
    assert.ok(familyNameEntry, "should have family name entry");
    assert.equal(familyNameEntry.family, "Smith");
  });

  it('should serialize and deserialize AST as JSON', async function() {
    const originalExpr = await fumifier('"Hello " & $.name');
    const originalAst = originalExpr.ast();

    // Serialize to JSON string
    const astJson = JSON.stringify(originalAst);

    // Deserialize from JSON string
    const deserializedAst = JSON.parse(astJson);

    // Create new fumifier object from deserialized AST
    const recreatedExpr = await fumifier(deserializedAst);

    // Should evaluate to same result
    const testData = { name: "World" };
    const originalResult = await originalExpr.evaluate(testData);
    const recreatedResult = await recreatedExpr.evaluate(testData);

    assert.equal(originalResult, recreatedResult);
    assert.equal(originalResult, "Hello World");
  });

  it('should handle AST with errors (recovery mode)', async function() {
    const originalExpr = await fumifier('1 + +', { recover: true });
    const originalAst = originalExpr.ast();
    const originalErrors = originalExpr.errors();

    // With AST mobility, errors now stay in the AST automatically
    const recreatedExpr = await fumifier(originalAst, { recover: true });
    const recreatedErrors = recreatedExpr.errors();

    // Should have same AST structure (with embedded error nodes)
    assert.deepEqual(recreatedExpr.ast(), originalAst);

    // Both should have had errors
    assert.ok(originalErrors && originalErrors.length > 0);
    assert.ok(recreatedErrors && recreatedErrors.length > 0);

    // The AST should contain error nodes
    assert.equal(originalAst.rhs.type, 'error');
    assert.equal(originalAst.rhs.code, 'S0211');

    // Both expressions should fail evaluation consistently (syntax errors)
    await assert.rejects(
      async () => await originalExpr.evaluate({}),
      (err) => err.code === 'S0500'
    );

    await assert.rejects(
      async () => await recreatedExpr.evaluate({}),
      (err) => err.code === 'S0500'
    );
  });

  it('should throw error for invalid AST', async function() {
    const invalidAst = { value: "broken" }; // Missing required 'type' property

    await assert.rejects(async () => {
      await fumifier(invalidAst);
    }, /Invalid AST/);
  });

  it('should throw error for invalid input types', async function() {
    // Test null
    await assert.rejects(async () => {
      await fumifier(null);
    }, /Expression must be either a string or an AST object/);

    // Test undefined
    await assert.rejects(async () => {
      await fumifier(undefined);
    }, /Expression must be either a string or an AST object/);

    // Test number
    await assert.rejects(async () => {
      await fumifier(123);
    }, /Expression must be either a string or an AST object/);

    // Test boolean
    await assert.rejects(async () => {
      await fumifier(true);
    }, /Expression must be either a string or an AST object/);
  });

  it('should preserve AST properties after recreation', async function() {
    const originalExpr = await fumifier('$.items[price > 10]');
    const originalAst = originalExpr.ast();

    const recreatedExpr = await fumifier(originalAst);
    const recreatedAst = recreatedExpr.ast();

    // Should preserve all AST properties
    assert.deepEqual(recreatedAst, originalAst);

    // Test with sample data
    const testData = {
      items: [
        { price: 5 },
        { price: 15 },
        { price: 8 },
        { price: 20 }
      ]
    };

    const originalResult = await originalExpr.evaluate(testData);
    const recreatedResult = await recreatedExpr.evaluate(testData);

    assert.deepEqual(originalResult, recreatedResult);
    assert.equal(originalResult.length, 2); // Two items with price > 10
  });

  it('should populate and preserve normalizedRootPackages for FLASH expressions', async function() {
    // Test a FLASH expression that should trigger normalized root package extraction
    const flashExpr = `InstanceOf: Patient
* id = 'mobility-test-patient'
* name
  * given = "Package"
  * family = "Mobility"
* gender = "unknown"`;

    const originalExpr = await fumifier(flashExpr, { navigator, terminologyRuntime });
    const originalAst = originalExpr.ast();

    // Verify that normalizedRootPackages was populated during compilation
    assert.ok(originalAst.normalizedRootPackages, 'normalizedRootPackages should be populated for FLASH expressions');
    assert.ok(Array.isArray(originalAst.normalizedRootPackages), 'normalizedRootPackages should be an array');
    assert.ok(originalAst.normalizedRootPackages.length > 0, 'normalizedRootPackages should contain package information');

    // Verify the structure of normalized packages (should have id and version)
    const firstPackage = originalAst.normalizedRootPackages[0];
    assert.ok(typeof firstPackage === 'object', 'Each package should be an object');
    assert.ok(typeof firstPackage.id === 'string', 'Package should have an id string');
    assert.ok(typeof firstPackage.version === 'string', 'Package should have a version string');

    // Serialize and deserialize the AST (simulating AST mobility)
    const astJson = JSON.stringify(originalAst);
    const deserializedAst = JSON.parse(astJson);

    // Verify normalizedRootPackages is preserved during serialization
    assert.deepEqual(deserializedAst.normalizedRootPackages, originalAst.normalizedRootPackages,
      'normalizedRootPackages should be preserved during JSON serialization/deserialization');

    // Create new fumifier object from deserialized AST with navigator
    const recreatedExpr = await fumifier(deserializedAst, { navigator, terminologyRuntime });
    const recreatedAst = recreatedExpr.ast();

    // Verify normalizedRootPackages is preserved after recreation
    assert.deepEqual(recreatedAst.normalizedRootPackages, originalAst.normalizedRootPackages,
      'normalizedRootPackages should be preserved after AST recreation');

    // Both should evaluate to the same result
    const originalResult = await originalExpr.evaluate({});
    const recreatedResult = await recreatedExpr.evaluate({});

    assert.deepEqual(originalResult, recreatedResult);
    assert.equal(originalResult.resourceType, "Patient");
    assert.equal(originalResult.id, "mobility-test-patient");
  });

  it('should not populate normalizedRootPackages for non-FLASH expressions', async function() {
    // Test a regular JSONata expression (no FLASH content)
    const regularExpr = await fumifier('1 + 2');
    const regularAst = regularExpr.ast();

    // Should not have normalizedRootPackages for non-FLASH expressions
    assert.ok(!regularAst.normalizedRootPackages, 'normalizedRootPackages should not be populated for non-FLASH expressions');

    // Even with navigator provided, non-FLASH expressions shouldn't get normalized packages
    const regularExprWithNav = await fumifier('$.name & " processed"', { navigator, terminologyRuntime });
    const regularAstWithNav = regularExprWithNav.ast();

    assert.ok(!regularAstWithNav.normalizedRootPackages, 'normalizedRootPackages should not be populated for non-FLASH expressions even with navigator');
  });
});