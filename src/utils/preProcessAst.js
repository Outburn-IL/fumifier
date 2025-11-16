/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

/* eslint-disable no-console */
/* eslint-disable valid-jsdoc */

/**
 * Recursively preprocesses a raw AST node and transforms flash-specific constructs
 * into normalized JSONata-compatible structures with helpful markers.
 *
 * Supports:
 * - flashblock → block + injected instance rule
 * - flashrule → inline, block, or empty block structure
 */
const preProcessAst = (ast) => {

  // If this is a multi-step flashrule, unchain it into nested single-step rules
  if (ast.type === 'flashrule' && ast.path?.type === 'flashpath' && ast.path.steps.length > 1) {
    return preProcessAst(unchainMultiStepFlashRule(ast));
  }

  var result;

  switch (ast.type) {
    case 'flashblock':
      result = processFlashBlock(ast);
      break;
    case 'flashrule':
      result = contextualize(processFlashRule(ast));
      break;
    default:
      result = ast;
  }

  return result;
};

// ======== TRANSFORMATION HELPERS ========

/**
 * Transforms a flashblock into a regular array constructor with:
 * - isFlashBlock flag
 * - optional instanceExpr injected as a rule with path: id
 * - all internal expressions recursively preprocessed
 */
function processFlashBlock(node) {
  const result = {
    ...node,
    type: 'unary',
    value: '[',
    isFlashBlock: true, // for later stages to distinguish these from normal arrays
    expressions: node.expressions ? node.expressions.map(preProcessAst) : []
  };

  // Remove properties no longer meaningful post-transformation
  delete result.indent;

  if (node.instanceExpr) {
    // Turn the instance line into a synthetic flashrule at the top of the block
    const instanceRule = preProcessAst(convertInstanceExprToRule(node.instanceExpr));
    result.expressions.unshift(instanceRule); // recurse on injected rule
    delete result.instanceExpr;
  }

  return result;
}

/**
 * Transforms a flashrule into one of two normalized forms:
 *
 * 1. Empty rule
 *   `  * path`     → transformed into an empty array, just to trigger evaluation of ElementDefinition constraints
 * 2. Non-empty rule
 *    has an inline expression and/or sub-rules → becomes an array of expressions
 */
function processFlashRule(node) {
  const result = { ...node };
  result.type = 'unary';
  result.value = '[';
  result.isFlashRule = true;

  // If the rule has nested rules inside, preprocess each recursively
  const hasSubExprs = Array.isArray(node.expressions) && node.expressions.length > 0;
  const subExpressions = hasSubExprs ? node.expressions.map(preProcessAst) : [];

  result.expressions = subExpressions;
  delete result.indent;

  // Inline expressions, if present, is extracted and marked
  // It will be merged into the final structure later
  const inlineExpr = result.inlineExpression;
  if (inlineExpr) {
    inlineExpr.isInlineExpression = true;
    delete result.inlineExpression;
  }

  if (!inlineExpr && !hasSubExprs) {
    // empty rule (no inline expression and no sub-rules)
    return result;
  }

  // non-empty rule
  // inline expression (if any) is prepended to expressions
  if (inlineExpr) {
    result.expressions.unshift(inlineExpr);
  }
  return result;
}

/**
 * A processed rule may have a context, left untouched up to this point.
 * In that case, the rule is converted to a two-step JSONata path node (binary '.')
 * with the context as lhs and the rule itself as rhs.
 * @param {ast} rule
 */
function contextualize(rule) {
  if (!rule.context) {
    // If no context, return the rule as is
    return rule;
  }
  // If the rule has a context, convert it to a path with the context as lhs and rule as rhs.
  // extract context and unblock it if it's a single expression to allow variable scope inheritance
  const lhs = unblockSingleExpression(toBlock(rule.context));
  // extract rule and ensure it's a self-contained block so the path is correctly processed for parent references
  const rhs = toBlock(rule);
  // remove context from the rule to avoid duplication
  delete rule.context;
  // return a binary '.' expression with the context as lhs and the rule as rhs
  return {
    type: 'binary',
    value: '.',
    lhs,
    rhs,
    position: rule.position,
    start: rule.start,
    line: rule.line
  };
}

/**
 * Takes a flashrule with a multi-step path and rewrites it into
 * nested flashrules, each with a single step path, preserving positions.
 *
 * The original inlineExpression is placed on the innermost node
 * and becomes the node itself (not nested under another flashrule),
 * mimicking how a single-step flashrule would be processed.
 */
function unchainMultiStepFlashRule(rule) {
  const { path, inlineExpression, expressions, context } = rule;
  const steps = path.steps;

  // Start by creating the innermost node:
  // Inline expressions and sub-expressions will be set to the deepest node
  // context is preserved on the root node

  const lastStep = steps[steps.length - 1];

  let current = {
    type: "flashrule",
    isFlashRule: true,
    path: {
      type: "flashpath",
      steps: [lastStep]
    },
    position: lastStep.position,
    start: lastStep.start,
    line: lastStep.line
  };
  if (inlineExpression) {
    current.inlineExpression = inlineExpression;
  }

  if (expressions && Array.isArray(expressions)) {
    current.expressions = expressions;
  } else {
    current.expressions = [];
  }

  // Recursively wrap each preceding path step
  for (let i = steps.length - 2; i >= 0; i--) {
    const step = steps[i];
    current = {
      type: "flashrule",
      path: {
        type: "flashpath",
        steps: [step]
      },
      expressions: [current],
      isFlashRule: true,
      position: step.position,
      start: step.start,
      line: step.line
    };
  }

  // add context to the root node if it exists
  if (context) {
    current.context = context;
  }
  return current;
}

/**
 * Converts an `Instance:` expression (e.g. `$uuid()` or `'PAT.' & patientId`) found in a flashblock header
 * into a synthetic flashrule node, with a fixed flash path of `id`, mimicking:
 *   * id = $uuid()
 *
 * This allows the block to be interpreted by the normal flashblock evaluation logic.
 */
function convertInstanceExprToRule (expr) {
  expr.isInlineExpression = true;
  return {
    type: "flashrule",
    position: expr.position,
    start: expr.start,
    line: expr.line,
    path: {
      type: "flashpath",
      steps: [
        {
          value: "id",
          type: "name",
          position: expr.position,
          start: expr.start,
          line: expr.line
        }
      ]
    },
    isFlashRule: true, // explicitly mark as flashrule to guide later phases
    expressions: [expr]
  };
}

/**
 * Wrap an expression node with in a native JSONata block.
 * It is used when contextualizing a rule into a two-step path,
 * to make sure the rhs inherits the context of the lhs and flagged correctly for parent seeking.
 * If it is already a block, return it unchanged.
 * @param {*} rule - The rule to wrap
 * @returns {object} - The wrapped rule as a block
 */
function toBlock (expr) {
  if (expr.type === 'block') {
    return expr; // already a block, return as is
  }
  // Wrap it in a block structure
  return {
    type: 'block',
    position: expr.position,
    line: expr.line,
    start: expr.start,
    expressions: [expr]
  };
}

/**
 * Unblock a block expression if it contains only a single expression.
 * This allows variable bindings in the block to be accessible to following expressions.
 * Blocks with multiple expressions (with ; separators) are kept as blocks to maintain their scope.
 * @param {*} expr - The expression to potentially unblock
 * @returns {object} - The unblocked expression or the original block
 */
function unblockSingleExpression(expr) {
  if (expr.type === 'block' && expr.expressions && expr.expressions.length === 1) {
    // Single expression block - return the inner expression to avoid closed scope
    return expr.expressions[0];
  }
  // Not a single-expression block, return as is
  return expr;
}

export default preProcessAst;
