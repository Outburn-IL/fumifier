/* eslint-disable no-console */
/* eslint-disable no-prototype-builtins */
/* eslint-disable require-jsdoc */
/* eslint-disable valid-jsdoc */
/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

This file includes and modifies code from JSONata (https://github.com/jsonata-js/jsonata).
JSONata portions: © IBM Corp. 2016–2018, licensed under the MIT License.
See NOTICE and LICENSES/MIT-JSONata.txt for details.

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

/**
 * @module Fumifier
 * @description FUME transformation evaluator
 */

import datetime from './utils/datetime.js';
import fn from './utils/functions.js';
import utils from './utils/utils.js';
import parser from './parser.js';
import resolveDefinitions from './utils/resolveDefinitions.js';

// Import boolize directly since it's a simple utility function
const { boolize } = fn;
// Destructure common helpers from utils to use as globals in this module
const { isNumeric, isArrayOfNumbers, isArrayOfStrings, createSequence, isSequence, isFunction, isIterable, getFunctionArity, isDeepEqual, isPromise, isLambda } = utils;
import { populateMessage } from './utils/errorCodes.js';
import defineFunction from './utils/defineFunction.js';
import registerNativeFn from './utils/registerNativeFn.js';
import createFlashEvaluator from './flashEvaluator.js';
import { createDefaultLogger, SYM, decide, push, thresholds, severityFromCode, LEVELS } from './utils/diagnostics.js';

/**
 * @typedef {import('@outburn/structure-navigator').FhirStructureNavigator} FhirStructureNavigator
 */

/**
 * @typedef FumifierOptions
 * @property {boolean} [recover] Attempt to recover on parse error.
 * @property {FhirStructureNavigator} [navigator] FHIR structure navigator used to resolve FLASH constructs.
 */

/**
 * @typedef FumifierCompiled
 * @property {(input: any, bindings?: Record<string, any>, callback?: (err: any, resp: any) => void) => Promise<any>} evaluate
 *   Evaluate the compiled expression against input. If provided, callback will be called with (err, result).
 * @property {(input: any, bindings?: Record<string, any>) => Promise<{ ok: boolean, status: number, result: any, diagnostics: any }>} evaluateVerbose
 *   Like evaluate(), but never throws for handled errors; returns a report with diagnostics and HTTP-like status.
 * @property {(name: string | symbol, value: any) => void} assign Assign a value to a variable in the compilation scope.
 * @property {(name: string, implementation: (this: {environment:any, input:any}, ...args: any[]) => any, signature?: string) => void} registerFunction
 *   Register a custom function available to the expression. Optional JSONata signature string is supported.
 * @property {(newLogger: {debug: Function, info: Function, warn: Function, error: Function}) => void} setLogger
 *   Provide a logger implementation; defaults to console-based logger.
 * @property {() => any} ast Get the parsed AST (possibly FLASH-processed).
 * @property {() => any} errors Get parse-time errors if compiled with recover=true.
 */

var fumifier = (function() {

  // Create frame
  function createFrame(enclosingEnvironment) {
    var bindings = {};
    const newFrame = {
      bind: function (name, value) {
        bindings[name] = value;
      },
      lookup: function (name) {
        var value;
        if(Object.prototype.hasOwnProperty.call(bindings, name)) {
          value = bindings[name];
        } else if (enclosingEnvironment) {
          value = enclosingEnvironment.lookup(name);
        }
        return value;
      },
      timestamp: enclosingEnvironment ? enclosingEnvironment.timestamp : null,
      async: enclosingEnvironment ? enclosingEnvironment.async : false,
      isParallelCall: enclosingEnvironment ? enclosingEnvironment.isParallelCall : false,
      global: enclosingEnvironment ? enclosingEnvironment.global : {
        ancestry: [null]
      }
    };

    if (enclosingEnvironment) {
      var framePushCallback = enclosingEnvironment.lookup(Symbol.for('fumifier.__createFrame_push'));
      if(framePushCallback) {
        framePushCallback(enclosingEnvironment, newFrame);
      }
    }
    return newFrame;
  }

  // Start of Evaluator code

  var staticFrame = createFrame(null);

  /**
     * Evaluate expression against input data
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {Promise<any>} Evaluated input data
     */
  async function evaluate(expr, input, environment) {

    var result;

    var entryCallback = environment.lookup(Symbol.for('fumifier.__evaluate_entry'));
    if(entryCallback) {
      await entryCallback(expr, input, environment);
    }


    switch (expr.type) {
      case 'path':
        result = await evaluatePath(expr, input, environment);
        break;
      case 'binary':
        result = await evaluateBinary(expr, input, environment);
        break;
      case 'unary': // <--- might be a flash block or rule since they are prefix operators (unary)
        result = await evaluateUnary(expr, input, environment);
        break;
      case 'name':
        result = evaluateName(expr, input, environment);
        break;
      case 'string':
      case 'number':
      case 'value':
        result = evaluateLiteral(expr, input, environment);
        break;
      case 'wildcard':
        result = evaluateWildcard(expr, input);
        break;
      case 'descendant':
        result = evaluateDescendants(expr, input, environment);
        break;
      case 'parent':
        result = environment.lookup(expr.slot.label);
        break;
      case 'condition':
        result = await evaluateCondition(expr, input, environment);
        break;
      case 'coalesce':
        result = await evaluateCoalesce(expr, input, environment);
        break;
      case 'elvis':
        result = await evaluateElvis(expr, input, environment);
        break;
      case 'block':
        result = await evaluateBlock(expr, input, environment);
        break;
      case 'bind':
        result = await evaluateBindExpression(expr, input, environment);
        break;
      case 'regex':
        result = evaluateRegex(expr, input, environment);
        break;
      case 'function':
        result = await evaluateFunction(expr, input, environment);
        break;
      case 'variable':
        result = evaluateVariable(expr, input, environment);
        break;
      case 'lambda':
        result = evaluateLambda(expr, input, environment);
        break;
      case 'partial':
        result = await evaluatePartialApplication(expr, input, environment);
        break;
      case 'apply':
        result = await evaluateApplyExpression(expr, input, environment);
        break;
      case 'transform':
        result = evaluateTransformExpression(expr, input, environment);
        break;
    }

    if (Object.prototype.hasOwnProperty.call(expr, 'predicate')) {
      for(var ii = 0; ii < expr.predicate.length; ii++) {
        result = await evaluateFilter(expr.predicate[ii].expr, result, environment);
      }
    }

    if (expr.type !== 'path' && Object.prototype.hasOwnProperty.call(expr, 'group')) {
      result = await evaluateGroupExpression(expr.group, result, environment);
    }

    var exitCallback = environment.lookup(Symbol.for('fumifier.__evaluate_exit'));
    if(exitCallback) {
      await exitCallback(expr, input, environment, result);
    }

    if(result && isSequence(result) && !result.tupleStream) {
      if(expr.keepArray) {
        result.keepSingleton = true;
      }
      if(result.length === 0) {
        result = undefined;
      } else if(result.length === 1) {
        result =  result.keepSingleton ? result : result[0];
      }
    }

    return result;
  }

  // Initialize FLASH evaluator (uses main evaluate)
  const evaluateFlash = createFlashEvaluator(evaluate);

  /**
     * Evaluate unary expression against input data
     * This includes specialized '[' unary operator for flash blocks and rules that were converted
     * to native JSONata AST nodes.
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {Promise<any>} Evaluated input data
     */
  async function evaluateUnary(expr, input, environment) {

    var result;


    // if it's a flash block or rule, evaluate it and return the result
    if (expr.isFlashBlock || expr.isFlashRule) {
      result = await evaluateFlash(expr, input, environment);
      return result;
    }

    // otherwise, it's a native JSONata unary operator, process normally

    switch (expr.value) {
      case '-':
        result = await evaluate(expr.expression, input, environment);
        if(typeof result === 'undefined') {
          result = undefined;
        } else if (isNumeric(result)) {
          result = -result;
        } else {
          throw {
            code: "D1002",
            stack: (new Error()).stack,
            position: expr.position,
            start: expr.start,
            token: expr.value,
            value: result
          };
        }
        break;
      case '[':
        // array constructor - evaluate each item
        result = [];
        // eslint-disable-next-line no-case-declarations
        let generators = await Promise.all(expr.expressions
          .map(async (item, idx) => {
            environment.isParallelCall = idx > 0;
            return [item, await evaluate(item, input, environment)];
          }));
        for (let generator of generators) {
          var [item, value] = generator;
          if (typeof value !== 'undefined') {
            if(item.value === '[') {
              result.push(value);
            } else {
              result = fn.append(result, value);
            }
          }
        }
        if(expr.consarray) {
          Object.defineProperty(result, 'cons', {
            enumerable: false,
            configurable: false,
            value: true
          });
        }
        break;
      case '{':
        // object constructor - apply grouping
        result = await evaluateGroupExpression(expr, input, environment);
        break;
    }

    return result;

  }

  /**
     * Evaluate path expression against input data
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {Promise<any>} Evaluated input data
     */
  async function evaluatePath(expr, input, environment) {
    var inputSequence;
    // expr is an array of steps
    // if the first step is a variable reference ($...), including root reference ($$),
    //   then the path is absolute rather than relative
    if (Array.isArray(input) && expr.steps[0].type !== 'variable') {
      inputSequence = input;
    } else {
      // if input is not an array, make it so
      inputSequence = createSequence(input);
    }

    var resultSequence;
    var isTupleStream = false;
    var tupleBindings = undefined;

    // evaluate each step in turn
    for(var ii = 0; ii < expr.steps.length; ii++) {
      var step = expr.steps[ii];

      if(step.tuple) {
        isTupleStream = true;
      }

      // if the first step is an explicit array constructor, then just evaluate that (i.e. don't iterate over a context array)
      if (ii === 0 && step.consarray) {
        resultSequence = await evaluate(step, inputSequence, environment);
      } else if (isTupleStream) {
        tupleBindings = await evaluateTupleStep(step, inputSequence, tupleBindings, environment);
      } else {
        resultSequence = await evaluateStep(step, inputSequence, environment, ii === expr.steps.length - 1);
      }

      if (!isTupleStream && (typeof resultSequence === 'undefined' || resultSequence.length === 0)) {
        break;
      }

      if(typeof step.focus === 'undefined') {
        inputSequence = resultSequence;
      }

    }

    if(isTupleStream) {
      if(expr.tuple) {
        // tuple stream is carrying ancestry information - keep this
        resultSequence = tupleBindings;
      } else {
        resultSequence = createSequence();
        for (ii = 0; ii < tupleBindings.length; ii++) {
          resultSequence.push(tupleBindings[ii]['@']);
        }
      }
    }

    if(expr.keepSingletonArray) {
      // if the array is explicitly constructed in the expression and marked to promote singleton sequences to array
      if(Array.isArray(resultSequence) && resultSequence.cons && !resultSequence.sequence) {
        resultSequence = createSequence(resultSequence);
      }
      resultSequence.keepSingleton = true;
    }

    if (expr.hasOwnProperty('group')) {
      resultSequence = await evaluateGroupExpression(expr.group, isTupleStream ? tupleBindings : resultSequence, environment);
    }

    return resultSequence;
  }

  function createFrameFromTuple(environment, tuple) {
    var frame = createFrame(environment);
    for(const prop in tuple) {
      frame.bind(prop, tuple[prop]);
    }
    return frame;
  }

  /**
     * Evaluate a step within a path
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @param {boolean} lastStep - flag the last step in a path
     * @returns {Promise<any>} Evaluated input data
     */
  async function evaluateStep(expr, input, environment, lastStep) {
    // console.log('🔸 evaluateStep', expr.type, '→ input:', JSON.stringify(input, null, 2));
    let result;

    // Handle sorting first
    if (expr.type === 'sort') {
      result = await evaluateSortExpression(expr, input, environment);
      if (expr.stages) {
        result = await evaluateStages(expr.stages, result, environment);
      }
      return result;
    }

    result = createSequence();

    for(var ii = 0; ii < input.length; ii++) {
      var res = await evaluate(expr, input[ii], environment);
      if(expr.stages) {
        for(var ss = 0; ss < expr.stages.length; ss++) {
          res = await evaluateFilter(expr.stages[ss].expr, res, environment);
        }
      }
      if(typeof res !== 'undefined') {
        result.push(res);
      }
    }

    var resultSequence = createSequence();
    if(lastStep && result.length === 1 && Array.isArray(result[0]) && !isSequence(result[0])) {
      resultSequence = result[0];
    } else {
      // flatten the sequence
      result.forEach(function(res) {
        if (!Array.isArray(res) || res.cons) {
          // it's not an array - just push into the result sequence
          resultSequence.push(res);
        } else {
          // res is a sequence - flatten it into the parent sequence
          res.forEach(val => resultSequence.push(val));
        }
      });
    }

    return resultSequence;
  }

  async function evaluateStages(stages, input, environment) {
    var result = input;
    for(var ss = 0; ss < stages.length; ss++) {
      var stage = stages[ss];
      switch(stage.type) {
        case 'filter':
          result = await evaluateFilter(stage.expr, result, environment);
          break;
        case 'index':
          for(var ee = 0; ee < result.length; ee++) {
            var tuple = result[ee];
            tuple[stage.value] = ee;
          }
          break;
      }
    }
    return result;
  }

  /**
     * Evaluate a step within a path
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} tupleBindings - The tuple stream
     * @param {Object} environment - Environment
     * @returns {Promise<any>} Evaluated input data
     */
  async function evaluateTupleStep(expr, input, tupleBindings, environment) {
    var result;
    if(expr.type === 'sort') {
      if(tupleBindings) {
        result = await evaluateSortExpression(expr, tupleBindings, environment);
      } else {
        var sorted = await evaluateSortExpression(expr, input, environment);
        result = createSequence();
        result.tupleStream = true;
        for(var ss = 0; ss < sorted.length; ss++) {
          var tuple = {'@': sorted[ss]};
          tuple[expr.index] = ss;
          result.push(tuple);
        }
      }
      if(expr.stages) {
        result = await evaluateStages(expr.stages, result, environment);
      }
      return result;
    }

    result = createSequence();
    result.tupleStream = true;
    var stepEnv = environment;
    if(tupleBindings === undefined) {
      tupleBindings = input.map(item => { return {'@': item}; });
    }

    for(var ee = 0; ee < tupleBindings.length; ee++) {
      stepEnv = createFrameFromTuple(environment, tupleBindings[ee]);
      var res = await evaluate(expr, tupleBindings[ee]['@'], stepEnv);
      // res is the binding sequence for the output tuple stream
      if(typeof res !== 'undefined') {
        if (!Array.isArray(res)) {
          res = [res];
        }
        for (var bb = 0; bb < res.length; bb++) {
          tuple = {};
          Object.assign(tuple, tupleBindings[ee]);
          if(res.tupleStream) {
            Object.assign(tuple, res[bb]);
          } else {
            if (expr.focus) {
              tuple[expr.focus] = res[bb];
              tuple['@'] = tupleBindings[ee]['@'];
            } else {
              tuple['@'] = res[bb];
            }
            if (expr.index) {
              tuple[expr.index] = bb;
            }
            if (expr.ancestor) {
              tuple[expr.ancestor.label] = tupleBindings[ee]['@'];
            }
          }
          result.push(tuple);
        }
      }
    }

    if(expr.stages) {
      result = await evaluateStages(expr.stages, result, environment);
    }

    return result;
  }

  /**
     * Apply filter predicate to input data
     * @param {Object} predicate - filter expression
     * @param {Object} input - Input data to apply predicates against
     * @param {Object} environment - Environment
     * @returns {Promise<any>} Result after applying predicates
     */
  async function evaluateFilter(predicate, input, environment) {
    var results = createSequence();
    if( input && input.tupleStream) {
      results.tupleStream = true;
    }
    if (!Array.isArray(input)) {
      input = createSequence(input);
    }
    if (predicate.type === 'number') {
      var index = Math.floor(predicate.value);  // round it down
      if (index < 0) {
        // count in from end of array
        index = input.length + index;
      }
      var item = input[index];
      if(typeof item !== 'undefined') {
        if(Array.isArray(item)) {
          results = item;
        } else {
          results.push(item);
        }
      }
    } else {
      for (index = 0; index < input.length; index++) {
        // eslint-disable-next-line no-redeclare
        var item = input[index];
        var context = item;
        var env = environment;
        if(input.tupleStream) {
          context = item['@'];
          env = createFrameFromTuple(environment, item);
        }
        var res = await evaluate(predicate, context, env);
        if (isNumeric(res)) {
          res = [res];
        }
        if (isArrayOfNumbers(res)) {
          res.forEach(function (ires) {
            // round it down
            var ii = Math.floor(ires);
            if (ii < 0) {
              // count in from end of array
              ii = input.length + ii;
            }
            if (ii === index) {
              results.push(item);
            }
          });
        } else if (fn.boolean(res)) { // truthy
          results.push(item);
        }
      }
    }
    return results;
  }

  /**
     * Evaluate binary expression against input data
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {Promise<any>} Evaluated input data
     */
  async function evaluateBinary(expr, input, environment) {
    var result;
    var lhs = await evaluate(expr.lhs, input, environment);
    var op = expr.value;

    //defer evaluation of RHS to allow short-circuiting
    var evalrhs = async () => await evaluate(expr.rhs, input, environment);
    if (op === "and" || op === "or") {
      try {
        return await evaluateBooleanExpression(lhs, evalrhs, op);
      } catch(err) {
        err.position = expr.position;
        err.start = expr.start;
        err.token = op;
        throw err;
      }
    }

    var rhs = await evalrhs();
    try {
      switch (op) {
        case '+':
        case '-':
        case '*':
        case '/':
        case '%':
          result = evaluateNumericExpression(lhs, rhs, op);
          break;
        case '=':
        case '!=':
          result = evaluateEqualityExpression(lhs, rhs, op);
          break;
        case '<':
        case '<=':
        case '>':
        case '>=':
          result = evaluateComparisonExpression(lhs, rhs, op);
          break;
        case '&':
          result = evaluateStringConcat(lhs, rhs);
          break;
        case '..':
          result = evaluateRangeExpression(lhs, rhs);
          break;
        case 'in':
          result = evaluateIncludesExpression(lhs, rhs);
          break;
      }
    } catch(err) {
      err.position = expr.position;
      err.start = expr.start;
      err.token = op;
      throw err;
    }
    return result;
  }

  /**
     * Evaluate name object against input data
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {*} Evaluated input data
     */
  function evaluateName(expr, input) {
    // lookup the 'name' item in the input
    return fn.lookup(input, expr.value);
  }

  /**
     * Evaluate literal against input data
     * @param {Object} expr - Fumifier expression
     * @returns {*} Evaluated input data
     */
  function evaluateLiteral(expr) {
    return expr.value;
  }

  /**
     * Evaluate wildcard against input data
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @returns {*} Evaluated input data
     */
  function evaluateWildcard(expr, input) {
    var results = createSequence();
    if (Array.isArray(input) && input.outerWrapper && input.length > 0) {
      input = input[0];
    }
    if (input !== null && typeof input === 'object') {
      Object.keys(input).forEach(function (key) {
        var value = input[key];
        if(Array.isArray(value)) {
          value = flatten(value);
          results = fn.append(results, value);
        } else {
          results.push(value);
        }
      });
    }

    return results;
  }

  /**
     * Returns a flattened array
     * @param {Array} arg - the array to be flatten
     * @param {Array} flattened - carries the flattened array - if not defined, will initialize to []
     * @returns {Array} - the flattened array
     */
  function flatten(arg, flattened) {
    if(typeof flattened === 'undefined') {
      flattened = [];
    }
    if(Array.isArray(arg)) {
      arg.forEach(function (item) {
        flatten(item, flattened);
      });
    } else {
      flattened.push(arg);
    }
    return flattened;
  }

  /**
     * Evaluate descendants against input data
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @returns {*} Evaluated input data
     */
  function evaluateDescendants(expr, input) {
    var result;
    var resultSequence = createSequence();
    if (typeof input !== 'undefined') {
      // traverse all descendants of this object/array
      recurseDescendants(input, resultSequence);
      if (resultSequence.length === 1) {
        result = resultSequence[0];
      } else {
        result = resultSequence;
      }
    }
    return result;
  }

  /**
     * Recurse through descendants
     * @param {Object} input - Input data
     * @param {Object} results - Results
     */
  function recurseDescendants(input, results) {
    // this is the equivalent of //* in XPath
    if (!Array.isArray(input)) {
      results.push(input);
    }
    if (Array.isArray(input)) {
      input.forEach(function (member) {
        recurseDescendants(member, results);
      });
    } else if (input !== null && typeof input === 'object') {
      Object.keys(input).forEach(function (key) {
        recurseDescendants(input[key], results);
      });
    }
  }

  /**
     * Evaluate numeric expression against input data
     * @param {Object} lhs - LHS value
     * @param {Object} rhs - RHS value
     * @param {Object} op - opcode
     * @returns {*} Result
     */
  function evaluateNumericExpression(lhs, rhs, op) {
    var result;

    if (typeof lhs !== 'undefined' && !isNumeric(lhs)) {
      throw {
        code: "T2001",
        stack: (new Error()).stack,
        value: lhs
      };
    }
    if (typeof rhs !== 'undefined' && !isNumeric(rhs)) {
      throw {
        code: "T2002",
        stack: (new Error()).stack,
        value: rhs
      };
    }

    if (typeof lhs === 'undefined' || typeof rhs === 'undefined') {
      // if either side is undefined, the result is undefined
      return result;
    }

    switch (op) {
      case '+':
        result = lhs + rhs;
        break;
      case '-':
        result = lhs - rhs;
        break;
      case '*':
        result = lhs * rhs;
        break;
      case '/':
        result = lhs / rhs;
        break;
      case '%':
        result = lhs % rhs;
        break;
    }
    return result;
  }

  /**
     * Evaluate equality expression against input data
     * @param {Object} lhs - LHS value
     * @param {Object} rhs - RHS value
     * @param {Object} op - opcode
     * @returns {*} Result
     */
  function evaluateEqualityExpression(lhs, rhs, op) {
    var result;

    // type checks
    var ltype = typeof lhs;
    var rtype = typeof rhs;

    if (ltype === 'undefined' || rtype === 'undefined') {
      // if either side is undefined, the result is false
      return false;
    }

    switch (op) {
      case '=':
        result = isDeepEqual(lhs, rhs);
        break;
      case '!=':
        result = !isDeepEqual(lhs, rhs);
        break;
    }
    return result;
  }

  /**
     * Evaluate comparison expression against input data
     * @param {Object} lhs - LHS value
     * @param {Object} rhs - RHS value
     * @param {Object} op - opcode
     * @returns {*} Result
     */
  function evaluateComparisonExpression(lhs, rhs, op) {
    var result;

    // type checks
    var ltype = typeof lhs;
    var rtype = typeof rhs;

    var lcomparable = (ltype === 'undefined' || ltype === 'string' || ltype === 'number');
    var rcomparable = (rtype === 'undefined' || rtype === 'string' || rtype === 'number');

    // if either aa or bb are not comparable (string or numeric) values, then throw an error
    if (!lcomparable || !rcomparable) {
      throw {
        code: "T2010",
        stack: (new Error()).stack,
        value: !(ltype === 'string' || ltype === 'number') ? lhs : rhs
      };
    }

    // if either side is undefined, the result is undefined
    if (ltype === 'undefined' || rtype === 'undefined') {
      return undefined;
    }

    //if aa and bb are not of the same type
    if (ltype !== rtype) {
      throw {
        code: "T2009",
        stack: (new Error()).stack,
        value: lhs,
        value2: rhs
      };
    }

    switch (op) {
      case '<':
        result = lhs < rhs;
        break;
      case '<=':
        result = lhs <= rhs;
        break;
      case '>':
        result = lhs > rhs;
        break;
      case '>=':
        result = lhs >= rhs;
        break;
    }
    return result;
  }

  /**
     * Inclusion operator - in
     *
     * @param {Object} lhs - LHS value
     * @param {Object} rhs - RHS value
     * @returns {boolean} - true if lhs is a member of rhs
     */
  function evaluateIncludesExpression(lhs, rhs) {
    var result = false;

    if (typeof lhs === 'undefined' || typeof rhs === 'undefined') {
      // if either side is undefined, the result is false
      return false;
    }

    if(!Array.isArray(rhs)) {
      rhs = [rhs];
    }

    for(var i = 0; i < rhs.length; i++) {
      if(rhs[i] === lhs) {
        result = true;
        break;
      }
    }

    return result;
  }

  /**
     * Evaluate boolean expression against input data
     * @param {Object} lhs - LHS value
     * @param {Function} evalrhs - function to evaluate RHS value
     * @param {Object} op - opcode
     * @returns {Promise<any>} Result
     */
  async function evaluateBooleanExpression(lhs, evalrhs, op) {
    var result;

    var lBool = boolize(lhs);

    switch (op) {
      case 'and':
        result = lBool && boolize(await evalrhs());
        break;
      case 'or':
        result = lBool || boolize(await evalrhs());
        break;
    }
    return result;
  }

  /**
     * Evaluate string concatenation against input data
     * @param {Object} lhs - LHS value
     * @param {Object} rhs - RHS value
     * @returns {string|*} Concatenated string
     */
  function evaluateStringConcat(lhs, rhs) {
    var result;

    var lstr = '';
    var rstr = '';
    if (typeof lhs !== 'undefined') {
      lstr = fn.string(lhs);
    }
    if (typeof rhs !== 'undefined') {
      rstr = fn.string(rhs);
    }

    result = lstr.concat(rstr);
    return result;
  }

  /**
     * Evaluate group expression against input data
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {Promise<any>} Evaluated input data
     */
  async function evaluateGroupExpression(expr, input, environment) {
    var result = {};
    var groups = {};
    var reduce = input && input.tupleStream ? true : false;
    // group the input sequence by 'key' expression
    if (!Array.isArray(input)) {
      input = createSequence(input);
    }
    // if the array is empty, add an undefined entry to enable literal JSON object to be generated
    if (input.length === 0) {
      input.push(undefined);
    }

    for(var itemIndex = 0; itemIndex < input.length; itemIndex++) {
      var item = input[itemIndex];
      var env = reduce ? createFrameFromTuple(environment, item) : environment;
      for(var pairIndex = 0; pairIndex < expr.lhs.length; pairIndex++) {
        var pair = expr.lhs[pairIndex];
        var key = await evaluate(pair[0], reduce ? item['@'] : item, env);
        // key has to be a string
        if (typeof  key !== 'string' && key !== undefined) {
          throw {
            code: "T1003",
            stack: (new Error()).stack,
            position: expr.position,
            start: expr.start,
            value: key
          };
        }

        if (key !== undefined) {
          var entry = {data: item, exprIndex: pairIndex};
          if (groups.hasOwnProperty(key)) {
            // a value already exists in this slot
            if(groups[key].exprIndex !== pairIndex) {
              // this key has been generated by another expression in this group
              // when multiple key expressions evaluate to the same key, then error D1009 must be thrown
              throw {
                code: "D1009",
                stack: (new Error()).stack,
                position: expr.position,
                start: expr.start,
                value: key
              };
            }

            // append it as an array
            groups[key].data = fn.append(groups[key].data, item);
          } else {
            groups[key] = entry;
          }
        }
      }
    }

    // iterate over the groups to evaluate the 'value' expression
    let generators = await Promise.all(Object.keys(groups).map(async (key, idx) => {
      let entry = groups[key];
      var context = entry.data;
      var env = environment;
      if (reduce) {
        var tuple = reduceTupleStream(entry.data);
        context = tuple['@'];
        delete tuple['@'];
        env = createFrameFromTuple(environment, tuple);
      }
      environment.isParallelCall = idx > 0;
      return [key, await evaluate(expr.lhs[entry.exprIndex][1], context, env)];
    }));

    for (let generator of generators) {
      // eslint-disable-next-line no-redeclare
      var [key, value] = await generator;
      if(typeof value !== 'undefined') {
        result[key] = value;
      }
    }

    return result;
  }

  function reduceTupleStream(tupleStream) {
    if(!Array.isArray(tupleStream)) {
      return tupleStream;
    }
    var result = {};
    Object.assign(result, tupleStream[0]);
    for(var ii = 1; ii < tupleStream.length; ii++) {
      for(const prop in tupleStream[ii]) {
        result[prop] = fn.append(result[prop], tupleStream[ii][prop]);
      }
    }
    return result;
  }

  /**
     * Evaluate range expression against input data
     * @param {Object} lhs - LHS value
     * @param {Object} rhs - RHS value
     * @returns {Array} Resultant array
     */
  function evaluateRangeExpression(lhs, rhs) {
    var result;

    if (typeof lhs !== 'undefined' && !Number.isInteger(lhs)) {
      throw {
        code: "T2003",
        stack: (new Error()).stack,
        value: lhs
      };
    }
    if (typeof rhs !== 'undefined' && !Number.isInteger(rhs)) {
      throw {
        code: "T2004",
        stack: (new Error()).stack,
        value: rhs
      };
    }

    if (typeof lhs === 'undefined' || typeof rhs === 'undefined') {
      // if either side is undefined, the result is undefined
      return result;
    }

    if (lhs > rhs) {
      // if the lhs is greater than the rhs, return undefined
      return result;
    }

    // limit the size of the array to ten million entries (1e7)
    // this is an implementation defined limit to protect against
    // memory and performance issues.  This value may increase in the future.
    var size = rhs - lhs + 1;
    if(size > 1e7) {
      throw {
        code: "D2014",
        stack: (new Error()).stack,
        value: size
      };
    }

    result = new Array(size);
    for (var item = lhs, index = 0; item <= rhs; item++, index++) {
      result[index] = item;
    }
    result.sequence = true;
    return result;
  }

  /**
     * Evaluate bind expression against input data
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {Promise<any>} Evaluated input data
     */
  async function evaluateBindExpression(expr, input, environment) {
    // The RHS is the expression to evaluate
    // The LHS is the name of the variable to bind to - should be a VARIABLE token (enforced by parser)
    var value = await evaluate(expr.rhs, input, environment);
    environment.bind(expr.lhs.value, value);
    return value;
  }

  /**
     * Evaluate condition against input data
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {Promise<any>} Evaluated input data
     */
  async function evaluateCondition(expr, input, environment) {
    var result;
    var condition = await evaluate(expr.condition, input, environment);
    if (fn.boolean(condition)) {
      result = await evaluate(expr.then, input, environment);
    } else if (typeof expr.else !== 'undefined') {
      result = await evaluate(expr.else, input, environment);
    }
    return result;
  }

  /**
   * Evaluate coalescing operator
   * @param {Object} expr - Fumifier expression
   * @param {Object} input - Input data to evaluate against
   * @param {Object} environment - Environment
   * @returns {Promise<any>} Evaluated input data
   */
  async function evaluateCoalesce(expr, input, environment) {
    var result;
    var condition = await evaluate(expr.condition, input, environment);
    if (typeof condition === 'undefined') {
      result = await evaluate(expr.else, input, environment);
    } else {
      result = condition;
    }
    return result;
  }

  /**
   * Evaluate default/elvis operator
   * @param {Object} expr - Fumifier expression
   * @param {Object} input - Input data to evaluate against
   * @param {Object} environment - Environment
   * @returns {Promise<any>} Evaluated input data
   */
  async function evaluateElvis(expr, input, environment) {
    var result;
    var condition = await evaluate(expr.condition, input, environment);
    if (fn.boolean(condition)) {
      result = condition;
    } else {
      result = await evaluate(expr.else, input, environment);
    }
    return result;
  }

  /**
     * Evaluate block against input data
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {Promise<any>} Evaluated input data
     */
  async function evaluateBlock(expr, input, environment) {
    var result;
    // create a new frame to limit the scope of variable assignments
    // TODO, only do this if the post-parse stage has flagged this as required
    var frame = createFrame(environment);
    var ii = 0;
    // if regular block (not flash block or rule), invoke each expression in turn
    // and only return the result of the last one

    for(ii = 0; ii < expr.expressions.length; ii++) {
      result = await evaluate(expr.expressions[ii], input, frame);
    }
    return result;
  }

  /**
     * Prepare a regex
     * @param {Object} expr - expression containing regex
     * @returns {Function} Higher order function representing prepared regex
     */
  function evaluateRegex(expr) {
    var re = new RegExp(expr.value);
    var closure = function(str, fromIndex) {
      var result;
      re.lastIndex = fromIndex || 0;
      var match = re.exec(str);
      if(match !== null) {
        result = {
          match: match[0],
          start: match.index,
          end: match.index + match[0].length,
          groups: []
        };
        if(match.length > 1) {
          for(var i = 1; i < match.length; i++) {
            result.groups.push(match[i]);
          }
        }
        result.next = function() {
          if(re.lastIndex >= str.length) {
            return undefined;
          } else {
            var next = closure(str, re.lastIndex);
            if(next && next.match === '') {
              // matches zero length string; this will never progress
              throw {
                code: "D1004",
                stack: (new Error()).stack,
                position: expr.position,
                start: expr.start,
                value: expr.value.source
              };
            }
            return next;
          }
        };
      }

      return result;
    };
    return closure;
  }

  /**
     * Evaluate variable against input data
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {*} Evaluated input data
     */
  function evaluateVariable(expr, input, environment) {
    // lookup the variable value in the environment
    var result;
    // if the variable name is empty string, then it refers to context value
    if (expr.value === '') {
      result = input && input.outerWrapper ? input[0] : input;
    } else {
      result = environment.lookup(expr.value);
    }
    return result;
  }

  /**
     * sort / order-by operator
     * @param {Object} expr - AST for operator
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {Promise<any>} Ordered sequence
     */
  async function evaluateSortExpression(expr, input, environment) {
    var result;

    // evaluate the lhs, then sort the results in order according to rhs expression
    var lhs = input;
    var isTupleSort = input.tupleStream ? true : false;

    // sort the lhs array
    // use comparator function
    var comparator = async function(a, b) {
      // expr.terms is an array of order-by in priority order
      var comp = 0;
      for(var index = 0; comp === 0 && index < expr.terms.length; index++) {
        var term = expr.terms[index];
        //evaluate the sort term in the context of a
        var context = a;
        var env = environment;
        if(isTupleSort) {
          context = a['@'];
          env = createFrameFromTuple(environment, a);
        }
        var aa = await evaluate(term.expression, context, env);
        //evaluate the sort term in the context of b
        context = b;
        env = environment;
        if(isTupleSort) {
          context = b['@'];
          env = createFrameFromTuple(environment, b);
        }
        var bb = await evaluate(term.expression, context, env);

        // type checks
        var atype = typeof aa;
        var btype = typeof bb;
        // undefined should be last in sort order
        if(atype === 'undefined') {
          // swap them, unless btype is also undefined
          comp = (btype === 'undefined') ? 0 : 1;
          continue;
        }
        if(btype === 'undefined') {
          comp = -1;
          continue;
        }

        // if aa or bb are not string or numeric values, then throw an error
        if(!(atype === 'string' || atype === 'number') || !(btype === 'string' || btype === 'number')) {
          throw {
            code: "T2008",
            stack: (new Error()).stack,
            position: expr.position,
            start: expr.start,
            value: !(atype === 'string' || atype === 'number') ? aa : bb
          };
        }

        //if aa and bb are not of the same type
        if(atype !== btype) {
          throw {
            code: "T2007",
            stack: (new Error()).stack,
            position: expr.position,
            start: expr.start,
            value: aa,
            value2: bb
          };
        }
        if(aa === bb) {
          // both the same - move on to next term
          continue;
        } else if (aa < bb) {
          comp = -1;
        } else {
          comp = 1;
        }
        if(term.descending === true) {
          comp = -comp;
        }
      }
      // only swap a & b if comp equals 1
      return comp === 1;
    };

    var focus = {
      environment: environment,
      input: input
    };
    // the `focus` is passed in as the `this` for the invoked function
    result = await fn.sort.apply(focus, [lhs, comparator]);

    return result;
  }

  /**
     * create a transformer function
     * @param {Object} expr - AST for operator
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {*} tranformer function
     */
  function evaluateTransformExpression(expr, input, environment) {
    // create a function to implement the transform definition
    var transformer = async function (obj) { // signature <(oa):o>
      // undefined inputs always return undefined
      if(typeof obj === 'undefined') {
        return undefined;
      }

      // this function returns a copy of obj with changes specified by the pattern/operation
      var cloneFunction = environment.lookup('clone');
      if(!isFunction(cloneFunction)) {
        // throw type error
        throw {
          code: "T2013",
          stack: (new Error()).stack,
          position: expr.position
        };
      }
      var result = await apply(cloneFunction, [obj], null, environment);
      var matches = await evaluate(expr.pattern, result, environment);
      if(typeof matches !== 'undefined') {
        if(!Array.isArray(matches)) {
          matches = [matches];
        }
        for(var ii = 0; ii < matches.length; ii++) {
          var match = matches[ii];
          if (match && (match.isPrototypeOf(result) || match instanceof Object.constructor)) {
            throw {
              code: "D1010",
              stack: (new Error()).stack,
              position: expr.position
            };
          }
          // evaluate the update value for each match
          var update = await evaluate(expr.update, match, environment);
          // update must be an object
          var updateType = typeof update;
          if(updateType !== 'undefined') {
            if(updateType !== 'object' || update === null || Array.isArray(update)) {
              // throw type error
              throw {
                code: "T2011",
                stack: (new Error()).stack,
                position: expr.update.position,
                start: expr.update.start,
                value: update
              };
            }
            // merge the update
            for(var prop in update) {
              match[prop] = update[prop];
            }
          }

          // delete, if specified, must be an array of strings (or single string)
          if(typeof expr.delete !== 'undefined') {
            var deletions = await evaluate(expr.delete, match, environment);
            if(typeof deletions !== 'undefined') {
              var val = deletions;
              if (!Array.isArray(deletions)) {
                deletions = [deletions];
              }
              if (!isArrayOfStrings(deletions)) {
                // throw type error
                throw {
                  code: "T2012",
                  stack: (new Error()).stack,
                  position: expr.delete.position,
                  start: expr.delete.start,
                  value: val
                };
              }
              for (var jj = 0; jj < deletions.length; jj++) {
                if(typeof match === 'object' && match !== null) {
                  delete match[deletions[jj]];
                }
              }
            }
          }
        }
      }

      return result;
    };

    return defineFunction(transformer, '<(oa):o>');
  }

  var chainAST = utils.chainAST;

  /**
     * Apply the function on the RHS using the sequence on the LHS as the first argument
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {Promise<any>} Evaluated input data
     */
  async function evaluateApplyExpression(expr, input, environment) {
    var result;


    var lhs = await evaluate(expr.lhs, input, environment);
    if(expr.rhs.type === 'function') {
      // this is a function _invocation_; invoke it with lhs expression as the first argument
      result = await evaluateFunction(expr.rhs, input, environment, { context: lhs });
    } else {
      var func = await evaluate(expr.rhs, input, environment);

      if(!isFunction(func)) {
        throw {
          code: "T2006",
          stack: (new Error()).stack,
          position: expr.position,
          start: expr.start,
          value: func
        };
      }

      if(isFunction(lhs)) {
        // this is function chaining (func1 ~> func2)
        // λ($f, $g) { λ($x){ $g($f($x)) } }
        var chain = await evaluate(chainAST, null, environment);
        result = await apply(chain, [lhs, func], null, environment);
      } else {
        result = await apply(func, [lhs], null, environment);
      }

    }

    return result;
  }

  /**
     * Evaluate function against input data
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {Promise<any>} Evaluated input data
     */
  async function evaluateFunction(expr, input, environment, applyto) {
    var result;

    // create the procedure
    // can't assume that expr.procedure is a lambda type directly
    // could be an expression that evaluates to a function (e.g. variable reference, parens expr etc.
    // evaluate it generically first, then check that it is a function.  Throw error if not.
    var proc = await evaluate(expr.procedure, input, environment);

    if (typeof proc === 'undefined' && expr.procedure.type === 'path' && environment.lookup(expr.procedure.steps[0].value)) {
      // help the user out here if they simply forgot the leading $
      throw {
        code: "T1005",
        stack: (new Error()).stack,
        position: expr.position,
        start: expr.start,
        token: expr.procedure.steps[0].value
      };
    }

    var evaluatedArgs = [];
    if(typeof applyto !== 'undefined') {
      evaluatedArgs.push(applyto.context);
    }
    // eager evaluation - evaluate the arguments
    for (var jj = 0; jj < expr.arguments.length; jj++) {
      const arg = await evaluate(expr.arguments[jj], input, environment);
      if(isFunction(arg)) {
        // wrap this in a closure
        const closure = async function (...params) {
          // invoke func
          return await apply(arg, params, null, environment);
        };
        closure.arity = getFunctionArity(arg);
        evaluatedArgs.push(closure);
      } else {
        evaluatedArgs.push(arg);
      }
    }
    // apply the procedure
    var procName = expr.procedure.type === 'path' ? expr.procedure.steps[0].value : expr.procedure.value;
    try {
      if(typeof proc === 'object') {
        proc.token = procName;
        proc.position = expr.position;
        proc.start = expr.start;
      }
      result = await apply(proc, evaluatedArgs, input, environment);
    } catch (err) {
      if(!err.position) {
        // add the position field to the error
        err.position = expr.position;
        err.start = expr.start;
      }
      if (!err.token) {
        // and the function identifier
        err.token = procName;
      }
      throw err;
    }
    return result;
  }

  /**
     * Apply procedure or function
     * @param {Object} proc - Procedure
     * @param {Array} args - Arguments
     * @param {Object} input - input
     * @param {Object} environment - environment
     * @returns {Promise<any>} Result of procedure
     */
  async function apply(proc, args, input, environment) {
    var result;
    result = await applyInner(proc, args, input, environment);
    while(isLambda(result) && result.thunk === true) {
      // trampoline loop - this gets invoked as a result of tail-call optimization
      // the function returned a tail-call thunk
      // unpack it, evaluate its arguments, and apply the tail call
      var next = await evaluate(result.body.procedure, result.input, result.environment);
      if(result.body.procedure.type === 'variable') {
        next.token = result.body.procedure.value;
      }
      next.position = result.body.procedure.position;
      next.start = result.body.procedure.start;
      var evaluatedArgs = [];
      for(var ii = 0; ii < result.body.arguments.length; ii++) {
        evaluatedArgs.push(await evaluate(result.body.arguments[ii], result.input, result.environment));
      }

      result = await applyInner(next, evaluatedArgs, input, environment);
    }
    return result;
  }

  /**
     * Apply procedure or function
     * @param {Object} proc - Procedure
     * @param {Array} args - Arguments
     * @param {Object} input - input
     * @param {Object} environment - environment
     * @returns {Promise<any>} Result of procedure
     */
  async function applyInner(proc, args, input, environment) {
    var result;
    try {
      var validatedArgs = args;
      if (proc) {
        validatedArgs = validateArguments(proc.signature, args, input);
      }

      if (isLambda(proc)) {
        result = await applyProcedure(proc, validatedArgs);
      } else if (proc && proc._fumifier_function === true) {
        var focus = {
          environment: environment,
          input: input
        };
        // the `focus` is passed in as the `this` for the invoked function
        result = proc.implementation.apply(focus, validatedArgs);
        // `proc.implementation` might be a generator function
        // and `result` might be a generator - if so, yield
        if (isIterable(result)) {
          result = result.next().value;
        }
        if (isPromise(result)) {
          result = await result;
        }
      } else if (typeof proc === 'function') {
        // typically these are functions that are returned by the invocation of plugin functions
        // the `input` is being passed in as the `this` for the invoked function
        // this is so that functions that return objects containing functions can chain
        // e.g. await (await $func())
        result = proc.apply(input, validatedArgs);
        if (isPromise(result)) {
          result = await result;
        }
      } else {
        throw {
          code: "T1006",
          stack: (new Error()).stack
        };
      }
    } catch(err) {
      if(proc) {
        if (typeof err.token === 'undefined' && typeof proc.token !== 'undefined') {
          err.token = proc.token;
        }
        err.position = proc.position || err.position;
        err.start = proc.start || err.start;
      }
      throw err;
    }
    return result;
  }

  /**
     * Evaluate lambda against input data
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {{lambda: boolean, input: *, environment: *, arguments: *, body: *}} Evaluated input data
     */
  function evaluateLambda(expr, input, environment) {
    // make a function (closure)
    var procedure = {
      _fumifier_lambda: true,
      input: input,
      environment: environment,
      arguments: expr.arguments,
      signature: expr.signature,
      body: expr.body
    };
    if(expr.thunk === true) {
      procedure.thunk = true;
    }
    procedure.apply = async function(self, args) {
      return await apply(procedure, args, input, self ? self.environment : environment);
    };
    return procedure;
  }

  /**
     * Evaluate partial application
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {Promise<any>} Evaluated input data
     */
  async function evaluatePartialApplication(expr, input, environment) {
    // partially apply a function
    var result;
    // evaluate the arguments
    var evaluatedArgs = [];
    for(var ii = 0; ii < expr.arguments.length; ii++) {
      var arg = expr.arguments[ii];
      if (arg.type === 'operator' && arg.value === '?') {
        evaluatedArgs.push(arg);
      } else {
        evaluatedArgs.push(await evaluate(arg, input, environment));
      }
    }
    // lookup the procedure
    var proc = await evaluate(expr.procedure, input, environment);
    if (typeof proc === 'undefined' && expr.procedure.type === 'path' && environment.lookup(expr.procedure.steps[0].value)) {
      // help the user out here if they simply forgot the leading $
      throw {
        code: "T1007",
        stack: (new Error()).stack,
        position: expr.position,
        start: expr.start,
        token: expr.procedure.steps[0].value
      };
    }
    if (isLambda(proc)) {
      result = partialApplyProcedure(proc, evaluatedArgs);
    } else if (proc && proc._fumifier_function === true) {
      result = partialApplyNativeFunction(proc.implementation, evaluatedArgs);
    } else if (typeof proc === 'function') {
      result = partialApplyNativeFunction(proc, evaluatedArgs);
    } else {
      throw {
        code: "T1008",
        stack: (new Error()).stack,
        position: expr.position,
        start: expr.start,
        token: expr.procedure.type === 'path' ? expr.procedure.steps[0].value : expr.procedure.value
      };
    }
    return result;
  }

  /**
     * Validate the arguments against the signature validator (if it exists)
     * @param {Function} signature - validator function
     * @param {Array} args - function arguments
     * @param {*} context - context value
     * @returns {Array} - validated arguments
     */
  function validateArguments(signature, args, context) {
    if(typeof signature === 'undefined') {
      // nothing to validate
      return args;
    }
    var validatedArgs = signature.validate(args, context);
    return validatedArgs;
  }

  /**
     * Apply procedure
     * @param {Object} proc - Procedure
     * @param {Array} args - Arguments
     * @returns {Promise<any>} Result of procedure
     */
  async function applyProcedure(proc, args) {
    var result;
    var env = createFrame(proc.environment);
    proc.arguments.forEach(function (param, index) {
      env.bind(param.value, args[index]);
    });
    if (typeof proc.body === 'function') {
      // this is a lambda that wraps a native function - generated by partially evaluating a native
      result = await applyNativeFunction(proc.body, env);
    } else {
      result = await evaluate(proc.body, proc.input, env);
    }
    return result;
  }

  /**
     * Partially apply procedure
     * @param {Object} proc - Procedure
     * @param {Array} args - Arguments
     * @returns {{lambda: boolean, input: *, environment: {bind, lookup}, arguments: Array, body: *}} Result of partially applied procedure
     */
  function partialApplyProcedure(proc, args) {
    // create a closure, bind the supplied parameters and return a function that takes the remaining (?) parameters
    var env = createFrame(proc.environment);
    var unboundArgs = [];
    proc.arguments.forEach(function (param, index) {
      var arg = args[index];
      if (arg && arg.type === 'operator' && arg.value === '?') {
        unboundArgs.push(param);
      } else {
        env.bind(param.value, arg);
      }
    });
    var procedure = {
      _fumifier_lambda: true,
      input: proc.input,
      environment: env,
      arguments: unboundArgs,
      body: proc.body
    };
    return procedure;
  }

  /**
     * Partially apply native function
     * @param {Function} native - Native function
     * @param {Array} args - Arguments
     * @returns {{lambda: boolean, input: *, environment: {bind, lookup}, arguments: Array, body: *}} Result of partially applying native function
     */
  function partialApplyNativeFunction(native, args) {
    // create a lambda function that wraps and invokes the native function
    // get the list of declared arguments from the native function
    // this has to be picked out from the toString() value
    var sigArgs = getNativeFunctionArguments(native);
    sigArgs = sigArgs.map(function (sigArg) {
      return '$' + sigArg.trim();
    });
    var body = 'function(' + sigArgs.join(', ') + '){ _ }';

    var bodyAST = parser(body);
    bodyAST.body = native;

    var partial = partialApplyProcedure(bodyAST, args);
    return partial;
  }

  /**
     * Apply native function
     * @param {Object} proc - Procedure
     * @param {Object} env - Environment
     * @returns {Promise<any>} Result of applying native function
     */
  async function applyNativeFunction(proc, env) {
    var sigArgs = getNativeFunctionArguments(proc);
    // generate the array of arguments for invoking the function - look them up in the environment
    var args = sigArgs.map(function (sigArg) {
      return env.lookup(sigArg.trim());
    });

    var focus = {
      environment: env
    };
    var result = proc.apply(focus, args);
    if (isPromise(result)) {
      result = await result;
    }
    return result;
  }

  /**
     * Get native function arguments
     * @param {Function} func - Function
     * @returns {*|Array} Native function arguments
     */
  function getNativeFunctionArguments(func) {
    var signature = func.toString();
    var sigParens = /\(([^)]*)\)/.exec(signature)[1]; // the contents of the parens
    var sigArgs = sigParens.split(',');
    return sigArgs;
  }

  /**
     * parses and evaluates the supplied expression
     * @param {string} expr - expression to evaluate
     * @returns {Promise<any>} - result of evaluating the expression
     */
  async function functionEval(expr, focus) {
    // undefined inputs always return undefined
    if(typeof expr === 'undefined') {
      return undefined;
    }
    var input = this.input;
    if(typeof focus !== 'undefined') {
      input = focus;
      // if the input is a JSON array, then wrap it in a singleton sequence so it gets treated as a single input
      if(Array.isArray(input) && !isSequence(input)) {
        input = createSequence(input);
        input.outerWrapper = true;
      }
    }

    let ast;
    try {
      ast = parser(expr, false);

      // Post-parse FLASH processing for inner $eval expressions
      // Inherit navigator from the factory; callers of $eval do not (and must not) pass it.
      if (ast && ast.containsFlash === true) {
        const env = this.environment;
        const navigator = env && env.lookup(Symbol.for('fumifier.__navigator'));
        if (!navigator) {
          // Mirror factory behavior for missing navigator with FLASH content
          const err = { code: 'F1000', position: 0 };
          err.stack = (new Error()).stack;
          throw err; // will be wrapped as D3120 below
        }
        const compiledFhirRegex = env && env.lookup(Symbol.for('fumifier.__compiledFhirRegex_OBJ'));
        const errors = []; // no recover mode for $eval; collect if needed but do not expose
        ast = await resolveDefinitions(ast, navigator, false, errors, compiledFhirRegex);
      }
    } catch(err) {
      // error parsing the expression (or resolving FLASH definitions) passed to $eval
      populateMessage(err);
      throw {
        stack: (new Error()).stack,
        code: "D3120",
        value: err.message,
        error: err
      };
    }
    try {
      // Evaluate with environment inherited from the caller, overriding only the
      // FHIR resolved definitions when this inner AST contains FLASH content.
      // Note: thresholds/logging/diagnostics and regex GET/SET remain inherited.
      let evalEnv = this.environment;
      if (ast && ast.containsFlash === true) {
        const localEnv = createFrame(this.environment);
        localEnv.bind(Symbol.for('fumifier.__resolvedDefinitions'), {
          typeMeta: ast.resolvedTypeMeta,
          baseTypeMeta: ast.resolvedBaseTypeMeta,
          typeChildren: ast.resolvedTypeChildren,
          elementDefinitions: ast.resolvedElementDefinitions,
          elementChildren: ast.resolvedElementChildren,
          resolvedValueSetExpansions: ast.resolvedValueSetExpansions
        });
        // TODO(inner-verbose): if we add support for inner verbose mode in $eval, we
        // will need to plumb a verbose flag and return a structured report instead of
        // throwing. For now, inner $eval is always non-verbose by design.
        evalEnv = localEnv;
      }

      var result = await evaluate(ast, input, evalEnv);
      return result;
    } catch(err) {
      // error evaluating the expression passed to $eval
      populateMessage(err);
      throw {
        stack: (new Error()).stack,
        code: "D3121",
        value:err.message,
        error: err
      };
    }
  }

  // Function registration
  registerNativeFn(staticFrame, functionEval);

  // Register user-facing logging functions
  (function registerLoggingFunctions(frame) {
    // $warn(message) -> F5320
    frame.bind('warn', defineFunction(function(message) {
      const msg = fn.string(message);
      const env = this.environment;
      const execId = env.executionId || 'unknown';
      const entry = { code: 'F5320', message: msg, executionId: execId };
      const act = decide(entry.code, env);
      if (act.shouldLog) {
        const logger = env.lookup(SYM.logger) || createDefaultLogger();
        logger.warn(`[${execId}] ${msg}`);
      }
      push(env, entry);
      return undefined;
    }, '<s?:u>'));

    // $info(message) -> F5500
    frame.bind('info', defineFunction(function(message) {
      const msg = fn.string(message);
      const env = this.environment;
      const execId = env.executionId || 'unknown';
      const entry = { code: 'F5500', message: msg, executionId: execId };
      const act = decide(entry.code, env);
      if (act.shouldLog) {
        const logger = env.lookup(SYM.logger) || createDefaultLogger();
        logger.info(`[${execId}] ${msg}`);
      }
      push(env, entry);
      return undefined;
    }, '<s?:u>'));

    // $trace(value?, label, projection?) -> F5600, returns value
    frame.bind('trace', defineFunction(function(value, label, projection) {
      const env = this.environment;
      const val = value;
      const lbl = fn.string(label);
      const proj = (typeof projection === 'undefined') ? val : projection;
      const execId = env.executionId || 'unknown';
      const msg = `${lbl}: ${fn.string(proj)}`;
      const entry = { code: 'F5600', message: msg, label: lbl, value: val, executionId: execId };
      const act = decide(entry.code, env);
      if (act.shouldLog) {
        const logger = env.lookup(SYM.logger) || createDefaultLogger();
        logger.debug(`[${execId}] ${msg}`);
      }
      push(env, entry);
      return val;
    }, '<x-sx?:x>'));
  })(staticFrame);

  /**
     * Fumifier
     * @param {string|Object} expr - FUME mapping expression as text, or pre-parsed AST object
     * @param {FumifierOptions} [options]
     * @returns {Promise<FumifierCompiled>} Compiled expression object
     */
  async function fumifier(expr, options) {
    var ast;
    var errors;
    var navigator = options && options.navigator;
    var recover = options && options.recover;
    var compiledFhirRegex = {};

    try {
      if (typeof expr === 'string') {
        // Parse string expression normally
        ast = parser(expr, options && options.recover);
        // initial parsing done - extract errors if they exist
        if (ast.errors) {
          errors = ast.errors;
          delete ast.errors;
        }
      } else if (typeof expr === 'object' && expr !== null) {
        // Assume it's a pre-parsed AST object that's already fully processed
        if (!expr.hasOwnProperty('type')) {
          throw new Error('Invalid AST: AST object must have a "type" property');
        }
        // Create a copy to avoid mutating the input AST
        ast = JSON.parse(JSON.stringify(expr));
        // If AST has errors from recovery mode, extract them
        if (ast.errors && Array.isArray(ast.errors)) {
          errors = [...ast.errors];
          delete ast.errors;
        }
      } else {
        throw new Error('Expression must be either a string or an AST object');
      }
      // post-parse FLASH processing (async)
      // - only if a navigator was provided
      // - only if the AST contains flash blocks
      // - throws if has flash and no navigator
      if (ast && ast.containsFlash === true) {
        if (!navigator) {
          var err = {
            code: 'F1000',
            position: 0,
          };

          if (recover) {
            err.type = 'error';
            errors.push(err);
          } else {
            err.stack = (new Error()).stack;
            throw err;
          }
        } else {
          // resolve all FHIR definition required for evaluation
          ast = await resolveDefinitions(ast, navigator, recover, errors, compiledFhirRegex);
        }
      }
    } catch(err) {
      // insert error message into structure
      populateMessage(err); // possible side-effects on `err`
      throw err;
    }

    var environment = createFrame(staticFrame);

    // Threshold defaults (scoped variables)
    environment.bind('throwLevel', 30);
    environment.bind('logLevel', 40);
    environment.bind('collectLevel', 70);
    environment.bind('validationLevel', 30);

    // Global logger for this compiled expression (not exposed to expressions)
    environment.bind(SYM.logger, createDefaultLogger());

    var timestamp = new Date(); // will be overridden on each call to evaluate()
    var executionId = utils.generateUuid(); // will be overridden on each call to evaluate()
    environment.bind('now', defineFunction(function(picture, timezone) {
      return datetime.fromMillis(timestamp.getTime(), picture, timezone);
    }, '<s?s?:s>'));
    environment.bind('millis', defineFunction(function() {
      return timestamp.getTime();
    }, '<:n>'));
    environment.bind('executionId', executionId);

    // bind a GETTER for compiled FHIR regexes
    environment.bind(Symbol.for('fumifier.__compiledFhirRegex_GET'), function(regexStr) {
      if (compiledFhirRegex.hasOwnProperty(regexStr)) {
        return compiledFhirRegex[regexStr];
      }
      return undefined;
    });

    // bind a SETTER for compiled FHIR regexes
    environment.bind(Symbol.for('fumifier.__compiledFhirRegex_SET'), function(regexStr) {
      const compiled = new RegExp(`^${regexStr}$`);
      compiledFhirRegex[regexStr] = compiled;
      return compiled;
    });

    // Expose navigator and compiled regex cache to inner $eval() via environment lookup
    environment.bind(Symbol.for('fumifier.__navigator'), navigator);
    environment.bind(Symbol.for('fumifier.__compiledFhirRegex_OBJ'), compiledFhirRegex);

    // bind the resolved definition collections
    environment.bind(Symbol.for('fumifier.__resolvedDefinitions'), {
      typeMeta: ast.resolvedTypeMeta,
      baseTypeMeta: ast.resolvedBaseTypeMeta,
      typeChildren: ast.resolvedTypeChildren,
      elementDefinitions: ast.resolvedElementDefinitions,
      elementChildren: ast.resolvedElementChildren,
      resolvedValueSetExpansions: ast.resolvedValueSetExpansions // added so flashEvaluator can access VS expansions
    });

    var fumifierObject = {
      evaluate: async function (input, bindings, callback) {
        var exec_env;
        try {
          // throw if the expression compiled with syntax errors
          if(typeof errors !== 'undefined') {
            var err = {
              code: 'S0500',
              position: 0
            };
            populateMessage(err); // possible side-effects on `err`
            throw err;
          }

          if (typeof bindings !== 'undefined') {
            // the variable bindings have been passed in - create a frame to hold these
            exec_env = createFrame(environment);
            for (var v in bindings) {
              exec_env.bind(v, bindings[v]);
            }
          } else {
            exec_env = environment;
          }
          // fresh diagnostics bag per call
          exec_env.bind(SYM.diagnostics, { error: [], warning: [], debug: [] });
          // put the input document into the environment as the root object
          exec_env.bind('$', input);

          // capture the timestamp and executionId for this execution
          // the $now() and $millis() functions will return these values, $executionId is available as a variable
          timestamp = new Date();
          executionId = utils.generateUuid();
          exec_env.timestamp = timestamp; // ensure date/time utils can access a fixed reference time
          exec_env.executionId = executionId; // ensure tracing can access the execution ID
          exec_env.bind('executionId', executionId);

          // Ensure array focus is wrapped as a singleton sequence
          if(Array.isArray(input) && !isSequence(input)) {
            input = createSequence(input);
            input.outerWrapper = true;
          }

          const result = await evaluate(ast, input, exec_env);

          if (typeof callback === 'function') {
            callback(null, result);
            return undefined;
          }
          return result;
        } catch (err) {
          // insert error message into structure
          populateMessage(err); // possible side-effects on `err`
          // Add executionId to error for traceability
          if (exec_env && exec_env.executionId) {
            err.executionId = exec_env.executionId;
          }
          try {
            const bag = exec_env && typeof exec_env.lookup === 'function' ? exec_env.lookup(SYM.diagnostics) : null;
            if (bag) err.flashDiagnostics = bag;
          } catch(ex) { /* ignore diagnostics attachment issues */ }
          if (typeof callback === 'function') {
            callback(err);
            return undefined;
          }
          throw err;
        }
      },
      evaluateVerbose: async function (input, bindings) {
        // Like evaluate(), but never throws for handled errors; returns a report
        var exec_env = typeof bindings !== 'undefined' ? createFrame(environment) : environment;
        if (typeof bindings !== 'undefined') {
          for (var v in bindings) exec_env.bind(v, bindings[v]);
        }
        // TODO: Expose a validation inhibitor hook (Symbol) on the environment so callers
        // can provide custom suppression logic for certain validations. See enforcePolicy().
        // Example:
        //   exec_env.bind(Symbol.for('fumifier.__validationInhibitor'), fn);
        // Ensure downstream policy checks honor it.
        const bag = { error: [], warning: [], debug: [] };
        exec_env.bind(SYM.diagnostics, bag);
        exec_env.bind('$', input);

        timestamp = new Date();
        executionId = utils.generateUuid();
        exec_env.timestamp = timestamp;
        exec_env.executionId = executionId;
        exec_env.bind('executionId', executionId);
        if(Array.isArray(input) && !isSequence(input)) {
          input = createSequence(input);
          input.outerWrapper = true;
        }

        let result;
        try {
          result = await evaluate(ast, input, exec_env);
        } catch (err) {
          // In verbose mode: never throw for any defined error (F/S/T/D). Only throw if completely unrecognized shape.
          populateMessage(err);
          // Add executionId to error for traceability
          if (exec_env && exec_env.executionId) {
            err.executionId = exec_env.executionId;
          }
          // Use diagnostics push() with the original error (message populated); push() will sanitize
          push(exec_env, err);
        }

        const status = (function computeStatus() {
          const { throwLevel } = thresholds(exec_env);
          const numSev = (e) => (typeof e.severity === 'number' ? e.severity : severityFromCode(e.code));
          const hasFatal = (bag.error || []).some(e => numSev(e) === LEVELS.fatal);
          const hasInvalid = (bag.error || []).some(e => {
            const s = numSev(e);
            return s >= LEVELS.invalid && s < LEVELS.error;
          });
          const hasThrowables = ['error','warning','debug'].some(bn =>
            (bag[bn] || []).some(e => numSev(e) < throwLevel)
          );
          if (hasFatal) return 422;
          if (!hasThrowables && !hasInvalid) return 200;
          if (!hasThrowables && hasInvalid) return 206;
          return 206;
        })();

        return { ok: status === 200, status, result, diagnostics: bag, executionId: exec_env.executionId };
      },
      assign: function (name, value) {
        environment.bind(name, value);
      },
      registerFunction: function(name, implementation, signature) {
        var func = defineFunction(implementation, signature);
        environment.bind(name, func);
      },
      setLogger: function(newLogger) {
        let lg;
        if (newLogger && typeof newLogger.debug === 'function' && typeof newLogger.info === 'function' && typeof newLogger.warn === 'function' && typeof newLogger.error === 'function') {
          lg = newLogger;
        } else {
          lg = createDefaultLogger();
        }
        environment.bind(SYM.logger, lg);
      },
      ast: function() {
        return ast;
      },
      errors: function() {
        return errors;
      }
    };

    return fumifierObject;

  }

  /**
   * Create a fumifier object from an existing AST
   * @param {Object} astJson - The AST object (can be from JSON.parse)
   * @param {FumifierOptions} [options] - Options including navigator, recover, etc.
   * @returns {Promise<FumifierCompiled>} Compiled expression object
   */
  fumifier.fromAst = async function(astJson, options) {
    if (!astJson || typeof astJson !== 'object') {
      throw new Error('Invalid AST: AST must be a valid object');
    }

    // Validate that this looks like a valid AST
    if (!astJson.hasOwnProperty('type')) {
      throw new Error('Invalid AST: AST must have a "type" property');
    }

    var ast = astJson;
    var errors = [];
    var navigator = options && options.navigator;
    var recover = options && options.recover;
    var compiledFhirRegex = {};

    try {
      // If AST has errors from recovery mode, extract them
      if (ast.errors && Array.isArray(ast.errors)) {
        errors = ast.errors;
        // Don't delete errors from AST since we're working with a copy
        ast = { ...ast };
        delete ast.errors;
      }

      // Handle FLASH processing if needed
      if (ast && ast.containsFlash === true) {
        if (!navigator) {
          var err = {
            code: 'F1000',
            position: 0,
          };

          if (recover) {
            err.type = 'error';
            errors.push(err);
          } else {
            err.stack = (new Error()).stack;
            throw err;
          }
        } else {
          // resolve all FHIR definition required for evaluation
          ast = await resolveDefinitions(ast, navigator, recover, errors, compiledFhirRegex);
        }
      }
    } catch(err) {
      // insert error message into structure
      populateMessage(err); // possible side-effects on `err`
      throw err;
    }

    var environment = createFrame(staticFrame);

    // Threshold defaults (scoped variables)
    environment.bind('throwLevel', 30);
    environment.bind('logLevel', 40);
    environment.bind('collectLevel', 70);
    environment.bind('validationLevel', 30);

    // Global logger for this compiled expression (not exposed to expressions)
    environment.bind(SYM.logger, createDefaultLogger());

    var timestamp = new Date(); // will be overridden on each call to evaluate()
    var executionId = utils.generateUuid(); // will be overridden on each call to evaluate()
    environment.bind('now', defineFunction(function(picture, timezone) {
      return datetime.fromMillis(timestamp.getTime(), picture, timezone);
    }, '<s?s?:s>'));
    environment.bind('millis', defineFunction(function() {
      return timestamp.getTime();
    }, '<:n>'));
    environment.bind('executionId', executionId);

    // bind a GETTER for compiled FHIR regexes
    environment.bind(Symbol.for('fumifier.__compiledFhirRegex_GET'), function(regexStr) {
      if (compiledFhirRegex.hasOwnProperty(regexStr)) {
        return compiledFhirRegex[regexStr];
      }
      return undefined;
    });

    // bind a SETTER for compiled FHIR regexes
    environment.bind(Symbol.for('fumifier.__compiledFhirRegex_SET'), function(regexStr) {
      const compiled = new RegExp(`^${regexStr}$`);
      compiledFhirRegex[regexStr] = compiled;
      return compiled;
    });

    // Expose navigator and compiled regex cache to inner $eval() via environment lookup
    environment.bind(Symbol.for('fumifier.__navigator'), navigator);
    environment.bind(Symbol.for('fumifier.__compiledFhirRegex_OBJ'), compiledFhirRegex);

    // bind the resolved definition collections
    environment.bind(Symbol.for('fumifier.__resolvedDefinitions'), {
      typeMeta: ast.resolvedTypeMeta,
      baseTypeMeta: ast.resolvedBaseTypeMeta,
      typeChildren: ast.resolvedTypeChildren,
      elementDefinitions: ast.resolvedElementDefinitions,
      elementChildren: ast.resolvedElementChildren,
      resolvedValueSetExpansions: ast.resolvedValueSetExpansions // added so flashEvaluator can access VS expansions
    });

    var fumifierObject = {
      evaluate: async function (input, bindings, callback) {
        if (typeof bindings === 'function') {
          callback = bindings;
          bindings = {};
        }
        // Set up execution environment
        var exec_env = createFrame(environment);

        if(bindings) {
          for (let variable in bindings) {
            exec_env.bind(variable, bindings[variable]);
          }
        }

        if (callback) {
          exec_env.bind(SYM.evaluateCallback, callback);
        }

        const bag = { error: [], warning: [], debug: [] };
        exec_env.bind(SYM.diagnostics, bag);
        exec_env.bind('$', input);

        timestamp = new Date();
        executionId = utils.generateUuid();
        exec_env.timestamp = timestamp;
        exec_env.executionId = executionId;
        exec_env.bind('executionId', executionId);
        if(Array.isArray(input) && !isSequence(input)) {
          input = createSequence(input);
          input.outerWrapper = true;
        }

        let result = await evaluate(ast, input, exec_env);

        return result;
      },
      evaluateVerbose: async function(input, bindings) {
        // Set up execution environment
        var exec_env = createFrame(environment);

        if(bindings) {
          for (let variable in bindings) {
            exec_env.bind(variable, bindings[variable]);
          }
        }

        const bag = { error: [], warning: [], debug: [] };
        exec_env.bind(SYM.diagnostics, bag);
        exec_env.bind('$', input);

        timestamp = new Date();
        executionId = utils.generateUuid();
        exec_env.timestamp = timestamp;
        exec_env.executionId = executionId;
        exec_env.bind('executionId', executionId);
        if(Array.isArray(input) && !isSequence(input)) {
          input = createSequence(input);
          input.outerWrapper = true;
        }

        let result;
        try {
          result = await evaluate(ast, input, exec_env);
        } catch (err) {
          populateMessage(err);
          if (exec_env && exec_env.executionId) {
            err.executionId = exec_env.executionId;
          }
          push(exec_env, err);
        }

        const status = (function computeStatus() {
          const { throwLevel } = thresholds(exec_env);
          const numSev = (e) => (typeof e.severity === 'number' ? e.severity : severityFromCode(e.code));
          const hasFatal = (bag.error || []).some(e => numSev(e) === LEVELS.fatal);
          const hasInvalid = (bag.error || []).some(e => {
            const s = numSev(e);
            return s >= LEVELS.invalid && s < LEVELS.error;
          });
          const hasThrowables = ['error','warning','debug'].some(bn =>
            (bag[bn] || []).some(e => numSev(e) < throwLevel)
          );
          if (hasFatal) return 422;
          if (!hasThrowables && !hasInvalid) return 200;
          if (!hasThrowables && hasInvalid) return 206;
          return 206;
        })();

        return { ok: status === 200, status, result, diagnostics: bag, executionId: exec_env.executionId };
      },
      assign: function (name, value) {
        environment.bind(name, value);
      },
      registerFunction: function(name, implementation, signature) {
        var func = defineFunction(implementation, signature);
        environment.bind(name, func);
      },
      setLogger: function(newLogger) {
        let lg;
        if (newLogger && typeof newLogger.debug === 'function' && typeof newLogger.info === 'function' && typeof newLogger.warn === 'function' && typeof newLogger.error === 'function') {
          lg = newLogger;
        } else {
          lg = createDefaultLogger();
        }
        environment.bind(SYM.logger, lg);
      },
      ast: function() {
        return ast;
      },
      errors: function() {
        return errors;
      }
    };

    return fumifierObject;
  };

  return fumifier;

})();

export default fumifier;
