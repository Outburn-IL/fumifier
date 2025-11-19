/**
 * Tests for critical cache bug fixes:
 * 1. AST with errors should be returned in recover mode
 * 2. Recover flag should be included in cache identity
 */
import assert from 'assert';
import fumifier from '../dist/index.mjs';
import { createExpressionIdentity } from '../src/utils/cacheUtils.js';

describe('Cache Bug Fixes', function() {

  describe('Recovery Mode Cache Bug Fix', function() {
    it('should return AST with errors in recover mode for FLASH without navigator', async function() {
      // This expression uses FLASH rule syntax that requires structure navigation
      const flashExpr = 'InstanceOf: Basic';

      // In recover mode, this should not throw but return a compiled expression with errors
      const compiled = await fumifier(flashExpr, { recover: true, navigator: undefined });

      // Should have errors
      const errors = compiled.errors();
      assert(Array.isArray(errors), 'errors() should return an array');
      assert(errors.length > 0, 'Should have at least one error');

      // Should find the F1000 error for missing navigator
      const f1000Error = errors.find(err => err.code === 'F1000');
      assert(f1000Error, 'Should have F1000 error for missing navigator');
      assert.strictEqual(f1000Error.type, 'error', 'Error should be marked as type error');
    });
  });

  describe('Cache Identity Structure Bug Fix', function() {
    it('should always include recover flag in cache identity with proper defaults', function() {
      // Test with recover: true
      const identity1 = createExpressionIdentity('Patient.name', true, null);
      assert.strictEqual(identity1.recover, true, 'Should include recover: true in identity');

      // Test with recover: false
      const identity2 = createExpressionIdentity('Patient.name', false, null);
      assert.strictEqual(identity2.recover, false, 'Should include recover: false in identity');

      // Test without recover flag (should default to false)
      const identity3 = createExpressionIdentity('Patient.name', undefined, null);
      assert.strictEqual(identity3.recover, false, 'Should default recover to false when undefined');

      // Identities should be different when recover flag differs
      assert.notDeepStrictEqual(identity1, identity2, 'Identities should differ when recover flag differs');
    });

    it('should create different cache identities for FLASH expressions with different recover flags', function() {
      const flashExpr = 'InstanceOf: Basic';

      // Verify cache identities are different with different recover flags
      const identityRecover = createExpressionIdentity(flashExpr, true, undefined);
      const identityNoRecover = createExpressionIdentity(flashExpr, false, undefined);

      // Both should have the recover flag set correctly
      assert.strictEqual(identityRecover.recover, true, 'Recover identity should have recover: true');
      assert.strictEqual(identityNoRecover.recover, false, 'Non-recover identity should have recover: false');

      // Cache identities should be different
      assert.notDeepStrictEqual(identityRecover, identityNoRecover,
        'Cache identities should be different when recover flag differs');

      // Verify the key difference is the recover flag
      const { recover: recoverFlag1, ...rest1 } = identityRecover;
      const { recover: recoverFlag2, ...rest2 } = identityNoRecover;
      assert.deepStrictEqual(rest1, rest2, 'Everything except recover flag should be the same');
      assert.notStrictEqual(recoverFlag1, recoverFlag2, 'Recover flags should be different');
    });
  });

  describe('Recovery Mode Behavior Validation', function() {
    it('should validate recovery mode works independently of caching', async function() {
      // Use unique expressions to avoid any cross-test caching issues
      const timestamp = Date.now();
      const flashExpr1 = `InstanceOf: Basic /* test-${timestamp}-1 */`;
      const flashExpr2 = `InstanceOf: Basic /* test-${timestamp}-2 */`;

      // Test recovery mode first
      const compiledRecover = await fumifier(flashExpr1, { recover: true, navigator: undefined });
      const errors = compiledRecover.errors();
      assert(errors.length > 0, 'Should have errors in recover mode');

      const f1000Error = errors.find(err => err.code === 'F1000');
      assert(f1000Error, 'Should have F1000 error in recovered AST');

      // Test non-recovery mode with different expression to avoid cache collision
      let threwError = false;
      let actualError = null;
      try {
        await fumifier(flashExpr2, { recover: false, navigator: undefined });
      } catch (err) {
        threwError = true;
        actualError = err;
      }
      assert(threwError, 'Should have thrown an error without recover');
      assert.strictEqual(actualError.code, 'F1000', 'Should throw F1000 for missing navigator');
    });
  });
});