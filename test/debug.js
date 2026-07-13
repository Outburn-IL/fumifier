/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';
import fumifier from '../src/fumifier.js';
import { FhirSnapshotGenerator } from 'fhir-snapshot-generator';
import { FhirStructureNavigator } from '@outburn/structure-navigator';
import { FhirPackageExplorer } from 'fhir-package-explorer';
import { FhirTerminologyRuntime } from 'fhir-terminology-runtime';

// var context = ['il.core.fhir.r4#0.21.0', 'fumifier.test.pkg#0.1.0'];
var context = ['il.tasmc.fhir.r4#0.9.5'];

void async function () {
  // Create shared FhirPackageExplorer instance
  var fpe = await FhirPackageExplorer.create({
    context,
    cachePath: './test/.test-cache',
    fhirVersion: '4.0.1',
    cacheMode: 'lazy',
    // logger: console
  });

  // Create FhirSnapshotGenerator with shared FPE
  var generator = await FhirSnapshotGenerator.create({ fpe, fhirVersion: '4.0.1', cacheMode: 'lazy' });
  var navigator = new FhirStructureNavigator(generator);

  var ftr = await FhirTerminologyRuntime.create({ fpe });

  var expression = `// line 1
  // line 2
  // line 3
  // line 4
          $search($, params)
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
      mappingCache,
      terminologyRuntime: ftr
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
    res = await expr.evaluateVerbose(
      {
        "encounter_adm_id": "adm-111",
        "followUp_medical_record": "fol-111",
        "release_medical_record": "rel-111",
        "record_type": "6",
        "release_date": "2026-01-29",
        "unit": "10038",
        "subject": "6105942",
        "admission_entry_date": "2026-01-25",
        "unit_satellite": "102",
        "encounter_id": "13705968"
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
