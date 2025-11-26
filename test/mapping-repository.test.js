/* eslint-disable require-jsdoc */
import fumifier from '../src/fumifier.js';
import assert from 'assert';

describe('Mapping Repository Feature', function() {

  before(async function() {
    this.timeout(180000); // Set timeout to 180 seconds (3 minutes)
  });

  describe('Mapping Cache Interface', function() {
    it('should define the correct interface', function() {
      // Basic smoke test - we'll test the interface through usage
      assert(typeof fumifier === 'function', 'fumifier should be a function');
    });
  });

  describe('Basic Mapping Functionality', function() {
    let simpleMappingCache;

    beforeEach(function() {
      // Create a simple in-memory mapping cache for testing
      const mappings = {
        'greeting': '"Hello, " & $',
        'doubleValue': '$ * 2',
        'upperCase': '$uppercase($)',
        'complexMapping': '{ "original": $, "doubled": $ & $, "greeting": "Hello, " & $ }',
        'withArithmetic': '($a + $b) * $c'
      };

      simpleMappingCache = {
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

    it('should bind mapping functions during evaluation', async function() {
      const expr = '$greeting("World")';
      const compiled = await fumifier(expr, { mappingCache: simpleMappingCache });

      const result = await compiled.evaluate({});
      assert.strictEqual(result, 'Hello, World');
    });

    it('should use context value when no input provided', async function() {
      const expr = '$greeting()';
      const compiled = await fumifier(expr, { mappingCache: simpleMappingCache });

      const result = await compiled.evaluate('World');
      assert.strictEqual(result, 'Hello, World');
    });

    it('should handle numeric operations', async function() {
      const expr = '$doubleValue(5)';
      const compiled = await fumifier(expr, { mappingCache: simpleMappingCache });

      const result = await compiled.evaluate({});
      assert.strictEqual(result, 10);
    });

    it('should handle string functions', async function() {
      const expr = '$upperCase("hello world")';
      const compiled = await fumifier(expr, { mappingCache: simpleMappingCache });

      const result = await compiled.evaluate({});
      assert.strictEqual(result, 'HELLO WORLD');
    });

    it('should handle complex object creation', async function() {
      const expr = '$complexMapping("test")';
      const compiled = await fumifier(expr, { mappingCache: simpleMappingCache });

      const result = await compiled.evaluate({});
      assert.deepStrictEqual(result, {
        original: 'test',
        doubled: 'testtest',
        greeting: 'Hello, test'
      });
    });
  });

  describe('Mapping with Bindings', function() {
    let mappingCache;

    beforeEach(function() {
      const mappings = {
        'addValues': '$a + $b',
        'multiplyAndAdd': '($a * $b) + $c',
        'useInput': '$ + $offset',
        'complexWithBindings': '{ "input": $, "sum": $a + $b, "product": $a * $b }'
      };

      mappingCache = {
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

    it('should support bindings in mapping calls', async function() {
      const expr = '$addValues(10, {"a": 5, "b": 3})';
      const compiled = await fumifier(expr, { mappingCache });

      const result = await compiled.evaluate({});
      assert.strictEqual(result, 8); // 5 + 3, input 10 is not used in this mapping
    });

    it('should use input and bindings together', async function() {
      const expr = '$useInput(100, {"offset": 25})';
      const compiled = await fumifier(expr, { mappingCache });

      const result = await compiled.evaluate({});
      assert.strictEqual(result, 125); // 100 + 25
    });

    it('should handle complex bindings', async function() {
      const expr = '$multiplyAndAdd($, {"a": 3, "b": 4, "c": 10})';
      const compiled = await fumifier(expr, { mappingCache });

      const result = await compiled.evaluate(5);
      assert.strictEqual(result, 22); // (3 * 4) + 10 = 22, input 5 is not used
    });

    it('should create complex objects with bindings', async function() {
      const expr = '$complexWithBindings("test", {"a": 10, "b": 20})';
      const compiled = await fumifier(expr, { mappingCache });

      const result = await compiled.evaluate({});
      assert.deepStrictEqual(result, {
        input: 'test',
        sum: 30,
        product: 200
      });
    });

    it('should require explicit $ for context when bindings provided', async function() {
      const expr = '$useInput($, {"offset": 50})';
      const compiled = await fumifier(expr, { mappingCache });

      const result = await compiled.evaluate(75);
      assert.strictEqual(result, 125); // 75 + 50
    });
  });

  describe('Binding Override Behavior', function() {
    let mappingCache;

    beforeEach(function() {
      const mappings = {
        'testOverride': '$uppercase($)', // Uses the native/overridden uppercase function
        'recursiveMapping': '$greeting("from recursive")'
      };

      mappingCache = {
        async getKeys() {
          return Object.keys(mappings);
        },
        async get(key) {
          if (!Object.prototype.hasOwnProperty.call(mappings, key)) {
            throw new Error(`Mapping '${key}' not found`);
          }
          return mappings[key];
        }
      };
    });

    it('should allow bindings to override native functions', async function() {
      // Override the $upper function with our own implementation
      const expr = '$testOverride("hello", {"uppercase": function(){"OVERRIDDEN"}})';
      const compiled = await fumifier(expr, { mappingCache });

      const result = await compiled.evaluate({});
      assert.strictEqual(result, 'OVERRIDDEN'); // Our override is used instead of $upper
    });

    it('should allow bindings to override other mappings', async function() {
      // We need another mapping in the cache for this test
      const mappings = {
        'testOverride': '$greeting($)',
        'greeting': '"Hello, " & $'
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

      const expr = '$testOverride("world", {"greeting": function() { "OVERRIDDEN" }})';
      const compiled = await fumifier(expr, { mappingCache: testCache });

      const result = await compiled.evaluate({});
      assert.strictEqual(result, 'OVERRIDDEN'); // Our binding overrides the mapping
    });

    it('should allow local variable assignment to override native functions', async function() {
      // Test local variable assignment override instead of binding parameter
      const expr = '$uppercase := function(){"OVERRIDDEN"}; $testOverride("hello")';
      const compiled = await fumifier(expr, { mappingCache });

      const result = await compiled.evaluate({});
      assert.strictEqual(result, 'OVERRIDDEN'); // Our local override is used instead of $uppercase
    });

    it('should allow local variable assignment to override other mappings', async function() {
      // We need another mapping in the cache for this test
      const mappings = {
        'testOverride': '$greeting($)',
        'greeting': '"Hello, " & $'
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

      const expr = '$greeting := function() { "OVERRIDDEN" }; $testOverride("world")';
      const compiled = await fumifier(expr, { mappingCache: testCache });

      const result = await compiled.evaluate({});
      assert.strictEqual(result, 'OVERRIDDEN'); // Our local variable overrides the mapping
    });
  });

  describe('Error Handling', function() {
    let mappingCache;

    beforeEach(function() {
      const mappings = {
        'validMapping': '"Valid result"',
        'syntaxError': '$ + + $', // Invalid syntax
        'runtimeError': '$undefinedFunction()'
      };

      mappingCache = {
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

    it('should handle missing mappings gracefully', async function() {
      const expr = '$nonExistentMapping()';
      const compiled = await fumifier(expr, { mappingCache });

      try {
        await compiled.evaluate({});
        assert.fail('Should have thrown an error');
      } catch (err) {
        // Should get standard JSONata "attempted to invoke a non-function" error
        assert.strictEqual(err.code, 'T1006');
      }
    });

    it('should handle syntax errors in mappings', async function() {
      const expr = '$syntaxError()';
      const compiled = await fumifier(expr, { mappingCache });

      try {
        await compiled.evaluate({});
        assert.fail('Should have thrown an error');
      } catch (err) {
        assert.strictEqual(err.code, 'F3002');
        assert(err.value.includes('syntaxError'));
      }
    });

    it('should handle runtime errors in mappings', async function() {
      const expr = '$runtimeError()';
      const compiled = await fumifier(expr, { mappingCache });

      try {
        await compiled.evaluate({});
        assert.fail('Should have thrown an error');
      } catch (err) {
        assert.strictEqual(err.code, 'F3001');
        assert(err.value.includes('runtimeError'));
      }
    });

    it('should work without mapping cache', async function() {
      const expr = '"No mappings here"';
      const compiled = await fumifier(expr); // No mappingCache option

      const result = await compiled.evaluate({});
      assert.strictEqual(result, 'No mappings here');
    });
  });

  describe('Mapping Cache Errors', function() {
    it('should handle mapping cache getKeys errors gracefully', async function() {
      const faultyCache = {
        async getKeys() {
          throw new Error('Cache connection failed');
        },
        async get(key) {
          return key ? '"test"': undefined;
        }
      };

      const expr = '"Should still work"';
      const compiled = await fumifier(expr, { mappingCache: faultyCache });

      // Should not throw during compilation, just log warning
      const result = await compiled.evaluate({});
      assert.strictEqual(result, 'Should still work');
    });

    it('should handle mapping cache get errors', async function() {
      const faultyCache = {
        async getKeys() {
          return ['testMapping'];
        },
        async get(key) {
          throw new Error('Failed to retrieve mapping', { cause: key });
        }
      };

      const expr = '$testMapping()';
      const compiled = await fumifier(expr, { mappingCache: faultyCache });

      try {
        await compiled.evaluate({});
        assert.fail('Should have thrown an error');
      } catch (err) {
        assert.strictEqual(err.code, 'F3006');
      }
    });
  });

  describe('Nested Mapping Calls', function() {
    let mappingCache;

    beforeEach(function() {
      const mappings = {
        'formatName': '"Mr. " & $upperCase($)',
        'upperCase': '$uppercase($)',
        'createGreeting': '$formatName($) & ", welcome!"',
        'processUser': '{ "name": $formatName($.name), "message": $createGreeting($.name) }'
      };

      mappingCache = {
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

    it('should support nested mapping calls', async function() {
      const expr = '$createGreeting("smith")';
      const compiled = await fumifier(expr, { mappingCache });

      const result = await compiled.evaluate({});
      assert.strictEqual(result, 'Mr. SMITH, welcome!');
    });

    it('should support complex nested processing', async function() {
      const expr = '$processUser({"name": "john"})';
      const compiled = await fumifier(expr, { mappingCache });

      const result = await compiled.evaluate({});
      assert.deepStrictEqual(result, {
        name: 'Mr. JOHN',
        message: 'Mr. JOHN, welcome!'
      });
    });
  });

  describe('Integration with evaluateVerbose', function() {
    let mappingCache;

    beforeEach(function() {
      const mappings = {
        'simpleMapping': '"Verbose result"',
        'errorMapping': '$nonExistentFunction()'
      };

      mappingCache = {
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

    it('should work with evaluateVerbose for successful mappings', async function() {
      const expr = '$simpleMapping()';
      const compiled = await fumifier(expr, { mappingCache });

      const report = await compiled.evaluateVerbose({});
      assert.strictEqual(report.ok, true);
      assert.strictEqual(report.status, 200);
      assert.strictEqual(report.result, 'Verbose result');
    });

    it('should handle mapping errors in evaluateVerbose', async function() {
      const expr = '$errorMapping()';
      const compiled = await fumifier(expr, { mappingCache });

      const report = await compiled.evaluateVerbose({});
      assert.strictEqual(report.ok, false);
      assert.notStrictEqual(report.status, 200);
      assert(report.diagnostics.error.length > 0);
    });
  });
});