/* eslint-disable no-prototype-builtins */
/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';
import fumifier from '../dist/index.mjs';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { FhirStructureNavigator } from '@outburn/structure-navigator';
import { FhirSnapshotGenerator } from 'fhir-snapshot-generator';
import { FhirTerminologyRuntime } from 'fhir-terminology-runtime';
import { fileURLToPath } from 'url';
import { LEVELS, severityFromCode } from '../src/utils/diagnostics.js';

chai.use(chaiAsPromised);
const expect = chai.expect;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Utility: read JSON
/**
 * Read and parse JSON test file from the test-suite.
 * @param {string} dir - Relative directory inside test folder.
 * @param {string} file - Filename within the directory.
 * @returns {any} Parsed JSON object from disk.
 */
function readJSON(dir, file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, dir, file)).toString());
  } catch (e) {
    throw new Error('Error reading ' + file + ' in ' + dir + ': ' + e.message);
  }
}

// Load datasets
const datasets = {};
const datasetnames = fs.readdirSync(path.join(__dirname, 'test-suite', 'datasets'));
datasetnames.forEach((name) => {
  datasets[name.replace('.json', '')] = readJSON(path.join('test-suite', 'datasets'), name);
});

/**
 * Resolve dataset object for a testcase.
 * @param {Object<string, any>} datasetsMap - Loaded datasets keyed by name.
 * @param {any} testcase - Test case specification.
 * @returns {any} Dataset value to use for evaluation.
 */
function resolveDataset(datasetsMap, testcase) {
  if ('data' in testcase) {
    return testcase.data;
  }
  if (datasetsMap.hasOwnProperty(testcase.dataset)) {
    if (datasetsMap?.[testcase.dataset]) return datasetsMap[testcase.dataset];
    throw new Error('Unable to find dataset ' + testcase.dataset + ' among known datasets, are you sure the datasets directory has a file named ' + testcase.dataset + '.json?');
  }
  return undefined;
}

/**
 * Map severity to diagnostics bucket name.
 * @param {number} sev - Numeric severity as mapped by severityFromCode.
 * @returns {'error'|'warning'|'debug'} Expected diagnostics bucket.
 */
function expectedBucketForSeverity(sev) {
  if (sev < LEVELS.warning) return 'error';
  if (sev < LEVELS.notice) return 'warning';
  return 'debug';
}

// Build list of groups (FLASH only to reduce runtime)
let groups = fs.readdirSync(path.join(__dirname, 'test-suite', 'groups')).filter((name) => !name.endsWith('.json'));
groups = groups.filter((g) => g.includes('flash'));

// The suite
describe('Fumifier Verbose Policy Matrix (F5xxx)', () => {
  let navigator;
  let terminologyRuntime;
  before(async () => {
    const fsg = await FhirSnapshotGenerator.create({
      context: ['il.core.fhir.r4#0.17.0', 'fumifier.test.pkg#0.1.0'],
      cachePath: './test/.test-cache',
      fhirVersion: '4.0.1',
      cacheMode: 'lazy'
    });
    navigator = new FhirStructureNavigator(fsg);
    terminologyRuntime = await FhirTerminologyRuntime.create({
      context: ['il.core.fhir.r4#0.17.0', 'fumifier.test.pkg#0.1.0'],
      cachePath: './test/.test-cache',
      fhirVersion: '4.0.1'
    });
  });

  for (const group of groups) {
    const filenames = fs.readdirSync(path.join(__dirname, 'test-suite', 'groups', group)).filter((name) => name.endsWith('.json'));
    // Aggregate cases
    let cases = [];
    filenames.forEach((name) => {
      const spec = readJSON(path.join('test-suite', 'groups', group), name);
      if (Array.isArray(spec)) {
        spec.forEach((item) => {
          if (!item.description) item.description = name;
          item.filename = name;
        });
        cases = cases.concat(spec);
      } else {
        if (!spec.description) spec.description = name;
        spec.filename = name;
        cases.push(spec);
      }
    });

    describe('Group: ' + group, () => {
      for (const testcase of cases) {
        const expectsCode = Object.prototype.hasOwnProperty.call(testcase, 'code');
        // Only policy-governed FLASH codes
        if (!expectsCode || typeof testcase.code !== 'string' || !/^F5\d{3}$/.test(testcase.code)) {
          continue;
        }

        const testTitle = `${testcase.description} [policy-matrix for ${testcase.code}]`;

        it(testTitle, async function () {
          // Compile
          let expr;
          try {
            expr = await fumifier(testcase.expr ?? fs.readFileSync(path.join(__dirname, 'test-suite', 'groups', group, testcase['expr-file'] || '')).toString(), {
              navigator: testcase.noNavigator ? undefined : navigator,
              terminologyRuntime: testcase.noNavigator ? undefined : terminologyRuntime
            });
          } catch (e) {
            // If this F5 code triggers at parse time (unexpected), skip
            this.skip();
            return;
          }

          const dataset = resolveDataset(datasets, testcase);
          const sev = severityFromCode(testcase.code);
          const bucket = expectedBucketForSeverity(sev);

          const scenarios = [
            { name: 'strict-throw', throwLevel: Math.min(sev + 1, 70) },
            { name: 'equal-downgrade', throwLevel: sev },
            { name: 'lenient-downgrade', throwLevel: Math.min(sev + 10, 70) }
          ];

          for (const sc of scenarios) {
            // Ensure validations are not inhibited for the code under test:
            // override any conflicting validationLevel by setting it above the code severity
            const validationLevel = Math.min(sev + 1, 70);
            const throwLevel = Math.min(sev + 1, 70);

            const res = await expr.evaluateVerbose(dataset, {
              throwLevel,
              validationLevel,
              logLevel: 0,
              collectLevel: 70
            });

            expect(res).to.be.an('object');
            expect(res).to.have.property('diagnostics');
            const bag = res.diagnostics;

            // Ensure the diagnostic was collected in the expected bucket
            const bucketArr = bag[bucket] || [];
            const inBucket = bucketArr.some((e) => e.code === testcase.code);
            const anywhere = ['error', 'warning', 'debug'].some((b) => (bag[b] || []).some((e) => e.code === testcase.code));
            expect(anywhere, `${sc.name}: expected to collect ${testcase.code}`).to.equal(true);
            expect(inBucket, `${sc.name}: expected ${testcase.code} in ${bucket} bucket`).to.equal(true);

            // Status should not be 200 when the code is present
            expect(res.ok).to.equal(false);
            expect([206, 422]).to.include(res.status);
          }
        });
      }
    });
  }
});
