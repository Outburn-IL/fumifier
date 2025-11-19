TODO: This is a first draft of README.md and needs some adjustments/improvents/cleanup

# Fumifier

> Core FLASH DSL engine for FUME – parses, compiles & executes FHIR‑aware transformation logic over JSON data.

---
## Table of Contents
1. What is Fumifier?
2. Feature Highlights
3. When to Use
4. Installation
5. Quick Start
6. FLASH DSL Overview (Very Brief)
7. FHIR Integration & Structure Navigation
8. Diagnostics, Threshold Policy & Verbose Mode
9. API Reference
10. Custom Functions & Logging
11. TypeScript Support
12. CLI / REPL (future)
13. Performance Notes
14. Cached Parsing
15. Roadmap
16. Contributing
17. Versioning & Release Process
18. License & Attribution
19. Acknowledgements

---
## 1. What is Fumifier?
Fumifier is the executable core of the **FLASH DSL** used in the broader **FUME** toolkit. It allows authors to express rich transformation, mapping, projection and validation logic over JSON (especially FHIR® resources) using a concise expression language inspired by FHIR Shorthand (FSH) and JSONata but extended for:
- FHIR profile / element introspection
- Cardinality & primitive handling
- Pattern / fixed value enforcement
- Value set binding validation
- Structured diagnostics with policy‑driven severities

Fumifier compiles a FLASH expression string to an executable object, then evaluates it against input JSON, optionally enriched with a FHIR structure navigator.

---
## 2. Feature Highlights
- Modern ES Module implementation (Node ≥ 20)
- **AST Mobility** ⭐ **New in v1.0.0** – serialize/deserialize compiled expressions as JSON
- Async evaluation pipeline with selective short‑circuiting
- FLASH blocks & rules lowered into native evaluator stages
- Tuple streams & ancestry tracking for context‑rich transformations
- Policy‑driven diagnostics (throw / log / collect / validate levels)
- Built‑in logging helpers: `$trace`, `$info`, `$warn`
- Pluggable FHIR Structure Navigator (external package) for resolving StructureDefinition metadata, children, regex constraints, and value set expansions
- Selective / inhibited validation depending on severity thresholds
- Verbose evaluation mode returning a full diagnostics report instead of throwing
- Function chaining (`func1 ~> func2`), partial application, lambdas, higher‑order utilities
- Deterministic timestamp utilities `$now()`, `$millis()` bound per evaluation invocation

---
## 3. When to Use
Use Fumifier when you need:
- Declarative JSON / FHIR resource transformation & mapping
- Enriching raw FHIR payloads guided by profiles
- Validated outputs with controllable strictness
- Embedding a safe, sandbox‑style expression engine in higher‑level services

Not ideal if you only need simple field renaming (a static template may suffice) or extremely large streaming transformations (no streaming reader yet – whole objects are in memory).

---
## 4. Installation
```bash
npm install fumifier
```
(Verify name availability; if taken, consider a scoped package like `@fume-dsl/fumifier`.)

Node requirement: `>= 20` (see `package.json` engines field).

---
## 5. Quick Start
```js
import fumifier from 'fumifier';
import { createNavigator } from '@outburn/structure-navigator'; // example placeholder

const expr = `
  /* Simple example */
  {
    id: $.id,
    fullName: $.name.given[0] & ' ' & $.name.family,
    firstTwoCodes: $.code.coding[0..1].code
  }
`;

const navigator = await createNavigator({ /* supply FHIR package sources */ });
const compiled = await fumifier(expr, { navigator });

const input = {/* FHIR resource JSON */};
const output = await compiled.evaluate(input);
console.log(output);
```

Verbose (never throws controlled diagnostics):
```js
const report = await compiled.evaluateVerbose(input);
if (!report.ok) {
  console.warn('Partial/diagnostic status', report.status, report.diagnostics);
}
```

Custom thresholds per evaluation:
```js
const output = await compiled.evaluate(input, {
  throwLevel: 10,     // stricter: throw even on invalid
  logLevel: 40,       // log fatal/invalid/error/warning
  collectLevel: 70,   // collect all severities (default)
  validationLevel: 30 // run validations for severities < 30
});
```

---
## 6. FLASH DSL Overview (Very Brief)
FLASH extends JSONata‑style expressions with:
- Flash blocks / rules (prefix `[` lowering to unary nodes) controlling grouped evaluation
- FHIR element awareness (cardinality shaping, pattern & fixed value injection – some still on roadmap)
- Enhanced tuple streams for multi‑binding contexts (`@` root, indices, ancestry labels)
- Policy‑aware validation primitives

(Full language guide forthcoming.)

---
## 7. FHIR Integration & Structure Navigation
When the supplied expression contains FLASH constructs requiring FHIR knowledge (flagged during parse), a `navigator` must be provided. Fumifier then:
1. Resolves referenced StructureDefinitions (base + differential)
2. Caches compiled FHIR regex patterns
3. Resolves value set expansions (if requested by rules)
4. Attaches metadata collections onto the evaluation environment via well‑known Symbols.

If FLASH features are detected but no navigator is passed and recovery is disabled, an `F1000` error is raised.

---
## 8. Diagnostics, Threshold Policy & Verbose Mode
Severity (lower = more critical):
- fatal(0) < invalid(10) < error(20) < warning(30) < notice(40) < info(50) < debug(60)

Threshold variables (bindings) control behavior:
- `throwLevel` (default 30): throw when severity < level
- `logLevel` (40): log when severity < level
- `collectLevel` (70): collect into diagnostics bag when severity < level
- `validationLevel` (30): run a validation only if its severity < level

`evaluate(...)` throws once a diagnostic meets throw criteria. `evaluateVerbose(...)` never throws; it returns `{ ok, status, result, diagnostics }` where `status` (200/206/422) reflects collected severities.

See `PolicyThresholds.md` for deeper guidance.

---
## 9. API Reference
### `await fumifier(expressionText, options)`
### `await fumifier(astObject, options)` ⭐ **New in v1.0.0**
Returns a compiled expression object.

The fumifier function now accepts either:
- `expressionText: string` – FLASH/JSONata expression to parse and compile
- `astObject: Object` – Pre-parsed AST JSON to compile directly (**AST Mobility**)

`options`:
- `navigator?: FhirStructureNavigator` – required only if FLASH FHIR features are used.
- `recover?: boolean` – attempt AST recovery on syntax / resolution errors, collecting them instead of throwing.
- `verbose?: boolean` (reserved).

Compiled object methods:
- `evaluate(input, bindings?, callback?) -> Promise<any>`
- `evaluateVerbose(input, bindings?) -> Promise<{ ok, status, result, diagnostics }>`
- `assign(name, value)` – bind a variable prior to evaluation
- `registerFunction(name, implementation, signature?)` – register custom function (signature spec similar to JSONata)
- `setLogger(logger)` – supply object with `{ debug, info, warn, error }`
- `ast()` – returns internal AST
- `errors()` – returns compilation errors (if any)

### AST Mobility ⭐ **New in v1.0.0**
Fumifier now supports "AST mobility" - the ability to serialize and recreate compiled expressions:

```js
// 1. Create and extract AST
const expr1 = await fumifier('$x * 2 + $y');
const ast = expr1.ast();

// 2. Serialize AST to JSON
const astJson = JSON.stringify(ast);

// 3. Recreate expression from AST
const deserializedAst = JSON.parse(astJson);
const expr2 = await fumifier(deserializedAst);

// 4. Both expressions work identically
const result1 = await expr1.evaluate({}, { x: 5, y: 3 }); // 13
const result2 = await expr2.evaluate({}, { x: 5, y: 3 }); // 13
```

**Use Cases:**
- Cache compiled expressions as JSON for faster application startup
- Transfer expressions between processes, services, or storage systems
- Version control and database storage of transformation logic
- Hot-reload expressions without re-parsing
- Expression introspection and analysis tools

### Custom Bindings
Pass `bindings` to `evaluate` to set parameter variables or override thresholds (`throwLevel`, etc.).

### Signatures
Signatures follow `<argtypes:return>` style. Example: `<s?:u>` means optional string param returning undefined.

---
## 10. Custom Functions & Logging
```js
compiled.registerFunction('toUpper', function(v){ return String(v).toUpperCase(); }, '<s:s>');
```
Within a custom function `this` contains `{ environment, input }`.

Built‑in logging helpers produce diagnostics respecting thresholds:
- `$warn(message)` code `F5320`
- `$info(message)` code `F5500`
- `$trace(value?, label, projection?)` code `F5600` – returns original value for chaining

---
## 11. TypeScript Support
Types are published via `fumifier.d.ts`. (If missing, build pipeline will generate from `fumifier.ts` – ensure the file ships in the package.)
Example:
```ts
import fumifier, { type FumifierOptions } from 'fumifier';
const compiled = await fumifier('$.id', {} as FumifierOptions);
```

---
## 12. CLI / REPL (future)
Planned: `npx fumifier --expr file.fume --in input.json` for quick invocations & experimentation.

---
## 13. Performance Notes
- Avoid extremely large arrays where possible (range operator limited to 1e7 entries)
- Tail call optimization is implemented for lambdas returning thunks
- Regex compilation for FHIR primitives cached per compiled expression
- Parallelizable map phases flagged internally to reduce await churn (best effort)

---
## 14. Cached Parsing ⭐ **New**
Fumifier now supports caching of parsed expressions to improve performance when the same expressions are used repeatedly:

```javascript
import fumifier from 'fumifier';

// Uses default shared LRU cache (128MB limit)
const compiled = await fumifier('Patient.name.given');

// Provide custom AST cache implementation
const myAstCache = {
  // identity is an object: { source, version, recover, rootPackages? }
  async get(identity) { /* your get logic */ },
  async set(identity, value) { /* your set logic */ }
};
const compiled2 = await fumifier('Patient.name.given', { astCache: myAstCache });

// Cache identities include expression text, FHIR context, and fumifier version
// Concurrent requests for the same expression are deduplicated automatically
```

**Key Features:**
- **Default LRU Cache**: Shared across all fumifier instances with memory-based eviction
- **External Cache Support**: Implement `{ get, set }` interface for Redis, database, etc.
- **Smart Cache Identities**: Based on expression text, FHIR context, and fumifier version
- **Concurrent Deduplication**: Multiple requests for the same unparsed expression share results
- **$eval Inheritance**: Expressions evaluated via `$eval()` inherit the parent's cache

---
## 15. Roadmap
Tracking in `TODO.md`. Near‑term priorities:
- Date / DateTime canonicalization & strict validation
- Fixed value / pattern injection
- Required binding validation & system/unit injections
- Reference function `$reference()` shape validation
- Smarter cardinality enforcement & primitive conversions
- Expanded verbose diagnostics normalization

---
## 16. Contributing
1. Fork & clone
2. `npm install`
3. `npm test` (runs lint + install FSH test package + coverage)
4. Create feature branch (`feat/...` or `fix/...`)
5. Add / update tests under `test/`
6. Run coverage target: `npm run check-coverage`
7. Open PR with concise description & rationale

Coding standards: ESLint (config in repo) – aim for zero warnings. Commit messages: Conventional style (`feat:`, `fix:`, `chore:`...).

Security / PHI: Test data MUST NOT contain real patient information.

---
## 16. Versioning & Release Process
Semantic Versioning: MAJOR.MINOR.PATCH.

Suggested release workflow (GitHub + npm):
- Ensure `README`, `CHANGELOG` (add one), and `LICENSE` updated
- `npm run test` & `npm run check-coverage` must pass
- Update `package.json` version
- `git tag vX.Y.Z && git push --tags`
- `npm publish --access public`

Automate with GitHub Actions: matrix (Node 20, 22), run tests + coverage, publish on tag push if CI green.

---
## 17. License & Attribution
GNU Affero General Public License v3.0 (see `LICENSE`). Portions adapted from / inspired by JSONata (MIT). Include original JSONata notices where required.
FHIR® is the registered trademark of HL7 and is used with permission.

If you redistribute modified sources, retain attribution headers and provide a NOTICE file summarizing third‑party attributions.

---
## 18. Acknowledgements
- JSONata project for foundational expression evaluation concepts
- HL7 & FHIR community
- Contributors & early adopters of the FUME / FLASH ecosystem

---
## Minimal Example (Copy/Paste)
```js
import fumifier from 'fumifier';

const compiled = await fumifier('{ id: $.id, given: $.name.given[0] }');
const result = await compiled.evaluate({ id: '123', name: { given: ['Alice'] }});
console.log(result); // { id: '123', given: 'Alice' }
```

---
Issues & feedback: please open a GitHub issue once the public repository is live.