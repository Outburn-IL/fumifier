/* eslint-disable valid-jsdoc */

/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

This file includes and modifies code from JSONata (https://github.com/jsonata-js/jsonata).
JSONata portions: © IBM Corp. 2016–2018, licensed under the MIT License.
See NOTICE and LICENSES/MIT-JSONata.txt for details.

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

import parseSignature from './utils/signature.js';
import operators from './utils/operators.js';
import tokenizer from './utils/tokenizer.js';
import processAST from './utils/processAst.js';

const tokenPairs = {
  '}': '{',
  ']': '[',
  ')': '('
};

// This parser implements the 'Top down operator precedence' algorithm developed by Vaughan R Pratt; http://dl.acm.org/citation.cfm?id=512931.
// and builds on the Javascript framework described by Douglas Crockford at http://javascript.crockford.com/tdop/tdop.html
// and in 'Beautiful Code', edited by Andy Oram and Greg Wilson, Copyright 2007 O'Reilly Media, Inc. 798-0-596-51004-6
// The original JSONata parser has been modified to support the FLASH syntax, which is a superset of JSONata based on a subset ofFHIR Shorthand.
// This modified parser only handles tokenization and initial AST building for FUME expressions.
// FHIR semantic enrichment and enforcement is handled later in processAST and processFlash.

const parser = (() => {

  /**
     * Runs the scanner/tokenizer/lexer on the whole input and return an array of simple tokens
     * @param {string} source The source as raw string
     * @returns {Array} Array of all simple tokens identified by the scanner
     */

  var parser = function (source, recover) {
    /**
         * The node variable (token in Crockford's implementation) always contains the current token.
         */
    var node;
    var lexer;

    /** This flag globally switches on indent aware mode for FLASH parsing.
     * When switched on, any parsed expression will be terminated if encountering an indent token as the next token.
     * When off, indent tokens are ignored entirely and regular JSONata mode is used where indents are not significant.
     */
    var indentAwareMode = false;

    /**
     * Every token, such as an operator or identifier, will inherit from a symbol.
     * We will keep all of our symbols (which determine the types of tokens in our language) in a symbol_table object.
     */
    var symbol_table = {};
    var errors = [];

    var remainingTokens = function () {
      var remaining = [];
      if (node.id !== '(end)') {
        remaining.push({type: node.type, value: node.value, position: node.position, line: node.line, start: node.start});
      }
      var nxt = lexer.next();
      while (nxt !== null) {
        remaining.push(nxt);
        nxt = lexer.next();
      }
      return remaining;
    };

    /** The base_symbol (original_symbol in Crockford's implementation) object is the prototype for all other symbols.
         * Its methods will usually be overridden.
         * The Null Denotation (or nud) of a token is the procedure and arguments applying for that token when there is nothing on it's left hand side.
         * The Left Denotation (or led) of a token is the procedure, arguments, and lbp applying for that token when there is an LHS expression.
         * A nud does not care about the tokens to the left, it is regarded as a prefix for and expression. A led does - it is regarded as an infix or suffix operator.
         * A token may have both a nud method and a led method.
         * For example, '-' might be both a prefix operator (negation) and an infix operator (subtraction), so it would have both nud and led methods.
         */
    var base_symbol = {
      nud: function () {
        // error - symbol has been invoked as a unary operator
        // Use more specific F1103 error for semicolons
        var err = {
          code: this.value === ';' ? 'F1103' : 'S0211',
          token: this.value,
          position: this.position,
          start: this.start,
          line: this.line
        };

        if (recover) {
          err.remaining = remainingTokens();
          err.type = 'error';
          errors.push(err);
          return err;
        } else {
          err.stack = (new Error()).stack;
          throw err;
        }
      }
    };

    /**
         * Let's define a function that makes symbols.
         * It takes a symbol id and an optional binding power that defaults to 0 and returns a symbol object for that id.
         * If the symbol already exists in the symbol_table, the function returns that symbol object.
         * Otherwise, it makes a new symbol object that inherits from the base_symbol, stores it in the symbol table, and returns it.
         * A symbol object initially contains an id, a value, a left binding power, and the nud and led it inherits from base_symbol.
         * @param {string} id symbol id
         * @param {number} bp binding power
         * @returns a symbol object
         */
    var symbol = function (id, bp) {
      var s = symbol_table[id];
      bp = bp || 0;
      if (s) {
        if (bp >= s.lbp) {
          s.lbp = bp;
        }
      } else {
        s = Object.create(base_symbol);
        s.id = s.value = id;
        s.lbp = bp;
        symbol_table[id] = s;
      }
      return s;
    };

    var handleError = function (err) {
      if (recover) {
        // tokenize the rest of the buffer and add it to an error token
        err.remaining = remainingTokens();
        errors.push(err);
        var symbol = symbol_table["(error)"];
        node = Object.create(symbol);
        node.error = err;
        node.type = "(error)";
        return node;
      } else {
        err.stack = (new Error()).stack;
        throw err;
      }
    };

    /**
         * The advance function makes a new token object from the next simple token in the array and assigns it
         * to the token variable.
         * It can take an optional id parameter which it can check against the id of the previous token.
         * @param {string} id checked against the id of the previous token
         * @param {boolean} infix
         * @returns token (node)
         */
    var advance = function (id, infix) {
      // In Crockford's implementation, we assume that the source text has been transformed into an array of simple token
      // objects (tokens), each containing a type (string) and a value (string or number).
      // In this implementation, the token array is built as we go, and the next token is returned by the lexer (next() function)
      // the node variable is currently set to the previous token
      if (id && // id argument provided
        node.id !== id // AND it's not the same as the previous node.id
      ) {
        var code;
        if (node.id === '(end)') {
          // Previous node is the end of the source, so we can't advance further to look for {id}
          // Expected {{id}} before end of expression
          code = "S0203";
        } else {
          // Previous node has as id and it's different from the one we are looking for
          //"Expected {{id}}, got {{token}}"
          code = "S0202";
        }
        var err = {
          code: code,
          position: node.position,
          start: node.start,
          line: node.line,
          token: node.value,
          value: id
        };
        return handleError(err);
      }
      /** Track line number */
      var line;
      var indent;
      if (node && node.indent >= 0) {
        indent = node.indent;
      }
      /** Need this to initialize at 1 */
      if (node && Object.prototype.hasOwnProperty.call(node, 'line')) {
        line = node.line; // Set to previous node's line
      } else {
        line = 1; // Initialize
      }
      // Track indent number
      if (node && node.id === '(indent)') {
        indent = node.value; // Set to previous node's line
      }
      /** Fetch next simple token from the scanner */
      var next_token = lexer.next(infix);
      if (next_token === null) {
        // When the scanner has no more tokens to consume from the source it returns null
        // So we create an (end) token and return it, but not before we override the node variable
        node = symbol_table["(end)"];
        node.position = source.length;
        node.start = source.length - 1;
        node.line = line;
        return node;
      }
      if (next_token.type === 'indent' && !indentAwareMode) {
        // skipping indent tokens unless inside a flash block, since they have no significance in a regular JSONata expression
        next_token = lexer.next(infix);
      }
      /** Start preparing the processed token to return and override the `node` var with */
      var value = next_token.value;
      var type = next_token.type;
      var symbol;
      switch (type) {
        case 'name':
        case 'variable':
          symbol = symbol_table["(name)"];
          break;
        case 'operator':
          symbol = symbol_table[value];
          if (!symbol) {
            return handleError({
              code: "S0204",
              stack: (new Error()).stack,
              position: next_token.position,
              start: next_token.start,
              line: next_token.line,
              token: value
            });
          }
          if (value === '*' || value === '$') {
            symbol.indent = indent;
          }
          break;
        case 'string':
        case 'number':
        case 'value':
        case 'url': // url is a special case of literal value added to support FLASH parsing
          symbol = symbol_table["(literal)"];
          break;
        case 'regex':
          type = "regex";
          symbol = symbol_table["(regex)"];
          break;
        case 'indent':
          // unskipped indents are seperators inside FLASH blocks, and define their rule hierarchy.
          symbol = symbol_table[`(indent)`];
          break;
        case 'blockindent':
          // we can skip indents if they are before declarations (blockindent).
          // We just need to pass the indent value to the next token

          // Handle flash indentation tokens.
          // var indentSymbol = symbol_table["(indent)"];
          var indentValue = next_token.value; // this is the indent number
          // go to next token
          next_token = lexer.next(infix);
          /* c8 ignore else */
          if (next_token.type === 'operator' && next_token.value === 'Instance:') {
            // It's a FLASH Instance: delaration
            type = 'instance';
            symbol = symbol_table['Instance:'];
            symbol.indent = indentValue;
          } else if (next_token.type === 'instanceof') {
            // It's an InstanceOf: declaration
            type = 'instanceof';
            symbol = symbol_table['(instanceof)'];
            symbol.indent = indentValue;
          }
          value = next_token.value;
          break;
          /* c8 ignore next */
        default:
          // If we get here, it means the token is not recognized
          return handleError({
            code: "S0205",
            stack: (new Error()).stack,
            position: next_token.position,
            start: next_token.start,
            line: next_token.line,
            token: value
          });
      }
      /** This is where we override the node variable with a new processed token */
      node = Object.create(symbol);
      node.value = value;
      node.type = type;
      node.position = next_token.position;
      node.start = next_token.start;
      node.line = next_token.line;
      return node;
    };

    // Pratt's algorithm
    /**
         * The heart of Pratt's technique is the expression function.
         * It takes a right binding power that controls how aggressively it binds to tokens on its right.
         * expression() takes the current token's nud (aka head handler), and uses it to process the next token.
         * Then as long as the right binding power is less than the left binding power of the next token,
         * the led method (aka tail handler) of the current token is invoked on the following token.
         * The led is used to process infix and suffix operators.
         * This process can be recursive because the nud and led methods can call expression().
         * @param {number} rbp Right binding power
         * @returns expression object
         */
    var expression = function (rbp) {
      const indentAwareTerminators = ['(indent)', '(end)', '(instanceof)', 'Instance:'];
      var left;
      var token = node; // save current node as token
      advance(null, true); // advance node to the next token
      left = token.nud(); // save result of calling the previous head handler on current node
      while (rbp < node.lbp) {
        if (indentAwareMode) {
          const peekedNext = lexer.peek();
          if (peekedNext && indentAwareTerminators.includes(peekedNext.id) || indentAwareTerminators.includes(peekedNext.value)) {
            break;
          }
        }
        // loop while rbp is less than the left binding power of the next token
        token = node;
        advance();
        left = token.led(left);
      }

      return left;
      // if we simulate parsing the expression `1 + 2 * 3` using expression(0) (rbp-0):
      // - current node is literal 1 (terminal)
      // - save token = literal 1
      // - advancing node to the next token
      // - node is now `+`, it's left binding power is 50.
      // - calling the literal 1 token's nud.
      // - it returns itself since it's a terminal (literal 1)
      // - left is now literal 1
      // - loop starts since rbp(0) < node(+).lbp(50)
      // - save token: + operator
      // - advance node
      // - node is now literal 2
      // - call the `+' operator's led on left (literal 1)
      // - it returns a '+' node with:
      //  - lhs: left (literal 1)
      //  - rhs: the result of calling expression(50)
      //      - we start at literal 2
      //      - advancing, node now at *. binding power is 60.
      //      - calling literal 2 token's nud and it returns itself
      //      - left is now literal 2
      //      - loop starts since rbp(50) < node(*).lbp(60)
      //      - token is now * operator
      //      - advancing node, it is now at literal 3
      //      - call the `*` operator's led on left (literal 2)
      //      - returns a '*' node with lhs = literal 2 (left)
      //      - rhs: the result of calling expression(60)
      //          - starting at node = literal 3
      //          - advancing, we get node = (end)
      //          - calling literal 3 nud - returns itself
      //          - left is now literal 3 (left of end)
      //          - loop is skipped since literal's lbp is 0 and rbp(60) is greater than that
      //          - returning literal 3
      // So we get a root '+' node with lhs = literal 1, and rhs which is a * node, that has
      // lhs = literal 2 and rhs = literal 3
    };

    /**
         * A terminal does not care about what's on the right or the left, it is a subexpression on itself and
         * doesn't bind anywhere (bp=0). It may be preceded or followed by operators that do something with it,
         * but that's their job and not the terminal's. Hence, it only has a nud (head handler), and it just returns
         * itself
         * @param {string} id symbol id
         */
    var terminal = function (id) {
      var s = symbol(id, 0);
      s.nud = function () {
        return this;
      };
    };


    /**
         * Create a left associative infix operator: <expression> <operator> <expression>
         * It takes an operator (symbol) id, a binding power and an led function.
         * If bp is not supplied, it will default to the bp defined in `operators`, otherwise 0.
         * If led is not supplied it will use a default led function that registers the left,
         * parses the right, and wrappes it in a binary node.
         * @param {string} id - the token identifier (symbol id)
         * @param {number} bp - the binding power to override with
         * @param {Function} led - The left-denotation function to override the default one with
         * @returns {Object} - a symbol object
         */
    var infix = function (id, bp, led) {
      var bindingPower = bp || operators[id];
      var s = symbol(id, bindingPower);
      s.led = led || function (left) {
        this.lhs = left;
        this.rhs = expression(bindingPower);
        this.type = "binary";
        return this;
      };
      return s;
    };

    /**
         * Create a right associative infix operator: <expression> <operator> <expression>
         * It takes an operator (symbol) id, a binding power and a led function.
         * If bp is not supplied, it will default to the bp defined in `operators`, otherwise 0.
         * When a right associative operator scans the rhs expression, it uses an expression binding power of bp-1.
         * This means that when encountering the same operator again, the first pair will not combine into the
         * lhs of the next operator - but the two later operands will be combined into the rhs of the first.
         * The only infixr tokens defined at the moment are ':=' and '(error)'
         * @param {string} id - the token identifier (symbol id)
         * @param {number} bp - the binding power to override with
         * @param {Function} led - The left-denotation function to override the default one with
         * @returns {Object} - a symbol object
         */
    var infixr = function (id, bp, led) {
      var s = symbol(id, bp);
      s.led = led;
      return s;
    };

    // match prefix operators
    // <operator> <expression>
    var prefix = function (id, nud) {
      var s = symbol(id);
      s.nud = nud || function () {
        this.expression = expression(70);
        this.type = "unary";
        return this;
      };
      return s;
    };

    terminal("(end)");
    terminal("(name)");
    terminal("(literal)");
    terminal("(regex)");
    terminal("(indent)");
    symbol(":");
    symbol(";");
    symbol(",");
    symbol(".."); // range operator
    infix("."); // map operator
    infix("+"); // numeric addition
    infix("-"); // numeric subtraction
    infix("*"); // numeric multiplication
    infix("/"); // numeric division
    infix("="); // equality OR assignment in FLASH rules (inline value assignment)
    infix("<"); // less than
    infix(">"); // greater than
    infix("!="); // not equal to
    infix("<="); // less than or equal
    infix(">="); // greater than or equal
    infix("&"); // string concatenation
    infix("and"); // Boolean AND
    infix("or"); // Boolean OR
    infix("in"); // is member of array
    terminal("and"); // the 'keywords' can also be used as terminals (field names)
    terminal("or"); //
    terminal("in"); //
    prefix("-"); // unary numeric negation
    infix("~>"); // function application
    prefix('}', unmatchedClosingBraceNud()); // unmatched closing brace error
    prefix(']', unmatchedClosingBraceNud()); // unmatched closing square brace error
    prefix(')', unmatchedClosingBraceNud()); // unmatched closing parenthesis error

    infixr("(error)", 10, function (left) {
      this.lhs = left;

      this.error = node.error;
      this.remaining = remainingTokens();
      this.type = 'error';
      return this;
    });

    // since a flash block expression can be initialized both by Instance: and InstanceOf: keywords,
    // and flashrules can themselves have subrules (indented) -
    // all of these handlers should collect rules using the same recursive function.
    // The only valid expression types that can be collected as "rules" are flashrules and ':=' (bind)
    var collectRules = function (level, root) {
      root = root || 0;
      if (node.type === 'instance') {
        // Instance:` declaration must come BEFORE `InstanceOf:`
        return handleError({
          code: "F1010",
          stack: (new Error()).stack,
          position: node.position,
          start: node.start,
          line: node.line,
          token: node.id
        });
      }
      // confirm that the indent level is correct
      if (node.id === '(indent)' && node.value > level) {
        return handleError({
          code: "F1017",
          stack: (new Error()).stack,
          position: node.position,
          start: node.start,
          line: node.line,
          token: `${String(level)} spaces`,
          value: `${String(node.value)} spaces`
        });
      }
      if (node.id === '(indent)' && node.value < root) {
        return handleError({
          code: "F1016",
          stack: (new Error()).stack,
          position: node.position,
          start: node.start,
          line: node.line,
          token: `${String(root)} spaces`,
          value: `${String(node.value)} spaces`
        });
      }
      // initialize an array to hold the collected rules
      var rules = [];
      while (node.id !== ")" && node.id !== "(end)") {
        var indent = node.indent;
        if (node.id === "(indent)") {
          if (node.value === level) {
            indent = node.value;
            advance("(indent)", null);
          } else {
            if ((level - node.value) % 2 !== 0) {
              return handleError({
                code: "F1021",
                stack: (new Error()).stack,
                position: node.position,
                start: node.start,
                line: node.line,
                token: '(indent)',
                value: `${String(node.value)} spaces`
              });
            }
            break;
          }
        }
        var rule = expression(0, true);
        // ensure expression is either a flashrule or a bind rule
        if (rule.type !== 'flashrule' && rule.id !== ':=') {
          if (rule.id === '=') {
            return handleError({
              code: "F1025",
              stack: (new Error()).stack,
              position: rule.position,
              start: rule.start,
              line: rule.line,
              token: rule.id
            });
          } else {
            return handleError({
              code: "F1011",
              stack: (new Error()).stack,
              position: rule.position,
              start: rule.start,
              line: rule.line,
              token: rule.id
            });
          }
        }
        rule.indent = rule.indent || indent;
        rules.push(rule);
        if (node.id === ';') advance();
        if (node.id !== "(indent)" || node.value < level) {
          break;
        }
        advance("(indent)");
      }
      return rules;
    };

    var parseFlashPath = function () {
      const steps = [];
      const pathStartLine = node.line;

      const validTerminators = ['=', '(indent)', '(end)', ')', ';','(instanceof)'];

      if (validTerminators.includes(node.id)) {
        return handleError({
          code: "F1024", // path cannot start with end of expression
          position: node.position,
          line: node.line,
          start: node.start,
          token: node.value,
        });
      }
      for (; ;) {
        if (node.line !== pathStartLine)
          return handleError({
            code: "F1028", // path breaks line
            position: node.position,
            line: node.line,
            start: node.start,
            token: node.value,
          });

        if (node.type !== 'name') {
          if (node.value === '*') {
            return handleError({
              code: "F1022", // double * *
              position: node.position,
              line: node.line,
              start: node.start,
              token: node.value
            });
          }
          return handleError({
            code: "F1029", // path segment must start with name
            position: node.position,
            line: node.line,
            start: node.start,
            token: node.type === 'variable' ? `$${node.value}` : node.value
          });
        }

        const step = {
          type: 'name',
          value: node.value,
          position: node.position,
          start: node.start,
          line: node.line
        };

        advance(); // consume the name

        // Collect slice(s)
        while (node.id === '[') {
          advance('['); // consume [
          if (node.line !== pathStartLine) {
            return handleError({
              code: "F1028", // path must be on a single line
              position: node.position,
              line: node.line,
              start: node.start,
              token: node.value,
            });
          }
          if (node.type !== 'name' && node.type !== 'number') {
            return handleError({
              code: "F1027", // invalid slice token
              position: node.position,
              line: node.line,
              start: node.start,
              token: node.value,
            });
          }

          const sliceStart = node;
          const sliceTokens = [];

          // Validate first token isn't '-'
          if (sliceStart.type === 'number' || sliceStart.value === '-') {
            return handleError({
              code: "F1027", // illegal slice start
              position: sliceStart.position,
              line: sliceStart.line,
              start: sliceStart.start,
              token: sliceStart.value
            });
          }

          sliceTokens.push(sliceStart.value);
          const sliceNode = {
            type: 'name',
            value: sliceStart.value,
            position: sliceStart.position,
            start: sliceStart.start,
            line: sliceStart.line
          };

          advance(); // consume the initial slice token

          while (node.id === '-') {
            advance('-'); // consume the dash
            if (node.type !== 'name' && node.type !== 'number') {
              return handleError({
                code: "F1027", // dash must be followed by name/number
                position: node.position,
                line: node.line,
                start: node.start,
                token: node.value
              });
            }
            sliceTokens.push('-', node.value);
            advance(); // consume token
          }

          if (node.id !== ']') {
            return handleError({
              code: "F1030", // expected closing ]
              position: node.position,
              line: node.line,
              start: node.start,
              token: node.value
            });
          }

          sliceNode.value = sliceTokens.join('');
          if (!step.slices) step.slices = [];
          step.slices.push(sliceNode);
          advance(']'); // consume ]
        }

        steps.push(step);

        if (node.id === '.') {
          if (node.line !== pathStartLine) {
            return handleError({
              code: "F1028", // path must be on a single line
              position: node.position,
              line: node.line,
              start: node.start,
              token: node.value,
            });
          }
          advance('.'); // continue
          continue;
        }

        if (!validTerminators.includes(node.id)) {
          if (node.value === ':=') {
            // user tried to assign into a path and not variable
            return handleError({
              code: "F1020", // assignment into path
              position: node.position,
              line: node.line,
              start: node.start,
              token: node.value
            });
          }
          return handleError({
            code: "F1030", // unexpected token after path
            position: node.position,
            line: node.line,
            start: node.start,
            token: node.value,
          });
        }

        break; // end of path
      }

      return {
        type: 'flashpath',
        steps
      };
    };

    // field wildcard (single level) OR flash rule
    prefix('*', function () {
      var { position, line, start } = this;
      if (indentAwareMode) {
        // a flash rule node will have:
        // - type: 'flashrule'
        // - expressions: an optional array of subrules that appear under it (indented)
        // - path: the FLASH path that defines the FHIR element this rule applies to
        // - context: an optional expression that defines the context of this rule (a block between the * and the path)
        // - inlineExpression: an optional expression that defines the inline value of this rule
        var indent = this.indent;
        this.type = 'flashrule';
        if (node.id === '(') {
          this.context = expression(75);
          advance(".", true);
        }
        this.path = parseFlashPath();
        if (node.id === '=') {
          advance('=');
          if (node.id !== '(end)' && node.id !== '(indent)') {
            this.inlineExpression = expression(0);
            // Allow optional trailing semicolon after inline expression for backwards compatibility
            if (node.id === ';') {
              var semicolonLine = node.line;
              advance(';');
              // After semicolon, next token must be on a new line (indent) or end of expression
              // If it's on the same line, that's an error
              if (node.id !== '(end)' && node.id !== '(indent)' && node.line === semicolonLine) {
                return handleError({
                  code: "F1103",
                  stack: (new Error()).stack,
                  position: node.position,
                  start: node.start,
                  line: node.line,
                  token: ";"
                });
              }
            }
          } else {
            // missing inline expression after '='
            return handleError({
              code: "F1012",
              stack: (new Error()).stack,
              position,
              start,
              line,
              token: "="
            });
          }
        }
        if (node.id === ':=') { // user tried to assign into a path and not variable
          return handleError({
            code: "F1020",
            stack: (new Error()).stack,
            position,
            line,
            start,
            token: ':='
          });
        }
        if (this.path) {
          const path = this.path;
          if (path.type === 'flashrule') {
            return handleError({ code: "F1022", position, line, start, token: '*', stack: (new Error()).stack });
          }
          if (path.type === 'variable' || path.id === ':=') {
            return handleError({ code: "F1023", position, line, start, token: '$', stack: (new Error()).stack });
          }
          if (path.id === '(end)') {
            return handleError({ code: "F1024", position, line, start, token: '*', stack: (new Error()).stack });
          }

        }
        this.indent = indent;
        var subrules;
        subrules = collectRules(indent + 2, null);
        // append subrules to the expressions array
        if (subrules.length > 0) this.expressions = subrules;
      } else {
        // not a flash rule, but a field wildcard in a regular jsonata expression
        this.type = "wildcard";
      }
      return this;
    });

    // The Instance: keyword is a prefix for the instance id expression that comes after it.
    // It also initiates a flash block scanning, where the next token MUST be (instanceof),
    // optionally followed by rules. Rules are collected and returned as children of the flashblock token.
    prefix('Instance:', function () {
      indentAwareMode = true; // enable indent aware mode
      var instanceExpr = expression(0); // this is the expression after Instance:
      if (instanceExpr.id === '(instanceof)') {
        // if it's a flashblock it means there is no expression between `Instance:` and `InstanceOf:` - throw error
        return handleError({
          code: "F1018",
          stack: (new Error()).stack,
          position: instanceExpr.position,
          start: instanceExpr.start,
          line: instanceExpr.line,
          token: instanceExpr.id,
          value: 'InstanceOf:'
        });
      }
      // set node type to flashblock
      this.type = "flashblock";
      // save the instance expression
      this.instanceExpr = instanceExpr;
      if (node.id !== '(instanceof)') {
        // Instance: <expr> without InstanceOf: immediately after it
        return handleError({
          code: "F1009",
          stack: (new Error()).stack,
          position: node.position,
          start: node.start,
          line: node.line,
          token: node.id
        });
      }
      // node is now on the (instanceof) token
      if (node.line === this.instanceExpr.line) {
        // InstanceOf: at the same line as Instance:
        return handleError({
          code: "F1013",
          stack: (new Error()).stack,
          position: node.position,
          start: node.start,
          line: node.line,
          token: node.id
        });
      }
      // node (instanceof) is confirmed to be on a new line, so we can proceed
      // check if the indent of the InstanceOf: token is the same as the Instance: token
      if (node.indent !== this.indent) {
        return handleError({
          code: "F1014",
          stack: (new Error()).stack,
          position: node.position,
          start: node.start,
          line: node.line,
          token: `${String(this.indent)} spaces`,
          value: `${String(node.indent)} spaces`
        });
      }
      // indentation OK.
      // confirm that value of (instanceof) token is not empty
      if (!node.value || node.value === '') {
        return handleError({
          code: "F1019",
          stack: (new Error()).stack,
          position: this.position,
          start: this.start,
          line: this.line,
          token: "InstanceOf:"
        });
      }
      // all good, set the node's 'instanceof' to the value of the (instanceof) token
      this.instanceof = node.value;
      // proceeed to the next token after InstanceOf:
      advance();
      // collect all rules under this flashblock
      var rules = collectRules(this.indent, this.indent);
      if (rules.length > 0) this.expressions = rules;
      indentAwareMode = false; // disable indent aware mode
      // return the flashblock node
      return this;
    });

    // The InstanceOf: keyword is a prefix for the rules in a block initiated by it, not for the actual profile/resource identifier
    // The identifier is "swallowed" by the 'InstanceOf:' token and used as it's value. This happens in the lexer.
    // For this reason, it is treated as a terminal and has an id of (instanceof) and not the original keyword
    // "InstanceOf:". Terminal symbols represent a token whose possible values cannot be predicted since
    // they are user-defined and not fixed into the language's grammer.
    // This token is optionally followed by rules.
    // Rules are collected and returned as children of the flashblock token.
    prefix('(instanceof)', function () {
      indentAwareMode = true; // enable indent aware mode
      // set node type to flashblock
      this.type = "flashblock";
      if (!this.value || this.value === '') {
        // if the value is empty, it means that the InstanceOf: token was not followed by a FHIR structure identifier
        return handleError({
          code: "F1019",
          stack: (new Error()).stack,
          position: this.position,
          start: this.start,
          line: this.line,
          token: "InstanceOf:"
        });
      }
      // set the node's 'instanceof' to the value of the (instanceof) token
      this.instanceof = this.value;
      // collect all rules under this flashblock
      var rules = collectRules(this.indent, this.indent);
      if (rules.length > 0) this.expressions = rules;
      indentAwareMode = false; // disable indent aware mode
      return this;
    });

    /**
     * This function returns a nud function that handles unmatched closing braces of different kinds.
     * It is meant to replace the unfriendly JSONata S0211 fallback error ("Symbol cannot be used as a unary operator)
     * @param {*} token
     * @returns Error object (on recover mode) or throws
     */
    function unmatchedClosingBraceNud() {
      return function () {
        // tailored error for unmatched closing brace
        var err = {
          code: 'F1100',
          token: this.value,
          matchingOpening: tokenPairs[this.value],
          position: this.position,
          start: this.start,
          line: this.line
        };

        if (recover) {
          err.remaining = remainingTokens();
          err.type = 'error';
          errors.push(err);
          return err;
        } else {
          err.stack = (new Error()).stack;
          throw err;
        }
      };
    }

    // descendant wildcard (multi-level)
    prefix('**', function () {
      this.type = "descendant";
      return this;
    });

    // parent operator
    prefix('%', function () {
      this.type = "parent";
      // peek to see if next token is another parent operator and throw F1107
      return this;
    });

    // numeric modulus
    infix('%', operators['%'], function (left) {
      // if left is also a parent operator, then this is a duplicate parent operator error F1107
      if (left.type === 'parent') {
        return handleError({
          code: "F1107",
          stack: (new Error()).stack,
          position: left.position,
          start: left.start,
          line: left.line,
          token: left.value,
          value: this.value
        });
      }
      this.lhs = left;
      this.rhs = expression(operators['%']);
      this.type = "binary";
      return this;
    });

    // function invocation
    infix("(", operators['('], function (left) {
      // left is is what we are trying to invoke
      this.procedure = left;
      this.type = 'function';
      this.arguments = [];
      if (node.id !== ')') {
        for (; ;) {
          if (node.type === 'operator' && node.id === '?') {
            // partial function application
            this.type = 'partial';
            this.arguments.push(node);
            advance('?');
          } else {
            this.arguments.push(expression(0));
          }
          if (node.id !== ',') break;
          advance(',');
        }
      }
      advance(")", true);
      // if the name of the function is 'function' or λ, then this is function definition (lambda function)
      if (left.type === 'name' && (left.value === 'function' || left.value === '\u03BB')) {
        // all of the args must be VARIABLE tokens
        this.arguments.forEach(function (arg, index) {
          if (arg.type !== 'variable') {
            return handleError({
              code: "S0208",
              stack: (new Error()).stack,
              position: arg.position,
              start: arg.start,
              line: arg.line,
              token: arg.value,
              value: index + 1
            });
          }
        });
        this.type = 'lambda';
        // is the next token a '<' - if so, parse the function signature
        if (node.id === '<') {
          var sigPos = node.position;
          var depth = 1;
          var sig = '<';
          while (depth > 0 && node.id !== '{' && node.id !== '(end)') {
            var tok = advance();
            if (tok.id === '>') {
              depth--;
            } else if (tok.id === '<') {
              depth++;
            }
            sig += tok.value;
          }
          advance('>');
          try {
            this.signature = parseSignature(sig);
          } catch (err) {
            // insert the position into this error
            err.position = sigPos + err.offset;
            err.start = sigPos;
            err.line = node.line;
            return handleError(err);
          }
        }
        // parse the function body with assume block feature
        advance('{');
        // Parse function body expressions with semicolon support
        var expressions = [];
        var firstExpr = expression(0);
        expressions.push(firstExpr);

        // Check if we have semicolons in function body - if so, assume this is a block
        while (node.id === ';') {
          advance(';');
          if (node.id !== '}') {
            expressions.push(expression(0));
          }
        }

        // If we have multiple expressions, wrap in an implicit block
        // If only one expression, return it directly (unwrap implicit block)
        if (expressions.length === 1) {
          this.body = expressions[0];
        } else {
          this.body = {
            type: 'block',
            expressions: expressions,
            position: firstExpr.position,
            start: firstExpr.start,
            line: firstExpr.line,
            isImplicitBlock: true
          };
        }
        advance('}');
      }
      return this;
    });

    // parenthesis - block expression
    prefix("(", function () {
      // if first token in block is an indent token, we should skip it
      if (node.id === '(indent)') {
        advance('(indent)');
      }
      const wasIndentAwareOnEnter = indentAwareMode;
      indentAwareMode = false; // disable indent aware mode for block expressions
      var expressions = [];
      while (node.id !== ")") {
        expressions.push(expression(0));
        if (node.id !== ";") {
          break;
        }
        advance(";");
      }
      indentAwareMode = wasIndentAwareOnEnter; // restore indent aware mode
      advance(")", true);
      this.type = 'block';
      this.expressions = expressions;
      return this;
    });

    // array constructor
    prefix("[", function () {
      // if first token in array is an indent token, we should skip it
      if (node.id === '(indent)') {
        advance('(indent)');
      }
      const wasIndentAwareOnEnter = indentAwareMode;
      indentAwareMode = false; // disable indent aware mode for array expressions
      var a = [];
      if (node.id !== "]") {
        for (; ;) {
          var item = expression(0);
          if (node.id === "..") {
            // range operator
            var range = {type: "binary", value: "..", position: node.position, line: node.line, lhs: item};
            advance("..");
            range.rhs = expression(0);
            item = range;
          }
          a.push(item);
          if (node.id === "]") break;
          if (node.id !== ",") {
            // if the token is one of the (other) closing braces, give the appropriate error
            if (tokenPairs[node.value]) {
              return handleError({
                code: "F1100",
                position: node.position,
                start: node.start,
                line: node.line,
                token: node.value,
                matchingOpening: tokenPairs[node.value]
              });
            }
            // if the token is a colon, we have a special message for that - F1109 :)
            if (node.id === ":") {
              return handleError({
                code: "F1109",
                stack: (new Error()).stack,
                position: node.position,
                start: node.start,
                line: node.line,
                token: node.value
              });
            }
            // missing comma - throw F1106 instead of breaking and letting a generic error throw on the next token
            return handleError({
              code: "F1106",
              stack: (new Error()).stack,
              position: node.position,
              start: node.start,
              line: node.line,
              token: ','
            });
          }
          // if the next token is a closing brace, throw F1108 (extra comma at the end)
          if (lexer.peek() && lexer.peek().value === "]") {
            return handleError({
              code: "F1108",
              stack: (new Error()).stack,
              position: node.position,
              start: node.start,
              line: node.line,
              token: node.value
            });
          }
          // if the next token is a comma, throw F1110 (duplicate comma)
          if (lexer.peek() && lexer.peek().value === ",") {
            return handleError({
              code: "F1110",
              stack: (new Error()).stack,
              position: node.position,
              start: node.start,
              line: node.line,
              token: node.value
            });
          }
          // advance from the comma and continue parsing the next item
          advance(",");
        }
      }
      indentAwareMode = wasIndentAwareOnEnter; // restore indent aware mode
      advance("]", true);
      this.expressions = a;
      this.type = "unary";
      return this;
    });

    // filter - predicate or array index
    infix("[", operators['['], function (left) {
      if (node.id === "]") {
        // empty predicate means maintain singleton arrays in the output
        var step = left;
        while (step && step.type === 'binary' && step.value === '[') {
          step = step.lhs;
        }
        step.keepArray = true;
        advance("]");
        return left;
      } else {
        this.lhs = left;
        this.rhs = expression(operators[']']);
        this.type = 'binary';
        advance("]", true);
        return this;
      }
    });

    // order-by
    infix("^", operators['^'], function (left) {
      advance("(");
      var terms = [];
      for (; ;) {
        var term = {
          descending: false
        };
        if (node.id === "<") {
          // ascending sort
          advance("<");
        } else if (node.id === ">") {
          // descending sort
          term.descending = true;
          advance(">");
        } else {
          //unspecified - default to ascending
        }
        term.expression = expression(0);
        terms.push(term);
        if (node.id !== ",") {
          break;
        }
        advance(",");
      }
      advance(")");
      this.lhs = left;
      this.rhs = terms;
      this.type = 'binary';
      return this;
    });

    var objectParser = function (left) {
      // if left is passed it's an infix, if left is undefined, it's a unary prefix
      const wasIndentAwareOnEnter = indentAwareMode;
      if (typeof left === 'undefined') {
        // disable indent aware mode for object parsing (prefix) - just like we do for blocks.
        // this allows literal object expressions to span multiple lines without breaking on special flash tokens
        // if first token in an object is an indent token, we should skip it
        if (node.id === '(indent)') {
          advance('(indent)');
        }
        indentAwareMode = false;
      }
      var a = [];
      // if the first token is a comma, we are missing a key-value pair
      if (node.id === ",") {
        return handleError({
          code: "F1102",
          stack: (new Error()).stack,
          position: node.position,
          start: node.start,
          line: node.line,
          token: node.id
        });
      }
      if (node.id !== "}") {
        for (; ;) {
          var n = expression(0);
          // after the key we expect a colon. If we see anything else, it means we are missing the colon and value
          if (node.id !== ":") {
            return handleError({
              code: "F1104",
              stack: (new Error()).stack,
              position: node.position,
              start: node.start,
              line: node.line,
              token: node.id
            });
          }
          advance(":");
          // to avoid throwing the unfriendly error "cannot be used as a unary operator"
          // on next token closing the object or the key-value pair, we check the token before calling expression(0)
          if (node.id === '}' || node.id === ',') {
            return handleError({
              code: "F1101",
              stack: (new Error()).stack,
              position: node.position,
              start: node.start,
              line: node.line,
              token: ':'
            });
          }

          var v = expression(0);
          a.push([n, v]); // holds an array of name/value expression pairs
          if (node.id !== ",") {
            break;
          }
          // if the peeked next token is closing the object, throw dedicated error F1105 instead of the generic one
          if (lexer.peek() && lexer.peek().value === "}") {
            return handleError({
              code: "F1105",
              stack: (new Error()).stack,
              position: node.position,
              start: node.start,
              line: node.line,
              token: node.value
            });
          }
          // if the next token is a comma, throw F1110 (duplicate comma)
          if (lexer.peek() && lexer.peek().value === ",") {
            return handleError({
              code: "F1110",
              stack: (new Error()).stack,
              position: node.position,
              start: node.start,
              line: node.line,
              token: node.value
            });
          }
          // otherwise, advance from the comma and continue parsing the next key-value pair
          advance(",");
        }
      }
      indentAwareMode = wasIndentAwareOnEnter;
      advance("}", true);
      if (typeof left === 'undefined') {
        // NUD - unary prefix form
        this.lhs = a;
        this.type = "unary";
      } else {
        // LED - binary infix form
        this.lhs = left;
        this.rhs = a;
        this.type = 'binary';
      }
      return this;
    };

    // object constructor
    prefix("{", objectParser);

    // object grouping
    infix("{", operators['{'], objectParser);

    // bind variable
    infixr(":=", operators[':='], function (left) {
      if (left.type !== 'variable') {
        return handleError({
          code: "S0212",
          stack: (new Error()).stack,
          position: left.position,
          line: left.line,
          token: left.value
        });
      }
      this.lhs = left;
      this.rhs = expression(operators[':='] - 1); // subtract 1 from bindingPower for right associative operators
      this.type = "binary";
      return this;
    });

    // focus variable bind
    infix("@", operators['@'], function (left) {
      this.lhs = left;
      this.rhs = expression(operators['@']);
      if(this.rhs.type !== 'variable') {
        return handleError({
          code: "S0214",
          stack: (new Error()).stack,
          position: this.rhs.position,
          line: this.rhs.line,
          token: "@"
        });
      }
      this.type = "binary";
      return this;
    });

    // index (position) variable bind
    infix("#", operators['#'], function (left) {
      this.lhs = left;
      this.rhs = expression(operators['#']);
      if(this.rhs.type !== 'variable') {
        return handleError({
          code: "S0214",
          stack: (new Error()).stack,
          position: this.rhs.position,
          line: this.rhs.line,
          token: "#"
        });
      }
      this.type = "binary";
      return this;
    });

    // if/then/else ternary operator ?:
    infix("?", operators['?'], function (left) {
      this.type = 'condition';
      this.condition = left;
      this.then = expression(0);
      if (node.id === ':') {
        // else condition
        advance(":");
        this.else = expression(0);
      }
      return this;
    });

    // FUME: coalesce operator ??
    // This was added to JSONata on July 2025 - but implemented differently
    // as a hacked 'condition' node with the condition being a fake $exists() function call on left,
    // and the else being the left expression.
    // In Fumifier we treat it as a separate operator
    infix("??", operators['??'], function (left) {
      this.type = 'coalesce';
      this.condition = left;
      this.else = expression(0);
      return this;
    });

    // FUME: default/elvis operator ?!
    // This was added to JSONata on July 2025 - but implemented differently
    // as a hacked 'condition' node with else = condition = left
    // In Fumifier we treat it as a separate operator
    infix("?:", operators['?:'], function (left) {
      this.type = 'elvis';
      this.condition = left;
      this.else = expression(0);
      return this;
    });

    // object transformer
    prefix("|", function () {
      this.type = 'transform';
      this.pattern = expression(0);
      advance('|');
      this.update = expression(0);
      if (node.id === ',') {
        advance(',');
        this.delete = expression(0);
      }
      advance('|');
      return this;
    });

    /**
     * Parse expressions with assume block support at root level
     * @returns {Object} parsed expression or implicit block
     */
    var parseRootWithAssumeBlock = function() {
      var expressions = [];
      var firstExpr = expression(0);
      expressions.push(firstExpr);

      // Check if we have semicolons at root level - if so, assume this is a block
      while (node.id === ';') {
        advance(';');
        // Handle trailing semicolons (e.g., "expr;" or "expr;;") - ignore empty expressions at end
        if (node.id !== '(end)') {
          var nextExpr = expression(0);
          expressions.push(nextExpr);
        }
      }      // Handle remaining tokens after parsing
      if (node.id !== '(end)') {
        // if the token is one of the closing braces, give the appropriate error
        if (tokenPairs[node.value]) {
          return handleError({
            code: "F1100",
            position: node.position,
            start: node.start,
            line: node.line,
            token: node.value,
            matchingOpening: tokenPairs[node.value]
          });
        }
        // if the token is anything else, throw the general syntax error
        var err = {
          code: "S0201",
          position: node.position,
          start: node.start,
          line: node.line,
          token: node.value
        };
        return handleError(err);
      }

      // If we have multiple expressions, wrap in an implicit block
      // If only one expression, return it directly (unwrap implicit block)
      if (expressions.length === 1) {
        return expressions[0];
      } else {
        return {
          type: 'block',
          expressions: expressions,
          position: firstExpr.position,
          start: firstExpr.start,
          line: firstExpr.line,
          isImplicitBlock: true
        };
      }
    };    // now invoke the tokenizer and the parser and return the syntax tree
    lexer = tokenizer(source);
    advance();
    // parse the tokens with assume block feature
    var expr = parseRootWithAssumeBlock();

    // process the AST
    expr = processAST(expr, recover, errors);

    if(expr.type === 'parent' || typeof expr.seekingParent !== 'undefined') {
      // error - trying to derive ancestor at top level
      throw {
        code: "S0217",
        token: expr.type,
        position: expr.position,
        start: expr.start,
        line: expr.line
      };
    }

    if (errors.length > 0) {
      expr.errors = errors;
    }
    // console.log('reached final line of the parser!');
    return expr;
  };

  return parser;
})();

export default parser;
