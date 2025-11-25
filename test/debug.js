/* eslint-disable no-console */
/* eslint-disable strict */
import fs from 'fs';
import path from 'path';
import fumifier from '../src/fumifier.js';
import { FhirSnapshotGenerator } from 'fhir-snapshot-generator';
import { FhirStructureNavigator } from '@outburn/structure-navigator';

var context = ['il.core.fhir.r4#0.17.0', 'fumifier.test.pkg#0.1.0'];

void async function () {
  var generator = await FhirSnapshotGenerator.create({
    context,
    cachePath: './test/.test-cache',
    fhirVersion: '4.0.1',
    cacheMode: 'lazy'
  });

  var navigator = new FhirStructureNavigator(generator);

  var expression = `
// InstanceOf: dual-assignment-test-profile
// * name
//   * given = 'John'
//   * family = 'Doe'
// // should create a single entry in identifier array
// // should include system, value, and use
// // since the TestSlice is max=1
// * identifier[TestSlice].value = '12345'
// * identifier[TestSlice].use = 'official'


// InstanceOf: il-core-patient
// * gender = 'male'
// * birthDate = '1980-01-01'
// * identifier[il-id].value = '123456789'
// * name
//   * family = 'Doe'
//   * given = ['John', 'A.']
// * extension[hmo].value.coding
//   * code = 'UNK'
//   * system = 'http://terminology.hl7.org/CodeSystem/v3-NullFlavor'


// InstanceOf: TestSliceValidation
// * status = 'unknown'
// * code.coding[OptionalSlice]


Instance: ''
InstanceOf: CodeableConcept
`
;

  console.log('Starting debug script...');

  var expr;
  try {
    console.log('Compiling expression...');
    expr = await fumifier(expression, {
      navigator
    });
    console.log('Expression compiled successfully');
  } catch (e) {
    console.error('Error compiling expression:', e);
    return;
  }

  console.log('Evaluating expression...');
  var res;

  try {
    res = await expr.evaluate(
      {
        resourceType: "Patient"
      },
      {
        // logLevel: 50,
        // validationLevel: 30,
        // throwLevel: 13,
        // collectLevel: 70
      });
    console.log('Expression evaluated successfully');
  } catch (e) {
    console.error('Error evaluating expression:');
    console.error('Code:', e.code);
    console.error('Message:', e.message);
    console.error('Details:', e);
  }

  // Write AST to file if available
  try {
    fs.writeFileSync(path.join('test', 'ast.json'), JSON.stringify(await expr.ast(), null, 2));
    console.log('AST written to test/ast.json');
  } catch (e) {
    console.warn('Could not write AST:', e.message);
  }

  // Write results to file for analysis
  fs.writeFileSync('debug-result.json', res ? JSON.stringify(res, null, 2) : '');
  console.log('Results written to debug-result.json');


  console.log('Result', JSON.stringify(res, null, 2) ?? 'undefined');

}();
