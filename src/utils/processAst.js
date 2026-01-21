/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

This file includes and modifies code from JSONata (https://github.com/jsonata-js/jsonata).
JSONata portions: © IBM Corp. 2016–2018, licensed under the MIT License.
See NOTICE and LICENSES/MIT-JSONata.txt for details.

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

/* eslint-disable require-jsdoc */
/* eslint-disable no-console */
import validateFhirTypeId from './validateFhirTypeId.js';
import resolveAncestry from './resolveAncestry.js';
import pushAncestry from './pushAncestry.js';
import seekParent from './seekParent.js';
import tailCallOptimize from './tailCallOptimize.js';
import preProcessAst from './preProcessAst.js';

// post-parse stage
// the purpose of this is to add as much semantic value to the parse tree as possible
// in order to simplify the work of the evaluator.
// This includes flattening the parts of the AST representing location paths,
// converting them to arrays of steps which in turn may contain arrays of predicates.
// following this, nodes containing '.' and '[' should be eliminated from the AST.

function processAstWrapper(ast, recover, errors) {
  var containsFlash = false; // track if the AST contains any flash syntax

  // Guard against cyclic ASTs produced during recovery-mode parsing of malformed input.
  // In recover mode we prefer returning partial AST + diagnostics over throwing/stack-overflowing.
  const visited = new WeakSet();

  // keep the root `InstanceOf:` value once entering flash blocks.
  var flashInstanceOf;
  var flashPathStack = []; // track the steps of the paths of flash rules in relation to their parent flash block

  // Global stacks to collect references to FHIR types. These will be resolved to actual FHIR metadata later.
  var structureDefinitionRefs = {}; // collect ALL references to FHIR types from all flash blocks in the entire AST
  var elementDefinitionRefs = {}; // Collect all references to FHIR elements from all flash rules in the entire AST

  const addStructureDefinitionRef = (node) => {
    const ref = {
      position: node.position,
      start: node.start,
      line: node.line
    };
    // if this `instanceof` value exists as a key in the structureDefinitionRefs, push it to the array
    // if it doesn't exist, create a new array with this ref
    if (structureDefinitionRefs[node.instanceof]) {
      structureDefinitionRefs[node.instanceof].push(ref);
    } else {
      structureDefinitionRefs[node.instanceof] = [ref];
    }
  };

  const addElementDefinitionRef = (node) => {
    const instanceOf = node.instanceof;
    const fullPath = node.path.steps.map(step => {
      if (!step.slices || step.slices.length === 0) return step.value;
      const slices = step.slices.map(slice => `[${slice.value}]`).join('');
      return `${step.value}${slices}`;
    }).join('.');
    const ref = { instanceOf, fullPath, ...node.path };
    const key = `${instanceOf}::${fullPath}`;
    // if this key exists in the elementDefinitionRefs, push it to the array
    // if it doesn't exist, create a new array with this ref
    if (elementDefinitionRefs[key]) {
      elementDefinitionRefs[key].push(ref);
    } else {
      elementDefinitionRefs[key] = [ref];
    }
    return key;
  };

  // ancestor tracking utilities
  var ancestorLabel = 0;
  var ancestorIndex = 0;
  var ancestry = [];
  const ancestorWrapper = {
    bumpLabel: () => {
      ancestorLabel++;
      return ancestorLabel;
    },
    bumpIndex: () => {
      ancestorIndex++;
      return ancestorIndex;
    },
    pushAncestor: (ancestor) => {
      ancestry.push(ancestor);
    },
    setSlotLabel: (slotIndex, label) => {
      ancestry[slotIndex].slot.label = label;
    }
  };

  // the core processAST function
  const processAST = function (ast) {
    var expr = preProcessAst(ast);

    if (expr && typeof expr === 'object') {
      if (visited.has(expr)) {
        return expr;
      }
      visited.add(expr);
    }
    var result;
    var slot;
    var priorPathSteps = [];
    // before switch-casing according to type, we check if the isFlashRule flag is set, and keep a snapshot of the path stack + current step.
    // this is to allow flash rules to be processed as native nodes, and not as a special case.
    // this is the absolute path for the current node. It may be one step deeper than the global path stack,
    // which is only updated when we encounter a flashrule that is also a block.
    if (expr.isFlashRule) {
      priorPathSteps.push(...flashPathStack);
    }

    switch (expr.type) {
      case 'binary':
        switch (expr.value) {
          case '.':
            var lstep = processAST(expr.lhs);

            if (lstep.type === 'path') {
              result = lstep;
            } else {
              result = {type: 'path', steps: [lstep]};
            }
            if(lstep.type === 'parent') {
              result.seekingParent = [lstep.slot];
            }
            var rest = processAST(expr.rhs);
            if (rest.type === 'function' &&
                                rest.procedure.type === 'path' &&
                                rest.procedure.steps.length === 1 &&
                                rest.procedure.steps[0].type === 'name' &&
                                result.steps[result.steps.length - 1].type === 'function') {
            // next function in chain of functions - will override a thenable
              result.steps[result.steps.length - 1].nextFunction = rest.procedure.steps[0].value;
            }
            if (rest.type === 'path') {
              Array.prototype.push.apply(result.steps, rest.steps);
            } else {
              if(typeof rest.predicate !== 'undefined') {
                rest.stages = rest.predicate;
                delete rest.predicate;
              }
              result.steps.push(rest);
            }
            // any steps within a path that are string literals, should be changed to 'name'
            result.steps.filter(function (step) {
              if (step.type === 'number' || step.type === 'value') {
              // don't allow steps to be numbers or the values true/false/null
                throw {
                  code: "S0213",
                  stack: (new Error()).stack,
                  position: step.position,
                  start: step.start,
                  line: step.line,
                  value: step.value
                };
              }
              return step.type === 'string';
            }).forEach(function (lit) {
              lit.type = 'name';
            });
            // any step that signals keeping a singleton array, should be flagged on the path
            if (result.steps.filter(function (step) {
              return step.keepArray === true;
            }).length > 0) {
              result.keepSingletonArray = true;
            }
            // if first step is a path constructor, flag it for special handling
            var firststep = result.steps[0];
            if (firststep.type === 'unary' && firststep.value === '[') {
              firststep.consarray = true;
            }
            // if the last step is an array constructor, flag it so it doesn't flatten
            var laststep = result.steps[result.steps.length - 1];
            if (laststep.type === 'unary' && laststep.value === '[') {
              laststep.consarray = true;
            }
            resolveAncestry(result, ancestorWrapper);
            break;
          case '[':
          // predicated step
          // LHS is a step or a predicated step
          // RHS is the predicate expr
            result = processAST(expr.lhs);
            var step = result;
            var type = 'predicate';
            if (result.type === 'path') {
              step = result.steps[result.steps.length - 1];
              type = 'stages';
            }
            if (typeof step.group !== 'undefined') {
              throw {
                code: "S0209",
                stack: (new Error()).stack,
                position: expr.position,
                start: expr.start,
                line: expr.line
              };
            }
            if (typeof step[type] === 'undefined') {
              step[type] = [];
            }
            var predicate = processAST(expr.rhs);
            if(typeof predicate.seekingParent !== 'undefined') {
              predicate.seekingParent.forEach(slot => {
                if(slot.level === 1) {
                  seekParent(step, slot, ancestorWrapper);
                } else {
                  slot.level--;
                }
              });
              pushAncestry(step, predicate);
            }
            step[type].push({type: 'filter', expr: predicate, position: expr.position, start: expr.start, line: expr.line});
            break;
          case '{':
          // group-by
          // LHS is a step or a predicated step
          // RHS is the object constructor expr
            result = processAST(expr.lhs);
            if (typeof result.group !== 'undefined') {
              throw {
                code: "S0210",
                stack: (new Error()).stack,
                position: expr.position,
                start: expr.start,
                line: expr.line
              };
            }
            // object constructor - process each pair
            result.group = {
              lhs: expr.rhs.map(function (pair) {
                return [processAST(pair[0]), processAST(pair[1])];
              }),
              position: expr.position,
              start: expr.start,
              line: expr.line
            };
            break;
          case '^':
          // order-by
          // LHS is the array to be ordered
          // RHS defines the terms
            result = processAST(expr.lhs);
            if (result.type !== 'path') {
              result = {type: 'path', steps: [result]};
            }
            var sortStep = {type: 'sort', position: expr.position, start: expr.start, line: expr.line};
            sortStep.terms = expr.rhs.map(function (terms) {
              var expression = processAST(terms.expression);
              pushAncestry(sortStep, expression);
              return {
                descending: terms.descending,
                expression: expression
              };
            });
            result.steps.push(sortStep);
            resolveAncestry(result, ancestorWrapper);
            break;
          case ':=':
            result = {type: 'bind', value: expr.value, position: expr.position, start: expr.start, line: expr.line};
            result.lhs = processAST(expr.lhs);
            result.rhs = processAST(expr.rhs);
            pushAncestry(result, result.rhs);
            break;
          case '@':
            result = processAST(expr.lhs);
            step = result;
            if (result.type === 'path') {
              step = result.steps[result.steps.length - 1];
            }
            // throw error if there are any predicates defined at this point
            // at this point the only type of stages can be predicates
            if(typeof step.stages !== 'undefined' || typeof step.predicate !== 'undefined') {
              throw {
                code: "S0215",
                stack: (new Error()).stack,
                position: expr.position,
                start: expr.start,
                line: expr.line
              };
            }
            // also throw if this is applied after an 'order-by' clause
            if(step.type === 'sort') {
              throw {
                code: "S0216",
                stack: (new Error()).stack,
                position: expr.position,
                start: expr.start,
                line: expr.line
              };
            }
            if(expr.keepArray) {
              step.keepArray = true;
            }
            step.focus = expr.rhs.value;
            step.tuple = true;
            break;
          case '#':
            result = processAST(expr.lhs);
            step = result;
            if (result.type === 'path') {
              step = result.steps[result.steps.length - 1];
            } else {
              result = {type: 'path', steps: [result]};
              if (typeof step.predicate !== 'undefined') {
                step.stages = step.predicate;
                delete step.predicate;
              }
            }
            if (typeof step.stages === 'undefined') {
              step.index = expr.rhs.value;
            } else {
              step.stages.push({type: 'index', value: expr.rhs.value, position: expr.position, start: expr.start, line: expr.line});
            }
            step.tuple = true;
            break;
          case '~>':
            result = {type: 'apply', value: expr.value, position: expr.position, start: expr.start, line: expr.line};
            result.lhs = processAST(expr.lhs);
            result.rhs = processAST(expr.rhs);
            result.keepArray = result.lhs.keepArray || result.rhs.keepArray;
            break;
          default:
            result = {type: expr.type, value: expr.value, position: expr.position, start: expr.start, line: expr.line};
            result.lhs = processAST(expr.lhs);
            result.rhs = processAST(expr.rhs);
            pushAncestry(result, result.lhs);
            pushAncestry(result, result.rhs);
        }
        break;
      case 'unary':
        result = {type: expr.type, value: expr.value, position: expr.position, start: expr.start, line: expr.line};
        if (expr.value === '[') {
          if (expr.isFlashBlock) {
            containsFlash = true;
            flashPathStack = [];
            result.isFlashBlock = true;
            if (expr.instanceof) {
              result.instanceof = expr.instanceof;
              flashInstanceOf = expr.instanceof; // globally keep the root InstanceOf value when inside flash blocks
              if (!validateFhirTypeId(expr.instanceof)) {
                var typeIdError = {
                  code: 'F1026',
                  position: expr.position,
                  start: expr.start,
                  line: expr.line,
                  token: 'InstanceOf:',
                  value: expr.instanceof
                };
                if (recover) {
                  errors.push(typeIdError);
                  return {type: 'error', error: typeIdError};
                } else {
                  typeIdError.stack = (new Error()).stack;
                  throw typeIdError;
                }
              }
              // push the InstanceOf value to the global stack
              addStructureDefinitionRef(expr);
            }
          } else if (expr.isFlashRule) {
            // this is a flash rule that is also a block, this means it may have child rules that need to keep track of the absolute path
            // so we must update the global flashPathStack
            result.isFlashRule = true;
            flashPathStack.push(expr.path.steps[0]); // assuming single-step paths only, enforced during pre-processing
          }
          // array constructor - process each item
          result.expressions = expr.expressions.map(function (item) {
            var value = processAST(item);
            pushAncestry(result, value);
            return value;
          });
          if (expr.isFlashRule) {
          // after processing all expressions, we pop the flashPathStack
            flashPathStack.pop();
          }
        } else if (expr.value === '{') {
        // object constructor - process each pair
          result.lhs = expr.lhs.map(function (pair) {
            var key = processAST(pair[0]);
            pushAncestry(result, key);
            var value = processAST(pair[1]);
            pushAncestry(result, value);
            return [key, value];
          });
        } else {
        // all other unary expressions - just process the expression
          result.expression = processAST(expr.expression);
          // if unary minus on a number, then pre-process
          if (expr.value === '-' && result.expression.type === 'number') {
            result = result.expression;
            result.value = -result.value;
          } else {
            pushAncestry(result, result.expression);
          }
        }
        break;
      case 'function':
      case 'partial':
        result = {type: expr.type, name: expr.name, value: expr.value, position: expr.position, start: expr.start, line: expr.line};
        result.arguments = expr.arguments.map(function (arg) {
          var argAST = processAST(arg);
          pushAncestry(result, argAST);
          return argAST;
        });
        result.procedure = processAST(expr.procedure);
        break;
      case 'lambda':
        result = {
          type: expr.type,
          arguments: expr.arguments,
          signature: expr.signature,
          position: expr.position,
          start: expr.start,
          line: expr.line
        };
        var body = processAST(expr.body);
        result.body = tailCallOptimize(body);
        break;
      case 'condition':
        result = {type: expr.type, position: expr.position, start: expr.start, line: expr.line};
        result.condition = processAST(expr.condition);
        pushAncestry(result, result.condition);
        result.then = processAST(expr.then);
        pushAncestry(result, result.then);
        if (typeof expr.else !== 'undefined') {
          result.else = processAST(expr.else);
          pushAncestry(result, result.else);
        }
        break;
      case 'coalesce':
      case 'elvis':
        result = {type: expr.type, position: expr.position, start: expr.start, line: expr.line};
        result.condition = processAST(expr.condition);
        pushAncestry(result, result.condition);
        result.else = processAST(expr.else);
        pushAncestry(result, result.else);
        break;
      case 'transform':
        result = {type: expr.type, position: expr.position, start: expr.start, line: expr.line};
        result.pattern = processAST(expr.pattern);
        result.update = processAST(expr.update);
        if (typeof expr.delete !== 'undefined') {
          result.delete = processAST(expr.delete);
        }
        break;
      case 'block':
        result = {type: expr.type, position: expr.position, start: expr.start, line: expr.line};

        // array of expressions - process each one
        result.expressions = expr.expressions.map(function (item) {
          var part = processAST(item);
          pushAncestry(result, part);
          if (part.consarray || (part.type === 'path' && part.steps[0].consarray)) {
            result.consarray = true;
          }
          return part;
        });
        // TODO scan the array of expressions to see if any of them assign variables
        // if so, need to mark the block as one that needs to create a new frame
        break;
      case 'name':
        result = {type: 'path', steps: [expr]};
        if (expr.keepArray) {
          result.keepSingletonArray = true;
        }
        break;
      case 'parent':
        slot = {
          label: '!' + ancestorWrapper.bumpLabel(),
          level: 1,
          index: ancestorWrapper.bumpIndex()
        };
        result = {
          type: 'parent',
          slot
        // seekingParent: [slot]
        };
        ancestorWrapper.pushAncestor(result);
        break;
      case 'string':
      case 'number':
      case 'value':
      case 'wildcard':
      case 'descendant':
      case 'variable':
      case 'regex':
        result = expr;
        break;
      case 'operator':
      // the tokens 'and' and 'or' might have been used as a name rather than an operator
        if (expr.value === 'and' || expr.value === 'or' || expr.value === 'in') {
          expr.type = 'name';
          result = processAST(expr);
        } else /* c8 ignore else */ if (expr.value === '?') {
        // partial application
          result = expr;
        } else {
          throw {
            code: "S0201",
            stack: (new Error()).stack,
            position: expr.position,
            start: expr.start,
            line: expr.line,
            token: expr.value
          };
        }
        break;
      case 'error':
        result = expr;
        if (expr.lhs && expr.lhs !== expr) {
          result = processAST(expr.lhs);
        }
        break;
      default:
        var code = "S0206";
        /* c8 ignore else */
        if (expr.id === '(end)') {
          code = "S0207";
        }
        var err = {
          code: code,
          position: expr.position,
          start: expr.start,
          line: expr.line,
          token: expr.value
        };
        if (recover) {
          errors.push(err);
          return {type: 'error', error: err};
        } else {
          err.stack = (new Error()).stack;
          throw err;
        }
    }

    if (expr.keepArray) {
      result.keepArray = true;
    }
    if (expr.isFlashRule) {
      result.isFlashRule = true;
      // keep the root InstanceOf value on each flash rule
      result.instanceof = flashInstanceOf;
      if (expr.path) {
        // override single step path with the whole absolute path
        result.path = {
          type:'flashpath',
          steps: [...priorPathSteps, expr.path.steps[0]]
        };
        // track this reference in elementDefinitionRefs and store the key in the node
        const flashPathRefKey = addElementDefinitionRef(result);
        result.flashPathRefKey = flashPathRefKey;
      }

      // if result is missing position, start or line, copy them from the expression
      if (typeof result.position === 'undefined') {
        result.position = expr.position;
      }
      if (typeof result.start === 'undefined') {
        result.start = expr.start;
      }
      if (typeof result.line === 'undefined') {
        result.line = expr.line;
      }
    }
    if (expr.isInlineExpression) {
      // if this is an inline expression, we need to restore the flag after processing
      result.isInlineExpression = true;
    }
    return result;
  };

  // process the AST
  var processedAst = processAST(ast);

  // attach the FHIR definition references to the processed AST
  if (containsFlash) {
    processedAst.containsFlash = true;
    processedAst.structureDefinitionRefs = structureDefinitionRefs;
    processedAst.elementDefinitionRefs = elementDefinitionRefs;
  }

  return processedAst;
}

export default processAstWrapper;