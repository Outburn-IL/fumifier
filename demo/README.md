# Browser Entry Point Examples

This directory contains examples of using the Fumifier browser entry point.

## Files

- `browser-demo.html` - Interactive web demo showing all browser capabilities
- `simple-example.html` - Minimal example for getting started
- `syntax-highlighter.html` - Example of building a syntax highlighter

## Quick Start

Run all demos with a single command:

```bash
npm run browser-demo
```

This will:
1. Build the project (`npm run build`)
2. Start a local server on port 8080
3. Display clickable links to all demos

## Running the Examples

### Recommended: Use npm script
```bash
npm run browser-demo
```

### Manual Setup
1. Build the project: `npm run build`
2. Start a local server:
   - **Node.js**: `npx serve . -p 8080` (install with `npm install -g serve`)
   - **Alternative**: Any static file server like Live Server VS Code extension
3. Open the server URL (shown in terminal) + `/demo/[example].html`
   - Usually: http://localhost:8080/demo/browser-demo.html
   - If port 8080 is in use, serve will automatically pick another port

### Using with Node.js
```javascript
import { parse, validate, tokenize } from 'fumifier/browser';

const ast = parse('name.first & " " & name.family');
console.log(ast);
```

## Features Demonstrated

- Real-time FUME expression parsing
- Error validation and recovery with detailed error codes
- Token extraction for syntax highlighting
- FLASH syntax recognition and parsing
- JSONata-compatible expression support
- TypeScript support with comprehensive type definitions