/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

This file includes and modifies code from JSONata (https://github.com/jsonata-js/jsonata).
JSONata portions: © IBM Corp. 2016–2018, licensed under the MIT License.
See NOTICE and LICENSES/MIT-JSONata.txt for details.

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

import isFunction from './isFunction.js';

const compileArgumentValidator = (() => {

  // A mapping between the function signature symbols and the full plural of the type
  // Expected to be used in error messages
  var arraySignatureMapping = {
    "a": "arrays",
    "b": "booleans",
    "f": "functions",
    "n": "numbers",
    "o": "objects",
    "s": "strings"
  };

  /**
     * Compiles argument declarations into a reusable runtime validator.
     * Values are checked/coerced only when validate(args, context) is called;
     * return declarations are intentionally ignored for legacy compatibility.
     * @param {string} signature - the signature between the <angle brackets>
     * @returns {{definition: string, validate: (args: any[], context: any) => any[]}} Runtime argument validator
     */
  function compileArgumentValidator(signature) {
    // Compile argument declarations; the returned validator checks values later.
    var position = 1;
    var params = [];
    var param = {};
    var prevParam = param;
    while (position < signature.length) {
      var symbol = signature.charAt(position);
      if (symbol === ':') {
        // Return annotations are not enforced by the legacy runtime validator.
        break;
      }

      var next = function () {
        params.push(param);
        prevParam = param;
        param = {};
      };

      var findClosingBracket = function (str, start, openSymbol, closeSymbol) {
        // returns the position of the closing symbol (e.g. bracket) in a string
        // that balances the opening symbol at position start
        var depth = 1;
        var position = start;
        while (position < str.length) {
          position++;
          symbol = str.charAt(position);
          if (symbol === closeSymbol) {
            depth--;
            if (depth === 0) {
              // we're done
              break; // out of while loop
            }
          } else if (symbol === openSymbol) {
            depth++;
          }
        }
        return position;
      };

      switch (symbol) {
        case 's': // string
        case 'n': // number
        case 'b': // boolean
        case 'l': // not so sure about expecting null?
        case 'o': // object
          param.regex = '[' + symbol + 'm]';
          param.type = symbol;
          next();
          break;
        case 'a': // array
          //  normally treat any value as singleton array
          param.regex = '[asnblfom]';
          param.type = symbol;
          param.array = true;
          next();
          break;
        case 'f': // function
          param.regex = 'f';
          param.type = symbol;
          next();
          break;
        case 'j': // any JSON type
          param.regex = '[asnblom]';
          param.type = symbol;
          next();
          break;
        case 'x': // any type
          param.regex = '[asnblfom]';
          param.type = symbol;
          next();
          break;
        case '-': // use context if param not supplied
          prevParam.context = true;
          prevParam.contextRegex = new RegExp(prevParam.regex); // pre-compiled to test the context type at runtime
          prevParam.regex += '?';
          break;
        case '?': // optional param
        case '+': // one or more
          prevParam.regex += symbol;
          break;
        case '(': // choice of types
          // search forward for matching ')'
          var endParen = findClosingBracket(signature, position, '(', ')');
          var choice = signature.substring(position + 1, endParen);
          if (choice.indexOf('<') === -1) {
            // no parameterized types, simple regex
            param.regex = '[' + choice + 'm]';
          } else {
            // TODO harder
            throw {
              code: "S0402",
              stack: (new Error()).stack,
              value: choice,
              offset: position
            };
          }
          param.type = '(' + choice + ')';
          position = endParen;
          next();
          break;
        case '<': // type parameter - can only be applied to 'a' and 'f'
          if (prevParam.type === 'a' || prevParam.type === 'f') {
            // search forward for matching '>'
            var endPos = findClosingBracket(signature, position, '<', '>');
            prevParam.subtype = signature.substring(position + 1, endPos);
            position = endPos;
          } else {
            throw {
              code: "S0401",
              stack: (new Error()).stack,
              value: prevParam.type,
              offset: position
            };
          }
          break;
      }
      position++;
    }
    var regexStr = '^' +
            params.map(function (param) {
              return '(' + param.regex + ')';
            }).join('') +
            '$';
    var regex = new RegExp(regexStr);
    var getSymbol = function (value) {
      var symbol;
      if (isFunction(value)) {
        symbol = 'f';
      } else {
        var type = typeof value;
        switch (type) {
          case 'string':
            symbol = 's';
            break;
          case 'number':
            symbol = 'n';
            break;
          case 'boolean':
            symbol = 'b';
            break;
          case 'object':
            if (value === null) {
              symbol = 'l';
            } else if (Array.isArray(value)) {
              symbol = 'a';
            } else {
              symbol = 'o';
            }
            break;
          case 'undefined':
          default:
            // any value can be undefined, but should be allowed to match
            symbol = 'm'; // m for missing
        }
      }
      return symbol;
    };

    var throwValidationError = function (badArgs, badSig) {
      // to figure out where this went wrong we need apply each component of the
      // regex to each argument until we get to the one that fails to match
      var partialPattern = '^';
      var goodTo = 0;
      for (var index = 0; index < params.length; index++) {
        partialPattern += params[index].regex;
        var match = badSig.match(partialPattern);
        if (match === null) {
          // failed here
          throw {
            code: "T0410",
            stack: (new Error()).stack,
            value: badArgs[goodTo],
            index: goodTo + 1
          };
        }
        goodTo = match[0].length;
      }
      // if it got this far, it's probably because of extraneous arguments (we
      // haven't added the trailing '$' in the regex yet.
      throw {
        code: "T0410",
        stack: (new Error()).stack,
        value: badArgs[goodTo],
        index: goodTo + 1
      };
    };

    return {
      definition: signature,
      validate: function (args, context) {
        var suppliedSig = '';
        args.forEach(function (arg) {
          suppliedSig += getSymbol(arg);
        });
        var isValid = regex.exec(suppliedSig);
        if (isValid) {
          var validatedArgs = [];
          var argIndex = 0;
          params.forEach(function (param, index) {
            var arg = args[argIndex];
            var match = isValid[index + 1];
            if (match === '') {
              if (param.context && param.contextRegex) {
                // substitute context value for missing arg
                // first check that the context value is the right type
                var contextType = getSymbol(context);
                // test contextType against the regex for this arg (without the trailing ?)
                if (param.contextRegex.test(contextType)) {
                  validatedArgs.push(context);
                } else {
                  // context value not compatible with this argument
                  throw {
                    code: "T0411",
                    stack: (new Error()).stack,
                    value: context,
                    index: argIndex + 1
                  };
                }
              } else {
                validatedArgs.push(arg);
                argIndex++;
              }
            } else {
              // may have matched multiple args (if the regex ends with a '+'
              // split into single tokens
              match.split('').forEach(function (single) {
                if (param.type === 'a') {
                  if (single === 'm') {
                    // missing (undefined)
                    arg = undefined;
                  } else {
                    arg = args[argIndex];
                    var arrayOK = true;
                    // is there type information on the contents of the array?
                    if (typeof param.subtype !== 'undefined') {
                      if (single !== 'a' && match !== param.subtype) {
                        arrayOK = false;
                      } else if (single === 'a') {
                        if (arg.length > 0) {
                          var itemType = getSymbol(arg[0]);
                          if (itemType !== param.subtype.charAt(0)) { // TODO recurse further
                            arrayOK = false;
                          } else {
                            // make sure every item in the array is this type
                            var differentItems = arg.filter(function (val) {
                              return (getSymbol(val) !== itemType);
                            });
                            arrayOK = (differentItems.length === 0);
                          }
                        }
                      }
                    }
                    if (!arrayOK) {
                      throw {
                        code: "T0412",
                        stack: (new Error()).stack,
                        value: arg,
                        index: argIndex + 1,
                        type: arraySignatureMapping[param.subtype]
                      };
                    }
                    // the function expects an array. If it's not one, make it so
                    if (single !== 'a') {
                      arg = [arg];
                    }
                  }
                  validatedArgs.push(arg);
                  argIndex++;
                } else {
                  validatedArgs.push(arg);
                  argIndex++;
                }
              });
            }
          });
          return validatedArgs;
        }
        throwValidationError(args, suppliedSig);
      }
    };
  }

  return compileArgumentValidator;
})();

export default compileArgumentValidator;

/**
 * Parses and validates the full signature declaration into structural metadata.
 * Never examines evaluation values or enforces declared return types; also
 * checks compatibility with the legacy argument-validator compiler.
 * @param {string} source
 * @returns {Object}
 */
export function parseSignatureStructure(source) {
  let position = 0;
  let hasFunctionType = false;
  const fail = (code = 'S0201') => { throw { code, token: source?.[position], value: source, offset: position }; };
  const consume = symbol => {
    if (source[position] !== symbol) fail();
    position++;
  };
  /**
   * @param {boolean} allowModifiers
   * @param {boolean} [isReturn]
   */
  function descriptor(allowModifiers, isReturn = false) {
    const type = source[position++];
    if (!type || (!'snbolafjx'.includes(type) && !(isReturn && type === 'u'))) fail();
    const result = { type, optional: false, contextDefault: false, repeated: false };
    if (type === 'f') hasFunctionType = true;
    if (source[position] === '<') {
      if (type !== 'a' && type !== 'f') fail('S0401');
      position++;
      if (type === 'f') {
        result.subtype = signatureBody();
      } else {
        result.subtype = readType(false);
        consume('>');
      }
    }
    if (allowModifiers && '?-+'.includes(source[position] || '\0')) {
      const modifier = source[position++];
      result.optional = modifier === '?';
      result.contextDefault = modifier === '-';
      result.repeated = modifier === '+';
    }
    return result;
  }
  /**
   * @param {boolean} allowModifiers
   * @param {boolean} [isReturn]
   */
  function readType(allowModifiers, isReturn = false) {
    if (source[position] !== '(') return descriptor(allowModifiers, isReturn);
    position++;
    const start = position;
    const choice = [];
    while (position < source.length && source[position] !== ')') choice.push(readType(false));
    if (source.slice(start, position).includes('<')) fail('S0402');
    if (choice.length === 0) fail();
    consume(')');
    const result = { type: 'choice', choice, optional: false, contextDefault: false, repeated: false };
    if (allowModifiers && '?-+'.includes(source[position] || '\0')) {
      const modifier = source[position++];
      result.optional = modifier === '?';
      result.contextDefault = modifier === '-';
      result.repeated = modifier === '+';
    }
    return result;
  }
  /** @returns {Object} */
  function signatureBody() {
    const args = [];
    while (position < source.length && source[position] !== ':' && source[position] !== '>') args.push(readType(true));
    let returnType;
    if (source[position] === ':') {
      position++;
      returnType = readType(false, true);
    }
    consume('>');
    return { arguments: args, returnType };
  }
  if (typeof source !== 'string') fail();
  consume('<');
  const result = signatureBody();
  if (position !== source.length) fail();
  compileArgumentValidator(source);
  return { ...result, hasFunctionType };
}
