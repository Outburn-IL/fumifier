/* eslint-disable require-jsdoc */
import preProcessAst from '../src/utils/preProcessAst.js';
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readCaseJSON(caseId) {
  const caseDir = path.join(__dirname, 'pre-process-ast');
  const file = `case${caseId}.json`;
  try {
    return JSON.parse(fs.readFileSync(path.join(caseDir, file), { encoding: 'utf-8' }));
  } catch(e) {
    throw new Error("Error reading "+file+" in "+caseDir+": "+e.message);
  }
}

describe('Correct transformation of AST', function() {
  describe('Minimal FLASH Blocks', function() {
    it('should turn minimal flashblock to block', function() {
      const { before, after } = readCaseJSON('001');
      assert.ok(before);
      assert.ok(after);
      assert.deepEqual(preProcessAst(before), after);
    });

    it('should turn flashblock with instance expression to block with rule', function() {
      const { before, after } = readCaseJSON('002');
      assert.ok(before);
      assert.ok(after);
      assert.deepEqual(preProcessAst(before), after);
    });

    it('should turn flashblock with instance expression and rule to block with two rules', function() {
      const { before, after } = readCaseJSON('003');
      assert.ok(before);
      assert.ok(after);
      assert.deepEqual(preProcessAst(before), after);
    });
  });

  describe('FLASH Rules', function() {
    it('should turn a rule + subrule with value into a block with one inline expression rule', function() {
      const { before, after } = readCaseJSON('101');
      assert.ok(before);
      assert.ok(after);
      assert.deepEqual(preProcessAst(before), after);
    });

    it('should turn a two-step chained rule with value into a block with nested inline expression rule', function() {
      const { before, after } = readCaseJSON('102');
      assert.ok(before);
      assert.ok(after);
      assert.deepEqual(preProcessAst(before), after);
    });

    it('should turn a 3-level indented rule with inner value into a block with correct subrules', function() {
      const { before, after } = readCaseJSON('103');
      assert.ok(before);
      assert.ok(after);
      assert.deepEqual(preProcessAst(before), after);
    });

    it('should turn a 3-step chained rule with value into a block with single-step subrules', function() {
      const { before, after } = readCaseJSON('104');
      assert.ok(before);
      assert.ok(after);
      assert.deepEqual(preProcessAst(before), after);
    });

    it('should turn a 3-step chained rule with complex inline expression into a block with single-step subrules', function() {
      const { before, after } = readCaseJSON('105');
      assert.ok(before);
      assert.ok(after);
      assert.deepEqual(preProcessAst(before), after);
    });
  });
});