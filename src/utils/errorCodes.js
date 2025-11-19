/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

This file includes and modifies code from JSONata (https://github.com/jsonata-js/jsonata).
JSONata portions: © IBM Corp. 2016–2018, licensed under the MIT License.
See NOTICE and LICENSES/MIT-JSONata.txt for details.

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

/**
     * Error codes
     *
      * FHIR related parse warnings:
      * ============================
      * F0xxx    - FLASH/FUME parsing warnings
      *
      * Always fatal (level 0):
      * =======================
      * Sxxxx    - Static errors (compile time)
      * Txxxx    - Type errors
      * Dxxxx    - Dynamic errors (evaluate time)
      *  01xx    - tokenizer
      *  02xx    - parser
      *  03xx    - regex parser
      *  04xx    - function signature parser/evaluator
      *  10xx    - evaluator
      *  20xx    - operators
      *  3xxx    - functions (blocks of 10 for each function)
      * F1xxx    - FLASH/FUME syntactic errors
      * F2xxx    - FLASH semantic parsing errors
      * F3xxx    - FLASH evaluation errors (unrecoverable)

      * F5xxx    - FLASH evaluation errors (recoverable):
      *   (level 1x) Treated as fatal by default:
      *   ======================================
      *   10x    - FHIR Type errors (not fixable)
      *   11x    - FHIR RegEx errors (not fixable)
      *   12x    - FHIR Required Binding violation errors
      *   13x    - FHIR Element Cardinality errors
      *   14x    - FHIR Slice Cardinality errors
      *
      *   (level 2x) Treated as errors by default:
      *   ================================
      *   20x    - FHIR Server general errors
      *   21x    - FHIR Server resource resolution errors
      *   22x    - HTTP errors
      *
      *   (level 3x) Treated as warnings by default:
      *   ================================
      *   30x    - Code translation errors
      *   31x    - FHIR Required ValueSet expansion errors
      *   32x    - User raised warnings
      *   33x    - FHIR Extensible ValueSet expansion errors
      *   34x    - FHIR Extensible binding violation warnings
      *
      *   Treated as notice/info/debug by default:
      *   ============================================
      *   40x    - Cardinality auto correction notices
      *   41x    - Type auto correction notices
      *   42x    - Auto-value override notices
      *   50x    - User raised informational log messages
      *   60x    - User trace/debug messages
     */

/**
  * Error severity levels - used to define thresholds for failing and validation skipping
  * =====================================================================================
  * {
      fatal: 0,
      invalid: 10,
      error: 20,
      warning: 30,
      notice: 40,
      info: 50,
      debug: 60
    }
*/

const errorCodes = {
  "S0101": "String literal must be terminated by a matching quote",
  "S0102": "Number out of range: {{token}}",
  "S0103": "Unsupported escape sequence: \\{{token}}",
  "S0104": "The escape sequence \\u must be followed by 4 hex digits",
  "S0105": "Quoted property name must be terminated with a backquote (`)",
  "S0106": "Comment has no closing tag",
  "S0201": "Syntax error: {{token}}",
  "S0202": "Expected {{value}}, got {{token}}",
  "S0203": "Expected {{value}} before end of expression",
  "S0204": "Unknown operator: {{token}}",
  "S0205": "Unexpected token: {{token}}",
  "S0206": "Unknown expression type: {{token}}",
  "S0207": "Unexpected end of expression",
  "S0208": "Parameter {{value}} of function definition must be a variable name (start with $)",
  "S0209": "A predicate cannot follow a grouping expression in a step",
  "S0210": "Each step can only have one grouping expression",
  "S0211": "Syntax error: symbol {{token}} used in a place where it is not allowed",
  "S0212": "The left side of := must be a variable name (start with $)",
  "S0213": "The literal value {{value}} cannot be used as a step within a path expression",
  "S0214": "The right side of {{token}} must be a variable name (start with $)",
  "S0215": "A context variable binding must precede any predicates on a step",
  "S0216": "A context variable binding must precede the 'order-by' clause on a step",
  "S0217": "The object representing the 'parent' cannot be derived from this expression",
  "S0301": "Empty regular expressions are not allowed",
  "S0302": "No terminating / in regular expression",
  "S0402": "Choice groups containing parameterized types are not supported",
  "S0401": "Type parameters can only be applied to functions and arrays",
  "S0500": "Attempted to evaluate an expression containing syntax error(s)",
  "T0410": "Argument {{index}} of function {{token}} does not match function signature",
  "T0411": "Context value is not a compatible type with argument {{index}} of function {{token}}",
  "T0412": "Argument {{index}} of function {{token}} must be an array of {{type}}",
  "D1001": "Number out of range: {{value}}",
  "D1002": "Cannot negate a non-numeric value: {{value}}",
  "T1003": "Key in object structure must evaluate to a string; got: {{value}}",
  "D1004": "Regular expression matches zero length string",
  "T1005": "Attempted to invoke a non-function. Did you mean ${{{token}}}?",
  "T1006": "Attempted to invoke a non-function",
  "T1007": "Attempted to partially apply a non-function. Did you mean ${{{token}}}?",
  "T1008": "Attempted to partially apply a non-function",
  "D1009": "Multiple key definitions evaluate to same key: {{value}}",
  "D1010": "Attempted to access the Javascript object prototype", // Javascript specific
  "T1010": "The matcher function argument passed to function {{token}} does not return the correct object structure",
  "T2001": "The left side of the {{token}} operator must evaluate to a number",
  "T2002": "The right side of the {{token}} operator must evaluate to a number",
  "T2003": "The left side of the range operator (..) must evaluate to an integer",
  "T2004": "The right side of the range operator (..) must evaluate to an integer",
  "D2005": "The left side of := must be a variable name (start with $)",  // defunct - replaced by S0212 parser error
  "T2006": "The right side of the function application operator ~> must be a function",
  "T2007": "Type mismatch when comparing values {{value}} and {{value2}} in order-by clause",
  "T2008": "The expressions within an order-by clause must evaluate to numeric or string values",
  "T2009": "The values {{value}} and {{value2}} either side of operator {{token}} must be of the same data type",
  "T2010": "The expressions either side of operator {{token}} must evaluate to numeric or string values",
  "T2011": "The insert/update clause of the transform expression must evaluate to an object: {{value}}",
  "T2012": "The delete clause of the transform expression must evaluate to a string or array of strings: {{value}}",
  "T2013": "The transform expression clones the input object using the $clone() function.  This has been overridden in the current scope by a non-function.",
  "D2014": "The size of the sequence allocated by the range operator (..) must not exceed 1e6.  Attempted to allocate {{value}}.",
  "D3001": "Attempting to invoke string function on Infinity or NaN",
  "D3010": "Second argument of replace function cannot be an empty string",
  "D3011": "Fourth argument of replace function must evaluate to a positive number",
  "D3012": "Attempted to replace a matched string with a non-string value",
  "D3020": "Third argument of split function must evaluate to a positive number",
  "D3030": "Unable to cast value to a number: {{value}}",
  "D3040": "Third argument of match function must evaluate to a positive number",
  "D3050": "The second argument of reduce function must be a function with at least two arguments",
  "D3060": "The sqrt function cannot be applied to a negative number: {{value}}",
  "D3061": "The power function has resulted in a value that cannot be represented as a JSON number: base={{value}}, exponent={{exp}}",
  "D3070": "The single argument form of the sort function can only be applied to an array of strings or an array of numbers.  Use the second argument to specify a comparison function",
  "D3080": "The picture string must only contain a maximum of two sub-pictures",
  "D3081": "The sub-picture must not contain more than one instance of the 'decimal-separator' character",
  "D3082": "The sub-picture must not contain more than one instance of the 'percent' character",
  "D3083": "The sub-picture must not contain more than one instance of the 'per-mille' character",
  "D3084": "The sub-picture must not contain both a 'percent' and a 'per-mille' character",
  "D3085": "The mantissa part of a sub-picture must contain at least one character that is either an 'optional digit character' or a member of the 'decimal digit family'",
  "D3086": "The sub-picture must not contain a passive character that is preceded by an active character and that is followed by another active character",
  "D3087": "The sub-picture must not contain a 'grouping-separator' character that appears adjacent to a 'decimal-separator' character",
  "D3088": "The sub-picture must not contain a 'grouping-separator' at the end of the integer part",
  "D3089": "The sub-picture must not contain two adjacent instances of the 'grouping-separator' character",
  "D3090": "The integer part of the sub-picture must not contain a member of the 'decimal digit family' that is followed by an instance of the 'optional digit character'",
  "D3091": "The fractional part of the sub-picture must not contain an instance of the 'optional digit character' that is followed by a member of the 'decimal digit family'",
  "D3092": "A sub-picture that contains a 'percent' or 'per-mille' character must not contain a character treated as an 'exponent-separator'",
  "D3093": "The exponent part of the sub-picture must comprise only of one or more characters that are members of the 'decimal digit family'",
  "D3100": "The radix of the formatBase function must be between 2 and 36.  It was given {{value}}",
  "D3110": "The argument of the toMillis function must be an ISO 8601 formatted timestamp. Given {{value}}",
  "D3120": "Syntax error in expression passed to function eval: {{value}}",
  "D3121": "Dynamic error evaluating the expression passed to function eval: {{value}}",
  "D3130": "Formatting or parsing an integer as a sequence starting with {{value}} is not supported by this implementation",
  "D3131": "In a decimal digit pattern, all digits must be from the same decimal group",
  "D3132": "Unknown component specifier {{value}} in date/time picture string",
  "D3133": "The 'name' modifier can only be applied to months and days in the date/time picture string, not {{value}}",
  "D3134": "The timezone integer format specifier cannot have more than four digits",
  "D3135": "No matching closing bracket ']' in date/time picture string",
  "D3136": "The date/time picture string is missing specifiers required to parse the timestamp",
  "D3137": "{{{message}}}",
  "D3138": "The $single() function expected exactly 1 matching result.  Instead it matched more.",
  "D3139": "The $single() function expected exactly 1 matching result.  Instead it matched 0.",
  "D3140": "Malformed URL passed to ${{{functionName}}}(): {{value}}",
  "D3141": "{{{message}}}",
  "F0001": "Failed to extract root FHIR package context. This may hinder AST mobility. FHIR Package Explorer < v1.5.0 doesn't support this operation.",
  "F1000": "FLASH blocks are present in the expression, but no FHIR Structure Navigator was provided. Cannot process FHIR conformance.",
  "F1003": "Invalid FHIR type/profile identifier after `InstanceOf:`",
  "F1004": "Duplicate `Instance:` declaration",
  "F1005": "Duplicate `InstanceOf:` declaration",
  "F1006": "Malformed FLASH rule",
  "F1007": "Missing `InstanceOf:` declaration",
  "F1008": "An `InstanceOf:` declaration must be the first in an expression block unless it is preceded by `Instance:`",
  "F1009": "An `Instance:` declaration must be immediately followed by `InstanceOf:`",
  "F1010": "`Instance:` declaration must come BEFORE `InstanceOf:`",
  "F1011": "A FLASH block can only contain FLASH rules (lines starting with `*`) or variable assignments ($v := value)",
  "F1012": "Malformed FLASH rule: missing expression after `=`",
  "F1013": "An `InstanceOf:` declaration following `Instance:` must start on a new line",
  "F1014": "`InstanceOf:` must have the same indentation as `Instance:` ({{{token}}}). Instead got {{{value}}}",
  "F1015": "Expected indentation of {{{token}}}. Instead found {{{value}}}",
  "F1016": "Indentation in this FLASH block cannot be lower than {{{token}}}. Instead found {{{value}}}",
  "F1017": "Indentation here cannot be greater than {{{token}}}. Instead found {{{value}}}",
  "F1018": "Expected an expression after the `Instance:` keyword. Instead found {{{value}}}",
  "F1019": "Expected a FHIR type/profile identifier after the `InstanceOf:` keyword.",
  "F1020": "The `:=` operator is used to bind values to variable names (starting with $). Did you mean `=`?",
  "F1021": "Indentation in FLASH blocks must be in increments of 2 spaces. Found {{{value}}}",
  "F1022": "Malformed FLASH rule: Duplicate `*` operator",
  "F1023": "Malformed FLASH rule: The path after the '*' cannot start with '$'. If you wanted to assign a variable, omit the * from the beginning of the line",
  "F1024": "Malformed FLASH rule: Rule is empty",
  "F1025": "Malformed variable assignment. Did you mean ':='?",
  "F1026": "Value of `InstanceOf:` must be a valid FHIR type/profile identifier. Found: {{{value}}}",
  "F1027": "Illegal slice name in FALSH path. Got: {{token}}",
  "F1028": "FLASH path segments must be on the same line. You may use indented rules (starting with '*') to continue the path on the next line.",
  "F1029": "Each FLASH path segment must be a simple alpha-numeric name. Got: {{token}}",
  "F1030": "FLASH path is invalid. Token {{token}} is unexpected here.",
  "F1100": "This closing {{token}} is not matched by an opening {{matchingOpening}}",
  "F1101": "Missing expression after {{token}}. Objects must contain only key-value pairs",
  "F1102": "Looks like you have an extra {{token}} at the beginning of the object.",
  "F1103": "The symbol \";\" is only valid inside parenthesis blocks (between \"(\" and \")\") and is used to separate expressions.",
  "F1104": "This key is not followed by a \":\" and is missing a value. Objects must contain only key-value pairs",
  "F1105": "Looks like you have an extra {{token}} at the end of the object.",
  "F1106": "Looks like a comma \",\" is missing here, to separate the values in the array.",
  "F1107": "Duplicate parent operator (\"%\").",
  "F1108": "Looks like you have an extra {{token}} at the end of the array.",
  "F1109": "The \":\" symbol is only valid in objects ({ key : value }), but this is an array. Did you mean \",\"?",
  "F1110": "Duplicate comma ({{token}})",
  "F2001": "Could not find a FHIR type/profile definition with identifier {{value}}",
  "F2002": "Invalid element path: element \"{{{value}}}\" was not found in {{fhirType}}",
  "F2003": "Failed to fetch definition of children for {{value}} in {{fhirType}}.",
  "F2004": "{{value}} in {{fhirType}} is a choice type element. Please select a type using one of: {{{allowedNames}}}.",
  "F2006": "Failed to fetch definition of children for {{fhirType}}.",
  "F2007": "Element definition for {{value}} in {{fhirType}} has no type defined.",
  "F2008": "Failed to fetch definition of children for mandatory element {{value}} in {{fhirType}}.",
  "F3000": "This FLASH rule is not attached to an ElementDefinition. This compiled FUME expression may be corrupted and needs to be parsed again.",
  "F5110": "The value {{value}} is invalid for FHIR element {{fhirElement}} (type: {{fhirType}}) in {{instanceOf}}. The value must match the regular expression: {{{regex}}}",
  "F5111": "The value {{value}} is invalid for FHIR element {{fhirElement}} (type: {{fhirType}}) in {{instanceOf}}. The value must be a valid calendar date/dateTime.",
  "F5112": "The value {{value}} is invalid for FHIR element {{fhirElement}} (type: {{fhirType}}) in {{instanceOf}}. Strings must contain at least one non-whitespace character and may only include TAB, LF, CR, or Unicode characters U+0020 and above (excluding U+0080..U+009F).",
  "F5113": "The value {{value}} is invalid for FHIR element {{fhirElement}} (type: {{fhirType}}) in {{instanceOf}}. Codes must have no leading/trailing whitespace, no consecutive spaces, and may only contain space (U+0020) or NBSP (U+00A0) as internal whitespace.",
  "F5114": "The value {{value}} is invalid for FHIR element {{fhirElement}} (type: {{fhirType}}) in {{instanceOf}}. String length ({{actualLength}}) exceeds maximum allowed length of {{maxLength}}.",
  "F5130": "The FHIR element {{fhirElement}} is required in {{fhirParent}}, but no value was provided.",
  "F3003": "Could not find ElementDefinition for {{fhirElement}} in {{instanceOf}}. This compiled FUME expression may be corrupted and needs to be parsed again.",
  "F3004": "Failed to determine the structural kind of {{fhirElement}} in {{instanceOf}}. This compiled FUME expression may be corrupted and needs to be parsed again.",
  "F3005": "Failed to determine the JSON element name of {{fhirElement}} in {{instanceOf}}. This compiled FUME expression may be corrupted and needs to be parsed again.",
  "F5101": "Value for {{fhirElement}} in {{instanceOf}} must be a primitive value, recieved type: {{valueType}}.",
  "F3007": "Failed to determine the data type of {{fhirElement}} in {{instanceOf}}. This compiled FUME expression may be corrupted and needs to be parsed again.",
  "F5131": "Element {{value}} is forbidden according to definition: {{fhirType}}.",
  "F5102": "Value for {{fhirElement}} in {{fhirParent}} must be a Resource object, received type: {{valueType}}.",
  "F5103": "Element {{fhirElement}} in {{fhirParent}} must be a Resource, but no \"resourceType\" attribute was found in the assigned object.",
  "F5104": "Value for {{fhirElement}} in {{fhirParent}} must be a complex object, received primitive type: {{valueType}}.",
  "F5140": "Missing required slice {{sliceName}} under {{fhirElement}} in {{fhirParent}}.",
  // ValueSet binding & expansion (primitives, Coding, Quantity, CodeableConcept)
  // Required binding violations (fatal by default)
  "F5120": "Value {{value}} for {{fhirElement}} in {{instanceOf}} is not in the required ValueSet.",
  "F5121": "Coding (system={{system}}, code={{code}}) for {{fhirElement}} in {{instanceOf}} is not in the required ValueSet.",
  "F5122": "Quantity unit code (system={{system}}, code={{code}}) for {{fhirElement}} in {{instanceOf}} is not in the required ValueSet.",
  "F5123": "CodeableConcept.coding does not contain a Coding from the required ValueSet ({{codingCount}} provided) for {{fhirElement}} in {{instanceOf}}.",
  // Required ValueSet expansion errors (warnings by default)
  "F5310": "Failed to expand required ValueSet for {{fhirElement}} in {{instanceOf}} ({{elementType}} binding).",
  "F5311": "Lazy expansion not implemented for required ValueSet for {{fhirElement}} in {{instanceOf}} ({{elementType}} binding).",
  // Extensible ValueSet expansion errors (warnings by default) consolidated
  "F5330": "Failed to expand extensible ValueSet for {{fhirElement}} in {{instanceOf}} ({{elementType}} binding).",
  "F5331": "Lazy expansion not implemented for extensible ValueSet for {{fhirElement}} in {{instanceOf}} ({{elementType}} binding).",
  // Extensible binding violations (warnings by default)
  "F5340": "Value {{value}} for {{fhirElement}} in {{instanceOf}} is not in the extensible ValueSet.",
  "F5341": "Coding (system={{system}}, code={{code}}) for {{fhirElement}} in {{instanceOf}} is not in the extensible ValueSet.",
  "F5342": "Quantity unit code (system={{system}}, code={{code}}) for {{fhirElement}} in {{instanceOf}} is not in the extensible ValueSet.",
  "F5343": "CodeableConcept.coding does not contain a Coding from the extensible ValueSet for {{fhirElement}} in {{instanceOf}}.",
  "F3013": "Failed to determine the children of {{fhirElement}} in {{instanceOf}}. This compiled FUME expression may be corrupted and needs to be parsed again.",
  "F3014": "Error generating UUID: {{{errorMessage}}}",
  "F3015": "Internal UUID generation requires a seed value that is a FHIR resource object with a resourceType field",
  "F5320": "{{{message}}}",
  "F5500": "{{{message}}}",
  "F5600": "{{{message}}}"
};

/**
 * lookup a message template from the catalog and substitute the inserts.
 * Populates `err.message` with the substituted message. Leaves `err.message`
 * untouched if code lookup fails.
 * @param {string} err - error code to lookup
 * @returns {undefined} - `err` is modified in place
 */
export function populateMessage(err) {
  var template = errorCodes[err.code];
  if(typeof template !== 'undefined') {
    // if there are any handlebars, replace them with the field references
    // triple braces - replace with value
    // double braces - replace with json stringified value
    var message = template.replace(/\{\{\{([^}]+)}}}/g, function() {
      return err[arguments[1]];
    });
    message = message.replace(/\{\{([^}]+)}}/g, function() {
      return JSON.stringify(err[arguments[1]]);
    });
    err.message = message;
  }
  // Otherwise retain the original `err.message`
}