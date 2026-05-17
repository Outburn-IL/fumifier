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

const malformedDoubleStarExpression = `InstanceOf: Patient
* address
  * * valueString = 'x'`;

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

  it('should validate the unwrapped expression as valid', function() {
    const result = validate(issueExpression);

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

  it('should still parse the parenthesized wildcard workaround', function() {
    const ast = parse(parenthesizedControlExpression, false);

    assert(ast, 'Expected the parenthesized control expression to parse');
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
});