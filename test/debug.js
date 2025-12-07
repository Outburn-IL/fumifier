/* eslint-disable no-console */
/* eslint-disable strict */
import fs from 'fs';
import path from 'path';
import fumifier from '../src/fumifier.js';
import { FhirSnapshotGenerator } from 'fhir-snapshot-generator';
import { FhirStructureNavigator } from '@outburn/structure-navigator';

// var context = ['il.core.fhir.r4#0.17.0', 'fumifier.test.pkg#0.1.0'];
var context = ['il.szmc.fhir.r4#0.3.3'];

void async function () {
  var generator = await FhirSnapshotGenerator.create({
    context,
    cachePath: './test/.test-cache',
    fhirVersion: '4.0.1',
    cacheMode: 'lazy',
    // logger: console
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



// (InstanceOf: ILHDPCondition
// * identifier
//   * system = 'urn:ietf:rfc:3986'
//   * value = 'urn:uuid:550e8400-e29b-41d4-a716-446655440000'
// * category.coding.code = 'problem-list-item'
// * code.text = 'Diabetes mellitus type 2'
// * subject.reference = 'Patient/12345'
// * recordedDate = '2024-06-01T10:00:00Z'
// * recorder.display = 'Dr. Jane Smith'
// * severity.coding.code = '255604002');
// $trace('additional info');

// InstanceOf: il-core-patient
// * identifier[il-id].value = '123'
// * name
//   * given = 'John'
//   * family = 'Doe'
// * gender = 'unknown'
// * birthDate = '1985'
// * address.extension[language].value = 'en'


// * maritalStatus.coding.code = 'UNK'
// * address.city.extension[cityCode].value.coding.code = '4000'

// InstanceOf: TestSliceValidation
// * status = 'unknown'
// * code.coding[OptionalSlice]

// Instance: '123'
// InstanceOf: TestSliceValidation
// $a := 'b'
// * status = 'unknown'; 
// * code.coding[MandatorySlice].display = $a;
// $a := 'b';

// $mapping1('other');

// InstanceOf: bp
// * component[SystolicBP].value = 120
// * component[DiastolicBP].value = 80
// * status = 'final'
// * subject.reference = 'Patient/12345'
// * effectiveDateTime = '2020-01-01T12:00:00Z'



// InstanceOf: bp
// * status = 'final'
// * subject.reference = 'Patient/123'
// * effectiveDateTime = '2023-10-01T00:00:00Z'
// * component[SystolicBP].value.value = '120.00'
// * component[DiastolicBP].value.value = '80.00'

  // * extension[ext-il-hmo].value.coding
  //   * code = '101-nope'
  // * display = 'Custom HMO Name'


// InstanceOf: ILHDPCondition
// * identifier.value = 'COND-001'
// * category.coding
//   * system = "http://terminology.hl7.org/CodeSystem/condition-category"
//   * code = "encounter-diagnosis"
//   * display = "Encounter Diagnosis"
// * code.text = "Hypertension"
// * subject.reference = "Patient/12345"
// * recordedDate = "2023-01-15T08:00:00Z"
// * recorder.display = "Dr. Alice Smith"
// * severity.coding


// InstanceOf: SZMCCondition
// * identifier
//   * system = 'urn:ietf:rfc:3986'
//   * value = 'urn:uuid:550e8400-e29b-41d4-a716-446655440000'
// * id = 'abc123'
// * clinicalStatus
//   * coding.code = 'active'
//   * coding[szmc].code = '2'
// * category.coding.code = 'problem-list-item'
// * code.text = 'Diabetes mellitus type 2'
// * subject.reference = 'Patient/12345'
// * recordedDate = '2024-06-01T10:00:00Z'
// * recorder.display = 'Dr. Jane Smith'
// * severity.coding.code = '255604002'


[(
  InstanceOf: Patient
  * communication
    * language
      * coding
        * system = 'http://acme.org.il/code/lang'
        * code = 'en'
      * coding
        * system = null
),(
  InstanceOf: Patient
  * communication
    * language
      * coding
        * system = 'http://acme.org.il/code/lang'
        * code = 'fr'
      * coding
)]
`
;

  console.log('Starting debug script...');

  var expr;

  const mappings = {
    'mapping1': 'InstanceOf: Patient\n* gender1 = $',
    'mapping2': '$mapping1($)'
  };
  const mappingCache = {
    get: async (key) => {
      console.log(`Retrieving mapping for key: ${key}`);
      return mappings[key];
    },
    getKeys: async () => {
      console.log('Retrieving all mapping keys');
      return Object.keys(mappings);
    }
  };

  try {
    console.log('Compiling expression...');
    expr = await fumifier(expression, {
      navigator,
      mappingCache
    });
    console.log('Expression compiled successfully');
  } catch (e) {
    console.error('Error compiling expression:', e);
    return;
  }

  console.log('Evaluating expression...');
  var res;

  try {
    expr.setLogger(console);
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
