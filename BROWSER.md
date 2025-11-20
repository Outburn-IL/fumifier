# Fumifier Browser Entry Point

This document describes the browser-friendly entry point for Fumifier that provides lightweight syntax parsing capabilities without Node.js-specific dependencies.

## Overview

The browser entry point (`fumifier/browser`) exposes the core parsing functionality of Fumifier in a form that can be used in browsers, web workers, and other JavaScript environments where Node.js APIs are not available.

## Features

### ✅ What's Included

- **Syntax Parsing**: Full tokenization and AST generation for FUME expressions
- **Validation**: Real-time syntax error detection and reporting
- **Tokenization**: Token extraction suitable for syntax highlighting
- **FLASH Syntax**: Basic FLASH (FHIR Shorthand) syntax recognition
- **Error Recovery**: Continue parsing despite syntax errors
- **Universal Compatibility**: Works in browsers, Node.js, web workers, and other ES6+ environments

### ❌ What's NOT Included

- **Expression Evaluation**: No runtime evaluation of expressions
- **FHIR Structure Navigation**: No FHIR definition resolution or validation
- **AST Caching**: No persistent caching mechanisms
- **Node.js Dependencies**: No filesystem access or Node.js-specific APIs

## Installation

```bash
npm install fumifier
```

## Usage

### ES6 Modules

```javascript
import { parse, validate, tokenize } from 'fumifier/browser';

// Basic parsing
const ast = parse('name.first & " " & name.family');
console.log(ast.type); // 'binary'

// Validation
const result = validate('name.first &');
console.log(result.isValid); // false
console.log(result.errors); // Array of error objects

// Tokenization for syntax highlighting
const tokens = tokenize('$patient.name[0].given');
tokens.forEach(token => {
    console.log(`${token.type}: ${token.value} (${token.start}-${token.end})`);
});
```

### CommonJS

```javascript
const fumifier = require('fumifier/browser');

// Use the default export for CommonJS
const { parse, validate, tokenize } = fumifier.default;

const ast = parse('name.first');
console.log(ast);
```

### Browser Script Tag

```html
<!DOCTYPE html>
<html>
<head>
    <script type="module">
        import fumifier from './node_modules/fumifier/dist/browser.mjs';
        
        const ast = fumifier.parse('name.first');
        console.log(ast);
    </script>
</head>
</html>
```

## API Reference

### `parse(expression, recover?)`

Parse a FUME expression into an Abstract Syntax Tree (AST).

**Parameters:**
- `expression` (string): The FUME expression to parse
- `recover` (boolean, optional): Whether to attempt error recovery (default: false)

**Returns:** AST object with syntax structure

**Throws:** Syntax errors when `recover=false`

```javascript
// Basic usage
const ast = parse('name.first & " " & name.family');

// With error recovery
const astWithErrors = parse('name.first &', true);
if (astWithErrors.errors) {
    console.log('Parse errors:', astWithErrors.errors);
}
```

### `validate(expression)`

Validate a FUME expression for syntax correctness.

**Parameters:**
- `expression` (string): The FUME expression to validate

**Returns:** Validation result object with `isValid` flag and `errors` array

```javascript
const result = validate('name.first & " " & name.family');
console.log(result.isValid); // true
console.log(result.errors);  // []

const invalid = validate('name.first &');
console.log(invalid.isValid); // false
console.log(invalid.errors);  // [{ code: 'S0203', message: '...' }]
```

### `tokenize(expression)`

Extract token information from an expression for syntax highlighting.

**Parameters:**
- `expression` (string): The FUME expression to tokenize

**Returns:** Array of token objects with type, value, and position information

```javascript
const tokens = tokenize('name.first');
// Returns: [
//   { type: 'name', value: 'name', start: 0, end: 4, line: 1 },
//   { type: 'operator', value: '.', start: 4, end: 5, line: 1 },
//   { type: 'name', value: 'first', start: 5, end: 10, line: 1 }
// ]
```

### `parser(source, recover?)`

Low-level parser function for advanced usage.

**Parameters:**
- `source` (string): Source expression to parse
- `recover` (boolean, optional): Whether to use recovery mode

**Returns:** Parsed AST

## FLASH Syntax Support

The browser entry point provides basic FLASH syntax recognition:

```javascript
const flashAst = parse(`
InstanceOf: Patient
* name.given = "John"
* name.family = "Doe"
`);

console.log(flashAst.containsFlash); // true
```

**Note:** Full FLASH processing (including FHIR structure validation) requires the complete Fumifier package with a FHIR Structure Navigator.

## Error Handling

### Syntax Errors

```javascript
try {
    const ast = parse('invalid syntax here');
} catch (error) {
    console.log(error.code);     // Error code (e.g., 'S0201')
    console.log(error.message);  // Human-readable message
    console.log(error.position); // Character position in source
    console.log(error.line);     // Line number
}
```

### Recovery Mode

```javascript
const result = parse('name.first &', true);
if (result.errors && result.errors.length > 0) {
    result.errors.forEach(error => {
        console.log(`${error.code}: ${error.message}`);
    });
}
```

## Browser Compatibility

- **Modern Browsers**: Chrome 61+, Firefox 60+, Safari 10.1+, Edge 16+
- **Node.js**: 14.0+
- **ES6 Modules**: Required (uses `import`/`export`)

## Use Cases

### Syntax Highlighting

```javascript
function highlightFume(expression) {
    const tokens = tokenize(expression);
    return tokens.map(token => 
        `<span class="token-${token.type}">${token.value}</span>`
    ).join('');
}
```

### Real-time Validation

```javascript
function validateInput(inputElement) {
    const result = validate(inputElement.value);
    inputElement.classList.toggle('invalid', !result.isValid);
    
    if (!result.isValid) {
        showErrors(result.errors);
    }
}
```

### Interactive Debugging

```javascript
function analyzeExpression(expression) {
    const ast = parse(expression, true);
    const tokens = tokenize(expression);
    const validation = validate(expression);
    
    return {
        ast,
        tokens,
        validation,
        hasFlash: ast.containsFlash || false
    };
}
```

## Migration from Full Fumifier

If you're currently using the full Fumifier package and want to switch to the browser entry point for parsing-only functionality:

### Before (full Fumifier)
```javascript
import fumifier from 'fumifier';

const compiled = fumifier('name.first');
const result = await compiled.evaluate(data);
```

### After (browser entry point)
```javascript
import { parse } from 'fumifier/browser';

const ast = parse('name.first');
// Note: No evaluation capabilities in browser entry point
```

## Performance

The browser entry point is significantly smaller than the full Fumifier package:

- **Full Fumifier**: ~341KB (includes evaluation, FHIR navigation, etc.)
- **Browser Entry Point**: ~103KB (parsing and validation only)

## License

Same as the main Fumifier package - see LICENSE file.