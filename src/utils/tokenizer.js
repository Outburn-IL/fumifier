/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

This file includes and modifies code from JSONata (https://github.com/jsonata-js/jsonata).
JSONata portions: © IBM Corp. 2016–2018, licensed under the MIT License.
See NOTICE and LICENSES/MIT-JSONata.txt for details.

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

import escapes from './escapes.js';
import operators from './operators.js';

const numregex = /^-?(0|([1-9][0-9]*))(\.[0-9]+)?([Ee][-+]?[0-9]+)?/;

/**
 * Tokenizer (lexer, or scanner) - invoked by the parser to return one token at a time.
 * The tokens are simple and generally context-independent at this stage.
 * Very little validation is done here, most of the work will be done later by the parser.
 * Possible token types: name, value, operator, variable, number, string, regex
 * Special FUME token types: instanceof, url, indent, blockindent
 * - The `indent` token will only be created if it is followed by a flash declaration or rule. Its value is the indentation number
 * - The `instanceof` token will have the profile identifier as its value
 * @param {string} path The source string
 * @returns {Function} the function that returns the next token
 */
export default function (path) {
  var position = 0; // The char position in the source string (last character scanned)
  var start = 0; // The start position of the current token
  var length = path.length; // Overall length of the source string
  var lineStart = 0; // Keep track of the current line's start position
  var line = 1; // The current line number in the source, starting from 1
  var lineIndent = ''; // accumulating indentation characters of the current line
  var previousToken; // Keep track of previous token

  /**
     * Creates a token object with type, value, and position.
     * @param {string} type - The type of the token (e.g., 'operator', 'string', 'number', 'name').
     * @param {string|number|boolean|null} value - The value of the token.
     * @param {object} [extraProps] - Optional extra token properties.
     * @returns {object} A token object containing type, value, and the current position.
     */
  var create = function (type, value, extraProps) {
    var obj = {
      type,
      value,
      position,           // end position (as in the original JSONata tokenizer)
      start,              // start position (added for better error marking in FUME)
      line                // line number (added for clear error reporting in FUME)
    };
    if (extraProps) {
      Object.assign(obj, extraProps);
    }
    previousToken = obj;
    return obj;
  };

  var scanRegex = function (literalStart) {
    // the prefix '/' will have been previously scanned. Find the end of the regex.
    // search for closing '/' ignoring any that are escaped, or within brackets
    var patternStart = position;
    var depth = 0;

    var isClosingSlash = function (position) {
      if (path.charAt(position) === '/' && depth === 0) {
        var backslashCount = 0;
        while (path.charAt(position - (backslashCount + 1)) === '\\') {
          backslashCount++;
        }
        if (backslashCount % 2 === 0) {
          return true;
        }
      }
      return false;
    };

    while (position < length) {
      var currentChar = path.charAt(position);
      if (isClosingSlash(position)) {
        // end of regex found
        var pattern = path.substring(patternStart, position);
        position++;
        currentChar = path.charAt(position);
        // flags
        var flagsStart = position;
        while (currentChar === 'i' || currentChar === 'm') {
          position++;
          currentChar = path.charAt(position);
        }
        var rawFlags = path.substring(flagsStart, position);
        var compiledFlags = rawFlags + 'g';

        try {
          new RegExp(pattern, compiledFlags);
        } catch (err) {
          throw {
            code: 'S0303',
            stack: (new Error()).stack,
            position,
            start: literalStart,
            line,
            value: `/${pattern}/${rawFlags}`,
            sourceMessage: err.message
          };
        }

        return {
          value: pattern,
          flags: compiledFlags,
          start: literalStart
        };
      }
      if ((currentChar === '(' || currentChar === '[' || currentChar === '{') && path.charAt(position - 1) !== '\\') {
        depth++;
      }
      if ((currentChar === ')' || currentChar === ']' || currentChar === '}') && path.charAt(position - 1) !== '\\') {
        depth--;
      }

      position++;
    }
    throw {
      code: "S0302",
      stack: (new Error()).stack,
      position,
      start: literalStart,
      line
    };
  };

  /**
    * Check if the current non-whitespace character is the first one in the current line
    * @returns {boolean}
    */
  var firstInLine = function () {
    return lineIndent === path.substring(lineStart, position);
  };

  /**
     * Returns the indentation of the current line as a number.
     * The number is the sum of whitespace characters, where a space is counted once and tab twice
     */
  var indentNumber = function () {
    var i = 0;
    var sum = 0;
    while (i < lineIndent.length) {
      if (lineIndent.charAt(i) === ' ') sum += 1;
      if (lineIndent.charAt(i) === '\t') sum += 2;
      i++;
    }
    return sum;
  };

  /**
     * Advances to the next simple token and returns it.
     * This is entirely sequential - no nesting and operator precedence logic is done here
     * @param {boolean} hasLeftContext - True when the next token has something to its left.
     *      The only use for this flag currently is to tell the scanner how to treat the '/' operator.
     *      When the next token has left context, '/' is tokenized as the division operator.
     *      Otherwise '/' starts a regex literal and everything up to the next unescaped closing '/'
     *      is swallowed into a regex token.
     * @returns {object|null} The next token object or null if end of input.
     */
  var next = function (hasLeftContext) {
    if (position >= length) return null;
    var currentChar = path.charAt(position);
    // skip whitespace - but keep track of new lines and indentation
    while (position < length && ' \t\n\r\v'.indexOf(currentChar) > -1) {
      if (path.substring(position, position + 2) === '\r\n') {
        // Windows style newline (\r\n)
        position += 2;
        line ++;
        currentChar = path.charAt(position);
        lineStart = position;
        lineIndent = '';
      } else if ('\r\n'.indexOf(currentChar) > -1) {
        // POSIX (\n) or old pre-OS X Macs Style (\r)
        position ++;
        line ++;
        currentChar = path.charAt(position);
        lineStart = position;
        lineIndent = '';
      } else if (' \t'.indexOf(currentChar) > -1 && firstInLine()) {
        // indentation
        position ++;
        lineIndent += currentChar;
        currentChar = path.charAt(position);
      } else {
        // regular mid-line whitespace
        position ++;
        currentChar = path.charAt(position);
      }
    }
    start = position; // remember the start of the token
    // Handle indent tokenization
    // We create one for every newline that starts with one of the following:
    // - Instance:
    // - InstanceOf:
    // - * (flash rules)
    // - $ (assignment rules)
    // The last two are created only if we previously encountered one of the first two declarations,
    // since they are only significant inside flash blocks.
    if (
      position < length &&
                '*$'.indexOf(currentChar) > -1 && // flash rule or assignment
                firstInLine()
    ) {
      // If we got here, it means we need to create an indent token
      // But it may have already been created, so we need to check previous token
      if (typeof previousToken === 'undefined' || previousToken.type !== 'indent' || previousToken.position < lineStart) {
        return create('indent', indentNumber());
      }
    }
    if (
      (position + 9) <= length &&
                path.substring(position, position + 9) === 'Instance:' ||
                path.substring(position, position + 11) === 'InstanceOf:'
    ) {
      // If we got here, it means we need a block indent token,
      // But it may have already been created so we need to check previous token
      if (typeof previousToken === 'undefined' || previousToken.type !== 'blockindent' || previousToken.position < lineStart) {
        return create('blockindent', indentNumber());
      }
    }
    // skip comments (regular jsonata comments /* */)
    if (currentChar === '/' && path.charAt(position + 1) === '*') {
      position += 2;
      start = position; // remember the start of the comment
      currentChar = path.charAt(position);
      while (!(currentChar === '*' && path.charAt(position + 1) === '/')) {
        currentChar = path.charAt(++position);
        if (position >= length) {
          // no closing tag
          throw {
            code: "S0106",
            stack: (new Error()).stack,
            position,
            start,
            line
          };
        }
        if (path.substring(position, position + 2) === '\r\n') {
          // Windows style newline (\r\n)
          position += 2;
          line ++;
          currentChar = path.charAt(position);
          lineStart = position;
          lineIndent = '';
        } else if ('\r\n'.indexOf(currentChar) > -1) {
          // POSIX (\n) or old pre-OS X Macs Style (\r)
          position ++;
          line ++;
          currentChar = path.charAt(position);
          lineStart = position;
          lineIndent = '';
        }
      }
      position += 2;
      currentChar = path.charAt(position);
      return next(hasLeftContext); // need this to swallow any following whitespace
    }
    start = position; // remember the start of the token
    // FUME: capture URL's (including URN's)
    if (
      (
        path.substring(position, position + 7) === 'http://' ||
                    path.substring(position, position + 8) === 'https://' ||
                    path.substring(position, position + 4) === 'urn:'
                    // TODO: Check if other schemas are relevant (e.g. ftp://, mailto:, file: etc.)
      )
    ) {
      let url = path.substring(position, position += 4); // at least the 4 first chars have been confirmed to be part of the string
      while (position < length) {
        const ch = path.charAt(position);
        // swallow anything until encountering a structural delimiter or whitespace
        if (ch === ')' || ch === ']' || ch === '}' || ch === ',' || ch === ';' || /[\s]/.test(ch)) {
          break;
        }
        url += ch;
        position++;
      }
      return create('url', url);
    }

    // FUME: skip single line comments
    if (path.substring(position, position + 2) === '//') {
      position += 2;
      currentChar = path.charAt(position);
      while (!(currentChar === '\r' || currentChar === '\n' || position === length)) {
        currentChar = path.charAt(++position);
      }
      // currentChar = path.charAt(position);
      return next(hasLeftContext); // need this to swallow any following whitespace
    }
    start = position; // remember the start of the token
    // handle flash block declarations ("Instance:", "InstanceOf:" and "* " rules)
    var token;
    if (path.substring(position, position + 9) === 'Instance:') {
      position += 9;
      token = create('operator', 'Instance:');
      token.indent = indentNumber();
      return token;
    }
    if (path.substring(position, position + 11) === 'InstanceOf:') {
      position += 11;
      var profileId = '';
      while (position < length && ' \t\r\n'.indexOf(path.charAt(position)) > -1) {
        // skip any whitespace after the keyword
        position ++;
      }
      start = position; // remember the start of the profile identifier
      while (') \t\r\n'.indexOf(path.charAt(position)) === -1) {
        // swallow everything until the first whitespace or ')'
        profileId += path.charAt(position);
        position ++;
      }
      token = create('instanceof', profileId);
      token.indent = indentNumber();
      return token;
    }
    // test for regex
    if (hasLeftContext !== true && currentChar === '/') {
      var literalStart = position;
      position++;
      var regexToken = scanRegex(literalStart);
      return create('regex', regexToken.value, {
        flags: regexToken.flags,
        start: regexToken.start
      });
    }
    // handle double-char operators
    if (currentChar === '.' && path.charAt(position + 1) === '.') {
      // double-dot .. range operator
      position += 2;
      return create('operator', '..');
    }
    if (currentChar === ':' && path.charAt(position + 1) === '=') {
      // := assignment
      position += 2;
      return create('operator', ':=');
    }
    if (currentChar === '!' && path.charAt(position + 1) === '=') {
      // !=
      position += 2;
      return create('operator', '!=');
    }
    if (currentChar === '>' && path.charAt(position + 1) === '=') {
      // >=
      position += 2;
      return create('operator', '>=');
    }
    if (currentChar === '<' && path.charAt(position + 1) === '=') {
      // <=
      position += 2;
      return create('operator', '<=');
    }
    if (currentChar === '*' && path.charAt(position + 1) === '*') {
      // **  descendant wildcard
      position += 2;
      return create('operator', '**');
    }
    if (currentChar === '~' && path.charAt(position + 1) === '>') {
      // ~>  chain function
      position += 2;
      return create('operator', '~>');
    }
    if (currentChar === '?' && path.charAt(position + 1) === ':') {
      // ?: default / elvis operator
      position += 2;
      return create('operator', '?:');
    }
    if (currentChar === '?' && path.charAt(position + 1) === '?') {
      // ?? coalescing operator
      position += 2;
      return create('operator', '??');
    }
    // potential flash rules
    if (currentChar === '*' && firstInLine()) {
      position++;
      token = create('operator', currentChar);
      token.indent = indentNumber();
      return token;
    }
    // test for single char operators
    if (Object.prototype.hasOwnProperty.call(operators, currentChar)) {
      position++;
      return create('operator', currentChar);
    }
    // test for string literals
    if (currentChar === '"' || currentChar === "'") {
      var quoteType = currentChar;
      // double quoted string literal - find end of string
      position++;
      var qstr = "";
      while (position < length) {
        currentChar = path.charAt(position);
        if (currentChar === '\\') { // escape sequence
          position++;
          currentChar = path.charAt(position);
          if (Object.prototype.hasOwnProperty.call(escapes, currentChar)) {
            qstr += escapes[currentChar];
          } else if (currentChar === 'u') {
            // \u should be followed by 4 hex digits
            var octets = path.substr(position + 1, 4);
            if (/^[0-9a-fA-F]+$/.test(octets)) {
              var codepoint = parseInt(octets, 16);
              qstr += String.fromCharCode(codepoint);
              position += 4;
            } else {
              throw {
                code: "S0104",
                stack: (new Error()).stack,
                position,
                start,
                line
              };
            }
          } else {
            // illegal escape sequence
            throw {
              code: "S0103",
              stack: (new Error()).stack,
              position,
              start,
              line,
              token: currentChar
            };
          }
        } else if (currentChar === quoteType) {
          position++;
          return create('string', qstr);
        } else {
          qstr += currentChar;
        }
        position++;
      }
      throw {
        code: "S0101",
        stack: (new Error()).stack,
        position,
        start,
        line
      };
    }
    // test for numbers
    var match = numregex.exec(path.substring(position));
    if (match !== null) {
      var num = parseFloat(match[0]);
      if (!isNaN(num) && isFinite(num)) {
        position += match[0].length;
        return create('number', num);
      } else {
        throw {
          code: "S0102",
          stack: (new Error()).stack,
          position,
          start,
          line,
          token: match[0]
        };
      }
    }
    // test for quoted names (backticks)
    var name;
    if (currentChar === '`') {
      // scan for closing quote
      position++;
      var end = path.indexOf('`', position);
      if (end !== -1) {
        name = path.substring(position, end);
        position = end + 1;
        return create('name', name);
      }
      position = length;
      throw {
        code: "S0105",
        stack: (new Error()).stack,
        position,
        start,
        line
      };
    }
    // test for names
    var i = position;
    var ch;
    for (; ;) {
      ch = path.charAt(i);
      if (i === length || ' \t\n\r\v'.indexOf(ch) > -1 || Object.prototype.hasOwnProperty.call(operators, ch)) {
        if (path.charAt(position) === '$') {
          // variable reference
          var indent;
          if (firstInLine()) indent = indentNumber();
          name = path.substring(position + 1, i);
          position = i;
          token = create('variable', name);
          if (indent && indent >= 0) token.indent = indent;
          return token;
        } else {
          name = path.substring(position, i);
          position = i;
          switch (name) {
            case 'or':
            case 'in':
            case 'and':
              return create('operator', name);
            case 'true':
              return create('value', true);
            case 'false':
              return create('value', false);
            case 'null':
              return create('value', null);
            default:
              if (position === length && name === '') {
                // whitespace at end of input
                return null;
              }
              return create('name', name);
          }
        }
      } else {
        i++;
      }
    }
  };

  let peeked = null;

  /**
   * Originaly this module exported next(), but now it returns a wrapped version of next()
   * that checks for a peeked token first, and returns it if available.
   * @param {*} prefix see `next()` for details
   * @returns {object} the next token, or the peeked token if available
   */
  function wrappedNext(prefix) {
    if (peeked !== null) {
      const t = peeked;
      peeked = null;
      return t;
    }
    return next(prefix);
  }

  /**
   * To allow context aware parsing, we need to be able to look ahead
   * without consuming the token. This function will return the next token
   * without consuming it, so that it can be used later.
   * @param {*} hasLeftContext see `next()` for details
   * @returns {object} the next token, or the peeked token if available
   */
  function peek(hasLeftContext) {
    if (peeked === null) {
      peeked = next(hasLeftContext);
    }
    return peeked;
  }

  return {
    next: wrappedNext,
    peek
  };

}
