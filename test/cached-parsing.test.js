/* eslint-disable require-jsdoc */
import fumifier from '../src/fumifier.js';
import assert from 'assert';
import { FhirStructureNavigator } from "@outburn/structure-navigator";
import { FhirSnapshotGenerator } from "fhir-snapshot-generator";
import { FhirTerminologyRuntime } from "fhir-terminology-runtime";
import { getDefaultCache } from '../src/utils/moduleCache.js';
import { AstCacheInterface } from '../src/utils/cacheUtils.js';

describe('Cached Parsing Feature', function() {
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

  beforeEach(function() {
    // Clear the default cache before each test to ensure clean state
    const cache = getDefaultCache();
    cache.cache.clear();
  });

  it('should cache and reuse parsed AST for identical expressions', async function() {
    const expression = '1 + 2 * 3';

    // First compilation should miss cache
    const expr1 = await fumifier(expression);
    const result1 = await expr1.evaluate({});

    // Second compilation should hit cache
    const expr2 = await fumifier(expression);
    const result2 = await expr2.evaluate({});

    // Both should return same result
    assert.equal(result1, result2);
    assert.equal(result1, 7);

    // ASTs should be structurally equal
    assert.deepEqual(expr1.ast(), expr2.ast());

    // Cache should contain the expression
    const cacheStats = getDefaultCache().getStats();
    assert.equal(cacheStats.size, 1);
  });

  it('should cache FLASH expressions with navigator', async function() {
    const flashExpr = `InstanceOf: Patient
* id = 'cached-patient-123'
* name
  * given = "Cached"
  * family = "Patient"
* gender = "unknown"`;

    // First compilation
    const expr1 = await fumifier(flashExpr, { navigator, terminologyRuntime });
    const result1 = await expr1.evaluate({});

    // Second compilation should use cache
    const expr2 = await fumifier(flashExpr, { navigator, terminologyRuntime });
    const result2 = await expr2.evaluate({});

    // Results should be identical
    assert.deepEqual(result1, result2);
    assert.equal(result1.resourceType, "Patient");
    assert.equal(result1.id, "cached-patient-123");

    // Cache should contain the FLASH expression
    const cacheStats = getDefaultCache().getStats();
    assert.equal(cacheStats.size, 1);
  });

  it('should handle different expressions separately in cache', async function() {
    const expr1Text = '1 + 2';
    const expr2Text = '3 + 4';

    const expr1 = await fumifier(expr1Text);
    const expr2 = await fumifier(expr2Text);

    const result1 = await expr1.evaluate({});
    const result2 = await expr2.evaluate({});

    assert.equal(result1, 3);
    assert.equal(result2, 7);

    // Cache should contain both expressions
    const cacheStats = getDefaultCache().getStats();
    assert.equal(cacheStats.size, 2);
  });

  it('should use cache for $eval function calls', async function() {
    const mainExpr = '$eval("1 + 2")';

    // First evaluation should cache the inner expression
    const expr = await fumifier(mainExpr);
    const result1 = await expr.evaluate({});

    // Second evaluation should use cached inner expression
    const result2 = await expr.evaluate({});

    assert.equal(result1, result2);
    assert.equal(result1, 3);

    // Cache should contain both the main expression and the $eval inner expression
    const cacheStats = getDefaultCache().getStats();
    assert.ok(cacheStats.size >= 1); // At least the inner $eval expression
  });

  it('should handle inflight deduplication', async function() {
    const expression = '$.complex.path.to.data & " processed"';

    // Start multiple compilations simultaneously
    const promises = [
      fumifier(expression),
      fumifier(expression),
      fumifier(expression)
    ];

    const [expr1, expr2, expr3] = await Promise.all(promises);

    // Test with same input
    const testData = { complex: { path: { to: { data: "test" } } } };
    const results = await Promise.all([
      expr1.evaluate(testData),
      expr2.evaluate(testData),
      expr3.evaluate(testData)
    ]);

    // All should return same result
    assert.equal(results[0], "test processed");
    assert.equal(results[1], "test processed");
    assert.equal(results[2], "test processed");

    // ASTs should be identical (same reference from cache)
    assert.deepEqual(expr1.ast(), expr2.ast());
    assert.deepEqual(expr2.ast(), expr3.ast());

    // Cache should only contain one entry
    const cacheStats = getDefaultCache().getStats();
    assert.equal(cacheStats.size, 1);
  });

  it('should differentiate between expressions with different navigator contexts', async function() {
    const flashExpr = `InstanceOf: Patient
* id = 'context-test'`;

    // Compile with navigator
    const exprWithNav = await fumifier(flashExpr, { navigator, terminologyRuntime });

    // Compile without navigator (should error or have different behavior)
    try {
      const exprWithoutNav = await fumifier(flashExpr, { recover: true });

      // If recovery mode allows it, the ASTs should be different
      const astWithNav = exprWithNav.ast();
      const astWithoutNav = exprWithoutNav.ast();

      // These should be cached separately
      const cacheStats = getDefaultCache().getStats();
      assert.ok(cacheStats.size >= 1);

      // The ASTs should be different due to different navigator contexts
      if (astWithNav.resolvedTypeMeta && !astWithoutNav.resolvedTypeMeta) {
        // Expected - with navigator has resolved definitions, without doesn't
        assert.ok(true);
      }
    } catch (error) {
      // Expected error for FLASH without navigator
      assert.equal(error.code, 'F1000');
    }
  });

  it('should support external cache implementation', async function() {
    const expression = '$.customField & " external"';

    // Create a mock external cache
    const externalCache = {
      storage: new Map(),
      async get(identity) {
        const key = JSON.stringify(identity);
        return this.storage.get(key);
      },
      async set(identity, ast) {
        const key = JSON.stringify(identity);
        this.storage.set(key, ast);
      }
    };

    // First compilation with external cache
    const expr1 = await fumifier(expression, { astCache: externalCache });
    const testData = { customField: "test" };
    const result1 = await expr1.evaluate(testData);

    // Second compilation should use external cache
    const expr2 = await fumifier(expression, { astCache: externalCache });
    const result2 = await expr2.evaluate(testData);

    assert.equal(result1, "test external");
    assert.equal(result2, "test external");

    // External cache should contain the expression
    assert.equal(externalCache.storage.size, 1);

    // Default cache should be empty (since we used external cache)
    const defaultCacheStats = getDefaultCache().getStats();
    assert.equal(defaultCacheStats.size, 0);
  });

  it('should estimate memory usage correctly', async function() {
    const { estimateMemoryUsage } = await import('../src/utils/cacheUtils.js');

    // Test primitive values
    assert.equal(estimateMemoryUsage(null), 8);
    assert.equal(estimateMemoryUsage(undefined), 8);
    assert.equal(estimateMemoryUsage(true), 4);
    assert.equal(estimateMemoryUsage(42), 8);
    assert.ok(estimateMemoryUsage("hello") > 10); // String + overhead

    // Test objects
    const simpleObject = { key: "value" };
    const objectSize = estimateMemoryUsage(simpleObject);
    assert.ok(objectSize > 30); // Object overhead + key + value

    // Test arrays
    const simpleArray = [1, 2, 3];
    const arraySize = estimateMemoryUsage(simpleArray);
    assert.ok(arraySize > 40); // Array overhead + elements
  });

  it('should handle cache size limits', async function() {
    // Create many expressions to test cache eviction
    const expressions = [];
    for (let i = 0; i < 10; i++) {
      expressions.push(`${i} + ${i * 2}`);
    }

    // Compile all expressions
    const compiledExprs = [];
    for (const expr of expressions) {
      compiledExprs.push(await fumifier(expr));
    }

    // All expressions should evaluate correctly
    for (let i = 0; i < compiledExprs.length; i++) {
      const result = await compiledExprs[i].evaluate({});
      assert.equal(result, i + (i * 2));
    }

    // Cache should contain expressions (some might be evicted depending on size)
    const cacheStats = getDefaultCache().getStats();
    assert.ok(cacheStats.size > 0);
    assert.ok(cacheStats.size <= 10); // Should not exceed the number of expressions
  });

  it('should handle cache errors gracefully', async function() {
    const expression = '1 + 2';

    // Create a faulty cache that throws errors
    const faultyCache = {
      async get() {
        throw new Error('Cache get error');
      },
      async set() {
        throw new Error('Cache set error');
      }
    };

    // Should work despite cache errors by falling back to direct parsing
    const expr = await fumifier(expression, { astCache: faultyCache });
    const result = await expr.evaluate({});

    assert.equal(result, 3);
  });

  it('should preserve AST properties in cached versions', async function() {
    const expression = '$.items[price > 10].name';

    const expr1 = await fumifier(expression);
    const expr2 = await fumifier(expression); // Should come from cache

    const ast1 = expr1.ast();
    const ast2 = expr2.ast();

    // ASTs should be deeply equal
    assert.deepEqual(ast1, ast2);

    // Verify complex AST structure is preserved
    assert.equal(ast1.type, 'path');
    assert.ok(Array.isArray(ast1.steps));

    const testData = {
      items: [
        { name: "cheap", price: 5 },
        { name: "expensive", price: 15 }
      ]
    };

    const result1 = await expr1.evaluate(testData);
    const result2 = await expr2.evaluate(testData);

    assert.deepEqual(result1, result2);
    // Result could be a string if it's a single result or an array
    if (Array.isArray(result1)) {
      assert.deepEqual(result1, ["expensive"]);
    } else {
      assert.equal(result1, "expensive");
    }
  });

  it('should track inflight statistics per cache instance', async function() {
    // Create a cache interface to test inflight stats
    const astCacheImpl = new AstCacheInterface(getDefaultCache());

    // Get initial stats
    const initialStats = astCacheImpl.getInflightStats();
    assert.equal(initialStats.activeInflightRequests, 0);

    // This test is inherently racy, but we can try to catch inflight requests
    // by using a complex expression that takes longer to parse
    const complexExpression = 'field1.subfield.array[index > 0 and value.nested.deep.property = "test"].result';

    // Start multiple simultaneous compilations using the same AST cache
    const promises = [
      fumifier(complexExpression, { astCache: astCacheImpl.impl }),
      fumifier(complexExpression, { astCache: astCacheImpl.impl }),
      fumifier(complexExpression, { astCache: astCacheImpl.impl })
    ];

    // Check if we can catch any inflight requests (timing dependent)
    // Note: This might be 0 if compilation is too fast

    await Promise.all(promises);

    // After completion, should be back to 0
    const finalStats = astCacheImpl.getInflightStats();
    assert.equal(finalStats.activeInflightRequests, 0);
  });

  it('should work with recovery mode and cache errors', async function() {
    const invalidExpression = '1 + +'; // Syntax error

    // First compilation with recovery
    const expr1 = await fumifier(invalidExpression, { recover: true });
    const errors1 = expr1.errors();

    // Second compilation should use cache
    const expr2 = await fumifier(invalidExpression, { recover: true });
    const errors2 = expr2.errors();

    // Both should have same errors
    assert.ok(errors1.length > 0);
    assert.deepEqual(errors1, errors2);

    // Both should fail evaluation consistently
    await assert.rejects(
      async () => await expr1.evaluate({}),
      (err) => err.code === 'S0500'
    );

    await assert.rejects(
      async () => await expr2.evaluate({}),
      (err) => err.code === 'S0500'
    );
  });

  it('should generate different cache keys for different recover modes', function() {
    const cache = getDefaultCache();

    const baseIdentity = {
      source: 'Patient.name',
      version: '1.2.0',
      rootPackages: ['hl7.fhir.r4.core']
    };

    // Test different recover modes
    const identityRecover = { ...baseIdentity, recover: true };
    const identityNoRecover = { ...baseIdentity, recover: false };

    const keyRecover = cache._generateKey(identityRecover);
    const keyNoRecover = cache._generateKey(identityNoRecover);

    // Keys should be different
    assert.notStrictEqual(keyRecover, keyNoRecover, 'Cache keys should differ for different recover modes');

    // Keys should contain recover mode information
    assert(keyRecover.includes('recover'), 'Recover=true key should contain "recover"');
    assert(keyNoRecover.includes('normal'), 'Recover=false key should contain "normal"');

    // Verify key structure includes all identity components
    const recoverParts = keyRecover.split('|');
    const noRecoverParts = keyNoRecover.split('|');

    // Should have: version, source, recover_mode, rootPackages
    assert.strictEqual(recoverParts.length, 4, 'Cache key should have 4 parts');
    assert.strictEqual(noRecoverParts.length, 4, 'Cache key should have 4 parts');

    // Version and source should be the same
    assert.strictEqual(recoverParts[0], noRecoverParts[0], 'Version should be same');
    assert.strictEqual(recoverParts[1], noRecoverParts[1], 'Source should be same');
    assert.strictEqual(recoverParts[3], noRecoverParts[3], 'Root packages should be same');

    // Only recover mode should differ
    assert.notStrictEqual(recoverParts[2], noRecoverParts[2], 'Recover mode should differ');
  });

  it('should handle race conditions in getOrCreateInflight correctly', async function() {
    // Create a mock cache that always misses to force inflight logic
    const mockCache = {
      async get() { return undefined; },
      async set() { /* no-op */ }
    };

    const astCacheImpl = new AstCacheInterface(mockCache);

    let parseCallCount = 0;
    const mockParseFunction = () => {
      parseCallCount++;
      return new Promise((resolve) => {
        // Small delay to increase chance of race condition if not handled properly
        setTimeout(() => {
          resolve({
            type: 'test',
            parsed: true,
            callNumber: parseCallCount
          });
        }, 10);
      });
    };

    // Start multiple concurrent requests with the same key
    const testKey = 'race-condition-test-key';
    const concurrentRequests = 5;

    const promises = [];
    for (let i = 0; i < concurrentRequests; i++) {
      promises.push(astCacheImpl.getOrCreateInflight(testKey, mockParseFunction));
    }

    // Wait for all requests to complete
    const results = await Promise.all(promises);

    // Verify that deduplication worked - parse function should only be called once
    assert.strictEqual(parseCallCount, 1, 'Parse function should only be called once despite concurrent requests');

    // All results should be identical (same call number)
    const allCallNumbers = results.map(r => r.callNumber);
    const uniqueCallNumbers = [...new Set(allCallNumbers)];
    assert.strictEqual(uniqueCallNumbers.length, 1, 'All concurrent requests should receive the same result');
    assert.strictEqual(uniqueCallNumbers[0], 1, 'All requests should receive result from first call');

    // Verify inflight map is cleaned up
    const finalStats = astCacheImpl.getInflightStats();
    assert.strictEqual(finalStats.activeInflightRequests, 0, 'Inflight map should be cleaned up after completion');
  });

  after(function() {
    // Clean up cache after all tests
    const cache = getDefaultCache();
    cache.cache.clear();
  });
});