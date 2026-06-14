import assert from 'assert';
import { parse, validate } from '../dist/browser.mjs';
import fumifier from '../dist/index.mjs';
import { FhirStructureNavigator } from '@outburn/structure-navigator';
import { FhirSnapshotGenerator } from 'fhir-snapshot-generator';
import { FhirTerminologyRuntime } from 'fhir-terminology-runtime';
import { FhirPackageExplorer } from 'fhir-package-explorer';

const issueExpression = `InstanceOf: Patient
* address
  * ($uuid('1')).line = $
    * ({'k': $}).extension[http://hl7.org/fhir/StructureDefinition/iso21090-ADXP-streetName]
      * valueString = *`;

const parenthesizedControlExpression = `InstanceOf: Patient
* address
  * ($uuid('1')).line = $
    * ({'k': $}).extension[http://hl7.org/fhir/StructureDefinition/iso21090-ADXP-streetName]
      * valueString = (*)`;

const issue84Expression = `InstanceOf: Patient
* ({'a': 'b'}).identifier
  $value := *;
  * value = $value`;

const issue84ParenthesizedControlExpression = `InstanceOf: Patient
* ({'a': 'b'}).identifier
  $value := (*);
  * value = $value`;

const malformedDoubleStarExpression = `InstanceOf: Patient
* address
  * * valueString = 'x'`;

const malformedEmptyRuleExpression = `InstanceOf: Patient
* address
  *`;

function findInlineWildcards(node, found = []) {
  if (!node || typeof node !== 'object') {
    return found;
  }

  if (node.isInlineExpression && node.type === 'wildcard') {
    found.push(node);
  }

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      value.forEach(item => findInlineWildcards(item, found));
    } else {
      findInlineWildcards(value, found);
    }
  }

  return found;
}

function findFirstBindExpression(node) {
  if (!node || typeof node !== 'object') {
    return undefined;
  }

  if (node.type === 'bind') {
    return node;
  }

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findFirstBindExpression(item);
        if (found) {
          return found;
        }
      }
    } else {
      const found = findFirstBindExpression(value);
      if (found) {
        return found;
      }
    }
  }

  return undefined;
}

describe('FLASH parser hardening regression', function() {
  let navigator;
  let terminologyRuntime;

  before(async function() {
    this.timeout(720000);

    const fpe = await FhirPackageExplorer.create({
      context: ['il.core.fhir.r4#0.17.0', 'fumifier.test.pkg#0.1.0'],
      cachePath: './test/.test-cache',
      fhirVersion: '4.0.1',
      cacheMode: 'lazy'
    });

    const fsg = await FhirSnapshotGenerator.create({ fpe, fhirVersion: '4.0.1', cacheMode: 'lazy' });
    navigator = new FhirStructureNavigator(fsg);
    terminologyRuntime = await FhirTerminologyRuntime.create({ fpe });
  });

  it('should parse bare wildcard inline assignments successfully when recover=false', function() {
    const ast = parse(issueExpression, false);

    assert(ast, 'Expected the unwrapped inline wildcard expression to parse');
    assert.equal(ast.containsFlash, true, 'Expected FLASH syntax to be detected');
    assert.equal(ast.errors, undefined);
  });

  it('should produce an inline wildcard node for the bare RHS *', function() {
    const ast = parse(issueExpression, false);
    const inlineWildcards = findInlineWildcards(ast);

    assert.equal(inlineWildcards.length, 1, 'Expected one inline wildcard node in the parsed AST');
    assert.equal(inlineWildcards[0].line, 5);
    assert.equal(typeof inlineWildcards[0].position, 'number');
    assert(inlineWildcards[0].position >= issueExpression.indexOf('* valueString = *'));
  });

  it('should also parse successfully in recover=true mode without attaching errors', function() {
    const ast = parse(issueExpression, true);

    assert(ast, 'Expected recover=true parsing to return an AST');
    assert.equal(ast.errors, undefined);
  });

  it('should parse bare wildcard variable assignments successfully when recover=false', function() {
    const ast = parse(issue84Expression, false);

    assert(ast, 'Expected the unwrapped wildcard variable assignment to parse');
    assert.equal(ast.containsFlash, true, 'Expected FLASH syntax to be detected');
    assert.equal(ast.errors, undefined);
  });

  it('should also parse bare wildcard variable assignments in recover=true mode without attaching errors', function() {
    const ast = parse(issue84Expression, true);

    assert(ast, 'Expected recover=true parsing to return an AST for the wildcard variable assignment');
    assert.equal(ast.errors, undefined);
  });

  it('should produce a wildcard RHS for the bare := assignment', function() {
    const ast = parse(issue84Expression, false);
    const bindExpression = findFirstBindExpression(ast);

    assert(bindExpression, 'Expected to find a := binding in the parsed AST');
    assert.equal(bindExpression.rhs.type, 'wildcard');
    assert.equal(bindExpression.rhs.line, 3);
    assert.equal(typeof bindExpression.rhs.position, 'number');
    assert(bindExpression.rhs.position >= issue84Expression.indexOf('$value := *;'));
  });

  it('should preserve error locations for malformed FLASH rules in recover=true mode', function() {
    const ast = parse(malformedDoubleStarExpression, true);
    const malformedWildcardStart = malformedDoubleStarExpression.lastIndexOf('*');

    assert(ast, 'Expected recover=true parsing to return an AST');
    assert(Array.isArray(ast.errors), 'Expected malformed recover-mode parse to attach errors');
    assert.equal(ast.errors.length, 1, 'Expected a single malformed rule error');
    assert.equal(ast.errors[0].code, 'F1022');
    assert.equal(ast.errors[0].line, 3);
    assert.equal(ast.errors[0].position, malformedWildcardStart + 1);
    assert.equal(ast.errors[0].start, malformedWildcardStart);
  });

  it('should preserve F1024 error locations for truly empty FLASH rules in recover=true mode', function() {
    const ast = parse(malformedEmptyRuleExpression, true);
    const malformedRuleStart = malformedEmptyRuleExpression.lastIndexOf('*');

    assert(ast, 'Expected recover=true parsing to return an AST');
    assert(Array.isArray(ast.errors), 'Expected malformed recover-mode parse to attach errors');
    assert.equal(ast.errors.length, 1, 'Expected a single malformed rule error');
    assert.equal(ast.errors[0].code, 'F1024');
    assert.equal(ast.errors[0].line, 3);
    assert.equal(ast.errors[0].position, malformedRuleStart + 1);
    assert.equal(ast.errors[0].start, malformedRuleStart);
    assert.equal(ast.errors[0].token, '(end)');
  });

  it('should validate the unwrapped expression as valid', function() {
    const result = validate(issueExpression);

    assert.equal(result.isValid, true);
    assert(Array.isArray(result.errors), 'Expected validate() to return an errors array');
    assert.equal(result.errors.length, 0);
  });

  it('should validate the wildcard variable assignment expression as valid', function() {
    const result = validate(issue84Expression);

    assert.equal(result.isValid, true);
    assert(Array.isArray(result.errors), 'Expected validate() to return an errors array');
    assert.equal(result.errors.length, 0);
  });

  it('should still reject malformed double-star FLASH rules with F1022', function() {
    assert.throws(
      () => parse(malformedDoubleStarExpression, false),
      (error) => {
        assert.equal(error.code, 'F1022');
        assert.equal(error.line, 3);
        return true;
      }
    );
  });

  it('should still reject truly empty FLASH rules with F1024', function() {
    assert.throws(
      () => parse(malformedEmptyRuleExpression, false),
      (error) => {
        assert.equal(error.code, 'F1024');
        assert.equal(error.line, 3);
        return true;
      }
    );
  });

  it('should still parse the parenthesized wildcard workaround', function() {
    const ast = parse(parenthesizedControlExpression, false);

    assert(ast, 'Expected the parenthesized control expression to parse');
    assert.equal(ast.containsFlash, true, 'Expected FLASH syntax to be detected');
  });

  it('should still parse the parenthesized wildcard variable assignment workaround', function() {
    const ast = parse(issue84ParenthesizedControlExpression, false);

    assert(ast, 'Expected the parenthesized wildcard variable assignment control to parse');
    assert.equal(ast.containsFlash, true, 'Expected FLASH syntax to be detected');
  });

  it('should evaluate the unwrapped and parenthesized expressions to the same Patient output', async function() {
    const unwrapped = await fumifier(issueExpression, { navigator, terminologyRuntime });
    const wrapped = await fumifier(parenthesizedControlExpression, { navigator, terminologyRuntime });

    const unwrappedResult = await unwrapped.evaluate({});
    const wrappedResult = await wrapped.evaluate({});

    assert.deepEqual(unwrappedResult, wrappedResult);
    assert.equal(unwrappedResult.resourceType, 'Patient');
    assert.equal(unwrappedResult.address[0].line[0], '356a192b-7913-504c-9457-4d18c28d46e6');
    assert.equal(unwrappedResult.address[0]._line[0].extension[0].url, 'http://hl7.org/fhir/StructureDefinition/iso21090-ADXP-streetName');
    assert.equal(
      unwrappedResult.address[0]._line[0].extension[0].valueString,
      unwrappedResult.address[0].line[0]
    );
  });

  it('should evaluate the unwrapped and parenthesized wildcard variable assignments to the same Patient output', async function() {
    const unwrapped = await fumifier(issue84Expression, { navigator, terminologyRuntime });
    const wrapped = await fumifier(issue84ParenthesizedControlExpression, { navigator, terminologyRuntime });

    const unwrappedResult = await unwrapped.evaluate({});
    const wrappedResult = await wrapped.evaluate({});

    assert.deepEqual(unwrappedResult, wrappedResult);
    assert.equal(unwrappedResult.resourceType, 'Patient');
    assert(Array.isArray(unwrappedResult.identifier), 'Expected an identifier array in the evaluation result');
    assert.equal(unwrappedResult.identifier.length, 1);
    assert.equal(unwrappedResult.identifier[0].value, 'b');
  });
});