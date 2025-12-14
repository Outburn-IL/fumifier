/* eslint-disable no-prototype-builtins */
/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

This file includes and modifies code from JSONata (https://github.com/jsonata-js/jsonata).
JSONata portions: © IBM Corp. 2016–2018, licensed under the MIT License.
See NOTICE and LICENSES/MIT-JSONata.txt for details.

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

/**
 * © Copyright IBM Corp. 2016, 2018 All Rights Reserved
 *   Project name: JSONata
 *   This project is licensed under the MIT License, see LICENSE
 */

import fs from "fs";
import path from "path";
import fumifier from '../dist/index.mjs';
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { FhirStructureNavigator } from "@outburn/structure-navigator";
import { FhirSnapshotGenerator } from "fhir-snapshot-generator";
import { FhirTerminologyRuntime } from "fhir-terminology-runtime";
import { FhirPackageExplorer } from "fhir-package-explorer";
import skippedGroups from "./skipped-groups.js";
import { fileURLToPath } from 'url';
import util from 'util';
import { MockFhirClient } from './mock-fhir-client.js';

chai.use(chaiAsPromised);
var expect = chai.expect;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let groups = fs.readdirSync(path.join(__dirname, "test-suite", "groups")).filter((name) => !name.endsWith(".json"));

// Filter groups for flash-only mode if --flash-only argument is passed
if (process.argv.includes('--flash-only')) {
  groups = groups.filter(group => group.includes('flash'));
  // eslint-disable-next-line no-console
  console.log('🔥 Running in FLASH-ONLY mode - filtered groups:', groups);
}

/**
 * Simple function to read in JSON
 * @param {string} dir - Directory containing JSON file
 * @param {string} file - Name of JSON file (relative to directory)
 * @returns {Object} Parsed JSON object
 */
function readJSON(dir, file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, dir, file)).toString());
  } catch(e) {
    throw new Error("Error reading "+file+" in "+dir+": "+e.message);
  }
}

let datasets = {};
let datasetnames = fs.readdirSync(path.join(__dirname, "test-suite", "datasets"));
var skippedTests = [];
var parsingErrorsCaught = [];

datasetnames.forEach((name) => {
  datasets[name.replace(".json", "")] = readJSON(path.join("test-suite", "datasets"), name);
});

// This is the start of the set of tests associated with the test cases
// found in the test-suite directory.
describe("Fumifier Test Suite", () => {
  var navigator;
  var terminologyRuntime;
  var fhirClient;
  before(async function() {
    this.timeout(180000); // Set timeout to 180 seconds (3 minutes)

    // Create shared FhirPackageExplorer instance
    const fpe = await FhirPackageExplorer.create({
      context: ['il.core.fhir.r4#0.17.0', 'fumifier.test.pkg#0.1.0'],
      cachePath: './test/.test-cache',
      fhirVersion: '4.0.1',
      cacheMode: 'lazy'
    });

    // Create FhirSnapshotGenerator with shared FPE
    const fsg = await FhirSnapshotGenerator.create({ fpe, fhirVersion: '4.0.1', cacheMode: 'lazy' });
    navigator = new FhirStructureNavigator(fsg);

    // Create FhirTerminologyRuntime with shared FPE
    terminologyRuntime = await FhirTerminologyRuntime.create({ fpe });

    // Create a mock FHIR client for testing
    fhirClient = new MockFhirClient({
      baseUrl: 'http://mock-server/fhir',
      fhirVersion: 'R4'
    });
  });

  // Iterate over all groups of tests
  groups.forEach(group => {
    let filenames = fs.readdirSync(path.join(__dirname, "test-suite", "groups", group)).filter((name) => name.endsWith(".json"));
    // Read JSON file containing all cases for this group
    let cases = [];
    filenames.forEach(name => {
      const spec = readJSON(path.join("test-suite", "groups", group), name);
      if(Array.isArray(spec)) {
        spec.forEach(item => {
          if(!item.description) {
            item.description = name;
          }
          item.filename = name;
        });
        cases = cases.concat(spec);
      } else {
        if(!spec.description) {
          spec.description = name;
        }
        spec.filename = name;
        cases.push(spec);
      }
    });
    describe("Group: " + group, () => {
      // Iterate over all cases
      for (let i = 0; i < cases.length; i++) {
        // Extract the current test case of interest
        let testcase = cases[i];

        // if the testcase references an external fumifier file, read it in
        if(testcase['expr-file']) {
          testcase.expr = fs.readFileSync(path.join(__dirname, "test-suite", "groups", group, testcase['expr-file'])).toString();
        }
        // create a display friendly version of the expression (add 5 space indentaion for second and subsequent lines, limit line size to 80)
        const MAX_LINES = 4;
        const MAX_LINE_LENGTH = 100;
        const displayTestExpr = testcase.expr ?
          testcase.expr
            .split("\n")
            .slice(0, MAX_LINES) // limit number of lines
            .map((line, index) => {
              const prefix = index === 0 ? "" : "     ";
              const trimmedLine =
          line.length > MAX_LINE_LENGTH ?
            line.substring(0, MAX_LINE_LENGTH - 3) + "..." :
            line;
              return prefix + trimmedLine;
            })
            .join("\n") +
          (testcase.expr.split("\n").length > MAX_LINES ? "\n     ... (truncated)" : "") + "\n":
          testcase["expr-file"] ?
            testcase["expr-file"] :
            "<no expression>";
        // Create a test based on the data in this testcase
        const testTitle = `${testcase.description ?? testcase.filename}: ${displayTestExpr}`;
        // If the testcase has a `skip` field, then skip this test

        const testFn = async function () {
          return (async () => {
            let expr;
            const expectsCode = "code" in testcase;

            try {
              expr = await fumifier(testcase.expr, {
                navigator: testcase.noNavigator ? undefined : navigator,
                terminologyRuntime: testcase.noNavigator ? undefined : terminologyRuntime,
                fhirClient: testcase.noFhirClient ? undefined : fhirClient
              });

              if ("timelimit" in testcase && "depth" in testcase) {
                this.timeout(testcase.timelimit * 2);
                timeboxExpression(expr, testcase.timelimit, testcase.depth);
              }
            } catch (e) {
              parsingErrorsCaught.push(e);
              if (expectsCode) {
                // ✅ Use chai assertion directly here to validate the thrown error
                expect(e && typeof e === 'object' && 'code' in e).to.be.true;
                expect(e).to.have.property("code", testcase.code);
                if ("token" in testcase) {
                  expect(e).to.have.property("token", testcase.token);
                }
                // remove the error from the parsingErrorsCaught array
                parsingErrorsCaught = parsingErrorsCaught.filter(err => err !== e);
                return; // ✅ Explicitly exit test after validating parse error
              } else {
                // ❌ Unexpected error
                throw new Error("Unexpected parse-time exception: " + e.message);
              }
            }

            // ✅ Proceed to evaluation phase only if parsing succeeded
            if (expr) {
              const dataset = resolveDataset(datasets, testcase);
              expr.assign('logLevel', 0);
              expr.assign('collectLevel', 0);
              if ("undefinedResult" in testcase) {
                const result = expr.evaluate(dataset, testcase.bindings);
                return expect(result).to.eventually.deep.equal(undefined);

              } else if ("result" in testcase) {
                const result = await expr.evaluate(dataset, testcase.bindings);
                return expect(JSON.parse(JSON.stringify(result))).to.deep.equal(testcase.result);

              } else if ("error" in testcase) {
                return expect(expr.evaluate(dataset, testcase.bindings))
                  .to.be.rejected
                  .and.to.eventually.deep.contain(testcase.error);

              } else if (expectsCode) {
                return expect(expr.evaluate(dataset, testcase.bindings))
                  .to.be.rejected
                  .and.to.eventually.have.property("code", testcase.code);

              } else {
                throw new Error("Nothing to test in this test case");
              }
            }

            // 🔒 Defensive fallback: this shouldn't happen if fumifier throws or returns an expr
            throw new Error("Expression was not parsed, and no error was thrown");
          })();
        };




        var itFn;
        // If the testcase has a `skip` field, or the group ends with '.skip', then skip this test
        if (testcase.skip === true || skippedGroups.includes(group)) {
          // Use the `skip` method of the `it` function to skip this test
          skippedTests.push(`Group: ${group}, ${testTitle}`);
          itFn = it.skip;
        } else {
          // Otherwise, use the `it` function to create a test
          itFn = it;
        }
        itFn(testTitle, testFn);
      }
    });
  });

  after(() => {
    if (skippedTests.length > 0) {
      // eslint-disable-next-line no-console
      console.warn("The following tests were skipped:",'\n', ...skippedTests.map(test => `\n - ${test}`));
      // eslint-disable-next-line no-console
      console.warn(`\n\nTotal of ${skippedTests.length} tests skipped.`);
    }
    if (parsingErrorsCaught.length > 0) {
      // eslint-disable-next-line no-console
      console.warn("The following parsing errors were caught:",'\n', );
      // loop through the parsing errors and print them using util.inspect
      parsingErrorsCaught.forEach((err, index) => {
        // eslint-disable-next-line no-console
        console.warn(`\nError ${index + 1}:`, util.inspect(err, { depth: null, colors: true }));
      });
      // eslint-disable-next-line no-console
      console.warn(`\n\nTotal of ${parsingErrorsCaught.length} parsing errors caught.`);
    }
  });
});

/**
 * Protect the process/browser from a runnaway expression
 * i.e. Infinite loop (tail recursion), or excessive stack growth
 *
 * @param {Object} expr - expression to protect
 * @param {Number} timeout - max time in ms
 * @param {Number} maxDepth - max stack depth
 */
function timeboxExpression(expr, timeout, maxDepth) {
  var depth = 0;
  var time = Date.now();

  var checkRunnaway = function() {
    if (maxDepth > 0 && depth > maxDepth) {
      // stack too deep
      throw {
        message:
                    "Stack overflow error: Check for non-terminating recursive function.  Consider rewriting as tail-recursive.",
        stack: new Error().stack,
        code: "U1001"
      };
    }
    if (Date.now() - time > timeout) {
      // expression has run for too long
      throw {
        message: "Expression evaluation timeout: Check for infinite loop",
        stack: new Error().stack,
        code: "U1001"
      };
    }
  };

  // register callbacks
  expr.assign(Symbol.for('fumifier.__evaluate_entry'), function(expr, input, env) {
    if (env.isParallelCall) return;
    depth++;
    checkRunnaway();
  });
  expr.assign(Symbol.for('fumifier.__evaluate_exit'), function(expr, input, env) {
    if (env.isParallelCall) return;
    depth--;
    checkRunnaway();
  });
}

/**
 * Based on the collection of datasets and the information provided as part of the testcase,
 * determine what input data to use in the case (may return undefined).
 *
 * @param {Object} datasets Object mapping dataset names to JS values
 * @param {Object} testcase Testcase data read from testcase file
 * @returns {any} The input data to use when evaluating the fumifier expression
 */
function resolveDataset(datasets, testcase) {
  if ("data" in testcase) {
    return testcase.data;
  }
  if (datasets.hasOwnProperty(testcase.dataset)) {
    if (datasets?.[testcase.dataset]) return datasets[testcase.dataset];
    throw new Error("Unable to find dataset "+testcase.dataset+" among known datasets, are you sure the datasets directory has a file named "+testcase.dataset+".json?");
  }
  return undefined;
}
