import fumifier from '../src/fumifier.js';
import { expect } from 'chai';
import { FhirStructureNavigator } from "@outburn/structure-navigator";
import { FhirSnapshotGenerator } from "fhir-snapshot-generator";
import { FhirTerminologyRuntime } from "fhir-terminology-runtime";
import { FhirPackageExplorer } from "fhir-package-explorer";

describe('AST Resolution Optimization', function() {
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

  it('should not re-resolve an already resolved AST', async function() {
    const expression = `InstanceOf: il-core-patient
* id = 'test-patient-123'`;

    // First compilation - should trigger FLASH resolution
    const compiled1 = await fumifier(expression, { navigator, terminologyRuntime });
    const ast1 = compiled1.ast();

    // Verify the AST is resolved
    expect(ast1.resolvedTypeMeta).to.be.an('object');
    expect(ast1.resolvedElementDefinitions).to.be.an('object');

    // Track the resolved data to verify it's not changed
    const originalResolvedTypeMeta = ast1.resolvedTypeMeta;
    const originalResolvedElementDefinitions = ast1.resolvedElementDefinitions;

    // Second compilation using the already-resolved AST - should NOT re-resolve
    const compiled2 = await fumifier(ast1, { navigator, terminologyRuntime });
    const ast2 = compiled2.ast();

    // Verify it's the same AST object (no cloning happened)
    expect(ast2).to.equal(ast1);

    // Verify the resolved data wasn't changed (no re-resolution happened)
    expect(ast2.resolvedTypeMeta).to.equal(originalResolvedTypeMeta);
    expect(ast2.resolvedElementDefinitions).to.equal(originalResolvedElementDefinitions);

    // Verify both compilations exist (even if evaluation might have validation errors)
    expect(compiled1).to.exist;
    expect(compiled2).to.exist;
  });

  it('should detect when FLASH AST needs resolution', async function() {
    const expression = `InstanceOf: il-core-patient
* id = 'test-patient-456'`;

    // Parse but don't resolve (no navigator) - this should fail
    let errorThrown = false;
    try {
      await fumifier(expression);
    } catch (err) {
      errorThrown = true;
      expect(err.code).to.equal('F1000'); // Expected: no navigator provided for FLASH content
    }
    expect(errorThrown).to.be.true;
  });

  it('should resolve an unresolved AST with FLASH content using recovery mode', async function() {
    const expression = `InstanceOf: il-core-patient
* id = 'test-patient-456'`;

    // Parse in recovery mode (no navigator)
    const compiled1 = await fumifier(expression, { recover: true });
    const ast1 = compiled1.ast();

    // Verify the AST has FLASH but is not resolved
    expect(ast1.containsFlash).to.be.true;
    expect(ast1.resolvedTypeMeta).to.be.undefined;
    expect(ast1.resolvedElementDefinitions).to.be.undefined;

    // Check that there are errors from the missing navigator
    const errors1 = compiled1.errors();
    expect(errors1).to.have.length.greaterThan(0);
    expect(errors1[0].code).to.equal('F1000');

    // Now compile with navigator - should resolve
    const compiled2 = await fumifier(ast1, { navigator, terminologyRuntime });
    const ast2 = compiled2.ast();

    // Verify it's the same AST object but now resolved
    expect(ast2).to.equal(ast1);
    expect(ast2.containsFlash).to.be.true;
    expect(ast2.resolvedTypeMeta).to.be.an('object');
    expect(ast2.resolvedElementDefinitions).to.be.an('object');
  });

  it('should handle non-FLASH AST (no resolution needed)', async function() {
    const expression = 'name.given[0]';

    // Parse without navigator
    const compiled1 = await fumifier(expression);
    const ast1 = compiled1.ast();

    // Verify no FLASH content
    expect(ast1.containsFlash).to.not.be.true;
    expect(ast1.resolvedTypeMeta).to.be.undefined;

    // Compile again with navigator - should not change anything
    const compiled2 = await fumifier(ast1, { navigator, terminologyRuntime });
    const ast2 = compiled2.ast();

    // Should be the same object, no changes
    expect(ast2).to.equal(ast1);
    expect(ast2.containsFlash).to.not.be.true;
    expect(ast2.resolvedTypeMeta).to.be.undefined;

    // Should work identically
    const input = { name: [{ given: ['John', 'Doe'] }] };
    const result1 = await compiled1.evaluate(input);
    const result2 = await compiled2.evaluate(input);
    expect(result1).to.equal('John');
    expect(result2).to.equal('John');
  });
});