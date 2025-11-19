/**
 * Basic browser mode test
 * Tests that browser mode can parse and evaluate vanilla JSONata expressions
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';
import browserFumifier from '../dist/browser.mjs';

describe('Browser Mode', function () {
  this.timeout(10000);

  it('should parse and evaluate basic JSONata expressions', async function () {
    const expr = await browserFumifier('1 + 2');
    const result = await expr.evaluate({});
    expect(result).to.equal(3);
  });

  it('should handle object navigation', async function () {
    const expr = await browserFumifier('name');
    const result = await expr.evaluate({ name: 'John', age: 30 });
    expect(result).to.equal('John');
  });

  it('should handle array operations', async function () {
    const expr = await browserFumifier('numbers[$ > 5]');
    const input = { numbers: [1, 6, 3, 8, 2, 9] };
    const result = await expr.evaluate(input);
    expect(result).to.deep.equal([6, 8, 9]);
  });

  it('should handle string operations', async function () {
    const expr = await browserFumifier('firstName & " " & lastName');
    const input = { firstName: 'John', lastName: 'Doe' };
    const result = await expr.evaluate(input);
    expect(result).to.equal('John Doe');
  });

  it('should support recovery mode for syntax errors', async function () {
    const expr = await browserFumifier('1 +', { recover: true });
    const errors = expr.errors();
    expect(errors.length).to.be.greaterThan(0);
  });

  it('should provide AST for syntax highlighting', async function () {
    const expr = await browserFumifier('name.first');
    const ast = expr.ast();
    expect(ast).to.have.property('type');
    expect(ast.browserMode).to.be.true;
  });

  it('should handle FLASH syntax in recovery mode (parsing only)', async function () {
    const flashExpression = `
InstanceOf: Patient
* name.given = "John"
* name.family = "Doe"`;

    const expr = await browserFumifier(flashExpression, { recover: true });
    const ast = expr.ast();
    const errors = expr.errors();

    // Should have parsed the AST structure for syntax highlighting
    expect(ast).to.have.property('type');
    // Should have errors indicating FLASH processing isn't available
    expect(errors.length).to.be.greaterThan(0);
  });

  it('should support variable bindings', async function () {
    const expr = await browserFumifier('$var1 + $var2');
    const result = await expr.evaluate({}, { var1: 10, var2: 5 });
    expect(result).to.equal(15);
  });

  it('should support function registration', async function () {
    const expr = await browserFumifier('$double(5)');
    expr.registerFunction('double', function(x) {
      return x * 2;
    });
    const result = await expr.evaluate({});
    expect(result).to.equal(10);
  });

  it('should provide verbose evaluation reports', async function () {
    const expr = await browserFumifier('nonExistent.property');
    const report = await expr.evaluateVerbose({});

    expect(report).to.have.property('ok');
    expect(report).to.have.property('status');
    expect(report).to.have.property('result');
    expect(report).to.have.property('diagnostics');
    expect(report).to.have.property('executionId');
  });
});